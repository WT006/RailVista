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
import type { AlongSpot, RoadAnchorSource, RoadAnchorType, RoadIndexEntry, RoadRoute } from '@railvista/shared';

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
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join('');
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
  /**
   * v0.6.5（P1-2）：段内**较弱**的一侧锚点实体类型。
   * 聚落（城镇）之外还有山口 / 景区地标 —— 「甲玛王宫 — 米拉山口」这类段名
   * 若不标注，用户会误以为两端都是城镇。UI 加弱化角标说明。
   */
  weakestType: RoadAnchorType | null;
}

/** 来源强弱：数字大者更权威 */
const SOURCE_STRENGTH: Record<RoadAnchorSource, number> = { station: 1, place: 2, amap: 3 };

/** 实体类型强弱：数字大者越「像地名」 */
const TYPE_STRENGTH: Record<string, number> = {
  settlement: 4, city: 4, junction: 3, pass: 2, station: 1, landmark: 1, service: 1, endpoint: 0,
};

/** 取两端中较弱的一侧（保守标注） */
function weakerSource(a?: RoadAnchorSource, b?: RoadAnchorSource): RoadAnchorSource | null {
  if (!a && !b) return null;
  if (!a) return b!;
  if (!b) return a;
  return SOURCE_STRENGTH[a] <= SOURCE_STRENGTH[b] ? a : b;
}

/** 同上，按实体类型取较弱一侧 */
function weakerType(a?: RoadAnchorType, b?: RoadAnchorType): RoadAnchorType | null {
  if (!a && !b) return null;
  if (!a) return b!;
  if (!b) return a;
  return (TYPE_STRENGTH[a] ?? 0) <= (TYPE_STRENGTH[b] ?? 0) ? a : b;
}

/** 实体类型 → UI 角标文案（null = 聚落，无需标注） */
const ANCHOR_TYPE_LABEL: Partial<Record<RoadAnchorType, string>> = {
  pass: '山口',
  landmark: '地标',
  station: '站名',
  junction: '省级',
  service: '服务点',
  endpoint: '端点',
};

function anchorTypeLabel(t: RoadAnchorType | null): string {
  if (!t) return '';
  return ANCHOR_TYPE_LABEL[t] ?? '';
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
      weakestType: weakerType(c.fromType, c.toType),
    }));
  }
  if (!total) return [];
  const out: RoadSegment[] = [];
  const windowKm = 120;
  for (let from = 0; from < total; from += windowKm) {
    const to = Math.min(from + windowKm, total);
    out.push({ title: `第 ${out.length + 1} 段 · ${Math.round(from)}—${Math.round(to)} km`, fromKm: from, toKm: to, byPlace: false, weakestSource: null, weakestType: null });
    if (to >= total) break;
  }
  return out;
});

/** 站名兜底段数：UI 上要如实说明有多少段名精度较低 */
const stationBasedSegmentCount = computed(
  () => segments.value.filter((s) => s.weakestSource === 'station').length,
);

/**
 * v0.6.5（P1-3）：分段覆盖率披露。
 *
 * 段名来自「沿主链反查的地名锚点」，只能覆盖主链已绘制的部分；
 * 而页面「收录里程」是全线名义里程（去重后，含未贯通的其它连通分量）。
 * 两者差距很大：G318 分段覆盖 0—1568.8km，但标称收录 5346.6km —— 只占 29.3%。
 * 不披露会让用户以为分段就是全线的完整体现。
 */
const segmentCoverage = computed(() => {
  if (!segments.value.length) return null;
  const lastKm = Math.max(...segments.value.map((s) => s.toKm));
  const drawnKm = chainMaxKm.value;
  // 分母用「主链实绘里程」，它才是分段能覆盖的上界
  const denom = totalLengthKm.value > 0 ? totalLengthKm.value : drawnKm;
  if (!(denom > 0)) return null;
  return {
    fromKm: 0,
    lastKm: Math.min(lastKm, drawnKm || lastKm),
    drawnKm,
    totalKm: denom,
    pct: Math.min(100, Math.round((Math.min(lastKm, drawnKm || lastKm) / denom) * 100)),
    /** 尾部未覆盖里程（名义里程 - 分段覆盖），>0 说明还有里程没切出地名段 */
    tailKm: Math.max(0, denom - Math.min(lastKm, drawnKm || lastKm)),
  };
});

/** 分段是否全部为里程等分（决定要不要显示降级说明） */
const segmentsByPlace = computed(() => segments.value.some((s) => s.byPlace));
const segmentSourceNote = computed(() => {
  if (!segments.value.length) return '';
  if (!segmentsByPlace.value) return '暂无中途地名，仅按里程等分（该编号尚未收录地名锚点）';
  const base = '按沿线地名切段';
  const notes: string[] = [];
  if (stationBasedSegmentCount.value > 0) {
    notes.push(`${stationBasedSegmentCount.value} 段含站名推测，精度较低`);
  }
  // P0-1 降级提示：cumKm 缺失时前端在抽稀链上重算里程，末段可能定位不到
  if (!cumKmAuthoritative.value) {
    notes.push('分段定位里程为前端估算，末段高亮可能偏移');
  }
  return notes.length ? `${base}（${notes.join('；')}）` : base;
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

/**
 * v0.6.5（P1-1）：切段时必须**同时**清掉景点定位与景点视野。
 *
 * 原实现只清 `focusTarget`，漏清 `focusViewBox` —— 于是「点景点 → 再点分段」后
 * viewBox 会卡在景点视角不回去，用户以为分段高亮失效。
 * 统一走 `clearFocus()`（它两个都清），随后再由 `activeSegmentPath` / 段视图接管。
 */
function selectSegment(i: number): void {
  const next = activeSegment.value === i ? null : i;
  activeSegment.value = next;
  // 切段时清掉景点定位与景点视野，避免上一段的视角/标记留在新视角里造成误读
  clearFocus();
  // 选中分段 → 视野收拢到该段（见 focusSegmentView）；取消 → 回到全局（clearFocus 已复位）
  if (next !== null) focusSegmentView(next);
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
/** P0-2：量 SVG 容器实际像素尺寸 —— viewBox 换算成屏幕像素必须有容器宽高，
 *  否则无法保证「高亮短边 ≥ 24px」这条判据。 */
const mapSvgRef = ref<SVGSVGElement | null>(null);

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
/** 已到缩放比上限、且到上限后仍达不到 HIGHLIGHT_TARGET_PX（UI 需如实说明，不假装成功） */
const focusCapped = ref(false);

/**
 * viewBox 序列化精度 —— 必须随视区宽度自适应。
 *
 * v0.6.5 第七轮（P1-4′）：原先固定 `toFixed(1)`。但聚焦时视区宽度由缩放比决定，
 * 极短线路走 SCALE_MAX=8000 后视区宽仅 **0.1 viewBox 单位** ——
 * 此时 ±0.05 的舍入误差**等于视区的 50%**，视区边界被推到折线之外，线被裁掉。
 * 实测 G3300（0.19km）@1440：折线 rect top=296.98 < svg rect top=319.59，**溢出 22.61px**；
 * @390 更严重：视区被 `toFixed(1)` 压成 **0.0 单位**，折线宽高直接归零（rect 0×0，整条线消失）。
 *
 * 判据：**舍入误差占视区的比例要足够小**。取 1%：
 *   需要的位数 ≈ ceil(-log10(视区宽 × 0.01))
 * 落到整数档位（阈值由「长线路实测视区宽」反推，保证其字符串逐字符不变）：
 *   · vb.w < 1   → 5 位：0.1 视区时误差 0.0005 = 0.5%  ✓（1 位时是 50%，✗）
 *   · vb.w < 5   → 3 位：1~5 视区时误差 ≤0.0005 = ≤0.05% ✓（1 位时 5~2%，勉强）
 *   · vb.w ≥ 5   → 1 位：长线路实测视区宽 5.1~13.0（G318/G217 全部段），
 *                  1 位误差 0.05/5.1 = 1% ✓，且**字符串与改动前逐字符相同**（零回归）
 *
 * 阈值 5 是刻意选的：G318@1440 段6 的视区宽 8.7、G217@1440 段5 的 5.7 都 ≥5，
 * 全部落回 1 位。若把阈值放到 20，长线路字符串会从 `196.1 553.3 13.0 9.5`
 * 变成 `196.109 553.253 13.026 9.532` —— 数值等价，但**不是逐字符不变**，
 * 会让「本轮只修超短路」这件事无法用字符串直接证明。故取 5。
 */
const VIEWBOX_PRECISION = (vbW: number): number => (vbW < 1 ? 5 : vbW < 5 ? 3 : 1);

const viewBoxAttr = computed(() => {
  const vb = focusViewBox.value ?? globalViewBox.value;
  const p = VIEWBOX_PRECISION(vb.w);
  return `${vb.x.toFixed(p)} ${vb.y.toFixed(p)} ${vb.w.toFixed(p)} ${vb.h.toFixed(p)}`;
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
  focusCapped.value = false;
}

/**
 * v0.6.5（P0-1）：主链各点对应的里程（km）。
 *
 * **必须使用 API 下发的 `route.cumKm`，不能在前端重算。**
 * /along 会把主链从 3669 点抽稀到 600 点，抽稀必然切掉弯道、缩短折线
 * （实测 G318 抽稀后重算 1509.5km，全分辨率是 1627.4km，缩水 117.8km / 7.2%）。
 * 若在降采样链上重算，末段（1518.6~1568.8km）完全落在重算链之外，
 * `activeSegmentPath` 遍历不到任何点 → `d=""` → 地图上「点了没反应」。
 * 服务端已在全分辨率链上算好 cumKm 并随抽稀同步切片下发（见 planRoadRoute）。
 *
 * 缺失时（老接口/其它来源）退回 haversine 兜底，并置 `cumKmAuthoritative=false`，
 * 由 UI 降级提示告知用户「分段定位精度可能偏低」。
 */
const cumKmAuthoritative = computed<boolean>(() => {
  const route = roadRoute.value;
  if (!route) return false;
  const cum = route.cumKm;
  return Array.isArray(cum) && cum.length === route.coords.length && cum.length > 1;
});

const chainCumKm = computed<number[]>(() => {
  const coords = roadRoute.value?.coords ?? [];
  if (cumKmAuthoritative.value) return roadRoute.value!.cumKm!;
  const out: number[] = new Array(coords.length).fill(0);
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    out[i] = out[i - 1]! + haversineKm(a[0], a[1], b[0], b[1]);
  }
  return out;
});

/** 主链实际绘制到的里程（km），用于覆盖率披露与分段裁剪的上界 */
const chainMaxKm = computed<number>(() => {
  const cum = chainCumKm.value;
  return cum.length ? cum[cum.length - 1]! : 0;
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
 *
 * v0.6.5（P0-1）：末段处理改为「**夹到主链末端**」而不是只认 `toKm`。
 * 末段的 toKm 常大于主链实际里程（锚点取自全分辨率链，而 coords 已抽稀），
 * 原判断 `i === pts.length - 1 && km <= seg.toKm` 在 km > toKm 时不成立，
 * 末段最后一个点被丢掉；更严重的是整段可能一个点都匹配不上 → d=""。
 * 现在先算区间与主链的交集，交集为空才返回空串。
 */
/**
 * 选中段落在主链上的**点下标集合**。
 *
 * v0.6.5（P0-2）：高亮折线与视野 bbox **必须用同一份下标**。
 * 之前 bbox 用 `km >= lo && km <= hi`、折线用 `km >= lo && km < hi`，
 * 两者不一致 → bbox 把右端点算进去、折线没画 → bbox 高估 →
 * 反解出的缩放比偏小 → 实测 G318 第 6 段（390 断点）短边只有 20.6px（< 24px 判据）。
 */
function activeSegmentIndices(): number[] {
  if (activeSegment.value === null) return [];
  const seg = segments.value[activeSegment.value];
  if (!seg) return [];
  const cum = chainCumKm.value;
  const n = cum.length;
  if (n < 2) return [];
  const lo = Math.max(0, seg.fromKm);
  const hi = Math.min(seg.toKm, cum[n - 1]!);
  if (!(hi > lo)) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const km = cum[i]!;
    // 末点用 <= 闭合（保留区间右端点）
    if (km >= lo && (km < hi || (i === n - 1 && km <= hi))) out.push(i);
  }
  return out;
}

const activeSegmentPath = computed(() => {
  const idxs = activeSegmentIndices();
  if (idxs.length < 2) return '';
  const pts = mainChainView.value;
  let d = '';
  for (let k = 0; k < idxs.length; k += 1) {
    const [x, y] = pts[idxs[k]!]!;
    // 精度必须给足：量化误差 = 10^-decimals × 缩放比。
    // toFixed(1) 在 50 倍就达 5px（G318 第 6 段实测只有 21.3px）；
    // toFixed(3) 在 1000 倍达 0.5px，仍是隐形天花板；
    // 第五轮把 SCALE_MAX 提到 8000（见其注释的两条依据），故用 5 位小数，
    // 8000 倍下量化误差 0.40px < 1px。
    d += `${k === 0 ? 'M' : 'L'}${x.toFixed(5)} ${y.toFixed(5)}`;
  }
  return d;
});

/**
 * v0.6.5（P0-2）：选中分段时把 viewBox **收拢到该段**，且保证高亮在屏幕上真的看得见。
 *
 * ── 为什么不能简单「按内容 bbox 留边」──
 * SVG 默认 `preserveAspectRatio="xMidYMid meet"`：viewBox 会**等比缩放并居中**。
 * 若 viewBox 直接取内容 bbox + 边距，则缩放比 = min(cw/vbW, ch/vbH)，
 * 对「又长又扁」的段（沿东西向近乎直线）来说，短边被压到几 px ——
 * 实测 G318 第 6 段（贡觉林湖—仁布）就是这样：内容 bbox 约 256×0.6 单位，
 * 套进 704×520 容器后短边只剩 **14.4px**，等于没高亮。
 *
 * ── 正确做法：反解缩放比 s（px / viewBox 单位）──
 *   1. s_fit  = min(cw / 内容宽, ch / 内容高) / (1 + 边距)   —— 保证内容装得下
 *   2. s_min  = 24 / min(内容宽, 内容高)                    —— 保证短边 ≥ 24px
 *   3. s      = max(s_fit, s_min)，并夹在 [1, S_MAX] 内防过度放大
 *   4. viewBox = 容器尺寸 / s，**宽高比与容器完全一致**（杜绝 letterbox 缩放）
 * 这样内容既装得下，短边又一定 ≥24px。
 *
 * ── 景点如何纳入 ──
 * 视区需容纳「该段高亮 + 两端锚点 + 该段景点」。但远处景点（沿路可达 35km）
 * 若全量并入会把 bbox 撑大、把该段压成细线。折中：景点并入 bbox，
 * 但总尺寸最多放大到纯段 bbox 的 SPOT_BBOX_MAX 倍（超出部分景点允许出视区）。
 */
const SEGMENT_FOCUS_PAD_RATIO = 0.12;
/** 高亮短边下限（px）—— 与 tmp/road-v065-probe.mjs 的 HIGHLIGHT_MIN_PX 保持一致 */
const HIGHLIGHT_MIN_PX = 24;
/**
 * 实际取用的目标短边 = 判据 × 本系数。
 *
 * 判据 24px 是**及格线**，不是目标值。实测发现贴着及格线交付很脆弱：
 * G318 第 1 段（扎马日岗—邦仁）算出来是 **24.8px**，只比及格线高 0.8px ——
 * 视口高度变化、滚动条出现/消失都会让它掉到 24px 以下（QA 用
 * `tmp/seg-audit.mjs` 复测时该段就判为不合格），且 24.8px 本身视觉上也偏细。
 * 因此把目标抬到 32px（24 × 1.3），留出足够余量。
 */
const HIGHLIGHT_TARGET_PX = HIGHLIGHT_MIN_PX * 1.3;
/**
 * v0.6.5 第五轮修正 · 缩放比上限（px / viewBox 单位）。
 *
 * ⚠️ 第五轮初版把极短线路改成「段 bbox ≈ 全链 bbox 就不收拢」，QA 复验发现**更糟**：
 * G256 / G1502 / G8311 的高亮从 2×4px / 17×10px / 31×13px 掉到 **0×0px / 1×0px / 1×1px**
 * —— 因为这几条路 `coords` 只有 2 个点，在 40 单位的全局视野下必然亚像素。
 * 「点了没反应」正是需求方第一轮投诉的原话，所以**不能靠不收拢来回避**。
 * 现改为「尽量收拢到可见 + 上限兜底」，本常量是那个上限。
 *
 * ── 上限取 8000 的依据（两条独立约束在此交汇）──
 * 1) **d 字符串量化**：`activeSegmentPath` 的坐标写到 `toFixed(5)`，量化误差
 *    ≤ 0.00005 viewBox 单位；在 8000 倍下 = 0.40px < 1px，线不会变锯齿。
 *    （上一版 `toFixed(3)` 在 1000 倍就逼近 0.5px，是更早的隐形天花板。）
 * 2) **数据量子**：1 viewBox 单位 ≈ 6.85km（赤道水平）。8000 倍下约 **0.86 m/px**，
 *    而 5 位小数坐标的存储量子是 **1.11m ≈ 1.3px** —— 再放大就是放大
 *    OSM 坐标的量化噪声，而不是真实道路形状。
 *
 * **超过 8000 倍会失真**：画面只剩 1~2 个数据点的连线，线形由坐标取整决定，
 * 不再反映实际走向。
 */
const SCALE_MAX = 8000;
/** 景点并入 bbox 后允许的最大放大倍数（相对纯段 bbox） */
const SPOT_BBOX_MAX = 2.2;

function focusSegmentView(index: number): void {
  const seg = segments.value[index];
  if (!seg) return;
  const pts = mainChainView.value;
  if (pts.length < 2) return;

  // 与高亮折线完全同一份下标（P0-2：两者必须一致，否则 bbox 高估、缩放比偏小）
  const idxs = activeSegmentIndices();
  if (idxs.length < 2) return;

  // 1) 纯段 bbox
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of idxs) {
    const [x, y] = pts[i]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return;
  const segW = Math.max(maxX - minX, 0.001);
  const segH = Math.max(maxY - minY, 0.001);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // 2) 该段景点并入（限幅），保证「点的段 + 段的景点」尽量同框
  const cum = chainCumKm.value;
  const lo = Math.max(0, seg.fromKm);
  const hi = Math.min(seg.toKm, cum[cum.length - 1]!);
  const maxW = segW * SPOT_BBOX_MAX;
  const maxH = segH * SPOT_BBOX_MAX;
  // minX/minY/maxX/maxY 已是纯段 bbox，就地扩成「含景点」bbox
  for (const s of spots.value) {
    if (s.progressKm < lo || s.progressKm > hi) continue;
    const [x, y] = lngLatToViewBox(s.lng, s.lat);
    // 以段中心为基准限幅，避免远处景点把视区无限撑大
    minX = Math.min(minX, Math.max(x, cx - maxW / 2));
    maxX = Math.max(maxX, Math.min(x, cx + maxW / 2));
    minY = Math.min(minY, Math.max(y, cy - maxH / 2));
    maxY = Math.max(maxY, Math.min(y, cy + maxH / 2));
  }

  const contentW = Math.max(maxX - minX, 0.001);
  const contentH = Math.max(maxY - minY, 0.001);

  // 3) 反解缩放比
  const el = mapSvgRef.value;
  const cw = el?.clientWidth || 704;
  const ch = el?.clientHeight || 520;
  const padFactor = 1 + SEGMENT_FOCUS_PAD_RATIO * 2;
  // sFit：让「含景点」的内容整体装得下
  const sFit = Math.min(cw / (contentW * padFactor), ch / (contentH * padFactor));
  // sMin：**用高亮折线自身的短边**（segW/segH），而不是含景点后的 contentW/H。
  // 判据约束的是屏幕上能不能看见那条高亮线；景点可能把 content 撑大 2.2 倍，
  // 若拿 content 的短边去算 sMin，会低估所需缩放比 —— 实测 G318 第 1 段
  // segW=0.592 单位但 contentW=1.303，据此算出的 s 只让线宽到 19.8px（< 24px）。
  // 用 HIGHLIGHT_TARGET_PX（32px）而非及格线 24px：贴着及格线交付会被视口尺寸波动打穿
  const sMin = HIGHLIGHT_TARGET_PX / Math.min(segW, segH);
  // 第八轮（P1-5）**长边硬约束**：光有 sMin 只保证「短边够粗、看得见」，
  // 不保证「长边装得下」——又长又扁的段（如 G318 段6，segW:segH = 7.03:0.47 ≈ 15:1）
  // 在窄视口下会横向溢出：实测 @390 段6 屏宽 469px > 容器 340px，**左右各溢出 64.7px**。
  // 该缺陷 @1440 不暴露（长边上限 97.6 > sMin 68.54，不冲突），只有窄视口才现形。
  //
  // 约束：收拢后折线的**长边 + 描边**不得超过容器对应边，即
  //       s ≤ min((cw - 描边) / segW, (ch - 描边) / segH)。
  // ⚠️ 必须为 `stroke-width: 4px`（`vector-effect: non-scaling-stroke`，不随缩放膨胀）
  //    **预留出描边宽度**：getBoundingClientRect() 量的是**含描边**的包围盒，
  //    描边每侧各 2px。不预留时 G318 段6 @390 实测仍溢出 3.4px（340 vs 341）。
  //
  // 三者取**最严的**：sFit（含 padFactor，让「段+景点」整体装下）、
  // sFitLong（长边+描边装得下）、sMin（短边够粗），再受 SCALE_MAX 封顶。
  //
  // ⚠️ 两条可见性约束在「又长又扁 + 窄视口」时**几何上不可兼得**：
  // G318 段6 @390 要短边 ≥24px 需 s≥68.5（此时宽 469px，溢出 129px）；
  // 要长边装得下需 s≈48.3（此时短边 22.7px）。二者互斥。
  // 本实现按裁决「取更严的那个」，即**优先不溢出**：短边掉到 ~22.7px
  // （略低于 HIGHLIGHT_MIN_PX=24，但仍远高于「看不见」的量级）。
  // 溢出是实打实的裁切（线被切断），偏细只是观感下降，故以前者优先。
  const HIGHLIGHT_STROKE_PX = 4; // 与 drive.css 的 .is-active stroke-width 保持一致
  const sFitLong = Math.min(
    Math.max(cw - HIGHLIGHT_STROKE_PX, 1) / segW,
    Math.max(ch - HIGHLIGHT_STROKE_PX, 1) / segH,
  );
  const sWanted = Math.max(sFit, sMin);
  const s = Math.max(1, Math.min(sWanted, sFitLong, SCALE_MAX));

  // 目标缩放比 < 1（算出来是「缩小」）→ 收拢反而丢信息，直接不收拢。
  if (sWanted <= 1) {
    focusViewBox.value = null;
    focusCapped.value = false;
    return;
  }

  // 是否「已到上限、且到上限后仍达不到 32px」——用于 UI 如实说明，不假装成功。
  focusCapped.value = sWanted > SCALE_MAX && Math.min(segW, segH) * s < HIGHLIGHT_TARGET_PX;

  // 4) viewBox 宽高比与容器一致 → 无 letterbox，短边即 content短边 × s
  const vbW = cw / s;
  const vbH = ch / s;
  focusViewBox.value = { x: cx - vbW / 2, y: cy - vbH / 2, w: vbW, h: vbH };
}

/**
 * 极短线路阈值（km）。
 *
 * 主理人裁决：总长 < 1km 的编号（G1502 0.400km / G256 0.063km / G8311 0.477km）
 * **不硬凑 24px 高亮** —— 把 63 米的路放大到 24px 需要 ~32000× 缩放比，地图会失真到无意义，
 * 这类路线本就该是「一个点」而不是「一条线」。但**不能因此让用户以为点击失败**，
 * 所以单独识别并给可见的替代反馈：
 *   · 分段行直接标出总里程（如「全线 0.4 km」）
 *   · 提示条改写成「全线仅 X km，已整体显示」而不是「已聚焦第 N 段」
 * 探针里这类也从「无高亮」里分出，独立统计为「极短线」，两者不是同一缺陷。
 */
const TINY_ROUTE_KM = 1;

/** 当前线路是否属于「极短线路」（主链实绘 < 1km） */
const isTinyRoute = computed<boolean>(() => chainMaxKm.value > 0 && chainMaxKm.value < TINY_ROUTE_KM);

/** 极短线路的里程文案（用于分段行与提示条） */
const tinyRouteKmText = computed<string>(() => `${chainMaxKm.value.toFixed(1)} km`);

/**
 * 分段提示条文案。
 *
 * 极短线路有两种结局，都必须如实说：
 * · 放大到上限后**够 32px** → 正常说「已聚焦第 N 段」（真的聚焦了）；
 * · 放大到上限**仍不够** → 说「已放到最大」，**不假装成功**。
 * 早期版本一律说「已整体显示」，但那时其实已改成不收拢 —— 现在收拢回来了，
 * 文案必须跟着实际行为走。
 */
const focusScopeText = computed<string>(() => {
  if (focusCapped.value) {
    return `全线仅 ${tinyRouteKmText.value}，已放到最大（再放大只剩数据噪声）`;
  }
  if (isTinyRoute.value) {
    return `全线仅 ${tinyRouteKmText.value}，已放大显示`;
  }
  return `已聚焦第 ${(activeSegment.value ?? 0) + 1} 段 · ${segments.value[activeSegment.value ?? 0]?.title ?? ''}`;
});

const segmentRangeNote = computed<string>(() => {
  if (isTinyRoute.value) return `全线 ${tinyRouteKmText.value}`;
  return '';
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
            <svg ref="mapSvgRef" :viewBox="viewBoxAttr" class="drive-trip-map__svg" role="img" aria-label="路线示意图">
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
                {{ focusScopeText }}
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
                        <!-- P1-2：非聚落类锚点（山口/地标）标注，避免被误读为城镇 -->
                        <span
                          v-else-if="anchorTypeLabel(seg.weakestType)"
                          class="drive-anchor-src"
                          :data-src="seg.weakestType"
                          :title="`此段端点为${anchorTypeLabel(seg.weakestType)}类实体（山口/景区地标等），不是城镇`"
                        >{{ anchorTypeLabel(seg.weakestType) }}</span>
                      </span>
                      <span class="drive-seg__range">
                        <template v-if="isTinyRoute">{{ segmentRangeNote }}</template>
                        <template v-else>{{ fmtKm(seg.fromKm) }}—{{ fmtKm(seg.toKm) }} km</template>
                        · {{ segmentSpots[i]?.length ?? 0 }} 处景点
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
              <p class="drive-seg__hint">{{ segmentSourceNote }}；<template v-if="isTinyRoute">线路过短，点击会尽量放大显示</template><template v-else>点击可只看该段并高亮</template></p>
              <!-- P1-3：分段覆盖率披露。段名只来自主链已绘制部分，尾部里程可能没有地名段 -->
              <p v-if="segmentCoverage" class="drive-seg__cover">
                分段覆盖 0—{{ fmtKm(segmentCoverage.lastKm) }} km，占已收录里程
                <strong>{{ segmentCoverage.pct }}%</strong>
                <template v-if="segmentCoverage.tailKm > 1">
                  ；其余约 {{ fmtKm(segmentCoverage.tailKm) }} km（{{ entryView.provinces.join('、') || '后续省域' }}）尚未切出地名段
                </template>
              </p>
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
