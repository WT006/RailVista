<script setup lang="ts">
/**
 * 万里路书 · 沿程页（PRD §2.3 DriveTrip，本版最重要的页面）。
 *
 * 入口共用同一套沿程匹配器（PRD §5.4）：
 *   C1 点对点   /drive/trip?from=上海&to=拉萨     规划引擎出折线
 *   C2 整条公路 /drive/trip?road=G318              L1 几何直接就是折线
 *   路书条目    /drive/trip?route=qinghai-gansu-ring（v1 打样）
 *
 * 布局：左路线卡 + 进度 + 即将到达 / 中地图 / 右沿程景点流。
 * 有定位时静默投影到折线推进进度；无定位可点进度条预览。
 * 地图为离线 SVG（中国轮廓 + 当前路线 + 动态取景框），零密钥依赖。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  buildChapterVisualScale,
  kmToVisualPct,
  projectToRoute,
  visualPctToKm,
  type AlongSpot,
  type RoadChapter,
  type RoadRoute,
} from '@railvista/shared';
import { api } from '../api/client';
import DriveSubNav from '../components/DriveSubNav.vue';
import RoadSideBadge from '../components/drive/RoadSideBadge.vue';
import RoadSpotCard from '../components/drive/RoadSpotCard.vue';
import { useGeolocation } from '../composables/useGeolocation';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import { useRoadDraw } from '../composables/useRoadDraw';
import outlineRaw from '../assets/china-outline.svg?raw';
import { CHINA_OUTLINE_VIEWBOX, lngLatToViewBox } from '../data/chinaBackdrop';
import { driveTierColor } from '../data/roadColors';
import { spotCategoryLabel } from '../data/roadSpotLabels';
import { loadAmap } from '../map/amap';
import {
  buildDriveCurrentFromPage,
  clearDriveCurrentTrip,
  driveTripKeyFromQuery,
  getDriveCurrentTrip,
  isDriveCurrentPinned,
  setDriveCurrentTrip,
  updateDriveCurrentProgress,
} from '../lib/driveCurrentTrip';

usePointerSpotlight();
const routePathRef = ref<SVGPathElement | null>(null);
useRoadDraw(routePathRef);

const route = useRoute();
const router = useRouter();

const tripKey = computed(() => driveTripKeyFromQuery(route.query));
const isPinnedCurrent = ref(false);
const pinToast = ref('');
let pinToastTimer: number | undefined;

function refreshPinState() {
  isPinnedCurrent.value = isDriveCurrentPinned(tripKey.value);
}

function showPinToast(msg: string) {
  pinToast.value = msg;
  if (pinToastTimer) window.clearTimeout(pinToastTimer);
  pinToastTimer = window.setTimeout(() => {
    pinToast.value = '';
  }, 2200);
}

function setAsCurrentTrip() {
  if (!roadRoute.value || !tripKey.value) return;
  if (isPinnedCurrent.value) {
    clearDriveCurrentTrip();
    isPinnedCurrent.value = false;
    showPinToast('已取消当前行程');
    return;
  }
  const kind = entryMode.value;
  const built = buildDriveCurrentFromPage({
    kind,
    title: roadRoute.value.name,
    from: kind === 'od' ? String(route.query.from ?? '') : undefined,
    to: kind === 'od' ? String(route.query.to ?? '') : undefined,
    road: kind === 'road' ? String(route.query.road ?? '') : undefined,
    route: kind === 'route' ? String(route.query.route ?? '') : undefined,
    progress: progress.value,
  });
  if (!built) {
    showPinToast('设置失败');
    return;
  }
  setDriveCurrentTrip(built);
  isPinnedCurrent.value = true;
  showPinToast('已设为当前行程');
}

const VIEW_W = CHINA_OUTLINE_VIEWBOX.width;
const VIEW_H = CHINA_OUTLINE_VIEWBOX.height;
const outlinePaths = (() => {
  const m = /<g[^>]*>([\s\S]*?)<\/g>/.exec(outlineRaw);
  return m ? m[1].trim() : '';
})();

/** 偏离路线超过此阈值（米）时不推进进度 */
const OFF_ROUTE_MAX_M = 5000;
/** 即将到达：前方多少公里内的景点 */
const UPCOMING_LOOKAHEAD_KM = 80;
const UPCOMING_LIMIT = 5;

// ── 数据加载 ─────────────────────────────────────────────────────────────────
const loading = ref(true);
const error = ref('');
const roadRoute = ref<RoadRoute | null>(null);
const spots = ref<AlongSpot[]>([]);
/** 未贯通段景点（局部里程）；不并进主链进度 / 即将到达 */
const orphanSpots = ref<AlongSpot[]>([]);
const spotStats = ref<{ main: number; orphan: number } | null>(null);
const chapters = ref<RoadChapter[]>([]);
const spotLibrary = ref<{
  count: number;
  updated: string;
  note?: string;
  version?: number;
  stats?: {
    bySource?: Record<string, number>;
    byDetourClass?: Record<string, number>;
    withRating?: number;
    withVisitHours?: number;
    withIntro?: number;
    withPhoto?: number;
  };
} | null>(null);
const progress = ref(0);

const entryMode = computed<'od' | 'road' | 'route'>(() => {
  if (route.query.road) return 'road';
  if (route.query.route) return 'route';
  return 'od';
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params: Parameters<typeof api.getDriveAlong>[0] = {};
    if (entryMode.value === 'road') params.road = String(route.query.road);
    else if (entryMode.value === 'route') params.route = String(route.query.route);
    else {
      params.from = String(route.query.from ?? '');
      params.to = String(route.query.to ?? '');
      if (!params.from || !params.to) {
        error.value = '缺少起终点：回到首页输入起点与终点';
        return;
      }
    }
    const data = await api.getDriveAlong(params);
    roadRoute.value = data.route;
    spots.value = data.spots;
    orphanSpots.value = data.orphanSpots ?? [];
    spotStats.value = data.spotStats ?? {
      main: data.spots.length,
      orphan: (data.orphanSpots ?? []).length,
    };
    chapters.value = data.chapters ?? [];
    spotLibrary.value = data.spotLibrary ?? null;

    const p = Number(route.query.progress);
    if (Number.isFinite(p)) progress.value = Math.max(0, Math.min(1, p));
    else {
      const pinned = getDriveCurrentTrip();
      if (pinned && pinned.key === tripKey.value && pinned.progress != null) {
        progress.value = Math.max(0, Math.min(1, pinned.progress));
      }
    }
    refreshPinState();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => [route.query.road, route.query.route, route.query.from, route.query.to],
  () => {
    void load();
  },
);

watch(progress, (p) => {
  const key = tripKey.value;
  if (key && isPinnedCurrent.value) updateDriveCurrentProgress(key, p);
});

onBeforeUnmount(() => {
  if (pinToastTimer) window.clearTimeout(pinToastTimer);
});

// ── 地图（离线 SVG：主链 + 未贯通段 + 动态取景框） ─────────────────────────────
/** 超短线 viewBox <1 时 toFixed(1) 会把折线量化成折角钩子，按跨度选精度 */
function pathCoordDecimals(coords: [number, number][]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [lng, lat] of coords) {
    const [x, y] = lngLatToViewBox(lng, lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY, 0.05);
  if (span < 2) return 3;
  if (span < 12) return 2;
  return 1;
}

function pathFromCoords(coords: [number, number][] | undefined): string {
  if (!coords || coords.length < 2) return '';
  const dec = pathCoordDecimals(coords);
  let d = '';
  for (let i = 0; i < coords.length; i++) {
    const [lng, lat] = coords[i]!;
    const [x, y] = lngLatToViewBox(lng, lat);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(dec)} ${y.toFixed(dec)}`;
  }
  return d;
}

const routePath = computed(() => pathFromCoords(roadRoute.value?.coords as [number, number][] | undefined));

/** 未贯通 orphan 段：虚线绘制，与 DriveRoad 一致——景点挂在这些段上，不画就会「点飞线外」 */
const segmentPaths = computed(() => {
  const segs = roadRoute.value?.segments;
  if (!segs?.length) return [] as string[];
  return segs
    .map((seg) => pathFromCoords(seg as [number, number][]))
    .filter(Boolean);
});

const gapAnnotations = computed(() => roadRoute.value?.gapAnnotations ?? []);
const hasGaps = computed(() => gapAnnotations.value.length > 0 || segmentPaths.value.length > 0);
const maxGapKm = computed(() =>
  gapAnnotations.value.reduce((m, g) => Math.max(m, g.gapKm), 0),
);

const focusBbox = computed<[number, number, number, number]>(() => {
  const coords = roadRoute.value?.coords;
  if (!coords || !coords.length) return [0, 0, VIEW_W, VIEW_H];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const absorb = (lng: number, lat: number) => {
    const [x, y] = lngLatToViewBox(lng, lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const [lng, lat] of coords) absorb(lng, lat);
  // 未贯通段必须纳入取景；取景只跟路线几何，勿被离线景点主导 bbox（invariants §5）
  for (const seg of roadRoute.value?.segments ?? []) {
    for (const pt of seg) absorb(pt[0], pt[1]);
  }

  // 短途在全国投影里可能不到 1 个 viewBox 单位（2km 级 ~0.3）；
  // 禁止绝对 pad=20 / 强制 min=1，否则线挤中间、圆点相对巨粗。
  const rawW = Math.max(maxX - minX, 0.05);
  const rawH = Math.max(maxY - minY, 0.05);
  // 多段公路跨度大：用 meet 等比居中，不用 slice（避免裁掉边段）
  const TARGET_AR = 4 / 3;
  let boxW = rawW;
  let boxH = rawH;
  if (boxW / boxH > TARGET_AR) boxH = boxW / TARGET_AR;
  else boxW = boxH * TARGET_AR;
  const padX = Math.max(boxW * 0.18, rawW * 0.14);
  const padY = Math.max(boxH * 0.18, rawH * 0.14);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return [cx - boxW / 2 - padX, cy - boxH / 2 - padY, boxW + padX * 2, boxH + padY * 2];
});

const viewBoxAttr = computed(() => {
  const [x, y, w, h] = focusBbox.value;
  // 超短线 viewBox 可能 <1，必须保留小数，禁止再 Math.max(., 1) 把框撑开
  const dec = Math.max(w, h) < 8 ? 3 : 1;
  return `${x.toFixed(dec)} ${y.toFixed(dec)} ${Math.max(w, 0.05).toFixed(dec)} ${Math.max(h, 0.05).toFixed(dec)}`;
});

const mapSvgRef = ref<SVGSVGElement | null>(null);
/** SVG 短边像素，供圆点按屏幕尺寸换算 */
const mapSvgPx = ref(420);
let mapSvgRo: ResizeObserver | null = null;

function syncMapSvgPx() {
  const el = mapSvgRef.value;
  if (!el) return;
  const px = Math.min(el.clientWidth || 0, el.clientHeight || 0);
  if (px > 0) mapSvgPx.value = px;
}

watch(
  mapSvgRef,
  (el) => {
    mapSvgRo?.disconnect();
    mapSvgRo = null;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      void nextTick(syncMapSvgPx);
      return;
    }
    mapSvgRo = new ResizeObserver(() => syncMapSvgPx());
    mapSvgRo.observe(el);
    void nextTick(syncMapSvgPx);
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  mapSvgRo?.disconnect();
  mapSvgRo = null;
});

/** 圆点按屏幕像素计（目标直径 ~8px），与线宽 non-scaling 同思路，超短线不再糊成一坨 */
const mapDotR = computed(() => {
  const [, , w, h] = focusBbox.value;
  const span = Math.max(w, h, 0.05);
  const px = Math.max(mapSvgPx.value, 120);
  const targetDiameterPx = 8;
  return (targetDiameterPx / px) * (span / 2);
});

/** 有未贯通段时用 meet，保证全部分量可见；单链仍用 slice 铺满预览卡 */
const mapAspectRatio = computed(() =>
  segmentPaths.value.length ? 'xMidYMid meet' : 'xMidYMid slice',
);

function spotPos(s: AlongSpot): [number, number] {
  return lngLatToViewBox(s.lng, s.lat);
}

/** 总览只画落在取景框内、且离路线不远的点；远绕景点留在右侧列表 */
function spotInFocus(s: AlongSpot): boolean {
  const [x, y, bw, bh] = focusBbox.value;
  const [sx, sy] = spotPos(s);
  const m = Math.max(bw, bh) * 0.02;
  if (sx < x - m || sy < y - m || sx > x + bw + m || sy > y + bh + m) return false;
  const routeKm = roadRoute.value?.lengthKm ?? 0;
  const nearKm = Math.max(1.2, Math.min(4, routeKm * 0.35 + 0.8));
  return s.distKm <= nearKm;
}

const mapSpots = computed(() => filteredSpots.value.filter(spotInFocus));
const mapOrphanSpots = computed(() => orphanSpots.value.filter(spotInFocus));

const expandedSpotId = ref('');

function toggleSpot(s: AlongSpot) {
  expandedSpotId.value = expandedSpotId.value === s.id ? '' : s.id;
}

function openFullMap() {
  // 提前拉高德脚本，进入全屏页时少等一轮网络
  const key = import.meta.env.VITE_AMAP_KEY as string | undefined;
  if (key) {
    void loadAmap(key, import.meta.env.VITE_AMAP_SECURITY as string | undefined);
  }
  void router.push({
    path: '/drive/trip/map',
    query: { ...route.query, progress: String(progress.value) },
  });
}

// ── 景点流过滤 ────────────────────────────────────────────────────────────────
const CATEGORY_FILTERS = [
  { key: 'nature', label: '自然' },
  { key: 'culture', label: '人文' },
  { key: 'engineering', label: '工程' },
  { key: 'viewpoint', label: '观景' },
  { key: 'experience', label: '体验' },
  { key: 'service', label: '服务' },
];
/**
 * 「可达性」筛选替代原来的「只看值得绕行」开关。
 * 自驾最关心的不是距离数字，而是**能不能顺路到** —— 按 detourClass 三档给，
 * 用户一眼就能把「路过就能看」和「值得专程跑一趟」分开。
 */
const REACH_FILTERS = [
  { key: 'pass', label: '顺路即停', hint: '路线经过或就在路边（≤1 km）' },
  { key: 'detour', label: '短绕可达', hint: '绕几公里，20 分钟内能打个来回（≤12 km）' },
  { key: 'spur', label: '专程绕行', hint: '超出常规沿程范围，需单独安排时间' },
];
const activeCategories = ref<string[]>([]);
const activeReach = ref<string[]>([]);
const filterPulse = ref(false);

const filteredSpots = computed(() => {
  let list = spots.value;
  if (activeCategories.value.length) {
    list = list.filter((s) => activeCategories.value.some((c) => s.category.startsWith(c)));
  }
  if (activeReach.value.length) {
    // 缺省（无 detourClass）按距离兜底分档，与数据层 alongClassOf 同口径
    list = list.filter((s) =>
      activeReach.value.includes(s.detourClass ?? (s.distKm <= 1 ? 'pass' : s.distKm <= 12 ? 'detour' : 'spur')),
    );
  }
  return list;
});

function toggleReach(key: string) {
  const i = activeReach.value.indexOf(key);
  if (i >= 0) activeReach.value.splice(i, 1);
  else activeReach.value.push(key);
  pulseFilterList();
}

function pulseFilterList() {
  filterPulse.value = false;
  void nextTick(() => {
    filterPulse.value = true;
  });
}

function toggleCategory(key: string) {
  const i = activeCategories.value.indexOf(key);
  if (i >= 0) activeCategories.value.splice(i, 1);
  else activeCategories.value.push(key);
  pulseFilterList();
}

// ── 展示辅助 ─────────────────────────────────────────────────────────────────
const TIER_LABEL: Record<string, string> = { A: '讲解级', B: '沿途可看', C: '小确幸' };

function tierColor(tier: string): string {
  return driveTierColor(tier);
}

function detourText(s: AlongSpot): string {
  if (s.visibility === 'distant') return '远景可见 · 不引导绕行';
  if (s.detourKm <= 0) return '就在路边，可停车即看';
  const min = Math.max(4, Math.round((s.detourKm / 30) * 60 / 4) * 4);
  return `绕行 ${s.detourKm} 公里 · 约 ${min} 分钟`;
}

function kmText(km: number): string {
  return `K${Math.round(km)}`;
}

function categoryLabel(cat: string): string {
  return spotCategoryLabel(cat);
}

// ── 沿程进度跨度 ─────────────────────────────────────────────────────────────
// lengthKm 常是「全线名义/去重后里程」（含未贯通分量），章节与主链 cumKm 只覆盖
// 已贯通主链。进度条若用 lengthKm 当分母，分段会全部挤在左侧（G331 实测
// 章节止于 ~1.5k km，而 lengthKm=9373）。
const nominalKm = computed(() => roadRoute.value?.lengthKm ?? 0);
const chapterSpanKm = computed(() => {
  if (!chapters.value.length) return 0;
  return Math.max(...chapters.value.map((c) => c.toKm));
});
const chainKm = computed(() => {
  const cum = roadRoute.value?.cumKm;
  if (cum?.length) return cum[cum.length - 1]!;
  return 0;
});
/**
 * 进度条跨度只认「章节 / 主链」——不要把未贯通段与飞点景点里程并进来。
 * 并入会把章节挤到左侧一小截（G101 章节 367km、景点偏移到 1000+km），
 * 进度条看起来像坏了。断段景点仍在右侧列表与「即将到达」回退里可见。
 */
const spanKm = computed(() => {
  const span = Math.max(chapterSpanKm.value, chainKm.value);
  return span > 0 ? span : nominalKm.value;
});
const progressPartial = computed(
  () => nominalKm.value > 0 && spanKm.value > 0 && spanKm.value / nominalKm.value < 0.92,
);

// ── 沿程进度 / 章节 / 即将到达 ───────────────────────────────────────────────
const chaptersExpanded = ref(false);
const gpsFollowing = ref(false);

const progressKm = computed(() => progress.value * spanKm.value);

/** 混合视觉刻度：短段保底可见，长段仍更宽；真实公里逻辑不变 */
const chapterVisualScale = computed(() =>
  buildChapterVisualScale(chapters.value, spanKm.value),
);

const progressPct = computed(() => kmToVisualPct(chapterVisualScale.value, progressKm.value));

const activeChapterIndex = computed(() => {
  const km = progressKm.value;
  const idx = chapters.value.findIndex((ch) => km >= ch.fromKm && km < ch.toKm);
  if (idx >= 0) return idx;
  if (chapters.value.length && km >= chapters.value[chapters.value.length - 1]!.toKm) {
    return chapters.value.length - 1;
  }
  return 0;
});

const activeChapter = computed(() => chapters.value[activeChapterIndex.value] ?? null);

/** 当前段标题：优先「地名 — 地名」；退化里程段则直接展示区间 */
const activeChapterTitle = computed(() => {
  const ch = activeChapter.value;
  if (!ch) return '';
  // 去掉「第 N 段 ·」前缀（徽章已有段号），只留地名或里程区间
  return ch.title.replace(/^第\s*\d+\s*段\s*[·•]\s*/, '');
});

const activeChapterRange = computed(() => {
  const ch = activeChapter.value;
  if (!ch) return '';
  // 地名标题时补一行里程区间；本身已是「0—120 km」则不再重复
  if (/km\s*$/i.test(ch.title)) return '';
  return `${Math.round(ch.fromKm)}—${Math.round(ch.toKm)} km`;
});

const routeEndpoints = computed(() => {
  if (!chapters.value.length) return { start: '', end: '' };
  const split = (title: string) => {
    const parts = title.split(/\s*[—–-]\s*/);
    if (parts.length >= 2) return { from: parts[0]!.trim(), to: parts[parts.length - 1]!.trim() };
    return { from: title.trim(), to: '' };
  };
  const first = split(chapters.value[0]!.title);
  const last = split(chapters.value[chapters.value.length - 1]!.title);
  // 退化标题「第 1 段 · 0—120 km」拆出来会是「第 1 段 · 0」——此时用起讫声明兜底
  const looksLikeKmFallback = (s: string) => /第\s*\d+\s*段/.test(s) || /^\d+(\.\d+)?$/.test(s) || /km$/i.test(s);
  const start = looksLikeKmFallback(first.from) ? (roadRoute.value?.name?.split(/\s+/)[0] ?? first.from) : first.from;
  let end = last.to || last.from;
  if (looksLikeKmFallback(end)) end = '';
  return { start, end };
});

/**
 * 即将到达：优先前方 UPCOMING_LOOKAHEAD_KM 内；
 * 窗口为空时回退到「下一处起」的最近 N 个（G101 首景点在 K169，
 * 进度 0 时若死守 80km 窗口会永远空表，用户误以为没数据）。
 */
const upcomingSpots = computed(() => {
  const km = progressKm.value;
  const ahead = spots.value
    .filter((s) => s.progressKm > km - 0.2)
    .sort((a, b) => a.progressKm - b.progressKm || b.score - a.score);
  const inWindow = ahead.filter((s) => s.progressKm <= km + UPCOMING_LOOKAHEAD_KM);
  return (inWindow.length ? inWindow : ahead).slice(0, UPCOMING_LIMIT);
});

const upcomingBeyondLookahead = computed(() => {
  if (!upcomingSpots.value.length) return false;
  const km = progressKm.value;
  return upcomingSpots.value.every((s) => s.progressKm > km + UPCOMING_LOOKAHEAD_KM);
});

function aheadText(s: AlongSpot): string {
  const d = s.progressKm - progressKm.value;
  if (d < 0.3) return '即将到达';
  if (d < 1) return `${Math.round(d * 1000)} 米`;
  return `${d.toFixed(1)} 公里`;
}

function chapterLeftPct(ch: RoadChapter, index: number): number {
  return chapterVisualScale.value.slices[index]?.leftPct ?? 0;
}

function chapterWidthPct(_ch: RoadChapter, index: number): number {
  return chapterVisualScale.value.slices[index]?.widthPct ?? 0;
}

function spotsInChapter(ch: RoadChapter): number {
  return spots.value.filter((s) => s.progressKm >= ch.fromKm && s.progressKm < ch.toKm).length;
}

function toggleChaptersExpanded() {
  chaptersExpanded.value = !chaptersExpanded.value;
}

function jumpToChapter(index: number) {
  const ch = chapters.value[index];
  if (!ch || !spanKm.value) return;
  gpsFollowing.value = false;
  progress.value = Math.min(1, Math.max(0, (ch.fromKm + 0.001) / spanKm.value));
}

function jumpToProgress(event: MouseEvent) {
  const track = event.currentTarget as HTMLElement;
  const rect = track.getBoundingClientRect();
  const visualRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  gpsFollowing.value = false;
  if (!spanKm.value) {
    progress.value = visualRatio;
    return;
  }
  const km = visualPctToKm(chapterVisualScale.value, visualRatio * 100);
  progress.value = Math.max(0, Math.min(1, km / spanKm.value));
}

/** 键盘微调：按视觉 1% 步进，短段上更好点到 */
function nudgeProgress(visualDelta: number) {
  gpsFollowing.value = false;
  if (!spanKm.value) {
    progress.value = Math.max(0, Math.min(1, progress.value + visualDelta));
    return;
  }
  const nextPct = Math.max(0, Math.min(100, progressPct.value + visualDelta * 100));
  const km = visualPctToKm(chapterVisualScale.value, nextPct);
  progress.value = Math.max(0, Math.min(1, km / spanKm.value));
}

// 有定位时静默推进进度（无独立「我在哪」面板）
const { gps } = useGeolocation();
watch(gps, (sample) => {
  if (!sample || !spanKm.value) return;
  const coords = roadRoute.value?.coords;
  if (!coords || coords.length < 2) return;
  const proj = projectToRoute(coords, sample.lng, sample.lat);
  if (proj.offRouteM > OFF_ROUTE_MAX_M) {
    gpsFollowing.value = false;
    return;
  }
  gpsFollowing.value = true;
  progress.value = Math.max(0, Math.min(1, proj.alongKm / spanKm.value));
});
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
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
      </div>
      <div v-else-if="error || !roadRoute" class="drive-empty drive-empty--error">
        {{ error || '未找到路线' }}
        <div class="drive-actions" style="justify-content: center">
          <router-link class="btn ghost btn-sm" to="/drive">回首页重新规划</router-link>
        </div>
      </div>

      <template v-else>
        <div class="drive-trip-grid">
          <!-- 左：路线卡 -->
          <aside class="drive-trip-side">
            <section class="rv-card drive-route-card is-flat" data-spotlight>
              <span class="drive-route-card__name" style="font-size: var(--fs-h3)">{{ roadRoute.name }}</span>
              <div class="drive-route-card__meta" style="flex-direction: column; align-items: flex-start; gap: 4px">
                <span>全程 {{ roadRoute.lengthKm }} km<template v-if="roadRoute.durationMin"> · 约 {{ Math.round(roadRoute.durationMin / 60) }} 小时</template></span>
                <span>
                  沿程景点 {{ spotStats?.main ?? spots.length }} 处
                  <template v-if="(spotStats?.orphan ?? orphanSpots.length) > 0">
                    · 未贯通段另 {{ spotStats?.orphan ?? orphanSpots.length }} 处
                  </template>
                  · 章节 {{ chapters.length }} 段
                </span>
                <span v-if="roadRoute.roadKeys.length" class="drive-trip-roadkeys">
                  <span
                    v-for="k in roadRoute.roadKeys.slice(0, 6)"
                    :key="k"
                    class="drive-trip-roadkey"
                  >{{ k }}</span>
                </span>
              </div>
              <button
                type="button"
                class="map-pin-trip-btn drive-pin-trip-btn"
                :class="{ 'is-active': isPinnedCurrent }"
                @click="setAsCurrentTrip"
              >
                {{ isPinnedCurrent ? '取消当前行程' : '设为当前行程' }}
              </button>
            </section>

            <!-- 沿程进度：默认进度条，点击展开全部章节 -->
            <section v-if="chapters.length" class="rv-card drive-chprog">
              <button
                type="button"
                class="drive-chprog__head"
                :aria-expanded="chaptersExpanded"
                @click="toggleChaptersExpanded"
              >
                <span class="drive-chprog__title">沿程进度</span>
                <span class="drive-chprog__km">{{ Math.round(progressKm) }} / {{ Math.round(spanKm) }} km</span>
                <span class="drive-chprog__chevron" :class="{ 'is-open': chaptersExpanded }" aria-hidden="true" />
              </button>

              <div class="drive-chprog__body">
                <div class="drive-chprog__ends">
                  <span>{{ routeEndpoints.start }}</span>
                  <span>{{ routeEndpoints.end }}</span>
                </div>

                <div
                  class="drive-chprog__track"
                  role="slider"
                  :aria-valuenow="Math.round(progressKm)"
                  aria-valuemin="0"
                  :aria-valuemax="Math.round(spanKm)"
                  aria-label="沿程进度"
                  tabindex="0"
                  @click="jumpToProgress"
                  @keydown.left.prevent="nudgeProgress(-0.01)"
                  @keydown.right.prevent="nudgeProgress(0.01)"
                >
                  <div class="drive-chprog__segments" aria-hidden="true">
                    <div
                      v-for="(ch, i) in chapters"
                      :key="'seg-' + i"
                      class="drive-chprog__segment"
                      :class="{ 'is-done': i < activeChapterIndex, 'is-current': i === activeChapterIndex }"
                      :style="{ left: chapterLeftPct(ch, i) + '%', width: chapterWidthPct(ch, i) + '%' }"
                    />
                  </div>
                  <div class="drive-chprog__fill" :style="{ width: progressPct + '%' }" />
                  <div class="drive-chprog__thumb" :style="{ left: progressPct + '%' }" />
                </div>

                <p v-if="progressPartial" class="drive-chprog__partial">
                  章节覆盖已贯通主链 {{ Math.round(Math.max(chapterSpanKm, chainKm)) }} km · 全线名义 {{ Math.round(nominalKm) }} km
                </p>

                <div v-if="!chaptersExpanded && activeChapter" class="drive-chprog__now">
                  <span class="drive-chprog__now-badge">第 {{ activeChapterIndex + 1 }}/{{ chapters.length }} 段</span>
                  <span class="drive-chprog__now-title">{{ activeChapterTitle }}</span>
                  <span v-if="activeChapterRange" class="drive-chprog__hint">{{ activeChapterRange }}</span>
                  <span class="drive-chprog__hint">
                    <template v-if="gpsFollowing">定位跟随中 · </template>点击标题展开全部章节
                  </span>
                </div>

                <Transition name="drive-chprog-expand">
                  <ul v-if="chaptersExpanded" class="drive-chprog__list">
                    <li v-for="(ch, i) in chapters" :key="'ch-' + i">
                      <button
                        type="button"
                        class="drive-chprog__item"
                        :class="{ 'is-active': i === activeChapterIndex, 'is-done': i < activeChapterIndex }"
                        @click="jumpToChapter(i)"
                      >
                        <span class="drive-chprog__item-dot" aria-hidden="true" />
                        <span class="drive-chprog__item-body">
                          <span class="drive-chprog__item-title">{{ ch.title }}</span>
                          <span class="drive-chprog__item-meta">
                            {{ Math.round(ch.fromKm) }}—{{ Math.round(ch.toKm) }} km · {{ spotsInChapter(ch) }} 处景点
                          </span>
                        </span>
                        <span v-if="i === activeChapterIndex" class="drive-chprog__item-here">当前</span>
                        <span v-else-if="i < activeChapterIndex" class="drive-chprog__item-done" aria-hidden="true">✓</span>
                      </button>
                    </li>
                  </ul>
                </Transition>
              </div>
            </section>

            <!-- 即将到达（按当前进度前方景点） -->
            <section class="rv-card drive-upcoming">
              <div class="drive-upcoming__head">
                <h2 class="drive-block-title">即将到达</h2>
                <span class="drive-upcoming__range">
                  {{ upcomingBeyondLookahead ? '下一处起' : `前方 ${UPCOMING_LOOKAHEAD_KM} km` }}
                </span>
              </div>
              <ul v-if="upcomingSpots.length" class="drive-upcoming__list">
                <li v-for="(s, i) in upcomingSpots" :key="s.id">
                  <button
                    type="button"
                    class="drive-upcoming__item"
                    :class="{ 'is-next': i === 0, 'is-on': expandedSpotId === s.id }"
                    @click="toggleSpot(s)"
                  >
                    <span class="drive-upcoming__ahead">{{ aheadText(s) }}</span>
                    <span class="drive-upcoming__body">
                      <span class="drive-upcoming__name">{{ s.name }}</span>
                      <span class="drive-upcoming__meta">
                        {{ kmText(s.progressKm) }} · {{ categoryLabel(s.category) }} · {{ detourText(s) }}
                      </span>
                      <!-- 自驾要提前知道往哪边拐，所以这里必须带方位 -->
                      <RoadSideBadge
                        class="drive-upcoming__side"
                        :side="s.side"
                        :dist-km="s.distKm"
                        :low="s.sideConfidence === 'low'"
                        compact
                      />
                    </span>
                    <span class="drive-spot__tier" :class="'is-' + s.tier">{{ TIER_LABEL[s.tier] ?? s.tier }}</span>
                  </button>
                </li>
              </ul>
              <p v-else class="drive-upcoming__empty">前方暂无匹配景点，点进度条可预览沿途</p>
            </section>
          </aside>

          <!-- 中：地图（主链 + 未贯通段；点击进入全屏高德地图） -->
          <section class="drive-trip-map rv-card is-enterable" data-spotlight>
            <svg
              ref="mapSvgRef"
              :viewBox="viewBoxAttr"
              :preserveAspectRatio="mapAspectRatio"
              class="drive-trip-map__svg"
              role="img"
              aria-label="路线示意图，点击进入全屏地图"
              @click="openFullMap"
            >
              <g class="drive-netmap__outline" v-html="outlinePaths" />
              <path ref="routePathRef" class="drive-trip-map__route" :d="routePath" />
              <path
                v-for="(d, i) in segmentPaths"
                :key="'seg-' + i"
                class="drive-trip-map__segment"
                :d="d"
              />
              <circle
                v-for="s in mapSpots"
                :key="s.id"
                class="drive-trip-map__dot"
                :cx="spotPos(s)[0]"
                :cy="spotPos(s)[1]"
                :r="expandedSpotId === s.id ? mapDotR * 1.7 : mapDotR"
                :fill="tierColor(s.tier)"
                :class="{ 'is-expanded': expandedSpotId === s.id }"
                @click.stop="toggleSpot(s)"
              >
                <title>{{ s.name }} · {{ kmText(s.progressKm) }}</title>
              </circle>
              <circle
                v-for="s in mapOrphanSpots"
                :key="'orphan-' + s.id"
                class="drive-trip-map__dot is-orphan"
                :cx="spotPos(s)[0]"
                :cy="spotPos(s)[1]"
                :r="mapDotR * 0.85"
                :fill="tierColor(s.tier)"
                opacity="0.55"
                @click.stop="toggleSpot(s)"
              >
                <title>{{ s.name }} · 未贯通段</title>
              </circle>
            </svg>
            <button type="button" class="drive-trip-map__enter" @click="openFullMap">
              <svg class="drive-trip-map__enter-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
                />
              </svg>
              进入地图
            </button>
            <p v-if="hasGaps" class="drive-trip-map__gap-note">
              虚线未贯通 · {{ segmentPaths.length }} 段<template v-if="maxGapKm > 0"> · 最大断口 {{ maxGapKm.toFixed(0) }} km</template>
            </p>
            <p class="drive-trip-map__hint">
              {{ roadRoute.engineNote || 'OSM 示意' }}
            </p>
          </section>

          <!-- 右：沿程景点流 -->
          <section class="drive-trip-flow">
            <div class="drive-flow-head">
              <h2 class="drive-block-title">沿程景点流<span>（按里程升序）</span></h2>
              <div class="drive-flow-filters">
                <button
                  v-for="f in CATEGORY_FILTERS"
                  :key="f.key"
                  type="button"
                  class="road-kbd__chip"
                  :class="{ 'is-on': activeCategories.includes(f.key) }"
                  @click="toggleCategory(f.key)"
                >
                  {{ f.label }}
                </button>
                <button
                  v-for="r in REACH_FILTERS"
                  :key="r.key"
                  type="button"
                  class="road-kbd__chip is-reach"
                  :class="{ 'is-on': activeReach.includes(r.key) }"
                  :title="r.hint"
                  @click="toggleReach(r.key)"
                >
                  {{ r.label }}
                </button>
              </div>
            </div>

            <div
              class="drive-flow-list"
              :class="{ 'is-filter-pulse': filterPulse }"
              @animationend="filterPulse = false"
            >
              <RoadSpotCard
                v-for="s in filteredSpots"
                :key="s.id"
                :spot="s"
                :expanded="expandedSpotId === s.id"
                compact-distance
                @toggle="toggleSpot"
              />
            </div>
            <p v-if="!filteredSpots.length" class="drive-empty">
              该路段暂无匹配景点（试试放开筛选，或降低 minScore）
            </p>

            <p v-if="spotLibrary" class="drive-footnote" :title="spotLibrary.note">
              景点库 {{ spotLibrary.count }} 条<template v-if="spotLibrary.stats?.withRating"> ·
                {{ spotLibrary.stats.withRating }} 条带平台评分</template><template v-if="spotLibrary.stats?.withVisitHours"> ·
                {{ spotLibrary.stats.withVisitHours }} 条有开放时间</template><template v-if="spotLibrary.stats?.withPhoto"> ·
                {{ spotLibrary.stats.withPhoto }} 条有实拍图</template><br />
              路网数据来自 OpenStreetMap 众包，里程与走向为估算，不作为导航依据
            </p>
          </section>
        </div>
      </template>
    </main>

    <div v-if="pinToast" class="toast">{{ pinToast }}</div>
  </div>
</template>
