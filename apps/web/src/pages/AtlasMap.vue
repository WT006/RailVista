<script setup lang="ts">
/**
 * 全国铁路景点地图 /atlas。
 *
 * 数据：GET /api/atlas/overview（apps/api 只读聚合，走廊折线已抽稀 ≤300 点，60s 缓存）。
 *
 * 图层：
 *  L1 铁路网   —— 全部走廊折线，细银灰、低透明度、不可点（选线走侧栏/搜索）
 *  L2 景点点位 —— 全量景点，MapLibre+supercluster 聚合，按六维着色，图例在侧栏
 *  L3 空间密度 —— MapLibre heatmap，可开关
 *  L4 选中态   —— 点击走廊加粗高亮 + fitBounds；点击景点弹 InfoWindow
 *
 * 聚合失败时降级为普通 Marker；热力由适配层原生支持。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  api,
  type AtlasCorridorLite,
  type AtlasOverviewData,
  type AtlasRoadCluster,
  type AtlasRoadCorridorLite,
  type AtlasSpotLite,
} from '../api/client';
import { RANKINGS } from '../data/beautifulRailings';
import {
  SPOT_DIMENSIONS,
  UNCLASSIFIED_DIMENSION,
  dimensionColor,
  dimensionMeta,
  escHtml,
  resolveSpotDimensions,
} from '../data/spotDimensions';
import {
  addMarker,
  addMultiPolyline,
  addPolyline,
  createInfoWindow,
  createMap,
  loadMapEngine,
  setCluster,
  setHeatmap,
  type InfoWindowHandle,
  type MapHandle,
  type MarkerHandle,
  type PolylineHandle,
} from '../map/engine';
import { roadColor } from '../data/roadColors';
import {
  ATLAS_NETWORK_STROKE,
  ATLAS_ORIGIN_COLORS,
  ATLAS_RAIL_STROKE,
} from '../data/atlasColors';
import { roadDisplayPlace } from '../data/prefectureSeeds';
import { dedupeAtlasRoadSpots, isAtlasRoadDisplaySpot } from '../data/atlasRoadDisplay';
/** 低于此缩放只画省圈；达到后按市降密 */
const ROAD_ZOOM_CITY = 6.2;
/** 点开某市后，最多画几处单点（避免再塞几千个 Marker） */
const CITY_EXPAND_MARKERS = 20;

const props = defineProps<{
  /** 公路图层模式（/drive/atlas 复用本页，PRD §2.1：公路图层与铁路图层共存、可切换） */
  drive?: boolean;
}>();
import { markStayOnSelect } from '../lib/tripCache';

const router = useRouter();

const mapEl = ref<HTMLElement | null>(null);
const loading = ref(true);
const loadError = ref('');
const mapError = ref('');
const heatSupported = ref(true);
const heatOn = ref(false);
/** 手机档筛选行折叠：默认收起（只留图层胶囊行），点「筛选」展开来源/维度 */
const layersExpanded = ref(false);
const hasActiveFilters = computed(
  () => activeDims.value.length > 0 || activeProvinces.value.length > 0 || activeCity.value !== '',
);
/** 桌面默认展开侧栏；手机地图优先，面板收起（点「筛选」再开） */
const sidebarOpen = ref(
  typeof window === 'undefined' ? true : window.matchMedia('(min-width: 840px)').matches,
);
const query = ref('');
const activeDims = ref<string[]>([]);
/** 省份筛选（铁路用库字段；公路用 displayProvince，与地图省圈一致） */
const activeProvinces = ref<string[]>([]);
/** 点开的地级市：展开该市高分单点；空 = 全国按市聚合 */
const activeCity = ref('');
const selectedCorridorId = ref('');
const stats = ref<AtlasOverviewData['meta'] | null>(null);

const corridors = ref<AtlasCorridorLite[]>([]);
const spots = ref<AtlasSpotLite[]>([]);
/** 双源融合：公路线路 + 省/市聚合；明细景点按需切片 */
const roadCorridors = ref<AtlasRoadCorridorLite[]>([]);
const roadProvinces = ref<AtlasRoadCluster[]>([]);
const roadCities = ref<AtlasRoadCluster[]>([]);
const roadTopSpots = ref<AtlasSpotLite[]>([]);
/** 当前已拉取的公路明细（市展开 / 热力），不是全国全量 */
const roadSpots = ref<AtlasSpotLite[]>([]);
/**
 * 景点来源筛选：all=铁路+公路都显示，rail/road=只看一侧。
 * /drive/atlas 进来默认 'road'。
 */
const spotOrigin = ref<'all' | 'rail' | 'road'>(props.drive ? 'road' : 'all');
/** 公路榜单（快捷入口用） */
const roadBoards = ref<Array<{ id: string; title: string; level: string; itemCount: number }>>([]);

/**
 * 公路：先拉轻量包（折线+省/市圈+Top10），明细点按市/热力再拉。
 * 避免默认路径下载 ~11MB / 2.7 万点。
 */
const roadLoading = ref(false);
const roadLoaded = ref(false);
const roadError = ref('');
const roadSpotsLoading = ref(false);
/** 已缓存的市景点切片 key */
const roadCitySpotsCache = new Map<string, AtlasSpotLite[]>();
let roadHeatSpotsLoaded = false;

async function loadRoad(): Promise<void> {
  if (roadLoaded.value || roadLoading.value) return;
  roadLoading.value = true;
  roadError.value = '';
  try {
    const d = await api.getAtlasRoad();
    roadCorridors.value = d.roadCorridors || [];
    roadProvinces.value = d.provinces || [];
    roadCities.value = d.cities || [];
    roadTopSpots.value = (d.topSpots || []).map((s) => ({
      ...s,
      origin: 'road' as const,
      displayProvince: s.displayProvince || s.province,
      displayCity: s.displayCity,
    }));
    roadLoaded.value = true;
    if (stats.value) {
      stats.value = {
        ...stats.value,
        roadCorridorCount: d.meta.roadCorridorCount,
        roadSpotCount: d.meta.roadSpotCount,
        roadSpotLibraryCount: d.meta.roadSpotLibraryCount,
        roadMigratedExcluded: d.meta.roadMigratedExcluded,
      };
    }
    renderSpots();
    if (heatOn.value) void ensureRoadHeatSpots().then(() => renderHeat());
    if (roadLayerOn.value) renderRoadLayer();
  } catch (e) {
    roadError.value = e instanceof Error ? e.message : '公路图层加载失败';
  } finally {
    roadLoading.value = false;
  }
}

async function loadRoadSpotsForCity(city: string): Promise<AtlasSpotLite[]> {
  const key = city.trim();
  if (!key) return [];
  const hit = roadCitySpotsCache.get(key);
  if (hit) return hit;
  roadSpotsLoading.value = true;
  try {
    const d = await api.getAtlasRoadSpots({ city: key, limit: CITY_EXPAND_MARKERS });
    const list = (d.spots || []).map((s) => ({ ...s, origin: 'road' as const }));
    roadCitySpotsCache.set(key, list);
    return list;
  } catch {
    return [];
  } finally {
    roadSpotsLoading.value = false;
  }
}

/** 热力需要坐标密度：一次性拉 slim 全量（比旧 11MB 包瘦很多，且仅开热力时才触发） */
async function ensureRoadHeatSpots(): Promise<void> {
  if (roadHeatSpotsLoaded || spotOrigin.value === 'rail') return;
  roadSpotsLoading.value = true;
  try {
    const d = await api.getAtlasRoadSpots();
    roadSpots.value = (d.spots || []).map((s) => ({ ...s, origin: 'road' as const }));
    roadHeatSpotsLoaded = true;
  } catch {
    /* 热力失败不阻断地图 */
  } finally {
    roadSpotsLoading.value = false;
  }
}

let map: MapHandle | null = null;
let infoWindow: InfoWindowHandle | null = null;
let clusterCtl: { clear(): void } | null = null;
let heatCtl: { clear(): void } | null = null;
let highlightLine: PolylineHandle | null = null;
let focusMarker: MarkerHandle | null = null;
/** 当前选中的景点 id；再点同一处或点空白取消 */
let focusedSpotId = '';
/** 刚从景点 Marker 点进去时，挡住随后冒泡的地图 click，避免选中立刻被清掉 */
let ignoreMapClickClear = false;
let baseLines: PolylineHandle[] = [];
let plainMarkers: MarkerHandle[] = [];
/** 公路侧普通 Marker 列表（renderRoadSpots 维护） */
let roadPlainMarkers: MarkerHandle[] = [];

// ── 公路图层：高速 / 国道分开关（琥珀 vs 蓝，不再绑在一起）────────────────
// v0.5.5：数据直接取 /atlas/overview 的 roadCorridors，不再单独请求
// /drive/network/overview —— 同一份折线在同页出现两次是纯浪费。
const expresswayLayerOn = ref(false);
const nationalLayerOn = ref(false);
/** 任一公路线层开启（用于按需拉数据） */
const roadLayerOn = computed(() => expresswayLayerOn.value || nationalLayerOn.value);
let roadPolylines: PolylineHandle[] = [];

function roadClassLayerOn(cls: string | undefined): boolean {
  if (cls === 'expressway') return expresswayLayerOn.value;
  if (cls === 'national') return nationalLayerOn.value;
  // 省道及以下此前跟「公路」一起画；跟国道开关，避免拆开后静默消失
  return nationalLayerOn.value;
}

function chromePadding() {
  const [top, right, bottom, left] = getMapChromeInsets();
  return { top, right, bottom, left };
}

async function renderRoadLayer() {
  if (!map) return;
  for (const l of roadPolylines) {
    try {
      l.remove();
    } catch {
      /* ignore */
    }
  }
  roadPolylines = [];
  if (!roadLayerOn.value) return;
  for (const r of roadCorridors.value) {
    if (!r.polyline || r.polyline.length < 2) continue;
    if (!roadClassLayerOn(r.class)) continue;
    const line = await addPolyline(map, {
      path: r.polyline as [number, number][],
      color: roadColor(r.class),
      weight: 2.2,
      opacity: 0.8,
      zIndex: 28,
      onClick: () => {
        void router.push({ path: '/drive/trip', query: { road: r.key } });
      },
    });
    roadPolylines.push(line);
  }
}

async function toggleExpresswayLayer() {
  expresswayLayerOn.value = !expresswayLayerOn.value;
  if (expresswayLayerOn.value) await loadRoad();
  renderRoadLayer();
}

async function toggleNationalLayer() {
  nationalLayerOn.value = !nationalLayerOn.value;
  if (nationalLayerOn.value) await loadRoad();
  renderRoadLayer();
}

const corridorName = computed(() => {
  const map = new Map<string, string>();
  for (const c of corridors.value) map.set(c.id, c.name);
  // 公路线路的 corridorIds 存的是 road key，名册里一并登记，弹窗才能显示线路名
  for (const r of roadCorridors.value) map.set(r.key, r.name ? `${r.ref} ${r.name}` : r.ref);
  return map;
});

/** 按来源筛选后的景点全集（铁路 + 公路） */
const spotsByOrigin = computed(() => {
  const o = spotOrigin.value;
  if (o === 'rail') return spots.value;
  if (o === 'road') return roadSpots.value;
  return spots.value.concat(roadSpots.value);
});

/**
 * 图集可见集：公路只计落图门槛 + 去重后的点，与省/市聚合圆同一口径。
 * 铁路仍用全量库字段。
 */
const atlasVisibleByOrigin = computed(() => {
  const rail = spotsByOrigin.value.filter((s) => s.origin !== 'road');
  const road = atlasRoadDisplayList(spotsByOrigin.value.filter((s) => s.origin === 'road'));
  return rail.concat(road);
});

const selectedCorridor = computed(
  () => corridors.value.find((c) => c.id === selectedCorridorId.value) || null,
);

/**
 * 六维 + 省份筛选：未选 = 全部；选中后 = 同时命中（维度取"任一"，省份取"任一"）。
 * 先按来源（铁路/公路）筛，再按维度与省份筛 —— 来源筛选是双源融合后新增的一层。
 */
function applyDimFilter(list: AtlasSpotLite[]): AtlasSpotLite[] {
  if (!activeDims.value.length) return list;
  const set = new Set(activeDims.value);
  return list.filter((s) => {
    const dims = resolveSpotDimensions(s);
    if (!dims.length) return set.has('other');
    return dims.some((d) => set.has(d));
  });
}

const filteredSpots = computed(() => {
  let base = applyDimFilter(atlasVisibleByOrigin.value);
  if (activeProvinces.value.length) {
    const ps = new Set(activeProvinces.value);
    base = base.filter((s) => {
      const p = spotFilterProvince(s);
      return p.length > 0 && ps.has(p);
    });
  }
  return base;
});

/** 省份选项：铁路来自库字段；公路优先用服务端省圈（轻量包），无则回退已拉明细 */
const provinceOptions = computed(() => {
  const counter = new Map<string, number>();
  const origin = spotOrigin.value;
  if (origin !== 'road') {
    for (const s of applyDimFilter(spots.value)) {
      const name = s.province ?? '';
      if (!name) continue;
      counter.set(name, (counter.get(name) ?? 0) + 1);
    }
  }
  if (origin !== 'rail') {
    if (roadProvinces.value.length) {
      for (const p of roadProvinces.value) {
        counter.set(p.name, (counter.get(p.name) ?? 0) + p.count);
      }
    } else {
      for (const s of applyDimFilter(roadSpots.value)) {
        const name = spotFilterProvince(s);
        if (!name) continue;
        counter.set(name, (counter.get(name) ?? 0) + 1);
      }
    }
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
});

function toggleProvince(name: string) {
  activeCity.value = '';
  if (activeProvinces.value.includes(name)) {
    activeProvinces.value = activeProvinces.value.filter((p) => p !== name);
  } else {
    activeProvinces.value = [...activeProvinces.value, name];
  }
}

/**
 * 景点统计（侧栏顶部）：当前筛选范围内的来源分布与分级分布。
 * 用 Progress 条呈现（鸿蒙展示类规范：数据可视化用进度/占比表达，不用纯数字堆砌）。
 *
 * 公路明细按需加载期间不显示数字 —— 直接算会得到 0，表现为"切来源后统计先掉 0
 * 再跳到一万多"，正是需求方说的"切换时跳一下"。此时显示加载态。
 */
const spotStats = computed(() => {
  const roadPending = roadLoading.value && spotOrigin.value !== 'rail';
  if (roadPending) {
    const railOnly = spotOrigin.value === 'all' ? spots.value.length : 0;
    return { total: railOnly, rail: railOnly, road: 0, byTier: {}, pending: true };
  }
  const origin = spotOrigin.value;
  const railList = origin === 'road' ? [] : applyDimFilter(spots.value).filter((s) => {
    if (!activeProvinces.value.length) return true;
    return activeProvinces.value.includes(s.province ?? '');
  });
  const rail = railList.length;
  // 公路未拉全量点时，用 meta / 省圈合计，避免统计掉成 0
  let road = 0;
  if (origin !== 'rail') {
    if (activeProvinces.value.length && roadProvinces.value.length) {
      const ps = new Set(activeProvinces.value);
      road = roadProvinces.value.filter((p) => ps.has(p.name)).reduce((n, p) => n + p.count, 0);
    } else if (stats.value?.roadSpotCount) {
      road = stats.value.roadSpotCount;
    } else if (roadProvinces.value.length) {
      road = roadProvinces.value.reduce((n, p) => n + p.count, 0);
    } else {
      road = applyDimFilter(roadSpots.value).length;
    }
  }
  return { total: rail + road, rail, road, byTier: {}, pending: false };
});

/**
 * 景点排名（铁路 / 公路各一份）。
 * 公路侧有 score（0–100）直接按分排序；铁路侧数据源没有评分字段，
 * 退化为"被多条铁路线路收录 = 知名度高"，并在 UI 上如实标注依据。
 */
const topRailSpots = computed(() =>
  spots.value
    .slice()
    .sort(
      (a, b) =>
        (b.corridorIds?.length ?? 0) - (a.corridorIds?.length ?? 0) ||
        a.name.localeCompare(b.name, 'zh'),
    )
    .slice(0, 10),
);

const topRoadSpots = computed(() => {
  if (roadTopSpots.value.length) return roadTopSpots.value;
  return atlasRoadDisplayList(roadSpots.value)
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name, 'zh'))
    .slice(0, 10);
});

const dimOptions = [...SPOT_DIMENSIONS, UNCLASSIFIED_DIMENSION];

/** 景点来源筛选选项：冷蓝=铁路（与铁路侧星点同色），琥珀=公路（与公路侧星点同色） */
const ORIGIN_OPTIONS = [
  { key: 'all' as const, label: '全部', color: ATLAS_ORIGIN_COLORS.all },
  { key: 'rail' as const, label: '铁路', color: ATLAS_ORIGIN_COLORS.rail },
  { key: 'road' as const, label: '公路', color: ATLAS_ORIGIN_COLORS.road },
];

/** 铁路：沿线景点最多的线路 Top10（按客户端统计的 spotCount） */
const topCorridors = computed(() =>
  corridors.value
    .filter((c) => c.spotCount > 0)
    .slice()
    .sort((a, b) => b.spotCount - a.spotCount || b.lengthKm - a.lengthKm)
    .slice(0, 10),
);

/** 公路：沿线景点最多的编号公路 Top10（此前 /drive/atlas 完全没有这一块，是空壳） */
const topRoadCorridors = computed(() =>
  roadCorridors.value
    .filter((r) => r.spotCount > 0)
    .slice()
    .sort((a, b) => b.spotCount - a.spotCount || b.lengthKm - a.lengthKm)
    .slice(0, 10),
);

const maxSpotCount = computed(
  () => Math.max(topCorridors.value[0]?.spotCount || 1, topRoadCorridors.value[0]?.spotCount || 1),
);

/** 排行榜快捷清单：去重后的上榜线路 */
const rankingShortcuts = computed(() => {
  const seen = new Set<string>();
  const out: Array<{ corridorId: string; name: string; rankingTitle: string; nature: string }> = [];
  for (const r of RANKINGS) {
    for (const item of r.items) {
      if (!item.corridorId || seen.has(item.corridorId)) continue;
      seen.add(item.corridorId);
      out.push({
        corridorId: item.corridorId,
        name: item.name,
        rankingTitle: r.title,
        nature: r.source.nature,
      });
    }
  }
  return out;
});

const searchResults = computed(() => {
  const q = query.value.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const hits: Array<{ kind: 'corridor' | 'spot'; id: string; name: string; desc: string }> = [];
  for (const c of corridors.value) {
    if (c.name.toLowerCase().includes(lower) || c.id.toLowerCase().includes(lower)) {
      hits.push({
        kind: 'corridor',
        id: c.id,
        name: c.name,
        desc: `${c.spotCount} 处景点 · ${c.lengthKm} km`,
      });
    }
    if (hits.length >= 12) break;
  }
  for (const s of spots.value) {
    if (s.name.toLowerCase().includes(lower)) {
      hits.push({
        kind: 'spot',
        id: s.id,
        name: s.name,
        desc: (s.corridorIds || []).map((id) => corridorName.value.get(id) || id).join('、') || '沿线景点',
      });
    }
    if (hits.length >= 12) break;
  }
  if (hits.length < 12) {
    const roadSearch = roadTopSpots.value.length
      ? roadTopSpots.value
      : atlasRoadDisplayList(roadSpots.value);
    for (const s of roadSearch) {
      if (!s.name.toLowerCase().includes(lower)) continue;
      hits.push({
        kind: 'spot',
        id: s.id,
        name: s.name,
        desc: roadPlaceText(s),
      });
      if (hits.length >= 12) break;
    }
  }
  return hits.slice(0, 12);
});

function toggleDim(key: string) {
  if (activeDims.value.includes(key)) {
    activeDims.value = activeDims.value.filter((k) => k !== key);
  } else {
    activeDims.value = [...activeDims.value, key];
  }
}

function clearDims() {
  activeDims.value = [];
}

/** 一键清空全部筛选条件（维度 + 省份 + 市展开） */
function clearFilters() {
  activeDims.value = [];
  activeProvinces.value = [];
  activeCity.value = '';
}

function attachRoadDisplayPlace(s: AtlasSpotLite): AtlasSpotLite {
  const { displayProvince, displayCity } = roadDisplayPlace(s.lng, s.lat, s.province);
  return { ...s, displayProvince, displayCity };
}

function ensureRoadDisplay(s: AtlasSpotLite): AtlasSpotLite {
  if (s.displayProvince && s.displayCity) return s;
  return attachRoadDisplayPlace(s);
}

function roadSpotCity(s: AtlasSpotLite): string {
  return ensureRoadDisplay(s).displayCity || '未分市';
}

function roadSpotProvince(s: AtlasSpotLite): string {
  return ensureRoadDisplay(s).displayProvince || '未标注省份';
}

function roadPlaceText(s: AtlasSpotLite): string {
  const prov = roadSpotProvince(s);
  const city = roadSpotCity(s);
  return city && city !== prov ? `${prov} / ${city}` : prov;
}

/** 筛选/计数用省份：公路用展示归属，铁路仍用库字段 */
function spotFilterProvince(s: AtlasSpotLite): string {
  return s.origin === 'road' ? roadSpotProvince(s) : (s.province ?? '');
}

/** 公路图集真正落图的点：质量门槛 + 近名/城区去重，不改库 */
function atlasRoadDisplayList(list: AtlasSpotLite[]): AtlasSpotLite[] {
  const passed = list.filter(
    (s) => Number.isFinite(s.lng) && Number.isFinite(s.lat) && isAtlasRoadDisplaySpot(s),
  ) as Array<AtlasSpotLite & { lng: number; lat: number }>;
  return dedupeAtlasRoadSpots(passed);
}

/** 库内总量展示：过万写「x.x 万」 */
function formatRoadLibraryCount(n: number | undefined): string {
  const v = Number(n) || 0;
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, '')} 万`;
  return String(v);
}

function roadSpotLod(): 'province' | 'city' | 'spots' {
  const z = Number(map?.getZoom?.() ?? 4.4);
  if (activeCity.value && z >= ROAD_ZOOM_CITY) return 'spots';
  if (z >= ROAD_ZOOM_CITY) return 'city';
  return 'province';
}

function lngLatInView(lng: number, lat: number, padDeg = 1.2): boolean {
  const b = map?.raw?.getBounds?.();
  if (!b) return true;
  return (
    lng >= b.getWest() - padDeg &&
    lng <= b.getEast() + padDeg &&
    lat >= b.getSouth() - padDeg &&
    lat <= b.getNorth() + padDeg
  );
}

function addRoadClusterMarker(opts: {
  keyAttr: 'data-prov' | 'data-city';
  key: string;
  label: string;
  count: number;
  lng: number;
  lat: number;
  size: number;
  title: string;
}) {
  if (!map) return;
  const marker = addMarker(map, {
    position: [opts.lng, opts.lat],
    contentHtml:
      '<div class="atlas-prov-cluster" ' +
      opts.keyAttr +
      '="' +
      escHtml(opts.key) +
      '" style="width:' +
      opts.size +
      'px;height:' +
      opts.size +
      'px">' +
      '<span class="atlas-prov-cluster__name">' +
      escHtml(opts.label) +
      '</span>' +
      '<em class="atlas-prov-cluster__num">' +
      opts.count +
      '</em>' +
      '</div>',
    zIndex: 95,
    anchor: 'center',
    title: opts.title,
  });
  roadPlainMarkers.push(marker);
}

function groupCentroid(items: AtlasSpotLite[]): { lng: number; lat: number; count: number } {
  let lng = 0;
  let lat = 0;
  for (const s of items) {
    lng += s.lng;
    lat += s.lat;
  }
  const count = items.length;
  return { lng: lng / count, lat: lat / count, count };
}

function corridorSpotsText(spot: AtlasSpotLite): string {
  const ids = spot.corridorIds || [];
  if (!ids.length) return '暂未归属具体线路';
  return ids
    .slice(0, 4)
    .map((id) => corridorName.value.get(id) || id)
    .join('、');
}

function closeSpotInfo() {
  try {
    infoWindow?.close();
  } catch {
    /* ignore */
  }
  try {
    map?.clearInfoWindow?.();
  } catch {
    /* ignore */
  }
}

function clearSpotSelection() {
  focusedSpotId = '';
  clearFocusMarker();
  closeSpotInfo();
}

/** 地图点位色：跟随侧栏维度筛选（双重身份也显示当前选中色） */
function spotMarkerColor(spot: AtlasSpotLite): string {
  return dimensionColor(spot.dimensions, spot.category, activeDims.value);
}

/** 聚合气泡主色：取簇内出现最多的维度色（尊重当前筛选） */
function dominantClusterColor(leaves: Array<{ properties?: Record<string, unknown> }>): string {
  const counts = new Map<string, number>();
  for (const leaf of leaves) {
    const spot = leaf.properties?.spot as AtlasSpotLite | undefined;
    if (!spot?.id) continue;
    const color = spotMarkerColor(spot);
    counts.set(color, (counts.get(color) || 0) + 1);
  }
  let best = UNCLASSIFIED_DIMENSION.color;
  let max = 0;
  for (const [color, n] of counts) {
    if (n > max) {
      max = n;
      best = color;
    }
  }
  return best;
}

function openSpotInfo(spot: AtlasSpotLite) {
  if (!map) return;
  const dims = resolveSpotDimensions(spot)
    .map(
      (d) =>
        `<span class="atlas-iw-dim" style="--dot:${dimensionColor([d])}">${escHtml(dimensionMeta(d).short)}</span>`,
    )
    .join('');
  const placeLine =
    spot.origin === 'road' ? `<p class="atlas-iw__line">${escHtml(roadPlaceText(spot))}</p>` : '';
  const html = `<div class="atlas-iw">
    <button type="button" class="atlas-iw__close" data-info-close aria-label="关闭">×</button>
    <p class="atlas-iw__name">${escHtml(spot.name)}</p>
    ${placeLine}
    <p class="atlas-iw__line">${escHtml(corridorSpotsText(spot))}</p>
    ${dims ? `<p class="atlas-iw__dims">${dims}</p>` : ''}
    ${spot.intro ? `<p class="atlas-iw__intro">${escHtml(spot.intro)}</p>` : ''}
  </div>`;
  if (!infoWindow) {
    infoWindow = createInfoWindow({ offsetPx: [0, -10] });
  }
  infoWindow.setContent(html);
  infoWindow.open(map, [spot.lng, spot.lat]);
  // 自定义关闭钮：打开后直接绑，避免依赖 popup DOM 冒泡
  requestAnimationFrame(() => {
    const btn = document.querySelector('.atlas-iw [data-info-close]');
    if (!btn) return;
    btn.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearSpotSelection();
      },
      { once: true },
    );
  });
}

function clearCluster() {
  if (clusterCtl) {
    try {
      clusterCtl.clear();
    } catch {
      /* ignore */
    }
    clusterCtl = null;
  }
  for (const m of plainMarkers) {
    try {
      m.remove();
    } catch {
      /* ignore */
    }
  }
  plainMarkers = [];
}

function renderSpots() {
  if (!map) return;
  /*
   * 铁路走 setCluster；公路优先画服务端省/市聚合圈，
   * 点开某市再按需拉明细（不再一次塞 2.7 万 Marker）。
   */
  const list = filteredSpots.value;
  const railList = list.filter((s) => s.origin !== 'road');
  renderRailSpots(railList);
  if (spotOrigin.value === 'rail') {
    clearRoadSpots();
    return;
  }
  renderRoadSpots(list.filter((s) => s.origin === 'road'));
}

function renderRailSpots(list: AtlasSpotLite[]) {
  if (!map) return;
  clearCluster();
  if (!list.length) return;

  const points = list.map((s) => ({
    id: s.id,
    lng: s.lng,
    lat: s.lat,
    properties: { spot: s },
  }));

  try {
    clusterCtl = setCluster(
      map,
      points,
      {
        cluster: (count, _lng, _lat, leaves) => {
          const size = count < 10 ? 22 : count < 50 ? 26 : 32;
          const color = dominantClusterColor(leaves);
          return `<div class="atlas-cluster" style="--cluster:${color};width:${size}px;height:${size}px">${count}</div>`;
        },
        leaf: (p) => {
          const spot = p.properties?.spot as AtlasSpotLite | undefined;
          const color = spot ? spotMarkerColor(spot) : UNCLASSIFIED_DIMENSION.color;
          const name = spot?.name || '';
          return `<span class="atlas-dot" style="--dot:${color}" title="${escHtml(name)}"></span>`;
        },
      },
      (p) => {
        const spot = p.properties?.spot as AtlasSpotLite | undefined;
        if (spot) selectSpot(spot);
      },
    );
  } catch (e) {
    console.warn('[atlas] setCluster failed, falling back to plain markers', e);
    for (const s of list.slice(0, 600)) {
      const m = addMarker(map, {
        position: [s.lng, s.lat],
        anchor: 'center',
        title: s.name,
        contentHtml: `<span class="atlas-dot" style="--dot:${spotMarkerColor(s)}"></span>`,
      });
      m.onClick(() => selectSpot(s));
      plainMarkers.push(m);
    }
  }
}

/**
 * 公路侧点渲染：优先用服务端省/市聚合；点开某市再按需拉高分单点。
 */
function renderRoadSpots(_list: AtlasSpotLite[]) {
  if (!map) return;
  if (roadLoading.value && !roadLoaded.value) return;
  clearRoadSpots();

  const lod = roadSpotLod();
  const provFilter = activeProvinces.value.length ? new Set(activeProvinces.value) : null;

  if (lod === 'spots') {
    const cityKey = activeCity.value;
    void (async () => {
      let inCity: AtlasSpotLite[] = [];
      if (cityKey) {
        inCity = await loadRoadSpotsForCity(cityKey);
      } else if (roadHeatSpotsLoaded) {
        inCity = atlasRoadDisplayList(roadSpots.value)
          .filter((s) => lngLatInView(s.lng, s.lat, 0.4))
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, CITY_EXPAND_MARKERS);
      }
      if (!map) return;
      // 异步回来时用户可能已切走市/缩放
      if (roadSpotLod() !== 'spots' || (cityKey && activeCity.value !== cityKey)) return;
      clearRoadSpots();
      for (const spot of inCity) {
        const m = addMarker(map, {
          position: [spot.lng, spot.lat],
          anchor: 'center',
          title: `${spot.name} · ${spot.score ?? '—'}分`,
          contentHtml: `<span class="atlas-dot atlas-dot--road" data-spot="${escHtml(spot.id)}" title="${escHtml(spot.name)}"></span>`,
          zIndex: 96,
        });
        m.onClick(() => selectSpot(spot));
        roadPlainMarkers.push(m);
      }
    })();
    return;
  }

  // 服务端聚合圈（轻量包）；无则回退本地对已拉明细分组
  if (lod === 'province' && roadProvinces.value.length) {
    for (const p of roadProvinces.value) {
      if (provFilter && !provFilter.has(p.name)) continue;
      const size = p.count < 50 ? 22 : p.count < 300 ? 26 : 30;
      addRoadClusterMarker({
        keyAttr: 'data-prov',
        key: p.name === '未标注省份' ? '' : p.name,
        label: p.name,
        count: p.count,
        lng: p.lng,
        lat: p.lat,
        size,
        title: p.name + ' · ' + p.count + ' 处高分景点（放大或点击查看各市）',
      });
    }
    return;
  }

  if (lod === 'city' && roadCities.value.length) {
    for (const c of roadCities.value) {
      if (provFilter && c.province && !provFilter.has(c.province)) continue;
      if (!lngLatInView(c.lng, c.lat)) continue;
      const size = c.count < 8 ? 18 : c.count < 40 ? 22 : 26;
      addRoadClusterMarker({
        keyAttr: 'data-city',
        key: c.name,
        label: c.name,
        count: c.count,
        lng: c.lng,
        lat: c.lat,
        size,
        title: c.name + ' · ' + c.count + ' 处高分景点（点击展开）',
      });
    }
    return;
  }

  // 回退：仅有已拉明细时本地聚合
  const display = atlasRoadDisplayList(_list);
  if (!display.length) return;
  const groups = new Map<string, AtlasSpotLite[]>();
  for (const s of display) {
    const key = lod === 'province' ? roadSpotProvince(s) : roadSpotCity(s);
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }
  for (const [name, items] of groups) {
    const { lng, lat, count } = groupCentroid(items);
    if (lod === 'city' && !lngLatInView(lng, lat)) continue;
    const size = lod === 'province' ? (count < 50 ? 22 : count < 300 ? 26 : 30) : count < 8 ? 18 : count < 40 ? 22 : 26;
    addRoadClusterMarker({
      keyAttr: lod === 'province' ? 'data-prov' : 'data-city',
      key: lod === 'province' && name === '未标注省份' ? '' : name,
      label: name,
      count,
      lng,
      lat,
      size,
      title: name + ' · ' + count + ' 处高分景点',
    });
  }
}

function onMapClickDelegated(event: MouseEvent) {
  const cityEl = (event.target as HTMLElement)?.closest?.('[data-city]') as HTMLElement | null;
  const city = cityEl?.dataset?.city;
  if (city) {
    activeCity.value = city;
    const cluster = roadCities.value.find((c) => c.name === city);
    if (cluster) {
      map?.setZoomAndCenter?.(Math.max(map.getZoom?.() ?? 5, 8.2), [cluster.lng, cluster.lat]);
    }
    void loadRoadSpotsForCity(city).then(() => {
      renderRoadSpots([]);
    });
    return;
  }
  const el = (event.target as HTMLElement)?.closest?.('[data-prov]') as HTMLElement | null;
  const prov = el?.dataset?.prov;
  if (!prov) return;
  activeCity.value = '';
  activeProvinces.value = [prov];
  const ofProv = roadProvinces.value.find((p) => p.name === prov);
  if (ofProv) {
    map?.setZoomAndCenter?.(ROAD_ZOOM_CITY + 0.15, [ofProv.lng, ofProv.lat]);
  }
}

let roadLodRedrawTimer: ReturnType<typeof setTimeout> | null = null;
function onRoadMapViewChange() {
  if (Number(map?.getZoom?.() ?? 4.4) < ROAD_ZOOM_CITY && activeCity.value) {
    activeCity.value = '';
  }
  if (roadLodRedrawTimer) clearTimeout(roadLodRedrawTimer);
  roadLodRedrawTimer = setTimeout(() => {
    renderRoadSpots([]);
  }, 80);
}

function clearRoadSpots() {
  for (const m of roadPlainMarkers) {
    try {
      m.remove();
    } catch {
      /* ignore */
    }
  }
  roadPlainMarkers = [];
}

async function renderHeat() {
  if (!map) return;
  if (heatCtl) {
    try {
      heatCtl.clear();
    } catch {
      /* ignore */
    }
    heatCtl = null;
  }
  if (!heatOn.value) return;

  // MapLibre 原生 heatmap，始终可用
  heatSupported.value = true;

  /*
   * 权重口径（v0.6.4）：max 固定 12（有评分用评分、无评分用 1），
   * 密度差异由点数与评分共同表达；适配层 weight 期望 0–1，故除以 12。
   */
  const points = filteredSpots.value
    .filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat))
    .map((s) => {
      const scoreW = Number.isFinite(s.score) ? Math.max(1, Math.min(12, s.score! / 8)) : 6;
      return { lng: s.lng, lat: s.lat, weight: scoreW / 12 };
    });
  if (!points.length) return;

  try {
    heatCtl = await setHeatmap(map, points, { radius: 16, opacity: 0.72 });
  } catch (e) {
    console.warn('[atlas] heatmap failed', e);
    heatOn.value = false;
    heatCtl = null;
  }
}

async function renderNetwork() {
  if (!map) return;
  for (const l of baseLines) {
    try {
      l.remove();
    } catch {
      /* ignore */
    }
  }
  baseLines = [];
  // 全部走廊合成一个 source：旧路径对每条线 await addPolyline，
  // 在 isStyleLoaded 等 source 时会把景点绘制堵死数分钟。
  const paths = corridors.value
    .filter((c) => c.polyline.length >= 2)
    .map((c) => c.polyline as [number, number][]);
  if (!paths.length) return;
  // 底图路网只作示意：不可点。选中线路走侧栏/搜索，避免密线区误触弹出蓝线
  const line = await addMultiPolyline(map, {
    paths,
    color: ATLAS_NETWORK_STROKE,
    weight: 1.25,
    opacity: 0.28,
    zIndex: 30,
  });
  baseLines.push(line);
}

function getMapChromeInsets(): [number, number, number, number] {
  // fitBounds padding 源：[上, 右, 下, 左]，为单位像素；调用处转 {top,right,bottom,left}
  const edge = 36;
  const dock = document.querySelector('.atlas-dock') as HTMLElement | null;
  const layers = document.querySelector('.atlas-layers') as HTMLElement | null;
  const mapRect = mapEl.value?.getBoundingClientRect();
  if (!mapRect) return [edge, edge, edge, edge];

  const vw = mapRect.width || window.innerWidth;
  const vh = mapRect.height || window.innerHeight;
  let top = edge;
  if (layers) {
    top = Math.max(edge, Math.ceil(layers.getBoundingClientRect().bottom - mapRect.top) + 8);
  }

  if (!dock || dock.classList.contains('is-collapsed')) {
    const bottomNav = vw <= 720 ? 76 : 0;
    return [top, edge, edge + bottomNav, edge];
  }

  const rect = dock.getBoundingClientRect();
  const dockRight = rect.right - mapRect.left;
  const dockTop = rect.top - mapRect.top;
  if (vw <= 720) {
    // 底部伸缩面板：景点落在面板上方可视区
    const bottom = Math.max(edge, Math.ceil(vh - dockTop) + 10);
    return [top, edge, bottom, edge];
  }
  const left = Math.max(edge, Math.ceil(dockRight) + 12);
  return [top, edge, edge, left];
}

function mapPixelSize(): { w: number; h: number } {
  const el = mapEl.value;
  if (el?.clientWidth && el?.clientHeight) {
    return { w: el.clientWidth, h: el.clientHeight };
  }
  const canvas = map?.raw?.getCanvas?.();
  return { w: canvas?.clientWidth ?? 0, h: canvas?.clientHeight ?? 0 };
}

/**
 * 把目标点放到侧栏右侧可视区的「居中偏左」。
 * 必须先瞬时落定 zoom/center，再用 panBy 像素平移——若在动画缩放中做 lngLat↔像素换算，
 * 会按旧级别放大偏移，景点会被甩到千里之外（「瞎定」）。
 */
function centerSpotInView(lng: number, lat: number, preferZoom = 12) {
  if (!map || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
  const [top, right, bottom, left] = getMapChromeInsets();
  const { w, h } = mapPixelSize();
  // 12 ≈ 区县/景区级：比全国视野大很多，又不到街道级
  map.setZoomAndCenter(preferZoom, [lng, lat], false);

  if (w && h) {
    const availW = Math.max(1, w - left - right);
    const availH = Math.max(1, h - top - bottom);
    // 可视区水平约 40%（居中偏左），垂直约 42%（略偏上给信息窗）
    const panX = left + availW * 0.4 - w / 2;
    const panY = top + availH * 0.42 - h / 2;
    if (Number.isFinite(panX) && Number.isFinite(panY) && (Math.abs(panX) >= 1 || Math.abs(panY) >= 1)) {
      try {
        map.raw.panBy([panX, panY], { animate: false });
      } catch {
        /* ignore */
      }
    }
  }
}

function clearFocusMarker() {
  if (!focusMarker) return;
  try {
    focusMarker.remove();
  } catch {
    /* ignore */
  }
  focusMarker = null;
}

function showFocusMarker(spot: AtlasSpotLite) {
  if (!map) return;
  clearFocusMarker();
  const color = spotMarkerColor(spot);
  focusMarker = addMarker(map, {
    position: [spot.lng, spot.lat],
    anchor: 'center',
    zIndex: 320,
    contentHtml: `<span class="atlas-focus" style="--dot:${color}" title="${escHtml(spot.name)}"><i></i></span>`,
  });
  focusMarker.onClick(() => {
    ignoreMapClickClear = true;
    clearSpotSelection();
  });
}

function clearCorridorHighlight() {
  selectedCorridorId.value = '';
  if (!highlightLine) return;
  try {
    highlightLine.remove();
  } catch {
    /* ignore */
  }
  highlightLine = null;
}

async function focusCorridor(id: string) {
  const target = corridors.value.find((c) => c.id === id);
  if (!target || !map || target.polyline.length < 2) return;
  selectedCorridorId.value = id;
  if (highlightLine) {
    try {
      highlightLine.remove();
    } catch {
      /* ignore */
    }
    highlightLine = null;
  }
  // 高亮线不抢景点点击（无 onClick）
  highlightLine = await addPolyline(map, {
    path: target.polyline as [number, number][],
    color: ATLAS_RAIL_STROKE,
    weight: 5,
    opacity: 0.95,
    zIndex: 50,
  });
  try {
    map.fitBounds(highlightLine.getBoundsCoords(), chromePadding(), false);
  } catch {
    map.setZoomAndCenter(7, target.polyline[0]! as [number, number]);
  }
}

function selectSpot(spot: AtlasSpotLite) {
  if (!map || !spot) return;
  const lng = Number(spot.lng);
  const lat = Number(spot.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  if (focusedSpotId && focusedSpotId === spot.id) {
    ignoreMapClickClear = true;
    clearSpotSelection();
    return;
  }
  ignoreMapClickClear = true;
  focusedSpotId = spot.id;
  showFocusMarker(spot);
  centerSpotInView(lng, lat, 12);
  openSpotInfo(spot);
}

function focusSpotById(id: string) {
  // 公路景点不在 spots 里，两源都要找（v0.6.3 双源后榜单可点）
  const spot = spots.value.find((s) => s.id === id) ?? roadSpots.value.find((s) => s.id === id);
  if (!spot) return;
  selectSpot(spot);
}

/** 景点榜点击：选中并把地图移到该点（榜单条目可点开的核心交互） */
function focusSpot(spot: AtlasSpotLite) {
  if (!map) {
    selectSpot(spot);
    return;
  }
  selectSpot(spot);
  try {
    map.setZoomAndCenter(Math.max(map.getZoom(), 7), [spot.lng, spot.lat]);
  } catch {
    /* 地图尚未就绪时忽略 */
  }
}

function onResultClick(hit: { kind: 'corridor' | 'spot'; id: string }) {
  if (hit.kind === 'corridor') {
    clearSpotSelection();
    focusCorridor(hit.id);
  } else {
    focusSpotById(hit.id);
  }
}

function resetView() {
  if (!map) return;
  clearSpotSelection();
  clearCorridorHighlight();
  map.setZoomAndCenter(4.4, [104.5, 34.5]);
}

function goBack() {
  // 明确回主页：不要触发选车页的自动恢复行程加载动画
  markStayOnSelect();
  void router.push('/');
}

function goRouteDetail() {
  if (!selectedCorridorId.value) return;
  void router.push(`/route/${selectedCorridorId.value}`);
}

/** 聚焦一条编号公路：加粗高亮 + fitBounds（与铁路走廊同一套交互） */
async function focusRoad(key: string) {
  const target = roadCorridors.value.find((r) => r.key === key);
  if (!target || !map) return;
  selectedCorridorId.value = key;
  if (highlightLine) {
    try {
      highlightLine.remove();
    } catch {
      /* ignore */
    }
    highlightLine = null;
  }
  highlightLine = await addPolyline(map, {
    path: target.polyline as [number, number][],
    color: roadColor(target.class),
    weight: 5,
    opacity: 0.95,
    zIndex: 50,
  });
  try {
    map.fitBounds(highlightLine.getBoundsCoords(), chromePadding(), false);
  } catch {
    map.setZoomAndCenter(7, target.polyline[0]! as [number, number]);
  }
}

/** 公路榜单击详情 */
function goRoadBoard(boardId: string) {
  void router.push(`/drive/rankings/${encodeURIComponent(boardId)}`);
}

async function initMap() {
  const { basemapConfigError } = await import('../map/tileSource');
  const cfgErr = basemapConfigError();
  if (cfgErr) {
    mapError.value = cfgErr;
    return;
  }
  try {
    await loadMapEngine();
  } catch {
    mapError.value = '地图引擎加载失败，请检查网络';
    return;
  }
  if (!mapEl.value) return;
  map = createMap(mapEl.value, {
    zoom: 4.4,
    center: [104.5, 34.5],
  });
  await new Promise<void>((resolve) => {
    if (map!.raw.isStyleLoaded()) resolve();
    else map!.raw.once('load', () => resolve());
  });
  heatSupported.value = true;

  map.raw.getContainer().addEventListener('click', (event: MouseEvent) => {
    const t = event.target as HTMLElement;
    if (t.closest?.('[data-info-close]')) {
      clearSpotSelection();
      return;
    }
    // 省聚合标记：点击只看该省（事件委托，见 onMapClickDelegated 注释）
    onMapClickDelegated(event);
  });
  // 点空白处收起高亮蓝线与景点选中（路网已不可点，避免密线区误触）
  map.on('click', (e: { originalEvent?: Event }) => {
    const t = e?.originalEvent?.target as HTMLElement | undefined;
    if (t?.closest?.('.atlas-focus, .atlas-dot, .atlas-cluster, .atlas-iw, .atlas-prov-cluster')) {
      return;
    }
    if (ignoreMapClickClear) {
      ignoreMapClickClear = false;
      return;
    }
    clearCorridorHighlight();
    clearSpotSelection();
  });
  map.on('zoomend', onRoadMapViewChange);
  map.on('moveend', onRoadMapViewChange);
  // 景点优先：路网再厚也不能挡住首屏点位
  renderSpots();
  if (heatOn.value) void renderHeat();
  try {
    await renderNetwork();
  } catch (e) {
    console.warn('[atlas] renderNetwork failed', e);
  }
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await api.getAtlasOverview();
    corridors.value = data.corridors || [];
    spots.value = (data.spots || []).map((s) => ({ ...s, origin: 'rail' as const }));
    stats.value = data.meta || null;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '地图数据加载失败';
  } finally {
    loading.value = false;
  }
  // 公路榜单（快捷入口）：失败不影响地图主体
  try {
    const b = await api.getDriveBoards();
    roadBoards.value = (b.boards || []).map((x) => ({
      id: x.id,
      title: x.title,
      level: x.level,
      itemCount: x.itemCount,
    }));
  } catch {
    roadBoards.value = [];
  }
}

/** P4 防御加固：错误态不再是一行死文本，提供重试按钮，避免"页面闪一下就回不去" */
async function reloadAll() {
  mapError.value = '';
  loadError.value = '';
  await load();
  if (!map) await initMap();
  else {
    renderSpots();
    try {
      await renderNetwork();
    } catch (e) {
      console.warn('[atlas] renderNetwork failed', e);
    }
    if (roadLayerOn.value) void renderRoadLayer();
    if (heatOn.value) void renderHeat();
  }
}

onMounted(async () => {
  await load();
  await initMap();
  // /drive/atlas 模式：默认打开高速+国道（铁路图层共存，可再手动切换）
  if (props.drive && map) {
    expresswayLayerOn.value = true;
    nationalLayerOn.value = true;
    await loadRoad();
    renderRoadLayer();
  } else if (spotOrigin.value === 'all') {
    // 默认「全部」：首屏后后台拉公路轻量包（省/市圈 + Top10），不再预拉 11MB 全量点。
    const idle =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(() => void loadRoad(), { timeout: 4000 })
        : window.setTimeout(() => void loadRoad(), 2000);
    void idle;
  }
});

onUnmounted(() => {
  try {
    infoWindow?.close();
  } catch {
    /* ignore */
  }
  infoWindow = null;
  clearFocusMarker();
  clearCluster();
  clearRoadSpots();
  for (const l of baseLines) {
    try {
      l.remove();
    } catch {
      /* ignore */
    }
  }
  baseLines = [];
  for (const l of roadPolylines) {
    try {
      l.remove();
    } catch {
      /* ignore */
    }
  }
  roadPolylines = [];
  if (highlightLine) {
    try {
      highlightLine.remove();
    } catch {
      /* ignore */
    }
    highlightLine = null;
  }
  if (heatCtl) {
    try {
      heatCtl.clear();
    } catch {
      /* ignore */
    }
    heatCtl = null;
  }
  if (roadLodRedrawTimer) {
    clearTimeout(roadLodRedrawTimer);
    roadLodRedrawTimer = null;
  }
  try {
    map?.off?.('zoomend', onRoadMapViewChange);
    map?.off?.('moveend', onRoadMapViewChange);
  } catch {
    /* ignore */
  }
  try {
    map?.destroy?.();
  } catch {
    /* ignore */
  }
  map = null;
});

// 筛选变化 → 重绘点位与热力（不重建底图路网）
watch([filteredSpots], () => {
  renderSpots();
  if (heatOn.value) renderHeat();
});
watch(heatOn, (on) => {
  if (on && spotOrigin.value !== 'rail') {
    void (async () => {
      await loadRoad();
      await ensureRoadHeatSpots();
      renderHeat();
    })();
    return;
  }
  renderHeat();
});
watch(activeCity, () => {
  if (map) renderRoadSpots([]);
});
watch(activeProvinces, () => {
  if (map && spotOrigin.value !== 'rail') renderRoadSpots([]);
});
// 切到含公路的来源时拉轻量包（折线+聚合圈），不拉 11MB 全量点
watch(spotOrigin, (v) => {
  activeCity.value = '';
  if (v === 'road' || v === 'all') void loadRoad();
  else clearRoadSpots();
});
</script>

<template>
  <div class="atlas-page">
    <div ref="mapEl" class="atlas-map"></div>

    <!-- 图层开关独立浮层：桌面仅图层胶囊；手机收成一块分组面板（筛选默认折叠，点「筛选」展开） -->
    <div
      class="atlas-layers"
      :class="{ 'is-expanded': layersExpanded }"
      role="toolbar"
      aria-label="地图图层与筛选"
    >
      <div class="atlas-layers__bar">
        <div class="atlas-layers__group">
          <span class="atlas-layers__k">图层</span>
          <div class="atlas-layers__row">
            <button
              type="button"
              class="atlas-layers__btn"
              :class="{ 'is-on': expresswayLayerOn }"
              style="--dot: var(--map-amber)"
              :disabled="!!mapError"
              :aria-pressed="expresswayLayerOn"
              @click="toggleExpresswayLayer"
            >
              <i class="atlas-layers__dot" aria-hidden="true"></i>
              高速
            </button>
            <button
              type="button"
              class="atlas-layers__btn"
              :class="{ 'is-on': nationalLayerOn }"
              style="--dot: var(--accent)"
              :disabled="!!mapError"
              :aria-pressed="nationalLayerOn"
              @click="toggleNationalLayer"
            >
              <i class="atlas-layers__dot" aria-hidden="true"></i>
              国道
            </button>
            <button
              type="button"
              class="atlas-layers__btn"
              :class="{ 'is-on': heatOn }"
              style="--dot: var(--map-heat)"
              :disabled="!heatSupported || !!mapError"
              :aria-pressed="heatOn"
              @click="heatOn = !heatOn"
            >
              <i class="atlas-layers__dot" aria-hidden="true"></i>
              热力
            </button>
          </div>
        </div>
        <button
          type="button"
          class="atlas-layers__toggle"
          :class="{ 'is-on': hasActiveFilters }"
          :aria-expanded="layersExpanded"
          @click="layersExpanded = !layersExpanded"
        >
          筛选
          <span class="atlas-layers__toggle-chevron" :class="{ 'is-open': layersExpanded }" aria-hidden="true"></span>
        </button>
      </div>
      <div class="atlas-layers__filters" aria-label="景点筛选">
        <div class="atlas-layers__group">
          <span class="atlas-layers__k">来源</span>
          <div class="atlas-layers__row">
            <button
              v-for="o in ORIGIN_OPTIONS"
              :key="o.key"
              type="button"
              class="atlas-layers__btn atlas-layers__btn--sm"
              :class="{ 'is-on': spotOrigin === o.key }"
              :style="{ '--dot': o.color }"
              :aria-pressed="spotOrigin === o.key"
              @click="spotOrigin = o.key"
            >
              <i class="atlas-layers__dot" aria-hidden="true"></i>
              {{ o.label }}
            </button>
          </div>
        </div>
        <div class="atlas-layers__group">
          <span class="atlas-layers__k">维度</span>
          <div class="atlas-layers__row">
            <button
              v-for="d in dimOptions"
              :key="d.key"
              type="button"
              class="atlas-layers__btn atlas-layers__btn--sm"
              :class="{ 'is-on': activeDims.includes(d.key) }"
              :style="{ '--dot': d.color }"
              :aria-pressed="activeDims.includes(d.key)"
              @click="toggleDim(d.key)"
            >
              <i class="atlas-layers__dot" aria-hidden="true"></i>
              {{ d.short }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 外层必须是 .atlas-dock：样式 / fitBounds 避让都认这个类；勿改回 atlas-side（会沉到地图下面） -->
    <aside class="atlas-dock" :class="{ 'is-collapsed': !sidebarOpen }">
      <template v-if="sidebarOpen">
        <header class="atlas-dock__head">
          <div class="atlas-dock__grab" aria-hidden="true"></div>
          <div class="atlas-dock__title-row">
            <button type="button" class="atlas-dock__back map-back-btn" @click="goBack">
              <span class="map-back-btn__icon" aria-hidden="true">‹</span>
              返回
            </button>
            <div class="atlas-dock__identity">
              <h1 class="atlas-dock__name">全国景点地图</h1>
            </div>
            <button
              type="button"
              class="atlas-dock__collapse"
              aria-label="收起面板"
              @click="sidebarOpen = false"
            >
              收起
            </button>
          </div>
        </header>

        <div class="atlas-dock__body">
        <section class="atlas-block">
          <label class="atlas-search">
            <span class="atlas-search__icon" aria-hidden="true">⌕</span>
            <input
              v-model="query"
              type="search"
              placeholder="搜索线路或景点，如「黄山」"
              aria-label="搜索线路或景点"
            />
          </label>
          <ul v-if="searchResults.length" class="atlas-results">
            <li v-for="hit in searchResults" :key="`${hit.kind}-${hit.id}`">
              <button type="button" class="atlas-result" @click="onResultClick(hit)">
                <span class="atlas-result__kind">{{ hit.kind === 'corridor' ? '线路' : '景点' }}</span>
                <span class="atlas-result__name">{{ hit.name }}</span>
                <span class="atlas-result__desc">{{ hit.desc }}</span>
              </button>
            </li>
          </ul>
          <p v-else-if="query.trim()" class="atlas-none">没有匹配的线路或景点</p>
        </section>

        <section class="atlas-block atlas-block--origin">
          <h2 class="atlas-block__title">景点来源</h2>
          <div class="atlas-dims">
            <button
              v-for="o in ORIGIN_OPTIONS"
              :key="o.key"
              type="button"
              class="atlas-dim"
              :class="{ 'is-on': spotOrigin === o.key }"
              :style="{ '--dot': o.color }"
              :aria-pressed="spotOrigin === o.key"
              @click.stop="spotOrigin = o.key"
            >
              <span class="atlas-dim__dot" aria-hidden="true"></span>{{ o.label }}
            </button>
          </div>
          <div class="atlas-dim-actions">
            <span class="atlas-count">
              <template v-if="roadLoading">公路数据加载中…</template>
              <template v-else-if="roadError">
                公路数据加载失败：{{ roadError }}
                <button type="button" class="atlas-link" @click="loadRoad">重试</button>
              </template>
              <template v-else>
                铁路 {{ spots.length }} · 公路展示
                {{ stats?.roadSpotCount ?? (roadLoaded ? roadProvinces.reduce((n, p) => n + p.count, 0) : 0) }}
                <template v-if="(stats?.roadSpotLibraryCount ?? 0) > (stats?.roadSpotCount ?? 0)">
                  / 库内 {{ formatRoadLibraryCount(stats?.roadSpotLibraryCount) }}
                </template>
              </template>
            </span>
            <button v-if="activeDims.length || activeProvinces.length || activeCity" type="button" class="atlas-link" @click="clearFilters">
              清空筛选
            </button>
          </div>
          <p
            v-if="!roadLoading && (stats?.roadSpotLibraryCount ?? 0) > (stats?.roadSpotCount ?? 0)"
            class="atlas-block__note"
          >
            地图只画较值得去的点；近名重复与城区密集聚（如城门群、馆群）已合并，测绘峰/低分观景已隐藏。
          </p>
          <p v-if="activeCity" class="atlas-block__note">
            当前展开：{{ activeCity }}
            <button type="button" class="atlas-link" @click="activeCity = ''">返回全市聚合</button>
          </p>

          <!-- 景点统计：当前筛选范围的来源与分级占比（鸿蒙展示类：数据可视化用进度条表达） -->
          <div class="atlas-stats" role="group" aria-label="景点统计">
            <div class="atlas-stat">
              <span class="atlas-stat__num">{{ spotStats.pending ? '…' : spotStats.total }}</span>
              <span class="atlas-stat__label">当前筛选景点</span>
            </div>
            <div class="atlas-stat">
              <span class="atlas-stat__num">{{ spotStats.rail }}</span>
              <span class="atlas-stat__label">铁路景点</span>
            </div>
            <div class="atlas-stat">
              <span class="atlas-stat__num">{{ spotStats.pending ? '…' : spotStats.road }}</span>
              <span class="atlas-stat__label">公路景点</span>
            </div>
          </div>
          <div v-if="spotStats.total > 0" class="atlas-split" aria-hidden="true">
            <span
              class="atlas-split__rail"
              :style="{ flexGrow: spotStats.rail || 0.001 }"
            ></span>
            <span
              class="atlas-split__road"
              :style="{ flexGrow: spotStats.road || 0.001 }"
            ></span>
          </div>
        </section>

        <section class="atlas-block atlas-block--dims">
          <h2 class="atlas-block__title">景点维度<span class="atlas-block__hint">（可多选）</span></h2>
          <div class="atlas-dims">
            <button
              v-for="d in dimOptions"
              :key="d.key"
              type="button"
              class="atlas-dim"
              :class="{ 'is-on': activeDims.includes(d.key) }"
              :style="{ '--dot': d.color }"
              :aria-pressed="activeDims.includes(d.key)"
              @click.stop="toggleDim(d.key)"
            >
              <span class="atlas-dim__dot" aria-hidden="true"></span>{{ d.short }}
            </button>
          </div>
          <div class="atlas-dim-actions">
            <span class="atlas-count">{{ spotStats.pending ? '…' : spotStats.total }} 处</span>
            <button v-if="activeDims.length || activeProvinces.length" type="button" class="atlas-link" @click="clearFilters">
              清空筛选
            </button>
          </div>
        </section>

        <section v-if="provinceOptions.length" class="atlas-block">
          <h2 class="atlas-block__title">
            省份<span class="atlas-block__hint">（可多选）</span>
          </h2>
          <div class="atlas-provinces">
            <button
              v-for="p in provinceOptions"
              :key="p.name"
              type="button"
              class="atlas-province"
              :class="{ 'is-on': activeProvinces.includes(p.name) }"
              :aria-pressed="activeProvinces.includes(p.name)"
              @click.stop="toggleProvince(p.name)"
            >
              {{ p.name }}<em>{{ p.count }}</em>
            </button>
          </div>
          <p v-if="!provinceOptions.length && roadLoaded" class="atlas-none">
            当前来源的景点暂无省份信息
          </p>
        </section>

        <section class="atlas-block">
          <h2 class="atlas-block__title">
            铁路景点榜 Top10
            <span class="atlas-block__hint">按被线路收录数</span>
          </h2>
          <ul class="atlas-rank-list">
            <li v-for="(s, i) in topRailSpots" :key="s.id">
              <button type="button" class="atlas-rank-row" @click="focusSpot(s)">
                <span class="atlas-rank-row__no">{{ i + 1 }}</span>
                <span class="atlas-rank-row__name">{{ s.name }}</span>
                <span class="atlas-rank-row__src">{{ s.corridorIds?.length ?? 0 }} 条线路</span>
              </button>
            </li>
          </ul>
        </section>

        <section class="atlas-block">
          <h2 class="atlas-block__title">
            公路景点榜 Top10
            <span class="atlas-block__hint">按观赏评分</span>
          </h2>
          <ul v-if="topRoadSpots.length" class="atlas-rank-list">
            <li v-for="(s, i) in topRoadSpots" :key="s.id">
              <button type="button" class="atlas-rank-row" @click="focusSpot(s)">
                <span class="atlas-rank-row__no">{{ i + 1 }}</span>
                <span class="atlas-rank-row__name">{{ s.name }}</span>
                <span class="atlas-rank-row__src">
                  <em class="atlas-tier" :class="'is-' + (s.tier ?? 'C')">{{ s.tier ?? 'C' }}</em>
                  {{ roadPlaceText(s) }} · {{ s.score ?? '—' }} 分
                </span>
              </button>
            </li>
          </ul>
          <p v-else-if="roadLoading" class="atlas-none">公路景点加载中…</p>
          <p v-else class="atlas-none">切到「公路」来源可加载公路景点榜</p>
        </section>

        <section class="atlas-block">
          <h2 class="atlas-block__title">
            铁路线 · 沿线景点最多 Top10
          </h2>
          <ul class="atlas-top-list">
            <li v-for="(c, i) in topCorridors" :key="c.id">
              <button
                type="button"
                class="atlas-top-row"
                :class="{ 'is-active': c.id === selectedCorridorId }"
                @click="focusCorridor(c.id)"
              >
                <span class="atlas-top-row__no">{{ i + 1 }}</span>
                <span class="atlas-top-row__name">{{ c.name }}</span>
                <span class="atlas-top-row__bar">
                  <span
                    class="atlas-top-row__fill"
                    :style="{ transform: `scaleX(${c.spotCount / maxSpotCount})` }"
                  ></span>
                </span>
                <span class="atlas-top-row__num">{{ c.spotCount }}</span>
              </button>
            </li>
          </ul>
          <p v-if="!topCorridors.length" class="atlas-none">暂无统计</p>
        </section>

        <section class="atlas-block">
          <h2 class="atlas-block__title">
            编号公路 · 沿线景点最多 Top10
          </h2>
          <ul class="atlas-top-list">
            <li v-for="(r, i) in topRoadCorridors" :key="r.key">
              <button
                type="button"
                class="atlas-top-row"
                :class="{ 'is-active': r.key === selectedCorridorId }"
                @click="focusRoad(r.key)"
              >
                <span class="atlas-top-row__no">{{ i + 1 }}</span>
                <span class="atlas-top-row__name">
                  <b class="atlas-top-row__ref" :style="{ color: roadColor(r.class) }">{{ r.ref }}</b>
                  {{ r.name ?? '' }}
                </span>
                <span class="atlas-top-row__bar">
                  <span
                    class="atlas-top-row__fill"
                    :style="{
                      transform: `scaleX(${r.spotCount / maxSpotCount})`,
                      background: roadColor(r.class),
                    }"
                  ></span>
                </span>
                <span class="atlas-top-row__num">{{ r.spotCount }}</span>
              </button>
            </li>
          </ul>
          <p v-if="!topRoadCorridors.length" class="atlas-none">
            暂无公路统计（需先补齐公路几何）
          </p>
        </section>

        <section v-if="roadBoards.length" class="atlas-block">
          <h2 class="atlas-block__title">公路榜单</h2>
          <ul class="atlas-rank-list">
            <li v-for="b in roadBoards" :key="b.id">
              <button type="button" class="atlas-rank-row" @click="goRoadBoard(b.id)">
                <span class="atlas-rank-row__name">{{ b.title }}</span>
                <span class="atlas-rank-row__src">{{ b.itemCount }} 条</span>
              </button>
            </li>
          </ul>
        </section>

        <section class="atlas-block">
          <h2 class="atlas-block__title">铁路排行榜线路快捷入口</h2>
          <ul class="atlas-rank-list">
            <li v-for="r in rankingShortcuts" :key="r.corridorId">
              <button
                type="button"
                class="atlas-rank-row"
                :class="{ 'is-active': r.corridorId === selectedCorridorId }"
                @click="focusCorridor(r.corridorId)"
              >
                <span class="atlas-rank-row__name">{{ r.name }}</span>
                <span class="atlas-rank-row__src">{{ r.nature }}</span>
              </button>
            </li>
          </ul>
        </section>

        <section v-if="selectedCorridor" class="atlas-block atlas-block--sel">
          <h2 class="atlas-block__title">{{ selectedCorridor.name }}</h2>
          <p class="atlas-sel-meta">
            {{ selectedCorridor.lengthKm }} km · {{ selectedCorridor.spotCount }} 处景点
            <template v-if="selectedCorridor.geoSpotCount && !selectedCorridor.lineSpotCount">
              （距离推算）
            </template>
          </p>
          <div class="atlas-sel-actions">
            <button type="button" class="btn primary btn-sm" @click="goRouteDetail">
              查看线路详情 ›
            </button>
            <button type="button" class="atlas-link" @click="resetView">重置视野</button>
          </div>
        </section>

        <p v-if="stats" class="atlas-foot">
          共 {{ stats.corridorCount }} 条线路 · {{ stats.spotCount }} 处景点 · 聚合耗时
          {{ stats.buildMs }}ms
        </p>
        </div>
      </template>
      <button
        v-else
        type="button"
        class="atlas-dock__open"
        aria-label="展开筛选与榜单"
        @click="sidebarOpen = true"
      >
        筛选 · 榜单
      </button>
    </aside>

    <p v-if="loading" class="atlas-status">正在加载全国铁路与景点数据…</p>
    <div v-else-if="loadError || mapError" class="atlas-status atlas-status--err">
      <p class="atlas-status__text">{{ loadError || mapError }}</p>
      <button type="button" class="btn ghost btn-sm" @click="reloadAll">重新加载</button>
    </div>
    <p v-else-if="!heatSupported" class="atlas-status atlas-status--warn">
      热力图插件不可用，已自动隐藏开关
    </p>
  </div>
</template>

<style scoped>
.atlas-page {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: var(--surface-0);
  color: var(--text-2);
}

.atlas-map {
  position: absolute;
  inset: 0;
  z-index: 0;
}

/* ── 图层开关（独立浮层，左上角常显） ── */
.atlas-layers {
  position: fixed;
  top: calc(12px + var(--safe-top));
  left: calc(12px + var(--safe-left) + var(--sidenav-w));
  z-index: 270;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  max-width: min(100vw - 24px, 420px);
  pointer-events: auto;
}

.atlas-layers__group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.atlas-layers__k {
  display: none;
}

.atlas-layers__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.atlas-layers__filters {
  display: none;
}

/* 手机折叠条容器：桌面不参与布局（display:contents），行为与旧版一致 */
.atlas-layers__bar {
  display: contents;
}

.atlas-layers__toggle {
  display: none;
}

.atlas-layers__btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 16px;
  border-radius: var(--radius-full);
  border: 1px solid var(--line-default);
  background: color-mix(in srgb, var(--surface-0) 88%, transparent);
  backdrop-filter: blur(var(--glass-blur-chrome)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur-chrome)) saturate(var(--glass-saturate));
  color: var(--text-2);
  font: inherit;
  font-size: var(--fs-meta);
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--elev-2);
  -webkit-tap-highlight-color: transparent;
}

/* 触控命中区扩展（视觉尺寸可小，命中不低于 44×44）：图层按钮 / 收起按钮 / 关闭按钮 */
.atlas-layers__btn::after,
.atlas-dock__collapse::after,
.atlas-iw__close::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: max(100%, var(--hit-min));
  height: max(100%, var(--hit-min));
  transform: translate(-50%, -50%);
}

.atlas-dock__collapse,
.atlas-iw__close {
  position: relative;
}

/* 统一按压态（快速响应档） */
.atlas-layers__btn:active,
.atlas-dock__collapse:active,
.atlas-iw__close:active,
.atlas-result:active,
.atlas-top-row:active,
.atlas-rank-row:active,
.atlas-province:active {
  transform: scale(0.97);
}

.atlas-layers__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.atlas-layers__btn.is-on {
  border-color: color-mix(in srgb, var(--dot, var(--accent)) 55%, transparent);
  color: var(--text-1);
  background: color-mix(in srgb, var(--dot, var(--accent)) 18%, var(--surface-0));
}

.atlas-layers__dot {
  width: 9px;
  height: 9px;
  border-radius: var(--radius-full);
  background: var(--dot, var(--accent));
  box-shadow: 0 0 8px color-mix(in srgb, var(--dot, var(--accent)) 55%, transparent);
}

/* ── 筛选/榜单伸缩面板（桌面左侧栏 · 手机底部 sheet） ── */
.atlas-dock {
  position: fixed;
  /* 网页端侧栏让出左上角图层开关，避免挡住高速/国道/热力 */
  top: calc(58px + var(--safe-top));
  left: calc(12px + var(--safe-left) + var(--sidenav-w));
  bottom: calc(12px + var(--safe-bottom));
  z-index: 200;
  width: min(320px, calc(100vw - 24px - var(--safe-left) - var(--safe-right)));
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-default);
  background: color-mix(in srgb, var(--surface-0) 94%, transparent);
  /* 常驻侧栏取「卡内条目」玻璃档（沉浸光感分档：避免最重材质常驻） */
  backdrop-filter: blur(var(--glass-blur-tile)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur-tile)) saturate(var(--glass-saturate));
  box-shadow: var(--elev-3);
  overflow: hidden;
  pointer-events: auto;
  transition:
    width var(--dur-base) var(--ease-standard),
    max-height var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}

.atlas-dock.is-collapsed {
  width: auto;
  top: calc(10px + var(--safe-top));
  right: auto;
  bottom: auto;
  /* 网页端收起后，展开钮跟在图层开关右侧（248px 为图层开关行宽度） */
  left: calc(12px + var(--safe-left) + var(--sidenav-w) + 248px);
  max-height: none;
}

.atlas-dock__head {
  flex-shrink: 0;
  display: grid;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--line-hairline);
}

.atlas-dock__grab {
  display: none;
  width: 36px;
  height: 4px;
  margin: 2px auto 4px;
  border-radius: var(--radius-full);
  background: var(--line-strong);
}

.atlas-dock__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.atlas-dock__back {
  flex-shrink: 0;
}

.atlas-dock__identity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  flex: 1;
}

.atlas-dock__name {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: 700;
  line-height: var(--lh-tight);
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.atlas-dock__collapse {
  flex-shrink: 0;
  min-height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--line-default);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: var(--fs-cap);
  font-weight: 600;
  cursor: pointer;
}

@media (hover: hover) and (pointer: fine) {
  .atlas-dock__collapse:hover {
    border-color: var(--line-accent);
    color: var(--text-1);
  }
}

.atlas-dock__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-2);
  display: grid;
  gap: var(--space-2);
  align-content: start;
}

.atlas-dock__open {
  min-height: 44px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--fill-accent);
  color: var(--text-1);
  font-size: var(--fs-cap);
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  box-shadow: var(--elev-3);
  -webkit-tap-highlight-color: transparent;
}

.atlas-block {
  display: grid;
  gap: 6px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-hairline);
  background: var(--surface-sunken);
}

.atlas-block--sel {
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.atlas-block__title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}

.atlas-block__hint {
  margin-left: 4px;
  font-weight: 400;
  font-size: var(--fs-micro);
  color: var(--text-3);
}

/* ── 搜索 ── */
.atlas-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-default);
  background: var(--surface-1);
}

.atlas-search__icon {
  color: var(--text-3);
  font-size: 14px;
}

.atlas-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}

.atlas-results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
  max-height: 190px;
  overflow-y: auto;
}

.atlas-result {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 7px;
  padding: 5px 7px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
}

@media (hover: hover) and (pointer: fine) {
  .atlas-result:hover {
    background: var(--accent-soft);
  }
}

.atlas-result__kind {
  padding: 1px 5px;
  border-radius: var(--radius-full);
  background: var(--line-hairline);
  color: var(--text-3);
  font-size: 10px;
  align-self: center;
}

.atlas-result__name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
}

.atlas-result__desc {
  grid-column: 2;
  font-size: var(--fs-micro);
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atlas-none {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
}

/* ── 维度筛选 ── */
.atlas-dims {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.atlas-dim {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--line-default);
  background: var(--line-hairline);
  color: var(--text-2);
  font-family: inherit;
  font-size: var(--fs-cap);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}

.atlas-dim__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--dot, var(--text-3));
  flex-shrink: 0;
}

.atlas-dim.is-on {
  border-color: var(--dot, var(--accent));
  background: color-mix(in srgb, var(--dot, var(--accent)) 22%, transparent);
  color: var(--text-1);
  font-weight: 600;
}

.atlas-dim-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.atlas-count {
  font-size: var(--fs-micro);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.atlas-link {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}

/* ── Top10 ── */
.atlas-top-list,
.atlas-rank-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.atlas-top-row {
  width: 100%;
  display: grid;
  grid-template-columns: 16px 1fr 46px 26px;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
}

.atlas-top-row.is-active {
  background: var(--accent-soft);
}

@media (hover: hover) and (pointer: fine) {
  .atlas-top-row:hover {
    background: var(--accent-soft);
  }
}

.atlas-top-row__no {
  font-size: var(--fs-micro);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.atlas-top-row__name {
  font-size: var(--fs-cap);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atlas-top-row__bar {
  height: 5px;
  border-radius: var(--radius-full);
  background: var(--line-hairline);
  overflow: hidden;
}

.atlas-top-row__fill {
  display: block;
  height: 100%;
  width: 100%;
  transform-origin: 0 50%;
  border-radius: var(--radius-full);
  background: linear-gradient(90deg, var(--accent), var(--info));
  transition: transform var(--dur-slow) var(--ease-standard);
}

.atlas-top-row__num {
  font-size: var(--fs-micro);
  color: var(--accent-hover);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ── 榜单快捷 ── */
.atlas-rank-list {
  max-height: 168px;
  overflow-y: auto;
}

.atlas-rank-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
}

.atlas-rank-row.is-active {
  background: var(--accent-soft);
}

@media (hover: hover) and (pointer: fine) {
  .atlas-rank-row:hover {
    background: var(--accent-soft);
  }
}

.atlas-rank-row__name {
  font-size: var(--fs-cap);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atlas-rank-row__src {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-3);
}

/* ── 选中卡片 ── */
.atlas-sel-meta {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
}

.atlas-sel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.atlas-btn {
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  border: none;
  background: linear-gradient(180deg, var(--accent), var(--accent-press));
  color: var(--surface-0);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.atlas-foot {
  margin: 0;
  font-size: 10px;
  color: var(--text-3);
  line-height: 1.5;
}

/* ── 状态提示 ── */
.atlas-status {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  z-index: 6;
  margin: 0;
  padding: 7px 14px;
  border-radius: var(--radius-full);
  background: var(--surface-0);
  border: 1px solid var(--line-default);
  font-size: var(--fs-cap);
  color: var(--text-2);
}

.atlas-status--err {
  border-color: var(--danger);
  color: var(--danger);
  /* P4：错误态容器需要容纳文本 + 重试按钮 */
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.atlas-status__text {
  margin: 0;
}

.atlas-status--warn {
  border-color: color-mix(in srgb, var(--warning) 36%, transparent);
  color: var(--warning);
}

@media (max-width: 839px) {
  /* 手机：收成一块带分类的玻璃面板（与底栏档 <840 对齐） */
  .atlas-layers {
    top: calc(12px + var(--safe-top));
    left: calc(12px + var(--safe-left));
    right: calc(12px + var(--safe-right));
    gap: 8px;
    max-width: none;
    padding: 8px 10px;
    border-radius: 16px;
    border: 1px solid var(--line-default);
    background: color-mix(in srgb, var(--surface-0) 88%, transparent);
    backdrop-filter: blur(var(--glass-blur-tile)) saturate(var(--glass-saturate));
    -webkit-backdrop-filter: blur(var(--glass-blur-tile)) saturate(var(--glass-saturate));
    box-shadow: var(--elev-3);
  }

  .atlas-layers__group {
    display: grid;
    grid-template-columns: 32px 1fr;
    align-items: start;
    gap: 4px 8px;
    width: 100%;
  }

  .atlas-layers__k {
    display: block;
    padding-top: 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-3);
    line-height: 1;
    white-space: nowrap;
  }

  .atlas-layers__row {
    gap: 5px;
  }

  .atlas-layers__filters {
    display: none; /* 手机默认折叠，.is-expanded 时展开 */
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding-top: 8px;
    border-top: 1px solid var(--line-hairline);
  }

  .atlas-layers.is-expanded .atlas-layers__filters {
    display: flex;
  }

  /* 折叠条：图层胶囊占满一行，右端「筛选」开关收放来源/维度 */
  .atlas-layers__bar {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }

  .atlas-layers__bar > .atlas-layers__group {
    flex: 1;
    min-width: 0;
    width: auto;
    grid-template-columns: auto 1fr;
  }

  .atlas-layers__bar > .atlas-layers__group .atlas-layers__k {
    padding-top: 0;
    align-self: center;
  }

  .atlas-layers__toggle {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 32px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--line-default);
    background: var(--fill-subtle);
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-cap);
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  /* 与图层胶囊一致的 44px 命中区 */
  .atlas-layers__toggle::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: max(100%, var(--hit-min));
    height: max(100%, var(--hit-min));
    transform: translate(-50%, -50%);
  }

  .atlas-layers__toggle.is-on {
    border-color: var(--line-accent);
    color: var(--accent-hover);
    background: var(--accent-soft);
  }

  .atlas-layers__toggle-chevron {
    width: 7px;
    height: 7px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(45deg) translateY(-1px);
    transition: transform var(--dur-fast) var(--ease-standard);
  }

  .atlas-layers__toggle-chevron.is-open {
    transform: rotate(-135deg) translateY(-2px);
  }

  .atlas-layers__btn {
    min-height: 32px;
    padding: 0 10px;
    font-size: var(--fs-cap);
    box-shadow: none;
    background: var(--fill-subtle);
  }

  .atlas-layers__btn--sm {
    min-height: 28px;
    padding: 0 8px;
  }

  .atlas-layers__dot {
    width: 7px;
    height: 7px;
  }

  /* 侧栏里的来源/维度/说明/统计在手机端去掉，改走顶部压缩条 */
  .atlas-block--origin,
  .atlas-block--dims {
    display: none;
  }

  /* 底部伸缩 sheet：标题条 + 可滚内容，不挡图层开关 */
  .atlas-dock {
    top: auto;
    left: calc(10px + var(--safe-left));
    right: calc(10px + var(--safe-right));
    bottom: calc(var(--bottomnav-h) + 10px + var(--safe-bottom));
    width: auto;
    max-height: min(34vh, calc(100dvh - var(--bottomnav-h) - 120px - var(--safe-top) - var(--safe-bottom)));
    z-index: 260;
    border-radius: var(--radius-lg) var(--radius-lg) var(--radius-md) var(--radius-md);
  }

  .atlas-dock.is-collapsed {
    top: auto;
    left: calc(10px + var(--safe-left));
    right: auto;
    bottom: calc(var(--bottomnav-h) + 10px + var(--safe-bottom));
    width: auto;
    min-width: 112px;
    max-height: none;
    border-radius: var(--radius-full);
    background: transparent;
    border: none;
    box-shadow: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .atlas-dock__grab {
    display: none;
  }

  .atlas-dock__back {
    display: none;
  }

  .atlas-dock__head {
    gap: 0;
    padding: 6px var(--space-2) var(--space-1);
  }

  .atlas-dock__name {
    font-size: var(--fs-body);
  }

  .atlas-dock__body {
    padding: var(--space-1) var(--space-2) var(--space-2);
    gap: var(--space-1);
  }

  .atlas-block {
    padding: 7px 8px;
  }

  .atlas-top-list,
  .atlas-rank-list {
    max-height: 12vh;
    overflow-y: auto;
  }

  .atlas-provinces {
    max-height: 88px;
  }
}

/* ══════════ 侧栏新增组件（鸿蒙展示类：统计用进度/占比表达，筛选用可点选胶囊） ══════════ */

/* 景点统计：三个关键数字 + 一条来源占比条 */
.atlas-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.atlas-stat {
  display: grid;
  gap: 2px;
  padding: var(--space-2);
  border: 1px solid var(--line-hairline);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
  min-width: 0;
}

.atlas-stat__num {
  font-size: var(--fs-h3);
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}

.atlas-stat__label {
  font-size: var(--fs-micro);
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 来源占比条：flex-grow 表达比例，比数字堆砌更容易读 */
.atlas-split {
  display: flex;
  gap: 2px;
  height: 4px;
  margin-top: 6px;
  border-radius: var(--radius-full);
  overflow: hidden;
  background: var(--fill-subtle);
}

.atlas-split__rail {
  background: var(--accent);
}

.atlas-split__road {
  background: var(--map-amber);
}

/* 省份筛选：可点选胶囊 + 计数 */
.atlas-provinces {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 168px;
  overflow-y: auto;
  padding-right: 2px;
}

.atlas-province {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--line-hairline);
  border-radius: var(--radius-full);
  background: var(--surface-1);
  color: var(--text-2);
  font-size: var(--fs-cap);
  line-height: 1.4;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}

.atlas-province em {
  font-style: normal;
  font-size: var(--fs-micro);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

@media (hover: hover) and (pointer: fine) {
  .atlas-province:hover {
    border-color: var(--line-default);
  }
}

.atlas-province.is-on {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  color: var(--text-1);
}

.atlas-province.is-on em {
  color: var(--accent);
}

/* 榜单行：序号 + 名称 + 依据 */
.atlas-rank-row__no {
  flex: none;
  width: 1.4em;
  color: var(--text-3);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
}

.atlas-tier {
  display: inline-block;
  padding: 0 5px;
  margin-right: 4px;
  border-radius: 4px;
  font-style: normal;
  font-size: var(--fs-micro);
  font-weight: 600;
  line-height: 1.5;
  background: var(--fill-subtle);
  color: var(--text-2);
}

.atlas-tier.is-A {
  background: color-mix(in srgb, var(--success) 22%, transparent);
  color: var(--success);
}
.atlas-tier.is-B {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  color: var(--accent);
}

.atlas-block__note {
  margin: 6px 0 0;
  font-size: var(--fs-micro);
  line-height: 1.6;
  color: var(--text-3);
}
</style>

<style>
/* 地图 Marker / 聚合气泡（挂到 MapLibre DOM） */
.atlas-dot {
  display: block;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--dot, var(--text-2));
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--surface-0) 85%, transparent),
    var(--elev-float);
}

.atlas-cluster {
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--cluster, var(--accent)) 32%, color-mix(in srgb, var(--surface-0) 82%, transparent));
  border: 1.5px solid var(--cluster, var(--accent));
  color: var(--text-1);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  box-shadow: var(--elev-float);
}

/* 搜索定位高亮：脉动环，保证聚合层下也看得见 */
.atlas-focus {
  position: relative;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
}

.atlas-focus::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius-full);
  border: 2px solid var(--dot, var(--accent));
  opacity: 0.55;
  animation: atlas-focus-pulse var(--dur-pulse) var(--ease-standard) infinite;
}

.atlas-focus i {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: var(--radius-full);
  background: var(--dot, var(--accent));
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--surface-0) 90%, transparent),
    var(--pin-shadow);
}

@keyframes atlas-focus-pulse {
  0% {
    transform: scale(0.7);
    opacity: 0.7;
  }
  100% {
    transform: scale(1.55);
    opacity: 0;
  }
}

/* 无障碍降级：定位脉冲停止（与全局兜底双保险） */
@media (prefers-reduced-motion: reduce) {
  .atlas-focus::before {
    animation: none;
  }
}

.atlas-iw {
  position: relative;
  max-width: 240px;
  padding: 9px 32px 11px 11px;
  border-radius: var(--radius-sm);
  background: var(--surface-0);
  border: 1px solid var(--line-default);
  color: var(--text-2);
  box-shadow: var(--elev-float-strong);
}

.atlas-iw__close {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: var(--line-hairline);
  color: var(--text-2);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
}

@media (hover: hover) and (pointer: fine) {
  .atlas-iw__close:hover {
    background: var(--line-default);
    color: var(--text-1);
  }
}

.atlas-iw__name {
  margin: 0;
  padding-right: 4px;
  font-size: var(--fs-meta);
  font-weight: 700;
}

.atlas-iw__line {
  margin: 3px 0 0;
  font-size: var(--fs-micro);
  color: var(--accent-hover);
}

.atlas-iw__dims {
  margin: 5px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.atlas-iw-dim {
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--dot, var(--text-3));
  color: var(--surface-0);
  font-size: 10px;
  font-weight: 700;
}

.atlas-iw__intro {
  margin: 5px 0 0;
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.5;
}

/* （旧版 .atlas-top/.atlas-toggle/.atlas-side 结构样式已删除：模板零引用、仅历史遗留；
   2026-10-09 鸿蒙化收敛。注：.atlas-top-list/.atlas-top-row* 为在用的 Top10 榜单样式，保留。）
   ══════════════════════════════════════════════════════════════════ */

/* （死规则 .route-dot 已删：模板零引用） */

/* 公路景点：琥珀色小点（与铁路侧的六维着色区分） */
.atlas-dot--road {
  --dot: var(--map-amber);
  width: 7px;
  height: 7px;
  box-shadow: 0 0 6px color-mix(in srgb, var(--map-amber) 55%, transparent);
}

/*
 * 公路侧地级市聚合标记（评分门槛之后）。
 * 全量 Marker 会卡死；按市聚合后约一两百个圆点。
 */
.atlas-prov-cluster {
  display: grid;
  place-content: center;
  gap: 0;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--map-amber) 75%, transparent);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--map-amber-bright) 95%, transparent), color-mix(in srgb, var(--map-amber-deep) 85%, transparent));
  color: var(--map-amber-ink);
  font-weight: 700;
  text-align: center;
  box-shadow: 0 0 14px color-mix(in srgb, var(--map-amber-deep) 45%, transparent);
  cursor: pointer;
  /* 数字为主、省名为辅：省名太长会挤爆小圆，截断即可 */
  white-space: nowrap;
  overflow: hidden;
}

.atlas-prov-cluster__name {
  font-size: var(--fs-annot-sm);
  line-height: 1.1;
  opacity: 0.85;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.atlas-prov-cluster__num {
  font-size: 12px;
  line-height: 1.1;
  font-style: normal;
  font-variant-numeric: tabular-nums;
}

/* （旧版响应式侧栏媒体块已删：仅作用 .atlas-side/.atlas-top 死选择器） */
</style>
