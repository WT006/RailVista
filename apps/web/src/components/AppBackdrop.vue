<script setup lang="ts">
/**
 * 全站统一背景层（挂在 App.vue，跨路由唯一实例）。
 *
 * 为什么从"每页各挂一个"改成 App 级单例：
 *   1. 路由切换时页面级背景会被销毁重建，视觉上是背景"跳一下"；
 *   2. 铁路页用 ChinaBackdropMap、自驾 6 页用 DriveBackdropMap，两套实现已经分叉，
 *      新增页面容易再复制第三套（v0.4.0 就发生过一次）；
 *   3. 报告 §三「沉浸光感从零散组件扩展到全局」要求背景是全局的。
 *
 * 规格（两套背景合并后仍然各自成立）：
 *   - 同一投影与 viewBox（CHINA_OUTLINE_VIEWBOX 1000×971）、同一 `china-outline.svg`
 *     （`?raw` 内联，运行时零网络请求、无密钥依赖）；
 *   - 同一铺满策略：stage `120vmax` + `aspect-ratio: 1000/971`，竖屏 150vw、横屏矮屏 150vh；
 *   - 同一 `--backdrop-map-opacity` 与径向 `mask-image` 渐隐；
 *   - 整层 `pointer-events: none`，绝不抢前景事件；
 *   - 触屏 / prefers-reduced-motion 下只渲染静态底图，不注册指针交互。
 *
 * 两个模式（按路由自动切换）：
 *   - rail：极淡中国轮廓 + **冷蓝**铁路景点星点（原 ChinaBackdropMap 观感）；
 *   - road：同一轮廓 + **公路网光带**（外发光宽带 + 高亮细芯，lighter 合成）
 *           + **琥珀**公路景点星点（原 DriveBackdropMap 观感）。
 *
 * 「进入页面时地图跳一下」的根治：
 *   路网折线单独占一个 canvas，就绪后由 CSS 走 700ms 淡入；星点层的 opacity 恒定，
 *   不再出现"整层亮度 0.24 → 0.46 且内容被瞬间替换"的双跳。
 *
 * 体积纪律：全国路网是构建期渲染的位图（apps/web/public/drive-network.png，约 1.6MB），
 * 由浏览器按需加载并缓存；主 bundle 只含轮廓与星点。
 */
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useRoute } from 'vue-router';
import outlineRaw from '../assets/china-outline.svg?raw';
import { CHINA_OUTLINE_VIEWBOX, CHINA_SCENIC_HEAT } from '../data/chinaBackdrop';
import { CHINA_ROAD_HEAT } from '../data/driveBackdrop';

const VIEW_W = CHINA_OUTLINE_VIEWBOX.width;
const VIEW_H = CHINA_OUTLINE_VIEWBOX.height;

/** 只取生成产物里 `<g>` 内部的路径，外层 `<svg>` 由本组件掌控 */
const outlinePaths = (() => {
  const m = /<g[^>]*>([\s\S]*?)<\/g>/.exec(outlineRaw);
  return m ? m[1].trim() : '';
})();

const route = useRoute();
/** 自驾路由（含 /drive/atlas）用公路网背景，其余用铁路背景 */
const mode = computed<'rail' | 'road'>(() =>
  route.path === '/drive' || route.path.startsWith('/drive/') ? 'road' : 'rail',
);

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const railCanvas = useTemplateRef<HTMLCanvasElement>('railCanvas');
const netCanvas = useTemplateRef<HTMLCanvasElement>('netCanvas');
const heatCanvas = useTemplateRef<HTMLCanvasElement>('heatCanvas');

const pointer = ref<{ nx: number; ny: number } | null>(null);
const interactive = ref(false);
/** 路网懒加载块是否就绪（就绪前 road 模式只有轮廓 + 星点） */
const netReady = ref(false);

// ── 空间分桶：加速"指针附近有哪些点"，避免每帧全量遍历 ───────────────────────
const BUCKET = 60; // viewBox 单位
type Buckets = Map<string, number[]>;

function buildBuckets(points: readonly (readonly number[])[]): Buckets {
  const map: Buckets = new Map();
  points.forEach((p, i) => {
    const key = `${Math.floor(p[0]! / BUCKET)},${Math.floor(p[1]! / BUCKET)}`;
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  });
  return map;
}

const railBuckets = buildBuckets(CHINA_SCENIC_HEAT);
const roadBuckets = buildBuckets(CHINA_ROAD_HEAT);

const HOT_RADIUS = 150; // viewBox 单位
function hotIndices(buckets: Buckets, px: number, py: number): number[] {
  const bx = Math.floor(px / BUCKET);
  const by = Math.floor(py / BUCKET);
  const out: number[] = [];
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      const list = buckets.get(`${bx + dx},${by + dy}`);
      if (!list) continue;
      for (const i of list) out.push(i);
    }
  }
  return out;
}

// ── 全国路网位图（构建期离线渲染，见 scripts/build-drive-network-raster.mjs） ──
// v0.6.0：折线方案无法承载"全国 790 万条可通行道路 / 1.5 万条编号公路"，
// 改为一张按同一墨卡托投影预渲染的 PNG，运行时只做一次 drawImage。
const ROAD_IMAGE_URL = '/drive-network.png';
let roadImg: HTMLImageElement | null = null;
/** 指针高光用的离屏画布（复用，避免每帧新建） */
let scratchLayer: HTMLCanvasElement | null = null;

/**
 * 指针高光：把光圈内的路网"点亮"。
 * 位图无法像折线那样逐条加亮，改用径向遮罩（destination-in）+ lighter 叠加，等效且更省。
 */
function brightenRoads(ctx: CanvasRenderingContext2D, width: number, height: number, px: number, py: number, radiusPx: number): void {
  if (!roadImg) return;
  if (!scratchLayer || scratchLayer.width !== width || scratchLayer.height !== height) {
    scratchLayer = document.createElement('canvas');
    scratchLayer.width = width;
    scratchLayer.height = height;
  }
  const octx = scratchLayer.getContext('2d');
  if (!octx) return;
  octx.globalCompositeOperation = 'source-over';
  octx.clearRect(0, 0, width, height);
  octx.drawImage(roadImg, 0, 0, width, height);
  octx.globalCompositeOperation = 'destination-in';
  const grad = octx.createRadialGradient(px, py, 0, px, py, radiusPx);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.38)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  octx.fillStyle = grad;
  octx.fillRect(0, 0, width, height);
  octx.globalCompositeOperation = 'source-over';
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(scratchLayer, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

/** 星点绘制：cold=铁路冷蓝，warm=公路琥珀 */
function paintPoints(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly number[])[],
  scale: number,
  warm: boolean,
  boost: (x: number, y: number, w: number) => number,
  glowScale: number,
): void {
  const inner = warm ? '255, 236, 205' : '199, 224, 255';
  const outer = warm ? '255, 184, 77' : '77, 159, 255';
  ctx.globalCompositeOperation = 'lighter';
  for (const p of points) {
    const [x, y, w] = [p[0]!, p[1]!, p[2] ?? 0.6];
    const alpha = Math.min(1, (w as number) * boost(x, y, w as number));
    if (alpha <= 0.01) continue;
    const cx = x * scale;
    const cy = y * scale;
    const glowR = glowScale * scale;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, `rgba(${inner}, ${(alpha * (warm ? 0.9 : 0.85)).toFixed(3)})`);
    grad.addColorStop(
      warm ? 0.45 : 0.45,
      `rgba(${outer}, ${(alpha * (warm ? 0.36 : 0.34)).toFixed(3)})`,
    );
    grad.addColorStop(1, `rgba(${outer}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** 指针光圈内的星点加亮圈 */
function paintHotSpots(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly number[])[],
  scale: number,
  warm: boolean,
  hot: number[],
): void {
  const inner = warm ? '255, 244, 224' : '226, 240, 255';
  const outer = warm ? '255, 184, 77' : '77, 159, 255';
  ctx.globalCompositeOperation = 'lighter';
  for (const i of hot) {
    const pt = points[i];
    if (!pt) continue;
    const cx = pt[0]! * scale;
    const cy = pt[1]! * scale;
    const glowR = 15 * scale;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, `rgba(${inner}, 0.92)`);
    grad.addColorStop(0.35, `rgba(${outer}, ${(0.4 * (pt[2] ?? 0.6)).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${outer}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ── 三层静态底图（尺寸变化时重建） ───────────────────────────────────────────
type LayerKind = 'rail' | 'net' | 'heat';
const baseLayers: Partial<Record<LayerKind, HTMLCanvasElement>> = {};

function buildLayer(kind: LayerKind, width: number, height: number): HTMLCanvasElement | null {
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const ctx = layer.getContext('2d');
  if (!ctx) return null;
  const scale = width / VIEW_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'rail') {
    paintPoints(ctx, CHINA_SCENIC_HEAT, scale, false, () => 1, 7);
  } else if (kind === 'heat') {
    paintPoints(ctx, CHINA_ROAD_HEAT, scale, true, () => 1, 6);
  } else {
    // 路网：构建期离线渲染的全国路网位图（含无编号的乡道村道与编号公路分级着色）
    if (roadImg && roadImg.complete && roadImg.naturalWidth > 0) {
      ctx.globalAlpha = 0.92;
      ctx.drawImage(roadImg, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }
  }
  return layer;
}

function canvasOf(kind: LayerKind): HTMLCanvasElement | null {
  return kind === 'rail' ? railCanvas.value : kind === 'net' ? netCanvas.value : heatCanvas.value;
}

function drawLayer(kind: LayerKind): void {
  const canvas = canvasOf(kind);
  if (!canvas || canvas.width === 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cached = baseLayers[kind];
  if (!cached || cached.width !== canvas.width || cached.height !== canvas.height) {
    const built = buildLayer(kind, canvas.width, canvas.height);
    if (!built) return;
    baseLayers[kind] = built;
  }
  ctx.drawImage(baseLayers[kind]!, 0, 0);

  const p = pointer.value;
  if (!interactive.value || !p) return;
  const isRoad = mode.value === 'road';
  if (kind === 'rail' && isRoad) return;
  if ((kind === 'net' || kind === 'heat') && !isRoad) return;

  const scale = canvas.width / VIEW_W;
  const px = p.nx * VIEW_W;
  const py = p.ny * VIEW_H;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'net') {
    // ① 光圈内的路网点亮（位图径向遮罩 + lighter 叠加）
    brightenRoads(ctx, canvas.width, canvas.height, px * scale, py * scale, HOT_RADIUS * scale);
    return;
  }

  // ② 光圈内的星点点亮（分桶把候选压到个位数）
  const buckets = kind === 'rail' ? railBuckets : roadBuckets;
  const points = kind === 'rail' ? CHINA_SCENIC_HEAT : CHINA_ROAD_HEAT;
  const warm = kind !== 'rail';
  const hot = hotIndices(buckets, px, py).filter((i) => {
    const pt = points[i];
    return pt && Math.hypot(pt[0]! - px, pt[1]! - py) <= HOT_RADIUS;
  });
  if (!hot.length) return;
  paintHotSpots(ctx, points, scale, warm, hot);
}

function render(): void {
  drawLayer('rail');
  drawLayer('net');
  drawLayer('heat');
}

function sizeCanvas(canvas: HTMLCanvasElement | null): boolean {
  if (!canvas) return false;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  // 背景是柔光层，不需要满 DPR；压到 1.5 兼顾清晰度与显存
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

function resizeCanvas(): void {
  const changed = ['rail', 'net', 'heat'].some((k) => sizeCanvas(canvasOf(k as LayerKind)));
  if (changed) {
    baseLayers.rail = undefined;
    baseLayers.net = undefined;
    baseLayers.heat = undefined;
  }
  render();
}

let rafId = 0;
let pendingEvent: PointerEvent | null = null;

function flushPointer(): void {
  rafId = 0;
  const ev = pendingEvent;
  const root = rootEl.value;
  if (!ev || !root) return;
  const rect = root.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const nx = (ev.clientX - rect.left) / rect.width;
  const ny = (ev.clientY - rect.top) / rect.height;
  pointer.value = { nx, ny };
  root.style.setProperty('--bx', `${(nx * 100).toFixed(2)}%`);
  root.style.setProperty('--by', `${(ny * 100).toFixed(2)}%`);
  render();
}

function onPointerMove(event: PointerEvent): void {
  pendingEvent = event;
  if (!rafId) rafId = requestAnimationFrame(flushPointer);
}

function clearPointer(): void {
  pointer.value = null;
  const root = rootEl.value;
  root?.style.removeProperty('--bx');
  root?.style.removeProperty('--by');
  render();
}

let resizeObserver: ResizeObserver | null = null;

onMounted(async () => {
  resizeCanvas();

  if (typeof ResizeObserver !== 'undefined' && railCanvas.value) {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(railCanvas.value);
  }

  // 全国路网位图：按需加载，到达后淡入（CSS transition，不再是瞬间替换）
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    roadImg = img;
    netReady.value = true;
    baseLayers.net = undefined;
    render();
  };
  img.onerror = () => {
    /* 底图缺失不影响轮廓与星点 */
  };
  img.src = ROAD_IMAGE_URL;

  const canHover =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!canHover || reducedMotion) {
    interactive.value = false;
    return;
  }

  interactive.value = true;
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', clearPointer, { passive: true });
  window.addEventListener('blur', clearPointer);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerleave', clearPointer);
  window.removeEventListener('blur', clearPointer);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  roadImg = null;
  scratchLayer = null;
});
</script>

<template>
  <div
    ref="rootEl"
    class="app-backdrop"
    :class="{
      'is-rail': mode === 'rail',
      'is-road': mode === 'road',
      'is-interactive': interactive,
      'is-net-ready': netReady,
    }"
    aria-hidden="true"
  >
    <div class="app-backdrop__stage">
      <svg
        class="app-backdrop__outline"
        :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <g v-html="outlinePaths" />
      </svg>
      <canvas ref="railCanvas" class="app-backdrop__layer app-backdrop__layer--rail" />
      <canvas ref="netCanvas" class="app-backdrop__layer app-backdrop__layer--net" />
      <canvas ref="heatCanvas" class="app-backdrop__layer app-backdrop__layer--heat" />
    </div>
    <div class="app-backdrop__glow" />
  </div>
</template>

<style scoped>
.app-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  /* 边缘径向渐隐：四角柔和淡出，避免与前景正文争夺注意力 */
  mask-image: radial-gradient(ellipse 100% 100% at 50% 50%, #000 55%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 100% 100% at 50% 50%, #000 55%, transparent 100%);
}

.app-backdrop__stage {
  position: absolute;
  /* 与首页铁路背景同一铺满策略：无论竖屏横屏都占满视口，溢出部分被裁掉 */
  left: 50%;
  top: 50%;
  width: 120vmax;
  max-width: none;
  aspect-ratio: 1000 / 971;
  transform: translate(-50%, -50%);
}

@media (max-aspect-ratio: 3 / 4) {
  .app-backdrop__stage {
    width: 150vw;
  }
}

@media (orientation: landscape) and (max-height: 560px) {
  .app-backdrop__stage {
    width: 150vh;
  }
}

/* 轮廓剪影：极淡但可辨识（有效不透明度 = 本层 opacity × path fill-opacity） */
.app-backdrop__outline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  color: var(--backdrop-map-color);
  opacity: calc(var(--backdrop-map-opacity) * 0.9);
}

.app-backdrop__outline :deep(path) {
  fill: currentColor;
  fill-opacity: 0.8;
  stroke: currentColor;
  stroke-opacity: 0.5;
  stroke-width: 0.7;
  vector-effect: non-scaling-stroke;
}

/* 三个 canvas 图层：默认全透明，由 is-rail / is-road 决定谁亮 */
.app-backdrop__layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  /*
   * 关键：模式切换与"路网就绪"都走这条过渡。此前路网是瞬间替换进同一张 canvas，
   * 同时整层不透明度还从 0.24 跳到 0.46 —— 双跳叠加就是用户看到的"地图跳一下"。
   */
  transition: opacity var(--dur-slower) var(--ease-emphasized);
}

.app-backdrop.is-rail .app-backdrop__layer--rail {
  opacity: calc(var(--backdrop-map-opacity) * 0.75);
}

.app-backdrop.is-road .app-backdrop__layer--heat {
  opacity: calc(var(--backdrop-map-opacity) * 0.75);
}

.app-backdrop.is-road.is-net-ready .app-backdrop__layer--net {
  opacity: calc(var(--backdrop-map-opacity) * 0.95);
}

/* 指针径向高光：只改 CSS 变量，由合成层完成，不触发布局与重绘 */
.app-backdrop__glow {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: radial-gradient(
    460px circle at var(--bx, 50%) var(--by, 50%),
    rgba(255, 184, 77, 0.14),
    rgba(77, 159, 255, 0.06) 42%,
    transparent 68%
  );
  transition: opacity var(--dur-slow) var(--ease-standard);
}

.app-backdrop.is-interactive .app-backdrop__glow {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .app-backdrop__glow {
    display: none;
  }
  .app-backdrop__layer {
    transition: none;
  }
}
</style>
