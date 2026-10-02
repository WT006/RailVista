<script setup lang="ts">
/**
 * 万里路书 · 单条公路详情页（PRD §2.3 DriveRoad）。
 *
 * v0.6.5 改版要点（对应用户 5 条反馈）：
 *   R1 分段按**地名**（API chapters，来自 geom.nodes = 沿几何反查的中途地名），
 *      仅在无地名时退回 120km 里程等分，并在 UI 上如实标注退化原因。
 *   R2 沿程景点顶部新增「精选」分组（按 score 降序），并明示精选依据。
 *   R3 分段/景点点击真正生效：分段 → 该段折线加粗高亮 + 其余变暗 + 侧栏筛选；
 *      景点 → 地图重算 viewBox 平移放大到该点 + 脉冲定位环；再点一次取消。
 *   R4 排版重做：桌面端左图（≥420px 高）+ 右侧独立滚动信息栏，地图内加里程刻度条。
 *   R5 顶栏由 App.vue 全局挂载，本页不再重复挂 AppTopBar。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import DriveSubNav from '../components/DriveSubNav.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import { useRoadDraw } from '../composables/useRoadDraw';

usePointerSpotlight();
import outlineRaw from '../assets/china-outline.svg?raw';
import { CHINA_OUTLINE_VIEWBOX, lngLatToViewBox } from '../data/chinaBackdrop';
import { ROAD_COLORS, roadColor, roadClassLabel, classOfRef } from '../data/roadColors';
import type { AlongSpot, RoadAnchorSource, RoadIndexEntry, RoadRoute } from '@railvista/shared';

const route = useRoute();
const router = useRouter();
const code = String(route.params.code ?? '');

function tierColor(tier: string): string {
  if (tier === 'A') return ROAD_COLORS.expressway;
  if (tier === 'C') return ROAD_COLORS.provincial;
  return ROAD_COLORS.national;
}

const routePathRef = ref<SVGPathElement | null>(null);
useRoadDraw(routePathRef);

const VIEW_W = CHINA_OUTLINE_VIEWBOX.width;
const VIEW_H = CHINA_OUTLINE_VIEWBOX.height;
const outlinePaths = (() => {
  const m = /<g[^>]*>([\s\S]*?)<\/g>/.exec(outlineRaw);
  return m ? m[1].trim() : '';
})();

const loading = ref(true);
const error = ref('');
/** B3：几何与景点独立降级 —— 索引/几何失败仍展示页面，景点失败给独立重试 */
const indexError = ref('');
const alongError = ref('');
const retryingAlong = ref(false);
const entry = ref<RoadIndexEntry | null>(null);
const roadRoute = ref<RoadRoute | null>(null);
const spots = ref<AlongSpot[]>([]);
const geometryNote = ref('');

/** B2-1：端点可信度与里程覆盖率（来自 /api/drive/road/:key） */
const endpointsUnverified = ref(false);
const connectedKm = ref(0);
const nominalKm = ref(0);
const coveragePct = ref<number | null>(null);

/** v0.6.0 精度分级与分量数（来自 geom 的 precision / componentCount / stitchedGaps） */
const precision = ref<string | null>(null);
const componentCount = ref(1);
const stitchedGaps = ref(0);
const PRECISION_TEXT: Record<string, string> = {
  A: '走向已核对（与官方里程偏差 ≤10%）',
  B: 'OSM 还原（偏差 ≤25%）',
  C: 'OSM 还原（官方里程未知或偏差更大）',
  X: '走向存疑（偏差 >50%，仅供参考）',
};
const precisionText = computed(() => (precision.value ? PRECISION_TEXT[precision.value] ?? 'OSM 还原' : 'OSM 还原'));

/**
 * B3：索引请求失败但几何成功时，模板仍需要 entry 的若干字段。
 * 这里用 roadKey 合成一个最小可用条目，避免模板解引用 null 而整页白屏。
 */
const entryView = computed<RoadIndexEntry>(() => {
  if (entry.value) return entry.value;
  const roadKey = code.includes(':') ? code.split(':')[1]! : code;
  return {
    key: code,
    ref: roadKey,
    name: undefined,
    class: classOfRef(roadKey),
    provinces: [],
    fromPlace: '—',
    toPlace: '—',
    lengthKm: 0,
    bbox: [0, 0, 0, 0],
    spotCount: 0,
    hasGeom: !!roadRoute.value,
    source: 'osm_only',
    status: 'unverified',
  };
});

/** 主链坐标（viewBox 坐标缓存，避免模板里反复调用换算函数） */
const mainChainView = computed<[number, number][]>(() =>
  (roadRoute.value?.coords ?? []).map(([lng, lat]) => lngLatToViewBox(lng, lat)),
);

const routePath = computed(() => {
  const pts = mainChainView.value;
  if (pts.length < 2) return '';
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
});

/** 多段几何（orphan 链）SVG 路径：虚线渲染未贯通段 */
const segmentPaths = computed(() => {
  const segs = roadRoute.value?.segments;
  if (!segs?.length) return [];
  return segs
    .map((seg) => {
      if (seg.length < 2) return '';
      return seg
        .map(([lng, lat], i) => {
          const [x, y] = lngLatToViewBox(lng, lat);
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join('');
    })
    .filter(Boolean);
});

/** 段间断点标注 */
const gapAnnotations = computed(() => roadRoute.value?.gapAnnotations ?? []);
const hasGaps = computed(() => gapAnnotations.value.length > 0);
const maxGapKm = computed(() =>
  gapAnnotations.value.reduce((m, g) => Math.max(m, g.gapKm), 0).toFixed(1),
);

// ────────────────────────────────────────────────────────────────────────────
// R1：分段按地名
// ────────────────────────────────────────────────────────────────────────────
/**
 * 分段数据源优先级：
 *   1. `roadRoute.chapters` —— API 已按 geom.nodes（沿几何反查的地名锚点）切段，
 *      段名形如「巴楚 — 库车」。
 *   2. chapters 为空 / 段名仍是「第 N 段 · X—Y km」形态（说明该路 geom 没有可用
 *      地名锚点，API 走了 120km 退化分支）→ 前端用同一套 120km 窗口兜底，
 *      并置 `byPlace=false`，UI 必须显示「暂无中途地名，仅按里程等分」。
 */
const PLACE_SEGMENT_RE = /第\s*\d+\s*段/;

interface RoadSegment {
  title: string;
  fromKm: number;
  toKm: number;
  /** 该段是否有真实地名（false = 里程等分兜底） */
  byPlace: boolean;
  /**
   * v0.6.5：段内**较弱**的一侧锚点来源。
   * 站名兜底（station）精度最低 —— 站名只是 towns 的子集且站场常离公路数公里，
   * 段名带「站名推测」标记以免被当成已核实地名。
   */
  weakestSource: RoadAnchorSource | null;
}

/** 来源强弱：数字大者更权威 */
const SOURCE_STRENGTH: Record<RoadAnchorSource, number> = { station: 1, place: 2, amap: 3 };

/** 取两端中较弱的一侧（保守标注） */
function weakerSource(a?: RoadAnchorSource, b?: RoadAnchorSource): RoadAnchorSource | null {
  if (!a && !b) return null;
  if (!a) return b!;
  if (!b) return a;
  return SOURCE_STRENGTH[a] <= SOURCE_STRENGTH[b] ? a : b;
}

const totalLengthKm = computed(() => roadRoute.value?.lengthKm ?? 0);

const segments = computed<RoadSegment[]>(() => {
  const total = totalLengthKm.value;
  const fromApi = roadRoute.value?.chapters ?? [];
  const usable = fromApi.filter((c) => c && Number.isFinite(c.fromKm) && Number.isFinite(c.toKm));
  if (usable.length) {
    return usable.map((c) => ({
      title: c.title,
      fromKm: c.fromKm,
      toKm: c.toKm,
      byPlace: !PLACE_SEGMENT_RE.test(c.title),
      weakestSource: weakerSource(c.fromSource, c.toSource),
    }));
  }
  if (!total) return [];
  const out: RoadSegment[] = [];
  const windowKm = 120;
  for (let from = 0; from < total; from += windowKm) {
    const to = Math.min(from + windowKm, total);
    out.push({ title: `第 ${out.length + 1} 段 · ${Math.round(from)}—${Math.round(to)} km`, fromKm: from, toKm: to, byPlace: false, weakestSource: null });
    if (to >= total) break;
  }
  return out;
});

/** 站名兜底段数：UI 上要如实说明有多少段名精度较低 */
const stationBasedSegmentCount = computed(
  () => segments.value.filter((s) => s.weakestSource === 'station').length,
);

/** 分段是否全部为里程等分（决定要不要显示降级说明） */
const segmentsByPlace = computed(() => segments.value.some((s) => s.byPlace));
const segmentSourceNote = computed(() => {
  if (!segments.value.length) return '';
  if (!segmentsByPlace.value) return '暂无中途地名，仅按里程等分（该编号尚未收录地名锚点）';
  const base = '按沿线地名切段';
  if (stationBasedSegmentCount.value > 0) {
    return `${base}（其中 ${stationBasedSegmentCount.value} 段含站名推测，精度较低）`;
  }
  return base;
});

/** 每段的景点数（用于密度条与列表筛选） */
function spotsInRange(fromKm: number, toKm: number): AlongSpot[] {
  return spots.value.filter((s) => s.progressKm >= fromKm && s.progressKm < toKm);
}

const segmentSpots = computed<AlongSpot[][]>(() =>
  segments.value.map((s) => spotsInRange(s.fromKm, s.toKm)),
);

const maxSegmentSpots = computed(() => segmentSpots.value.reduce((m, arr) => Math.max(m, arr.length), 1));

/** 当前选中的分段下标（null = 全部） */
const activeSegment = ref<number | null>(null);

function selectSegment(i: number): void {
  activeSegment.value = activeSegment.value === i ? null : i;
  // 切段时清掉景点定位，避免上一段的定位环留在新视角里造成误读
  if (activeSegment.value !== null) focusTarget.value = null;
}

// ────────────────────────────────────────────────────────────────────────────
// R2：精选景点
// ────────────────────────────────────────────────────────────────────────────
const FEATURED_LIMIT = 8;

/**
 * 名称是否含中文。
 *
 * v0.6.5：`data/roads/roadside-spots.json` 里有 1112 条纯 ASCII 名条目
 * （OSM 上无中文名，如实测精选第 6 名 `Grand Canyon trailhead`）。这些条目在
 * 中文界面里既突兀、又无法让用户判断是哪儿，不该占据精选位。
 *
 * 只做**展示层降权 + 标注**，不改数据、不凭空翻译（项目硬要求：不编造内容）。
 * 规则与 scripts/fill-road-place-anchors.mjs 的 hasChineseName 保持一致。
 */
function hasChineseName(name: string | undefined): boolean {
  return /[㐀-䶿一-鿿豈-﫿]/.test(String(name ?? ''));
}

/** 精选：按 score 降序取前 N。
 *  有中文名的优先排在前（保证精选位都是用户能读懂的地名）；
 *  纯外文名的排在后面，且只在有中文名不足 N 个时才补位。
 *  数据源是 data/roads/roadside-spots.json 的观赏评分，未做主观加权。 */
const featuredSpots = computed<AlongSpot[]>(() => {
  const sorted = [...spots.value].sort((a, b) => b.score - a.score || a.progressKm - b.progressKm);
  const named = sorted.filter((s) => hasChineseName(s.name));
  const latin = sorted.filter((s) => !hasChineseName(s.name));
  return [...named, ...latin].slice(0, FEATURED_LIMIT);
});

/** 精选里外文名的占比，用于如实说明「补位」情况 */
const featuredLatinCount = computed(() => featuredSpots.value.filter((s) => !hasChineseName(s.name)).length);

/** 全部景点（按里程升序，符合「沿途」直觉）；外文名条目排在该段末尾并弱化 */
function sortForList(list: AlongSpot[]): AlongSpot[] {
  return [...list].sort((a, b) => {
    const la = hasChineseName(a.name) ? 0 : 1;
    const lb = hasChineseName(b.name) ? 0 : 1;
    // 同一语言组内仍按里程升序；外文名整体沉底
    if (la !== lb) return la - lb;
    return a.progressKm - b.progressKm;
  });
}

const routeSpots = computed<AlongSpot[]>(() => sortForList(spots.value));

/** 侧栏景点列表：选中分段时只看该段，否则看全线 */
const visibleSpots = computed<AlongSpot[]>(() => {
  if (activeSegment.value === null) return routeSpots.value;
  return sortForList(segmentSpots.value[activeSegment.value] ?? []);
});

/** 分类中文名（公路侧 category 是英文层级，取末段做中文兜底） */
const SPOT_CATEGORY_CN: Record<string, string> = {
  'viewpoint.landmark': '地标',
  'viewpoint.observation-deck': '观景台',
  'viewpoint.scenic-byway': '风景公路',
  'nature.mountain': '山岳',
  'nature.canyon': '峡谷',
  'nature.lake': '湖泊',
  'nature.river': '河流',
  'nature.forest': '森林',
  'nature.grassland': '草原',
  'nature.desert': '沙漠',
  'nature.glacier': '冰川',
  'culture.heritage': '遗产',
  'culture.ancient-town': '古镇',
  'culture.ruin': '遗址',
  'culture.temple': '古建',
  'engineering.bridge': '桥梁',
  'engineering.tunnel': '隧道',
  'engineering.pass': '垭口',
  'experience.hot-spring': '温泉',
};

function spotCategoryCn(cat?: string): string {
  if (!cat) return '';
  return SPOT_CATEGORY_CN[cat] ?? cat.split('.').pop() ?? '';
}

// ────────────────────────────────────────────────────────────────────────────
// R3：地图交互（分段高亮 + 景点定位）
// ────────────────────────────────────────────────────────────────────────────
interface FocusTarget {
  lng: number;
  lat: number;
  name: string;
  key: number;
}
const focusTarget = ref<FocusTarget | null>(null);
const mapWrap = ref<HTMLElement | null>(null);

/** 全局视野：覆盖主链 + 全部连通分量（G318 这类长线的分量可能分处东西两端） */
interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function bboxOfViewPts(pts: [number, number][]): ViewBox | null {
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const padX = Math.max((maxX - minX) * 0.08, 20);
  const padY = Math.max((maxY - minY) * 0.08, 20);
  return { x: minX - padX, y: minY - padY, w: maxX - minX + padX * 2, h: maxY - minY + padY * 2 };
}

/** 主链 + 全部分量的全局视野 */
const globalViewBox = computed<ViewBox>(() => {
  const all: [number, number][] = [...mainChainView.value];
  for (const seg of roadRoute.value?.segments ?? []) {
    for (const p of seg) all.push(lngLatToViewBox(p[0], p[1]));
  }
  return bboxOfViewPts(all) ?? { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
});

/** 聚焦时使用的视野（未聚焦 = 全局） */
const focusViewBox = ref<ViewBox | null>(null);

const viewBoxAttr = computed(() => {
  const vb = focusViewBox.value ?? globalViewBox.value;
  return `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`;
});

/**
 * R3 关键：把选中景点平移到视野中心。
 * 旧实现只设 focusTarget + scrollIntoView，viewBox 永远是全局的 ——
 * 全线视野下 G318 的定位环直径不到 3px（viewBox 单位），肉眼等于「没反应」。
 * 这里重算 viewBox：以该点为中心，取全局视野 22% 的窗口（并设最小窗口），
 * 保证标记有可见尺寸，同时保留上下文不至于迷失。
 */
const FOCUS_SPAN_RATIO = 0.22;
const FOCUS_MIN_SPAN = 90;

function focusOn(lng: number, lat: number): void {
  const [px, py] = lngLatToViewBox(lng, lat);
  const g = globalViewBox.value;
  const w = Math.max(g.w * FOCUS_SPAN_RATIO, FOCUS_MIN_SPAN);
  const h = Math.max(g.h * FOCUS_SPAN_RATIO, FOCUS_MIN_SPAN * 0.72);
  focusViewBox.value = { x: px - w / 2, y: py - h / 2, w, h };
}

/** 点击景点（含精选卡片）：定位 + 聚焦；再次点击同一点 = 取消选中回全局 */
function focusSpotOnMap(s: AlongSpot): void {
  if (focusTarget.value && focusTarget.value.name === s.name) {
    focusTarget.value = null;
    focusViewBox.value = null;
    return;
  }
  focusTarget.value = { lng: s.lng, lat: s.lat, name: s.name, key: Date.now() };
  focusOn(s.lng, s.lat);
  // 移动端地图在上方，聚焦后滚回地图让用户看见定位结果
  if (mapWrap.value) mapWrap.value.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** 取消景点选中（点「返回全线」） */
function clearFocus(): void {
  focusTarget.value = null;
  focusViewBox.value = null;
}

/** 主链各点对应的里程（km）：与 API progressKm 同量纲（主链投影里程） */
const chainCumKm = computed<number[]>(() => {
  const coords = roadRoute.value?.coords ?? [];
  const out: number[] = new Array(coords.length).fill(0);
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    out[i] = out[i - 1]! + haversineKm(a[0], a[1], b[0], b[1]);
  }
  return out;
});

function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * R3：选中分段的折线子路径（按里程区间裁剪主链）。
 * 高亮段用独立 path 绘制（加粗 + 不透明），未选中时主链整体变淡。
 */
const activeSegmentPath = computed(() => {
  if (activeSegment.value === null) return '';
  const seg = segments.value[activeSegment.value];
  if (!seg) return '';
  const pts = mainChainView.value;
  const cum = chainCumKm.value;
  if (pts.length < 2 || cum.length !== pts.length) return '';
  let d = '';
  let started = false;
  for (let i = 0; i < pts.length; i += 1) {
    const km = cum[i]!;
    // 末段闭合：toKm 恰等于主链长度时把最后一个点也带上
    const inRange = km >= seg.fromKm && (km < seg.toKm || (i === pts.length - 1 && km <= seg.toKm));
    if (!inRange) {
      started = false;
      continue;
    }
    const [x, y] = pts[i]!;
    d += `${started ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    started = true;
  }
  return d;
});

/** 地图点位是否落在选中分段的里程区间内（决定点位是否变暗） */
function spotInActiveSegment(s: AlongSpot): boolean {
  if (activeSegment.value === null) return true;
  const seg = segments.value[activeSegment.value];
  if (!seg) return true;
  return s.progressKm >= seg.fromKm && s.progressKm < seg.toKm;
}

/** 地图内的里程刻度：沿主链等距取 5 个刻度点，标注相对里程 */
const mileTicks = computed(() => {
  const cum = chainCumKm.value;
  const chainKm = cum[cum.length - 1] ?? 0;
  if (chainKm <= 0) return [];
  const TICKS = 5;
  const out: Array<{ km: number; x: number; y: number }> = [];
  for (let i = 0; i <= TICKS; i += 1) {
    const target = (chainKm * i) / TICKS;
    // 二分找第一个 >= target 的点索引
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    const pt = mainChainView.value[lo];
    if (pt) out.push({ km: Math.round(target), x: pt[0], y: pt[1] });
  }
  return out;
});

/** 切换路段 / 数据重载后，丢弃已失效的选中态 */
watch(segments, () => {
  if (activeSegment.value !== null && activeSegment.value >= segments.value.length) {
    activeSegment.value = null;
  }
});

onMounted(load);

/**
 * B3：原先用 Promise.all，任一请求失败即整页红字「加载失败」。
 * 实际数据里 558/591 条路 hasGeom:false —— 此时 getDriveAlong 返 404，
 * 但 getDriveRoad 仍能正常返回索引，属于「部分可用」而非「整页失败」。
 * 改为两个请求各自 settle，互不牵连。
 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  indexError.value = '';
  alongError.value = '';
  activeSegment.value = null;
  clearFocus();

  const [roadRes, alongRes] = await Promise.allSettled([
    api.getDriveRoad(code),
    api.getDriveAlong({ road: code, max: 200 }),
  ]);

  if (roadRes.status === 'fulfilled') {
    entry.value = roadRes.value.entry;
    geometryNote.value = roadRes.value.note ?? '';
    endpointsUnverified.value = roadRes.value.endpointsUnverified ?? false;
    connectedKm.value = roadRes.value.connectedKm ?? 0;
    nominalKm.value = roadRes.value.nominalKm ?? roadRes.value.entry.lengthKm ?? 0;
    coveragePct.value = roadRes.value.coveragePct ?? null;
    // v0.6.0：精度分级 / 连通分量数 / 缝合断档数（无字段时保持旧行为）
    const extra = roadRes.value as unknown as {
      precision?: string | null;
      segmentCount?: number;
      componentCount?: number;
      stitchedGaps?: number;
    };
    precision.value = extra.precision ?? null;
    componentCount.value = extra.componentCount ?? extra.segmentCount ?? 1;
    stitchedGaps.value = extra.stitchedGaps ?? 0;
  } else {
    indexError.value = roadRes.reason instanceof Error ? roadRes.reason.message : '公路索引加载失败';
  }

  if (alongRes.status === 'fulfilled') {
    roadRoute.value = alongRes.value.route;
    spots.value = alongRes.value.spots;
  } else {
    alongError.value = alongRes.reason instanceof Error ? alongRes.reason.message : '沿途景点加载失败';
  }

  // 索引也没有 → 确实无从展示，整页错误态
  if (!entry.value && !roadRoute.value) {
    error.value = indexError.value || '公路不在册';
  }
  loading.value = false;
}

/** 景点区独立重试（不重载整页） */
async function retryAlong(): Promise<void> {
  if (retryingAlong.value) return;
  retryingAlong.value = true;
  alongError.value = '';
  try {
    const data = await api.getDriveAlong({ road: code, max: 200 });
    roadRoute.value = data.route;
    spots.value = data.spots;
  } catch (e) {
    alongError.value = e instanceof Error ? e.message : '沿途景点加载失败';
  } finally {
    retryingAlong.value = false;
  }
}

function goTripLive(): void {
  void router.push(`/drive/trip?road=${encodeURIComponent(code)}&mode=live`);
}

function fmtKm(v: number): string {
  return `${Math.round(v)}`;
}
</script>

<template>
  <div class="drive-page">

    <main class="rv-shell">
      <DriveSubNav />

      <div v-if="loading" class="drive-skeleton">
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
        <div class="drive-skeleton__line drive-skeleton__line--mid" />
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
        <div class="drive-skeleton__line drive-skeleton__line--narrow" />
        <div class="drive-skeleton__line drive-skeleton__line--mid" />
      </div>
      <div v-else-if="error" class="drive-empty drive-empty--error">{{ error }}</div>

      <template v-else>
        <!-- P6：公路详情页 header 重构（鸿蒙布局/排版规范）——
             编号徽章与名称左对齐成行，元信息改为「事实卡」栅格（dt/dd），
             不再是一串裸 span 挤在一行。 -->
        <header class="drive-road-hero">
          <div class="drive-road-hero__id">
            <span
              class="drive-road-hero__ref"
              :style="{ '--prefix-color': roadColor(entryView.class) }"
              aria-hidden="true"
            >{{ entryView.ref }}</span>
            <div class="drive-road-hero__names">
              <p class="drive-road-hero__class">
                {{ roadClassLabel(entryView.class) }}<template v-if="entryView.name"> · {{ entryView.name }}</template>
              </p>
              <!-- B2-1：端点未经验证时不展示「上海 —聂拉木」这种会被误读的标题 -->
              <h1 class="drive-road-hero__title">
                <template v-if="!endpointsUnverified">{{ entryView.fromPlace }} — {{ entryView.toPlace }}</template>
                <template v-else>全线走向（端点待核）</template>
              </h1>
            </div>
          </div>

          <dl class="drive-road-facts">
            <div class="drive-road-fact">
              <dt>收录里程</dt>
              <dd v-if="nominalKm > 0">
                {{ connectedKm }}<small> km</small>
                <em class="drive-road-fact__sub">/ 官方 {{ nominalKm }} km · {{ coveragePct }}%</em>
              </dd>
              <dd v-else-if="roadRoute">{{ roadRoute.lengthKm }}<small> km</small><em class="drive-road-fact__sub">OSM 估算</em></dd>
              <dd v-else>约 {{ entryView.lengthKm }}<small> km</small><em class="drive-road-fact__sub">官方里程</em></dd>
            </div>
            <div v-if="precision" class="drive-road-fact">
              <dt>几何精度</dt>
              <dd>
                <span class="drive-road-precision" :data-grade="precision">{{ precisionText }}</span>
              </dd>
            </div>
            <div v-if="componentCount > 1" class="drive-road-fact">
              <dt>连通情况</dt>
              <dd>{{ componentCount }}<small> 段</small><em class="drive-road-fact__sub">{{ componentCount - 1 }} 处未贯通</em></dd>
            </div>
            <div v-if="entryView.provinces.length" class="drive-road-fact">
              <dt>途经</dt>
              <dd class="drive-road-fact__provs">{{ entryView.provinces.join(' · ') }}</dd>
            </div>
            <div class="drive-road-fact">
              <dt>沿线景点</dt>
              <dd>{{ spots.length }}<small> 处</small></dd>
            </div>
          </dl>
        </header>

        <!-- R4：提示条降级为轻量 chip 行（信息不删，只是不再占大块视觉空间） -->
        <div class="drive-road-flags">
          <span v-if="endpointsUnverified" class="drive-road-flag" data-grade="warn" title="端点地名与已收录几何相距较远，顺序与真实走向未必一致；官方逐桩走向表尚未发布，此处不作导航依据。">
            端点待核
          </span>
          <span v-if="componentCount > 1" class="drive-road-flag" data-grade="warn" :title="`该编号在 OSM 中未贯通：共 ${componentCount} 段，合计 ${connectedKm} km（另有 ${stitchedGaps} 处 ≤1.5km 的城区断档已按几何接续）。虚线段为其余连通分量，不代表实际连接关系。`">
            未完全贯通 · {{ componentCount }} 段
          </span>
          <span v-if="hasGaps" class="drive-road-flag" data-grade="info">
            {{ gapAnnotations.length }} 处断口 · 最大 {{ maxGapKm }} km
          </span>
          <span class="drive-road-flag" data-grade="muted">{{ precisionText }}</span>
        </div>

        <div v-if="geometryNote" class="drive-road-note" data-grade="info">
          <p>{{ geometryNote }}</p>
        </div>
        <div v-if="indexError" class="drive-road-note" data-grade="danger">
          <strong>公路索引加载失败</strong>
          <p>{{ indexError }}</p>
        </div>

        <!-- B3：几何/景点缺失时的占位说明，而不是整页红字 -->
        <div v-if="!roadRoute && !alongError" class="drive-road-note" data-grade="info">
          <p>
            该公路的几何尚未收录，暂无法展示走向与沿途景点。可先到
            <router-link to="/drive">首页按起点/终点规划</router-link>。
          </p>
        </div>

        <div v-if="roadRoute" class="drive-road-layout">
          <!-- 左：地图（R4 主视觉，桌面端 ≥420px 高） -->
          <section ref="mapWrap" class="drive-trip-map rv-card" data-spotlight>
            <svg :viewBox="viewBoxAttr" class="drive-trip-map__svg" role="img" aria-label="路线示意图">
              <g class="drive-netmap__outline" v-html="outlinePaths" />
              <!-- 未选中分段时主链整体绘制；选中时变淡，由高亮 path 承担视觉 -->
              <path
                ref="routePathRef"
                class="drive-trip-map__route"
                :class="{ 'is-dim': activeSegment !== null }"
                :d="routePath"
                :stroke="roadColor(entryView.class)"
              />
              <path
                v-for="(d, i) in segmentPaths"
                :key="'seg-' + i"
                class="drive-trip-map__segment"
                :d="d"
                :stroke="roadColor(entryView.class)"
                stroke-dasharray="4 3"
                opacity="0.45"
              />
              <!-- R3：选中分段的高亮折线 -->
              <path
                v-if="activeSegmentPath"
                class="drive-trip-map__route is-active"
                :d="activeSegmentPath"
                :stroke="roadColor(entryView.class)"
              />
              <circle
                v-for="s in spots.slice(0, 160)"
                :key="s.id"
                class="drive-trip-map__dot"
                :class="{ 'is-dim': !spotInActiveSegment(s) }"
                :cx="lngLatToViewBox(s.lng, s.lat)[0]"
                :cy="lngLatToViewBox(s.lng, s.lat)[1]"
                :r="2.4"
                :fill="tierColor(s.tier)"
              >
                <title>{{ s.name }} · K{{ Math.round(s.progressKm) }}</title>
              </circle>
              <!-- R4：里程刻度（让人看得懂这是哪条路） -->
              <g v-if="mileTicks.length && focusViewBox === null" class="drive-trip-map__ticks">
                <g v-for="t in mileTicks" :key="t.km" :transform="`translate(${t.x} ${t.y})`">
                  <circle class="drive-trip-map__tick-dot" r="1.6" />
                  <text class="drive-trip-map__tick-text" x="4" y="-3">{{ fmtKm(t.km) }} km</text>
                </g>
              </g>
              <!-- R3：选中景点的高亮定位环（点击景点后出现，视野已聚焦到该点） -->
              <g
                v-if="focusTarget"
                :key="focusTarget.key"
                class="drive-trip-map__focus"
                :transform="`translate(${lngLatToViewBox(focusTarget.lng, focusTarget.lat)[0]} ${lngLatToViewBox(focusTarget.lng, focusTarget.lat)[1]})`"
              >
                <circle class="drive-trip-map__focus-pulse" r="7" />
                <circle class="drive-trip-map__focus-ring" r="3.5" />
                <circle class="drive-trip-map__focus-core" r="1.2" />
              </g>
            </svg>

            <!-- R4：图例 + 状态条（三行纵向排列，互不压字） -->
            <div class="drive-trip-map__bar">
              <p v-if="hasGaps" class="drive-trip-map__gap-note">
                ⚠ {{ gapAnnotations.length }} 处未贯通（最大断口约 {{ maxGapKm }} km），虚线段为其余连通分量
              </p>
              <p class="drive-trip-map__hint">
                全线走向（OSM 众包还原，{{ precisionText }}）
              </p>
              <p v-if="activeSegment !== null" class="drive-trip-map__scope">
                已聚焦第 {{ activeSegment + 1 }} 段 · {{ segments[activeSegment]?.title }}
                <button type="button" class="drive-trip-map__back" @click="selectSegment(activeSegment)">返回全线</button>
              </p>
              <p v-else-if="focusTarget" class="drive-trip-map__scope">
                已定位 · {{ focusTarget.name }}
                <button type="button" class="drive-trip-map__back" @click="clearFocus">返回全线</button>
              </p>
            </div>
          </section>

          <!-- 右：独立滚动信息栏 -->
          <aside class="drive-road-side">
            <!-- R1：分段 -->
            <section v-if="segments.length" class="rv-card drive-chapters">
              <div class="drive-road-side__head">
                <h2 class="drive-block-title">分段</h2>
                <span class="drive-road-side__count">{{ segments.length }} 段</span>
              </div>
              <ul class="drive-chapterlist drive-road-seglist">
                <li v-for="(seg, i) in segments" :key="`${seg.fromKm}-${i}`">
                  <button
                    type="button"
                    class="drive-seg"
                    :class="{ 'is-on': activeSegment === i }"
                    :aria-pressed="activeSegment === i"
                    @click="selectSegment(i)"
                  >
                    <span class="drive-seg__no">{{ i + 1 }}</span>
                    <span class="drive-seg__body">
                      <!-- R1c：段名用「起点 — 终点」，地名不折行 -->
                      <span class="drive-seg__title">
                        {{ seg.title }}
                        <!-- 站名兜底：段名精度较低，弱化标注但不隐藏（数据诚实性） -->
                        <span
                          v-if="seg.weakestSource === 'station'"
                          class="drive-anchor-src"
                          data-src="station"
                          title="此段端点地名由铁路站名推得：站名只是城镇的子集，且站场常离公路数公里，精度低于行政地名与逆地理编码"
                        >站名推测</span>
                      </span>
                      <span class="drive-seg__range">
                        {{ fmtKm(seg.fromKm) }}—{{ fmtKm(seg.toKm) }} km · {{ segmentSpots[i]?.length ?? 0 }} 处景点
                      </span>
                      <span class="drive-seg__bar">
                        <span
                          class="drive-seg__fill"
                          :style="{ transform: `scaleX(${(segmentSpots[i]?.length ?? 0) / maxSegmentSpots})` }"
                        ></span>
                      </span>
                    </span>
                    <span class="drive-seg__num">{{ segmentSpots[i]?.length ?? 0 }}</span>
                  </button>
                </li>
              </ul>
              <p class="drive-seg__hint">{{ segmentSourceNote }}；点击可只看该段并高亮</p>
            </section>

            <!-- R2：精选景点 -->
            <section v-if="featuredSpots.length && activeSegment === null" class="rv-card drive-featured">
              <div class="drive-road-side__head">
                <h2 class="drive-block-title">精选景点</h2>
                <span class="drive-road-side__count">{{ featuredSpots.length }} 处</span>
              </div>
              <ul class="drive-featured__list">
                <li v-for="s in featuredSpots" :key="'f-' + s.id">
                  <button
                    type="button"
                    class="drive-featured__card"
                    :class="{ 'is-on': focusTarget?.name === s.name }"
                    @click="focusSpotOnMap(s)"
                  >
                    <span class="drive-featured__rank">{{ featuredSpots.indexOf(s) + 1 }}</span>
                    <span class="drive-featured__main">
                      <span class="drive-featured__name">
                        {{ s.name }}
                        <!-- 外文名条目：说明为何显示为外文（OSM 无中文名，不凭空翻译） -->
                        <span v-if="!hasChineseName(s.name)" class="drive-untranslated" title="数据源无中文名，未做机器翻译">未译名</span>
                      </span>
                      <span class="drive-featured__meta">
                        <span class="drive-featured__km">K{{ fmtKm(s.progressKm) }}</span>
                        <span v-if="spotCategoryCn(s.category)" class="drive-featured__cat">{{ spotCategoryCn(s.category) }}</span>
                        <span v-if="s.province" class="drive-featured__prov">{{ s.province }}</span>
                      </span>
                    </span>
                    <span class="drive-featured__score">
                      <span class="drive-spot__tier" :class="'is-' + s.tier">{{ s.tier }}</span>
                      <span class="drive-featured__score-num">{{ s.score }}</span>
                    </span>
                  </button>
                </li>
              </ul>
              <p class="drive-seg__hint">
                按沿线景点的观赏评分（score）降序取前 {{ FEATURED_LIMIT }} 处，优先选有中文名的条目；点击可在地图上定位
                <template v-if="featuredLatinCount">
                  。其中 {{ featuredLatinCount }} 处数据源无中文名（标「未译名」）
                </template>
              </p>
            </section>

            <!-- 景点列表 -->
            <section class="rv-card">
              <div class="drive-road-side__head">
                <h2 class="drive-block-title">
                  <template v-if="activeSegment === null">沿线景点</template>
                  <template v-else>第 {{ activeSegment + 1 }} 段的景点</template>
                </h2>
                <span class="drive-road-side__count">{{ visibleSpots.length }} 处</span>
              </div>

              <!-- B3：景点加载失败时的独立错误态 + 重试（不牵连整页） -->
              <div v-if="alongError" class="drive-road-degraded">
                <p>沿途景点加载失败：{{ alongError }}</p>
                <button type="button" class="btn ghost btn-sm" :disabled="retryingAlong" @click="retryAlong">
                  {{ retryingAlong ? '重试中…' : '重试' }}
                </button>
              </div>

              <template v-else>
                <ul v-if="visibleSpots.length" class="drive-road-spots">
                  <li v-for="s in visibleSpots" :key="s.id">
                    <button
                      type="button"
                      class="drive-road-spot"
                      :class="{ 'is-on': focusTarget?.name === s.name, 'is-latin': !hasChineseName(s.name) }"
                      @click="focusSpotOnMap(s)"
                    >
                      <span class="drive-spot__km">K{{ fmtKm(s.progressKm) }}</span>
                      <span class="drive-road-spot__main">
                        <span class="drive-road-spot__name">
                          {{ s.name }}
                          <span v-if="!hasChineseName(s.name)" class="drive-untranslated" title="数据源无中文名，未做机器翻译">未译名</span>
                        </span>
                        <span v-if="spotCategoryCn(s.category)" class="drive-road-spot__cat">
                          {{ spotCategoryCn(s.category) }}
                        </span>
                      </span>
                      <span class="drive-spot__tier" :class="'is-' + s.tier">{{ s.tier }}</span>
                    </button>
                  </li>
                </ul>
                <p v-else class="drive-road-degraded">
                  已收录几何，但该路段暂无匹配景点（景点库仍在扩充中）。
                </p>
                <div class="drive-actions">
                  <router-link class="btn primary btn-sm" :to="`/drive/trip?road=${encodeURIComponent(code)}`">
                    看全部沿程景点 →
                  </router-link>
                  <button type="button" class="btn ghost btn-sm" @click="goTripLive">实时态（我在哪）</button>
                </div>
              </template>
            </section>
          </aside>
        </div>

        <footer class="drive-footnote">
          路网数据来自 OpenStreetMap 众包数据，里程与走向为估算，不作为导航依据。
        </footer>
      </template>
    </main>
  </div>
</template>
