<script setup lang="ts">
/**
 * 我的中国足迹 · 等距立体浮雕地图
 *
 * 渲染思路（2.5D extrude，非 WebGL）：
 *  1. 几何由 scripts/gen-footprint-map.mjs 预计算（Albers 等积投影），运行时零计算；
 *  2. 每个省画 N 层「侧壁」+ 1 层「顶面」，侧壁逐层向下偏移形成厚度；
 *  3. 外层容器做 perspective + rotateX/rotateZ，平面 SVG 由此获得等距俯视的立体感；
 *  4. 省份按中心点纬度排序（北→南）绘制，满足画家算法，近处省份正确遮挡远处侧壁。
 *
 * 几何复用：省界与侧壁轮廓各只在 <defs> 里存一份，顶面 / 金色覆层 / 柔光 /
 * 省界 / 点击热区全部走 <use> 引用。34 个省若各画 4 遍完整省界，path 数据量翻
 * 数倍，拖视角时会明显掉帧。
 *
 * 「点亮」的表达：金色覆层铺满整个省形，比例只改**不透明度**。上一版用
 * 「半径按 sqrt(比例) 缩放的径向渐变」，结果只点亮 1/21 座城市的省只剩中心
 * 一小坨高亮，整张图读起来是故障热力图，不是足迹。
 *
 * 交互可靠性：点击热区是与顶面完全重合的原生 path（<use> 置于最上、透明填充），
 * 命中判定交给浏览器 path hit-test；港澳等亚像素区域额外补圆形放大热区。
 *
 * 动画全部交给 CSS transition：Vue 仅在点亮状态翻转时渲染一次，由浏览器合成器
 * 插值，避免每帧重建数百个节点的 vdom。
 */
import { computed, onMounted, ref } from 'vue';
import {
  FOOTPRINT_CITIES,
  FOOTPRINT_EXTRUDE,
  FOOTPRINT_GRATICULE_FRAME,
  FOOTPRINT_GRATICULE_LINES,
  FOOTPRINT_INSET_BOX,
  FOOTPRINT_NINE_DASH,
  FOOTPRINT_PROVINCES,
  FOOTPRINT_SOUTH_ISLANDS,
  FOOTPRINT_VIEWBOX,
  type FootprintCityGeom,
} from '../../data/chinaFootprintGeom';
import {
  AMBIENT_COOL,
  AMBIENT_EDGE,
  AMBIENT_WARM,
  CITY_DOT,
  CITY_GLOW_IN,
  CITY_GLOW_OUT,
  CITY_HALO,
  CITY_RIPPLE,
  CITY_RING,
  EDGE_DIM,
  EDGE_HOVER,
  EDGE_LIT,
  EDGE_W_DIM,
  EDGE_W_HOVER,
  EDGE_W_LIT,
  GRATICULE,
  GRATICULE_FRAME,
  INSET_BG,
  INSET_BORDER,
  INSET_DASH,
  INSET_ISLAND,
  INSET_ISLAND_LINE,
  INSET_LABEL,
  RIM_GLOW,
  RIM_GLOW_W,
  TOP_DIM_GRADS,
  TOP_LIT_GRADS,
  WALL,
  WALL_LIT,
} from '../../data/footprintPalette';

/** 视频逐帧渲染时的一帧状态 */
export interface FootprintFrameState {
  /** adcode → 该省本帧的点亮比例 0..1；缺省或 0 表示未点亮 */
  ratios: Record<number, number>;
  /** 本帧已出现的城市 adcode */
  cities: number[];
  /** 镜头角度（度）与缩放 */
  camera: { rx: number; rz: number; zoom: number };
  /** 整幅不透明度，片头淡入用 */
  alpha?: number;
}

const props = defineProps<{
  /** 城市模式下已点亮的城市名 */
  litCities: string[];
  /** 省份模式下已点亮的省名 */
  litProvinces: string[];
  mode: 'city' | 'province';
}>();

const emit = defineEmits<{
  (e: 'province-click', name: string): void;
}>();

/** 渐变与 path 的 id 前缀：同页可能出现第二份实例（导出时），避免撞名 */
const uid = `fp${Math.random().toString(36).slice(2, 7)}`;
const pid = (adcode: number) => `${uid}-p${adcode}`;
const cid = (adcode: number) => `${uid}-c${adcode}`;
const dimId = (i: number) => `${uid}-dim${i}`;
const litId = (i: number) => `${uid}-lit${i}`;

const VB_W = FOOTPRINT_VIEWBOX.w;
const VB_H = FOOTPRINT_VIEWBOX.h;
const LAYERS = FOOTPRINT_EXTRUDE.layers;
const STEP = FOOTPRINT_EXTRUDE.step;
/** 侧壁层序号：0 紧贴顶面 → LAYERS-1 位于最底 */
const LAYER_KEYS = Array.from({ length: LAYERS }, (_, i) => i);
const N_SHADE = TOP_DIM_GRADS.length;

// ── 静态派生 ──────────────────────────────────────────────────────────────
const cityByName = new Map<string, FootprintCityGeom>(
  FOOTPRINT_CITIES.map((c) => [c.name, c]),
);
const cityTotalByProvince = new Map<string, number>();
for (const c of FOOTPRINT_CITIES) {
  cityTotalByProvince.set(c.province, (cityTotalByProvince.get(c.province) ?? 0) + 1);
}
/** 港澳在等距视角下不足 1px，补一个以中心为圆点的放大热区 */
const TINY_REGIONS = new Set([810000, 820000]);

// ── 视角状态 ──────────────────────────────────────────────────────────────
const DEFAULT_VIEW = { rx: 50, rz: -6, zoom: 1.06 };
const view = ref({ ...DEFAULT_VIEW });
const flat = ref(false);
/** 入场：从高空缓缓落到默认机位，仅首屏生效 */
const intro = ref(true);
const dragging = ref(false);
const stageRef = ref<HTMLElement | null>(null);
/** 累计位移，用于区分「点击省份」与「拖拽转视角」 */
let moved = 0;
let dragStart = { x: 0, y: 0, rx: 0, rz: 0 };
/** 是否已升级为拖拽（拿到指针捕获） */
let captured = false;
/** 超过该位移即视为拖拽视角，而非点击省份 */
const DRAG_THRESHOLD = 5;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
function onPointerDown(e: PointerEvent) {
  if (flat.value) return;
  dragging.value = true;
  moved = 0;
  captured = false;
  dragStart = { x: e.clientX, y: e.clientY, rx: view.value.rx, rz: view.value.rz };
  // 这里不能立刻 setPointerCapture：指针捕获会把随后的 click 重定向到捕获元素
  // （舞台容器），省份 path 上的点击处理器就收不到事件。确认是拖拽之后再捕获。
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
  if (moved <= DRAG_THRESHOLD) return;
  if (!captured) {
    captured = true;
    stageRef.value?.setPointerCapture(e.pointerId);
  }
  view.value.rz = clamp(dragStart.rz + dx * 0.16, -44, 44);
  view.value.rx = clamp(dragStart.rx - dy * 0.13, 0, 74);
}
function onPointerUp(e: PointerEvent) {
  dragging.value = false;
  if (captured) {
    captured = false;
    const el = stageRef.value;
    if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }
}
function onWheel(e: WheelEvent) {
  e.preventDefault();
  view.value.zoom = clamp(view.value.zoom - e.deltaY * 0.0012, 0.72, 2.4);
}
function resetView() {
  view.value = { ...DEFAULT_VIEW };
}
function toggleFlat() {
  flat.value = !flat.value;
}

// ── 点亮状态 ──────────────────────────────────────────────────────────────
const hoverAdcode = ref<number | null>(null);
/** 入场错峰：挂载后一帧即归零，避免之后每次点亮都要排队等动画 */
const entered = ref(false);

onMounted(() => {
  // 先以「高空机位 + 未铺开的大地」画出一帧，再落到默认机位、铺开金色
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      intro.value = false;
      entered.value = true;
    });
  });
});

const litProvinceSet = computed(() => new Set(props.litProvinces));

const litByProvince = computed(() => {
  const m = new Map<string, FootprintCityGeom[]>();
  for (const name of props.litCities) {
    const c = cityByName.get(name);
    if (!c) continue;
    const arr = m.get(c.province);
    if (arr) arr.push(c);
    else m.set(c.province, [c]);
  }
  return m;
});

/** 某省的铺满比例 0~1：省份模式取 0/1，城市模式取「已点亮城市 / 该省城市总数」 */
function ratioOf(name: string): number {
  if (props.mode === 'province') return litProvinceSet.value.has(name) ? 1 : 0;
  const total = cityTotalByProvince.get(name) ?? 0;
  if (!total) return 0;
  return Math.min(1, (litByProvince.value.get(name)?.length ?? 0) / total);
}

/**
 * 比例 → 金色覆层不透明度。
 *
 * 起点必须高（0.55）：低不透明度的暖金叠在暗底上不会变「淡金」，只会变灰。
 * 所以「刚涉足」就直接给一块实的暖赭金，「走满」再往上亮到饱和金——
 * 深浅表达覆盖度，材质本身始终读作金色。上一版把起点压到 0.16，
 * 结果 28 个省全是同一种奶茶灰，既不像金也看不出走过多少。
 */
function goldOpacity(ratio: number): number {
  if (ratio <= 0) return 0;
  return Number((0.55 + 0.42 * Math.pow(ratio, 0.6)).toFixed(3));
}

/**
 * 比例 → 板块抬升量（viewBox 单位）。
 * 单独成函数，是为了让逐帧导出能按「这一帧的比例」重算抬升：
 * 克隆出来的节点带着现场的 transform，若某省在这一帧还没点亮却仍然浮着，
 * 板块之间就会错开，露出一道一道不该有的黑缝。
 */
function liftOf(ratio: number, hovered = false): number {
  if (ratio > 0) return -(5 + 9 * Math.sqrt(ratio));
  return hovered ? -3 : 0;
}

interface RenderProvince {
  name: string;
  adcode: number;
  cx: number;
  cy: number;
  /** 金色覆层：铺满外接框的矩形，被省形 clipPath 裁切 */
  rect: { x: number; y: number; w: number; h: number };
  ratio: number;
  lit: boolean;
  op: number;
  lift: number;
  delayMs: number;
  /** 取哪一档全局光照渐变；相邻省错档，打破同色死板 */
  shade: number;
}

const renderProvinces = computed<RenderProvince[]>(() =>
  FOOTPRINT_PROVINCES.map((p, i) => {
    const ratio = ratioOf(p.name);
    const lit = ratio > 0;
    // 点亮即抬升：走满的省浮得最高，形成「走过的地块亮着、浮着」的层次
    const lift = liftOf(ratio, hoverAdcode.value === p.adcode);
    const [x1, y1, x2, y2] = p.box;
    return {
      name: p.name,
      adcode: p.adcode,
      cx: p.cx,
      cy: p.cy,
      rect: { x: x1 - 1, y: y1 - 1, w: x2 - x1 + 2, h: y2 - y1 + 2 },
      ratio,
      lit,
      op: goldOpacity(ratio),
      lift,
      delayMs: entered.value ? 0 : 220 + i * 20,
      shade: p.adcode % N_SHADE,
    };
  }),
);

/** 城市光点按省分组，整体跟随所属省份抬升，避免「浮在半空」 */
const cityGroups = computed(() => {
  const provOf = new Map(renderProvinces.value.map((p) => [p.name, p]));
  return Array.from(litByProvince.value.entries())
    .map(([province, cities]) => ({
      province,
      adcode: provOf.get(province)?.adcode ?? 0,
      cities,
    }))
    .filter((g) => g.cities.length);
});

const touchedProvinces = computed(() => litByProvince.value.size);

function onProvinceClick(name: string) {
  // 拖拽视角收尾时不应误点亮
  if (moved > DRAG_THRESHOLD) return;
  emit('province-click', name);
}
function onProvinceEnter(adcode: number) {
  hoverAdcode.value = adcode;
}
function onProvinceLeave(adcode: number) {
  if (hoverAdcode.value === adcode) hoverAdcode.value = null;
}

function provinceStat(name: string) {
  return {
    total: cityTotalByProvince.get(name) ?? 0,
    lit: litByProvince.value.get(name)?.length ?? 0,
  };
}
const hoverProvince = computed(
  () => renderProvinces.value.find((p) => p.adcode === hoverAdcode.value) ?? null,
);

function getView() {
  return {
    rx: flat.value ? 0 : view.value.rx,
    rz: flat.value ? 0 : view.value.rz,
    zoom: flat.value ? 1 : view.value.zoom,
  };
}

const stageTransform = computed(() => {
  if (flat.value) return `scale(${view.value.zoom})`;
  const v = intro.value ? { rx: 72, rz: -22, zoom: 1.02 } : view.value;
  return `rotateX(${v.rx}deg) rotateZ(${v.rz}deg) scale(${v.zoom})`;
});

// ── 逐帧导出：给视频合成器用 ──────────────────────────────────────────────
const svgRef = ref<SVGSVGElement | null>(null);

/**
 * 生成某一帧的独立 SVG 字符串。
 *
 * 帧里只做「减少」不做「增加」：视频演的是已经走过的路，所以任意一帧的点亮
 * 集合必然是当前画面的子集，从活的 DOM 克隆就够，无需在此重建几何。
 * 相机是容器级 CSS perspective，克隆带不走，故烘焙成正交变换写进 transform 属性。
 *
 * out 是输出的像素尺寸，fit 是要框进画面的 viewBox 用户单位尺寸（缺省等于 out）。
 * 两者分开，调用方才能「按内容包围盒取景、按画布尺寸出图」而不互相牵制。
 */
function buildFrameSvg(
  state: FootprintFrameState,
  out: { w: number; h: number },
  fit?: { w: number; h: number },
): string {
  const source = svgRef.value;
  if (!source) throw new Error('地图尚未就绪');
  const clone = source.cloneNode(true) as SVGSVGElement;

  clone.querySelectorAll('.fp-hit').forEach((el) => el.remove());

  const wantCities = new Set(state.cities);
  clone.querySelectorAll<SVGGElement>('[data-city]').forEach((el) => {
    if (!wantCities.has(Number(el.dataset.city))) {
      el.remove();
      return;
    }
    // 呼吸/涟漪的中间态由 CSS 关键帧决定，序列化带不走；导出时固定成常态亮度
    el.querySelectorAll('[data-part]').forEach((p) => p.removeAttribute('style'));
    el.removeAttribute('data-city');
    el.removeAttribute('style');
  });
  // 城市光点跟着所属省份在这一帧的抬升量走
  clone.querySelectorAll<SVGGElement>('[data-cgrp]').forEach((el) => {
    const lift = liftOf(state.ratios[Number(el.dataset.cgrp)] ?? 0);
    el.removeAttribute('style');
    if (lift) el.setAttribute('transform', `translate(0 ${lift.toFixed(2)})`);
    else el.removeAttribute('transform');
    el.removeAttribute('data-cgrp');
  });

  // 侧壁批次：换色 + 跟着本帧的抬升量走
  clone.querySelectorAll<SVGGElement>('[data-provw]').forEach((el) => {
    const adcode = Number(el.dataset.provw);
    const lit = (state.ratios[adcode] ?? 0) > 0;
    el.querySelectorAll<SVGElement>('[data-wall]').forEach((w) => {
      w.setAttribute('fill', (lit ? WALL_LIT : WALL)[Number(w.dataset.wall)]);
    });
    const lift = liftOf(state.ratios[adcode] ?? 0);
    el.removeAttribute('style');
    if (lift) el.setAttribute('transform', `translate(0 ${lift.toFixed(2)})`);
    else el.removeAttribute('transform');
    el.removeAttribute('data-provw');
  });

  clone.querySelectorAll<SVGGElement>('[data-prov]').forEach((el) => {
    const adcode = Number(el.dataset.prov);
    const ratio = state.ratios[adcode] ?? 0;
    const gold = el.querySelector<SVGElement>('[data-gold]');
    const rim = el.querySelector<SVGElement>('[data-rim]');
    const edge = el.querySelector<SVGElement>('[data-edge]');
    const top = el.querySelector<SVGElement>('[data-top]');
    const lit = ratio > 0;
    if (lit) {
      const op = goldOpacity(ratio);
      // 整体改写 style：现场那份带着 scale(0.72) 与 transition-delay，
      // 未点亮的省在这一帧可能已经点亮，留着就会缩成一小块
      gold?.setAttribute('style', `opacity:${op}`);
      if (rim) rim.setAttribute('style', `opacity:${Math.min(1, op * 1.15)}`);
      edge?.setAttribute('stroke', EDGE_LIT);
      edge?.setAttribute('stroke-width', String(EDGE_W_LIT));
    } else {
      gold?.remove();
      rim?.remove();
      edge?.setAttribute('stroke', EDGE_DIM);
      edge?.setAttribute('stroke-width', String(EDGE_W_DIM));
    }
    top?.setAttribute('fill', `url(#${(lit ? litId : dimId)(adcode % N_SHADE)})`);
    // 抬升量按本帧比例重算：CSS transform 优先级高于属性，必须先清掉 inline style
    const lift = liftOf(ratio);
    el.removeAttribute('style');
    if (lift) el.setAttribute('transform', `translate(0 ${lift.toFixed(2)})`);
    else el.removeAttribute('transform');
    el.removeAttribute('data-prov');
  });

  const cx = VB_W / 2;
  const cy = VB_H / 2;
  const sy = Math.cos((state.camera.rx * Math.PI) / 180);
  const z = state.camera.zoom;
  const warp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  warp.setAttribute(
    'transform',
    `translate(${cx} ${cy}) scale(${z} ${(z * sy).toFixed(4)}) rotate(${state.camera.rz.toFixed(2)}) translate(${-cx} ${-cy})`,
  );
  while (clone.firstChild) warp.appendChild(clone.firstChild);
  clone.appendChild(warp);

  clone.removeAttribute('class');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(out.w));
  clone.setAttribute('height', String(out.h));
  const fw = fit?.w ?? out.w;
  const fh = fit?.h ?? out.h;
  clone.setAttribute(
    'viewBox',
    `${(cx - fw / 2).toFixed(1)} ${(cy - fh / 2).toFixed(1)} ${fw.toFixed(1)} ${fh.toFixed(1)}`,
  );
  if (state.alpha !== undefined && state.alpha < 1) {
    clone.style.setProperty('opacity', state.alpha.toFixed(3));
  }
  return new XMLSerializer().serializeToString(clone);
}

defineExpose({ resetView, toggleFlat, getView, touchedProvinces, buildFrameSvg });
</script>

<template>
  <div class="fp3" :class="{ 'is-flat': flat, 'is-ready': !intro }">
    <div
      ref="stageRef"
      class="fp3-stage"
      :class="{ 'is-dragging': dragging }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onWheel"
    >
      <div class="fp3-plane" :style="{ transform: stageTransform }">
        <svg
          ref="svgRef"
          class="fp3-svg"
          :viewBox="`0 0 ${VB_W} ${VB_H}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="中国旅行足迹立体地图"
        >
          <defs>
            <!-- 大陆之下的氛围光：冷蓝托底，右下角一丝暖金，避免深底死板 -->
            <radialGradient :id="`${uid}-amb`" cx="50%" cy="46%" r="62%">
              <stop offset="0%" :stop-color="AMBIENT_COOL" />
              <stop offset="100%" :stop-color="AMBIENT_EDGE" />
            </radialGradient>
            <radialGradient :id="`${uid}-amb-warm`" cx="62%" cy="70%" r="46%">
              <stop offset="0%" :stop-color="AMBIENT_WARM" />
              <stop offset="100%" :stop-color="AMBIENT_EDGE" />
            </radialGradient>
            <!-- 城市暖光：objectBoundingBox 单位，跟着 circle 的 r 走，一处定义全站复用 -->
            <radialGradient :id="`${uid}-glow`">
              <stop offset="0%" :stop-color="CITY_GLOW_IN" />
              <stop offset="55%" :stop-color="CITY_GLOW_IN" stop-opacity="0.45" />
              <stop offset="100%" :stop-color="CITY_GLOW_OUT" />
            </radialGradient>

            <!-- 全局光照：未点亮（冷石墨）与已点亮（香槟金）各两档，相邻省错档 -->
            <linearGradient
              v-for="(g, i) in TOP_DIM_GRADS"
              :id="dimId(i)"
              :key="`dim-${i}`"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              :x2="VB_W"
              :y2="VB_H"
            >
              <stop offset="0%" :stop-color="g[0]" />
              <stop offset="100%" :stop-color="g[1]" />
            </linearGradient>
            <linearGradient
              v-for="(g, i) in TOP_LIT_GRADS"
              :id="litId(i)"
              :key="`lit-${i}`"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              :x2="VB_W"
              :y2="VB_H"
            >
              <stop offset="0%" :stop-color="g[0]" />
              <stop offset="100%" :stop-color="g[1]" />
            </linearGradient>

            <!-- 省界与侧壁轮廓各存一份，其余全靠 <use> 引用 -->
            <path
              v-for="p in FOOTPRINT_PROVINCES"
              :id="pid(p.adcode)"
              :key="`d-${p.adcode}`"
              :d="p.d"
            />
            <clipPath v-for="p in FOOTPRINT_PROVINCES" :id="cid(p.adcode)" :key="`c-${p.adcode}`">
              <use :href="`#${pid(p.adcode)}`" />
            </clipPath>
          </defs>

          <!-- ⓪ 氛围光 + 测绘底图（经纬网与图幅边框） -->
          <g class="fp3-sheet">
            <ellipse
              :cx="VB_W / 2"
              :cy="VB_H * 0.46"
              :rx="VB_W * 0.52"
              :ry="VB_H * 0.42"
              :fill="`url(#${uid}-amb)`"
            />
            <ellipse
              :cx="VB_W * 0.62"
              :cy="VB_H * 0.7"
              :rx="VB_W * 0.4"
              :ry="VB_H * 0.32"
              :fill="`url(#${uid}-amb-warm)`"
            />
            <path
              v-for="(line, i) in FOOTPRINT_GRATICULE_LINES"
              :key="`grat-${i}`"
              :d="line"
              fill="none"
              :stroke="GRATICULE"
              stroke-width="0.8"
            />
            <path
              :d="FOOTPRINT_GRATICULE_FRAME"
              fill="none"
              :stroke="GRATICULE_FRAME"
              stroke-width="1"
            />
          </g>

          <!-- ① 立体省份。分两趟画：先把所有侧壁画完，再画所有顶面。
               合成一趟会出问题——南侧省份的侧壁是自身轮廓向下平移得到的，
               省界一旦有凹陷，这条侧壁就会探进北侧省份的领地，把人家刚画好的
               金色顶面糊成一块黑。拆成两趟后侧壁永远在顶面之下，
               厚度只留在大陆外缘，内部省界不再出现「假悬崖」。 -->
          <g class="fp3-walls">
            <g
              v-for="p in renderProvinces"
              :key="`wallg-${p.adcode}`"
              :data-provw="p.adcode"
              class="fp3-prov"
              :style="{ transform: `translateY(${p.lift}px)` }"
            >
              <use
                v-for="k in LAYER_KEYS"
                :key="`wall-${p.adcode}-${k}`"
                :data-wall="k"
                class="fp3-wall"
                :href="`#${pid(p.adcode)}`"
                :fill="(p.lit ? WALL_LIT : WALL)[k]"
                :transform="`translate(0 ${(k + 1) * STEP})`"
              />
            </g>
          </g>
          <g class="fp3-tops">
            <g
              v-for="p in renderProvinces"
              :key="`prov-${p.adcode}`"
              :data-prov="p.adcode"
              class="fp3-prov"
              :class="{ 'is-hover': hoverAdcode === p.adcode }"
              :style="{ transform: `translateY(${p.lift}px)` }"
            >
              <!-- 顶面底色 -->
              <use
                data-top
                class="fp3-top"
                :href="`#${pid(p.adcode)}`"
                :fill="`url(#${dimId(p.shade)})`"
              />
              <!-- 金色覆层：铺满外接框的矩形，被省形裁切；比例只调不透明度 -->
              <g :clip-path="`url(#${cid(p.adcode)})`">
                <rect
                  data-gold
                  class="fp3-gold"
                  :x="p.rect.x"
                  :y="p.rect.y"
                  :width="p.rect.w"
                  :height="p.rect.h"
                  :fill="`url(#${litId(p.shade)})`"
                  :style="{
                    opacity: p.op,
                    transformOrigin: `${p.cx}px ${p.cy}px`,
                    transform: `scale(${p.lit ? 1 : 0.72})`,
                    transitionDelay: `${p.delayMs}ms`,
                  }"
                />
              </g>
              <!-- 已点亮省份外扩的柔光轮廓：粗描边假光，不用 filter，导出可原样带走。
                   fill=none 必须写成属性——导出走 SVG 序列化，scoped CSS 带不走，
                   漏写就会用默认黑色把整块陆地糊掉。 -->
              <use
                data-rim
                class="fp3-rim"
                :href="`#${pid(p.adcode)}`"
                fill="none"
                :stroke="RIM_GLOW"
                :stroke-width="RIM_GLOW_W"
                :style="{ opacity: p.lit ? 1 : 0 }"
              />
              <!-- 省界 -->
              <use
                data-edge
                class="fp3-edge"
                :href="`#${pid(p.adcode)}`"
                fill="none"
                :stroke="hoverAdcode === p.adcode ? EDGE_HOVER : p.lit ? EDGE_LIT : EDGE_DIM"
                :stroke-width="
                  hoverAdcode === p.adcode
                    ? EDGE_W_HOVER
                    : p.lit
                      ? EDGE_W_LIT
                      : EDGE_W_DIM
                "
              />
            </g>
          </g>

          <!-- ② 城市光点：光晕 + 涟漪 + 内环 + 实心点，整体跟随所属省份抬升 -->
          <g class="fp3-cities">
            <g
              v-for="g in cityGroups"
              :key="`cg-${g.province}`"
              :data-cgrp="g.adcode"
              :style="{ transform: `translateY(${liftOf(ratioOf(g.province))}px)` }"
            >
              <g
                v-for="(c, ci) in g.cities"
                :key="`city-${c.adcode}`"
                :data-city="c.adcode"
                class="fp3-city"
              >
                <circle
                  data-part
                  :cx="c.x"
                  :cy="c.y"
                  r="21"
                  :fill="`url(#${uid}-glow)`"
                  class="fp3-glow"
                />
                <circle data-part :cx="c.x" :cy="c.y" r="9.5" :fill="CITY_HALO" class="fp3-halo" />
                <circle
                  data-part
                  class="fp3-ripple"
                  :cx="c.x"
                  :cy="c.y"
                  r="4"
                  fill="none"
                  :stroke="CITY_RIPPLE"
                  stroke-width="0.8"
                  :style="{ animationDelay: `${((ci + g.cities.length) % 9) * 0.6}s` }"
                />
                <circle
                  data-part
                  class="fp3-ring"
                  :cx="c.x"
                  :cy="c.y"
                  r="4.2"
                  fill="none"
                  :stroke="CITY_RING"
                  stroke-width="0.8"
                />
                <circle data-part :cx="c.x" :cy="c.y" r="2" :fill="CITY_DOT" />
              </g>
            </g>
          </g>

          <!-- ③ 南海诸岛附图（国家标准地图表达方式）：九段线 + 岛礁 -->
          <g :transform="`translate(${FOOTPRINT_INSET_BOX.x} ${FOOTPRINT_INSET_BOX.y})`">
            <rect
              :width="FOOTPRINT_INSET_BOX.w"
              :height="FOOTPRINT_INSET_BOX.h"
              rx="3"
              :fill="INSET_BG"
              :stroke="INSET_BORDER"
              stroke-width="0.8"
            />
            <path
              :d="FOOTPRINT_SOUTH_ISLANDS"
              :fill="INSET_ISLAND"
              :stroke="INSET_ISLAND_LINE"
              stroke-width="0.35"
            />
            <path
              :d="FOOTPRINT_NINE_DASH"
              fill="none"
              :stroke="INSET_DASH"
              stroke-width="1.3"
              stroke-dasharray="6 4"
              stroke-linecap="round"
            />
            <text
              :x="FOOTPRINT_INSET_BOX.w / 2"
              :y="FOOTPRINT_INSET_BOX.h - 5"
              :fill="INSET_LABEL"
              font-size="8"
              letter-spacing="1.2"
              text-anchor="middle"
              font-family="'HarmonyOS Sans SC','PingFang SC','Microsoft YaHei',sans-serif"
            >
              南海诸岛
            </text>
          </g>

          <!-- ④ 点击热区：透明 <use> 覆盖于最上层，命中交给浏览器原生 path hit-test -->
          <g class="fp-hit">
            <g v-for="p in renderProvinces" :key="`hit-${p.adcode}`">
              <use
                :href="`#${pid(p.adcode)}`"
                class="fp-hit__path"
                @click.stop="onProvinceClick(p.name)"
                @mouseenter="onProvinceEnter(p.adcode)"
                @mouseleave="onProvinceLeave(p.adcode)"
              />
              <!-- 港澳等亚像素区域：补圆形放大热区，保证一定点得到 -->
              <circle
                v-if="TINY_REGIONS.has(p.adcode)"
                :cx="p.cx"
                :cy="p.cy"
                r="16"
                class="fp-hit__path"
                @click.stop="onProvinceClick(p.name)"
                @mouseenter="onProvinceEnter(p.adcode)"
                @mouseleave="onProvinceLeave(p.adcode)"
              />
            </g>
          </g>
        </svg>
      </div>

      <!-- 机位控件：贴在舞台右上角的玻璃胶囊，不与地图抢画面 -->
      <div class="fp3-cam">
        <button
          type="button"
          class="fp3-cam__btn"
          :disabled="flat"
          title="回到默认机位"
          @click="resetView"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"
            />
          </svg>
          <span>复位</span>
        </button>
        <button
          type="button"
          class="fp3-cam__btn"
          :class="{ 'is-on': flat }"
          :title="flat ? '恢复立体视角' : '切换为平面地图'"
          @click="toggleFlat"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 3l8 4.5-8 4.5-8-4.5L12 3zM4 12.5 12 17l8-4.5"
            />
          </svg>
          <span>{{ flat ? '立体' : '平面' }}</span>
        </button>
      </div>
      <span v-if="!flat" class="fp3-hint">拖拽旋转 · 滚轮缩放</span>
    </div>

    <!-- hover 浮层：放在 3D 容器之外，不受透视变形影响，文字始终正向可读 -->
    <transition name="fp3-tip">
      <div v-if="hoverProvince" class="fp3-tipcard" :class="{ 'is-lit': hoverProvince.lit }">
        <strong>{{ hoverProvince.name }}</strong>
        <span v-if="mode === 'city'">
          已点亮 {{ provinceStat(hoverProvince.name).lit }} /
          {{ provinceStat(hoverProvince.name).total }} 座
        </span>
        <span v-else>{{ hoverProvince.lit ? '已点亮' : '未到访' }}</span>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.fp3 {
  position: relative;
}

/* ── 3D 舞台 ─────────────────────────────────────────────────────────────
   aspect-ratio 按「rotateX 压缩 + rotateZ 旋转后」的视觉包围盒反推：
   陆地本身在 viewBox 里接近 1:0.87，rotateX(50°) 纵向压到 0.64 → 视觉约 1:0.62。
   用 1:0.86 之类平面比例会让压缩后的地图缩在舞台中上部、下方大片留白。 */
.fp3-stage {
  position: relative;
  aspect-ratio: 1 / 0.62;
  min-height: 420px;
  max-height: 74vh;
  perspective: 1700px;
  perspective-origin: 50% 44%;
  cursor: grab;
  touch-action: none;
  overflow: hidden;
  border-radius: var(--radius-md);
  /* 舞台自身有一束顶光：板块从亮处浮出、向四周沉入夜色，而不是贴在卡片上 */
  background:
    radial-gradient(120% 86% at 50% 26%, #16202e 0%, #0c1119 52%, #070a10 100%);
}
.fp3-stage.is-dragging {
  cursor: grabbing;
}
.fp3.is-flat .fp3-stage {
  cursor: default;
  perspective: none;
}

.fp3-plane {
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transition: transform var(--dur-slower) var(--ease-emphasized);
  will-change: transform;
}
/* 入场是一次从高空落下的镜头运动，给足时间；落地后拖拽必须跟手 */
.fp3:not(.is-ready) .fp3-plane {
  transition: transform 1700ms cubic-bezier(0.16, 0.8, 0.28, 1);
}
.fp3-stage.is-dragging .fp3-plane {
  transition: none;
}

.fp3-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* ── 底图装饰层：随镜头落地一起浮现 ─────────────────────────────────────── */
.fp3-sheet {
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-slower) var(--ease-standard) var(--dur-base);
}
.fp3.is-ready .fp3-sheet {
  opacity: 1;
}

/* ── 省份 ──────────────────────────────────────────────────────────────── */
.fp3-prov {
  transition: transform 620ms cubic-bezier(0.22, 1, 0.32, 1);
}
.fp3-wall {
  stroke: none;
  pointer-events: none;
}
.fp3-top {
  pointer-events: none;
  transition: filter var(--dur-base) var(--ease-standard);
}
.fp3-gold {
  pointer-events: none;
  transition:
    opacity 900ms cubic-bezier(0.22, 1, 0.32, 1),
    transform 900ms cubic-bezier(0.22, 1, 0.32, 1);
}
.fp3-rim {
  pointer-events: none;
  transition: opacity var(--dur-slow) var(--ease-standard);
}
.fp3-edge {
  pointer-events: none;
  stroke-linejoin: round;
  transition: stroke var(--dur-base) var(--ease-standard);
}

/* hover：顶面提亮并描出一圈冷光，与「已点亮」的暖金区分开 */
.fp3-prov.is-hover {
  filter: drop-shadow(0 0 9px rgba(120, 170, 225, 0.2));
}
.fp3-prov.is-hover .fp3-top {
  filter: brightness(1.4);
}

/* ── 城市光点 ──────────────────────────────────────────────────────────── */
.fp3-cities {
  pointer-events: none;
}
/* 新点亮的城市「长」出来：由节点挂载触发，无需额外状态机 */
.fp3-city {
  animation: fp3-pop 620ms cubic-bezier(0.34, 1.4, 0.64, 1);
}
.fp3-halo {
  animation: fp3-breathe 4.2s ease-in-out infinite;
}
.fp3-ripple {
  animation: fp3-ripple 5.4s ease-out infinite;
}
/* 呼吸与涟漪以自身为原点缩放 */
.fp3-halo,
.fp3-ripple {
  transform-box: fill-box;
  transform-origin: center;
}
@keyframes fp3-pop {
  from {
    opacity: 0;
    transform: scale(0.2);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes fp3-breathe {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1.16);
  }
}
@keyframes fp3-ripple {
  0% {
    opacity: 0.45;
    transform: scale(0.6);
  }
  68%,
  100% {
    opacity: 0;
    transform: scale(3.2);
  }
}

/* ── 点击热区 ──────────────────────────────────────────────────────────── */
.fp-hit__path {
  fill: transparent;
  stroke: transparent;
  cursor: pointer;
}

/* ── 机位控件与操作提示 ────────────────────────────────────────────────── */
.fp3-cam {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  z-index: 2;
  display: flex;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-lg);
  background: var(--surface-scrim);
  border: 1px solid var(--line-hairline);
  box-shadow: var(--elev-float);
  backdrop-filter: blur(var(--glass-blur-tile)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur-tile)) saturate(var(--glass-saturate));
}
.fp3-cam__btn {
  position: relative; /* ::after 命中区以按钮自身为基准（否则会盖住相邻按钮） */
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font-family: inherit;
  font-size: var(--fs-cap);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}
/* 视觉 32px、命中 ≥44px（触屏可用性） */
.fp3-cam__btn::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: max(100%, var(--hit-min));
  height: max(100%, var(--hit-min));
  transform: translate(-50%, -50%);
}
.fp3-cam__btn:hover:not(:disabled) {
  background: var(--interactive-hover);
  color: var(--text-1);
}
.fp3-cam__btn:active:not(:disabled) {
  background: var(--interactive-pressed);
}
.fp3-cam__btn.is-on {
  background: var(--accent-soft);
  color: var(--accent-hover);
}
.fp3-cam__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fp3-hint {
  position: absolute;
  right: var(--space-4);
  bottom: var(--space-3);
  z-index: 2;
  font-size: var(--fs-micro);
  color: var(--text-3);
  pointer-events: none;
}

/* ── hover 浮层 ────────────────────────────────────────────────────────── */
.fp3-tipcard {
  position: absolute;
  left: var(--space-4);
  bottom: var(--space-4);
  z-index: 2;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-scrim);
  border: 1px solid var(--line-default);
  box-shadow: var(--elev-float);
  backdrop-filter: blur(var(--glass-blur-tile)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur-tile)) saturate(var(--glass-saturate));
  pointer-events: none;
}
.fp3-tipcard strong {
  font-size: var(--fs-meta);
  font-weight: 600;
  color: var(--text-1);
}
.fp3-tipcard.is-lit strong {
  color: var(--ticket-gold-bright);
}
.fp3-tipcard span {
  font-size: var(--fs-cap);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.fp3-tip-enter-active,
.fp3-tip-leave-active {
  transition: opacity var(--dur-fast) var(--ease-standard);
}
.fp3-tip-enter-from,
.fp3-tip-leave-to {
  opacity: 0;
}

@media (max-width: 839px) {
  /* 手机竖屏：min-height + aspect-ratio 会反推宽度（320/0.74≈432px）撑破容器，
     改为显式高度，宽度恒随父容器（横屏 / 平板回到比例模式） */
  .fp3-stage {
    aspect-ratio: auto;
    height: min(84vw, 480px);
    min-height: 320px;
    max-height: 74vh;
  }
  .fp3-hint {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fp3-prov,
  .fp3-gold,
  .fp3-rim,
  .fp3-plane,
  .fp3-sheet {
    transition-duration: 0.01ms;
  }
  .fp3-city,
  .fp3-halo,
  .fp3-ripple {
    animation: none;
  }
}
</style>
