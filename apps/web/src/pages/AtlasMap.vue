<script setup lang="ts">
/**
 * 全国铁路景点地图 /atlas。
 *
 * 数据：GET /api/atlas/overview（apps/api 只读聚合，走廊折线已抽稀 ≤300 点，60s 缓存）。
 *
 * 图层：
 *  L1 铁路网   —— 全部走廊折线，细银灰、低透明度、只响应 click（hover 不响应，性能优先）
 *  L2 景点点位 —— 全量景点，AMap MarkerCluster 聚合，按六维着色，图例在侧栏
 *  L3 空间密度 —— AMap HeatMap，可开关
 *  L4 选中态   —— 点击走廊加粗高亮 + fitView；点击景点弹 InfoWindow
 *
 * 插件（MarkerCluster / HeatMap）若加载失败，自动降级为普通 Marker 并隐藏热力开关，
 * 页面其余能力不受影响。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  api,
  type AtlasCorridorLite,
  type AtlasOverviewData,
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
import { AMAP_MAP_STYLE, loadAmap } from '../map/amap';
import { roadColor } from '../data/roadColors';

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
const sidebarOpen = ref(true);
const query = ref('');
const activeDims = ref<string[]>([]);
/** 省份筛选（铁路侧仅 192/624 有值，公路侧已全量补齐） */
const activeProvinces = ref<string[]>([]);
const selectedCorridorId = ref('');
const stats = ref<AtlasOverviewData['meta'] | null>(null);

const corridors = ref<AtlasCorridorLite[]>([]);
const spots = ref<AtlasSpotLite[]>([]);
/** 双源融合：公路线路与公路景点（公路景点已排除从铁路迁移来的条目） */
const roadCorridors = ref<AtlasRoadCorridorLite[]>([]);
const roadSpots = ref<AtlasSpotLite[]>([]);
/**
 * 景点来源筛选：all=铁路+公路都显示，rail/road=只看一侧。
 * /drive/atlas 进来默认 'road'（此前该页标题硬编码「铁路景点地图」、
 * Top10 与排行榜全是铁路数据，公路侧等于空壳 —— 需求方指出的严重问题）。
 */
const spotOrigin = ref<'all' | 'rail' | 'road'>(props.drive ? 'road' : 'all');
/** 公路榜单（快捷入口用） */
const roadBoards = ref<Array<{ id: string; title: string; level: string; itemCount: number }>>([]);

/**
 * v0.6.3：公路侧数据改为**按需加载**。
 * 之前 /atlas/overview 一次返回 4.4MB（624 铁路 + 1.2 万公路景点），
 * 浏览器解析 4.2 万行 JSON 再把 1.2 万个点丢给 AMap 聚类，主线程长时间阻塞，
 * 侧栏一直停在「正在加载」且景点统计全为 0。现在 overview 只回铁路（~200KB），
 * 公路明细走 /atlas/road：切到公路来源、或打开公路图层时才拉。
 */
const roadLoading = ref(false);
const roadLoaded = ref(false);
const roadError = ref('');

async function loadRoad(): Promise<void> {
  if (roadLoaded.value || roadLoading.value) return;
  roadLoading.value = true;
  roadError.value = '';
  try {
    const d = await api.getAtlasRoad();
    roadCorridors.value = d.roadCorridors || [];
    roadSpots.value = (d.roadSpots || []).map((s) => ({ ...s, origin: 'road' as const }));
    roadLoaded.value = true;
    if (stats.value) {
      stats.value = {
        ...stats.value,
        roadCorridorCount: d.meta.roadCorridorCount,
        roadSpotCount: d.meta.roadSpotCount,
        roadMigratedExcluded: d.meta.roadMigratedExcluded,
      };
    }
    renderSpots();
    // 公路点进来后热力图要跟着重算，否则仍按铁路的 624 点渲染
    if (heatOn.value) renderHeat();
    if (roadLayerOn.value) renderRoadLayer();
  } catch (e) {
    roadError.value = e instanceof Error ? e.message : '公路图层加载失败';
  } finally {
    roadLoading.value = false;
  }
}

let map: any = null;
let AMapRef: any = null;
let infoWindow: any = null;
let cluster: any = null;
let heat: any = null;
let highlightLine: any = null;
let focusMarker: any = null;
let baseLines: any[] = [];
let plainMarkers: any[] = [];
/** 公路侧普通 Marker 列表（renderRoadSpots 维护） */
let roadPlainMarkers: any[] = [];
/** corridorId → 折线，供点击/搜索后 fitView */
const lineByCorridor = new Map<string, any>();

// ── 公路图层：与铁路图层共存，独立开关 ────────────────────────────────────────
// v0.5.5：数据直接取 /atlas/overview 的 roadCorridors，不再单独请求
// /drive/network/overview —— 同一份折线在同页出现两次是纯浪费。
const roadLayerOn = ref(false);
let roadPolylines: any[] = [];

function renderRoadLayer() {
  if (!map || !AMapRef) return;
  for (const l of roadPolylines) {
    try {
      map.remove(l);
    } catch {
      /* ignore */
    }
  }
  roadPolylines = [];
  if (!roadLayerOn.value) return;
  for (const r of roadCorridors.value) {
    if (!r.polyline || r.polyline.length < 2) continue;
    const line = new AMapRef.Polyline({
      path: r.polyline,
      strokeColor: roadColor(r.class),
      strokeWeight: 2.2,
      strokeOpacity: 0.8,
      lineJoin: 'round',
      zIndex: 28,
      bubble: true,
      cursor: 'pointer',
    });
    line.on('click', () => {
      void router.push({ path: '/drive/trip', query: { road: r.key } });
    });
    map.add(line);
    roadPolylines.push(line);
  }
}

async function toggleRoadLayer() {
  roadLayerOn.value = !roadLayerOn.value;
  if (roadLayerOn.value) await loadRoad();
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

const selectedCorridor = computed(
  () => corridors.value.find((c) => c.id === selectedCorridorId.value) || null,
);

/**
 * 六维 + 省份筛选：未选 = 全部；选中后 = 同时命中（维度取"任一"，省份取"任一"）。
 * 先按来源（铁路/公路）筛，再按维度与省份筛 —— 来源筛选是双源融合后新增的一层。
 */
const filteredSpots = computed(() => {
  let base = spotsByOrigin.value;
  if (activeDims.value.length) {
    const set = new Set(activeDims.value);
    base = base.filter((s) => {
      const dims = resolveSpotDimensions(s);
      if (!dims.length) return set.has('other');
      return dims.some((d) => set.has(d));
    });
  }
  if (activeProvinces.value.length) {
    const ps = new Set(activeProvinces.value);
    base = base.filter((s) => (s.province ?? '').length > 0 && ps.has(s.province!));
  }
  return base;
});

/** 省份选项：按当前来源范围内出现的省份聚合，计数从多到少 */
const provinceOptions = computed(() => {
  const counter = new Map<string, number>();
  for (const s of spotsByOrigin.value) {
    if (!s.province) continue;
    counter.set(s.province, (counter.get(s.province) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
});

function toggleProvince(name: string) {
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
    return { total: spotsByOrigin.value.length, rail: spotsByOrigin.value.length, road: 0, byTier: {}, pending: true };
  }
  const list = filteredSpots.value;
  const rail = list.filter((s) => s.origin === 'rail').length;
  const road = list.length - rail;
  const byTier: Record<string, number> = {};
  for (const s of list) {
    const t = s.tier ?? '—';
    byTier[t] = (byTier[t] ?? 0) + 1;
  }
  return { total: list.length, rail, road, byTier, pending: false };
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

const topRoadSpots = computed(() =>
  roadSpots.value
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name, 'zh'))
    .slice(0, 10),
);

const dimOptions = [...SPOT_DIMENSIONS, UNCLASSIFIED_DIMENSION];

/** 景点来源筛选选项：冷蓝=铁路（与铁路侧星点同色），琥珀=公路（与公路侧星点同色） */
const ORIGIN_OPTIONS = [
  { key: 'all' as const, label: '全部', color: '#9aa7b8' },
  { key: 'rail' as const, label: '铁路', color: '#4d9fff' },
  { key: 'road' as const, label: '公路', color: '#ffb84d' },
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

/** 一键清空全部筛选条件（维度 + 省份） */
function clearFilters() {
  activeDims.value = [];
  activeProvinces.value = [];
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

/** 地图点位色：跟随侧栏维度筛选（双重身份也显示当前选中色） */
function spotMarkerColor(spot: AtlasSpotLite): string {
  return dimensionColor(spot.dimensions, spot.category, activeDims.value);
}

/** 聚合气泡主色：取簇内出现最多的维度色（同样尊重当前筛选） */
function dominantClusterColor(items: unknown[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const raw = item as { spot?: AtlasSpotLite } | AtlasSpotLite | null;
    const spot = raw && typeof raw === 'object' && 'spot' in raw ? raw.spot : (raw as AtlasSpotLite | undefined);
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

function clusterItems(context: any): unknown[] {
  if (Array.isArray(context?.clusterData)) return context.clusterData;
  if (Array.isArray(context?.data)) return context.data;
  return [];
}

function openSpotInfo(spot: AtlasSpotLite) {
  if (!map || !AMapRef) return;
  const dims = resolveSpotDimensions(spot)
    .map(
      (d) =>
        `<span class="atlas-iw-dim" style="--dot:${dimensionColor([d])}">${escHtml(dimensionMeta(d).short)}</span>`,
    )
    .join('');
  const html = `<div class="atlas-iw">
    <button type="button" class="atlas-iw__close" data-info-close aria-label="关闭">×</button>
    <p class="atlas-iw__name">${escHtml(spot.name)}</p>
    <p class="atlas-iw__line">${escHtml(corridorSpotsText(spot))}</p>
    ${dims ? `<p class="atlas-iw__dims">${dims}</p>` : ''}
    ${spot.intro ? `<p class="atlas-iw__intro">${escHtml(spot.intro)}</p>` : ''}
  </div>`;
  if (!infoWindow) {
    infoWindow = new AMapRef.InfoWindow({
      offset: new AMapRef.Pixel(0, -10),
      isCustom: true,
      closeWhenClickMap: true,
      // 禁止为弹窗自动挪图，否则会冲掉我们算好的「居中偏左」
      autoMove: false,
    });
  } else {
    try {
      infoWindow.setOptions?.({ autoMove: false });
    } catch {
      /* ignore */
    }
  }
  infoWindow.setContent(html);
  infoWindow.open(map, [spot.lng, spot.lat]);
  // isCustom 内容有时不冒泡到 map container，打开后直接绑关闭钮
  requestAnimationFrame(() => {
    const btn = document.querySelector('.atlas-iw [data-info-close]');
    if (!btn) return;
    btn.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSpotInfo();
      },
      { once: true },
    );
  });
}

function clearCluster() {
  if (cluster) {
    try {
      cluster.setMap?.(null);
    } catch {
      /* ignore */
    }
    cluster = null;
  }
  for (const m of plainMarkers) {
    try {
      map?.remove(m);
    } catch {
      /* ignore */
    }
  }
  plainMarkers = [];
}

function renderSpots() {
  if (!map || !AMapRef) return;
  /*
   * v0.6.4 按来源分流渲染，消除"切换来源时地图跳一下"：
   *   · 铁路点（≤ ~1k）走 MarkerCluster，保留聚合圆圈与维度着色；
   *   · 公路点（1.2 万）走独立图层 + 4000 个绘制上限，
   *     全部塞进 MarkerCluster 会长时间阻塞主线程，表现为切到公路时地图卡住再跳一下。
   * 两侧各自独立重建/销毁，切换来源时另一侧保持不动。
   */
  const list = filteredSpots.value;
  const railList = list.filter((s) => s.origin !== 'road');
  const roadList = list.filter((s) => s.origin === 'road');

  renderRailSpots(railList);
  renderRoadSpots(roadList);
}

function renderRailSpots(list: AtlasSpotLite[]) {
  if (!map || !AMapRef) return;
  const data = list.map((s) => ({ lnglat: [s.lng, s.lat], spot: s }));

  if (typeof AMapRef.MarkerCluster === 'function') {
    // 着色逻辑变更后必须重建，避免沿用旧的全蓝 renderClusterMarker
    clearCluster();
    if (!data.length) return;
    cluster = new AMapRef.MarkerCluster(map, data, {
      gridSize: 70,
      maxZoom: 12,
      averageCenter: true,
      clusterByZoomChange: false,
      renderClusterMarker: (context: any) => {
        const count = context.count || 0;
        const size = count < 10 ? 22 : count < 50 ? 26 : 32;
        const color = dominantClusterColor(clusterItems(context));
        context.marker.setContent(
          `<div class="atlas-cluster" style="--cluster:${color};width:${size}px;height:${size}px">${count}</div>`,
        );
        context.marker.setOffset(new AMapRef.Pixel(-size / 2, -size / 2));
      },
      renderMarker: (context: any) => {
        const raw = Array.isArray(context.data) ? context.data[0] : context.data;
        const spot: AtlasSpotLite | undefined = raw?.spot || raw;
        if (!spot) return;
        const color = spotMarkerColor(spot);
        context.marker.setContent(
          `<span class="atlas-dot" style="--dot:${color}" title="${escHtml(spot.name)}"></span>`,
        );
        context.marker.setOffset(new AMapRef.Pixel(-3.5, -3.5));
        context.marker.on('click', () => selectSpot(spot));
      },
    });
    return;
  }

  // 降级：聚合插件不可用时直接画普通 Marker
  clearCluster();
  for (const item of data.slice(0, 600)) {
    const spot = item.spot;
    const m = new AMapRef.Marker({
      position: item.lnglat,
      anchor: 'center',
      title: spot.name,
      content: `<span class="atlas-dot" style="--dot:${spotMarkerColor(spot)}"></span>`,
    });
    m.on('click', () => selectSpot(spot));
    map.add(m);
    plainMarkers.push(m);
  }
}

/**
/**
/**
 * 公路侧点渲染：**省级聚合标记**（不是逐点画）。
 *
 * 走过的两条弯路，都留在这里别再踩：
 *  1. AMap.MassMarks（Canvas 批量绘制）—— 实测在当前环境下**一个点都不画**，
 *     MassMarks 是图片标记 API，内联 SVG data URI + anchor 都不生效。
 *  2. 普通 Marker 逐点画 —— 实测 4000 个 Marker 产生 **10.7 秒主线程长任务**
 *     （约 2.7ms/Marker），页面直接卡死。1.2 万点这条路根本走不通。
 *
 * 现在的方案：按省份聚合成 30 来个标记（瞬时渲染），
 * 密度交给热力图层承载（AMap.HeatMap 走 canvas，1.2 万点无压力，
 * 权重口径见 renderHeat）。这与参考 UI 的聚合圆圈是同一种表达。
 * 点击省标记 = 切换该省的筛选，侧栏统计与榜单随之收敛。
 */
function renderRoadSpots(list: AtlasSpotLite[]) {
  if (!map || !AMapRef) return;
  // 切到公路来源但明细还在加载时保持上一次渲染，避免"点先消失再冒出来"
  if (!list.length && roadLoading.value) return;
  clearRoadSpots();
  if (!list.length) return;

  // 按省份聚合
  const groups = new Map<string, AtlasSpotLite[]>();
  for (const s of list) {
    const key = s.province ?? '';
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  for (const [prov, items] of groups) {
    let lng = 0;
    let lat = 0;
    let scoreSum = 0;
    for (const s of items) {
      lng += s.lng;
      lat += s.lat;
      scoreSum += s.score ?? 60;
    }
    const count = items.length;
    const size = count < 50 ? 20 : count < 300 ? 24 : 28;
    const label = prov || '未标注省份';
    const marker = new AMapRef.Marker({
      position: [lng / count, lat / count],
      content:
        '<div class="atlas-prov-cluster" data-prov="' + escHtml(prov) + '" style="width:' + size + 'px;height:' + size + 'px">' +
        '<span class="atlas-prov-cluster__name">' + escHtml(label) + '</span>' +
        '<em class="atlas-prov-cluster__num">' + count + '</em>' +
        '</div>',
      offset: new AMapRef.Pixel(-size / 2, -size / 2),
      zIndex: 95,
      cursor: 'pointer',
      title: label + ' · ' + count + ' 处景点（点击只看该省）',
    });
    map.add(marker);
    roadPlainMarkers.push(marker);
  }
}

/**
 * 省聚合标记的点击：走**地图容器上的事件委托**而不是 Marker.on('click')。
 * AMap 2.0 的 Marker 事件在部分环境下不稳定触发（合成点击测不到），
 * 委托到容器上用 data-prov 判定最可靠，行为与用户直觉一致。
 */
function onMapClickDelegated(event: MouseEvent) {
  const el = (event.target as HTMLElement)?.closest?.('[data-prov]') as HTMLElement | null;
  const prov = el?.dataset?.prov;
  if (!prov) return;
  if (activeProvinces.value.includes(prov)) {
    activeProvinces.value = activeProvinces.value.filter((p) => p !== prov);
  } else {
    activeProvinces.value = [prov];
  }
}

function clearRoadSpots() {
  for (const m of roadPlainMarkers) {
    try {
      map?.remove(m);
    } catch {
      /* ignore */
    }
  }
  roadPlainMarkers = [];
}

function resolveHeatMapCtor(): (new (...args: any[]) => any) | null {
  if (!AMapRef) return null;
  const ctor = AMapRef.HeatMap || AMapRef.Heatmap;
  return typeof ctor === 'function' ? ctor : null;
}

function renderHeat() {
  if (!map || !AMapRef) return;
  if (heat) {
    try {
      heat.hide?.();
      heat.setMap?.(null);
    } catch {
      /* ignore */
    }
    heat = null;
  }
  if (!heatOn.value) return;

  const HeatMapCtor = resolveHeatMapCtor();
  if (!HeatMapCtor) {
    heatSupported.value = false;
    heatOn.value = false;
    return;
  }

  /*
   * HeatMap 走 canvas，颜色必须是实色；CSS 变量无效会导致整层不渲染。
   *
   * 权重口径（v0.6.4 修正）：原先每点 count 固定 1、max 按总数动态
   * （`points.length / 80`）。切到公路来源后点数从 624 涨到 1.2 万，
   * max 随之变成 ~151，单点相对强度降到 1/151 —— 热力层几乎不可见，
   * 表现为「热力图开关打开但看不到东西」。
   * 改为：max 固定 12（有评分用评分、无评分用 1），密度差异由点数与评分共同表达，
   * 两侧来源的观感一致，且高评分景点自然更热。
   */
  const points = filteredSpots.value
    .filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat))
    .map((s) => ({
      lng: s.lng,
      lat: s.lat,
      // 评分 0–100 → 1–12；无评分（铁路侧数据源无 score）按 6 计
      count: Number.isFinite(s.score) ? Math.max(1, Math.min(12, s.score! / 8)) : 6,
    }));
  if (!points.length) return;

  try {
    heat = new HeatMapCtor(map, {
      radius: 16,
      opacity: [0, 0.72],
      gradient: {
        0.25: '#38bdf8',
        0.45: '#34d399',
        0.65: '#fbbf24',
        0.85: '#fb923c',
        1: '#f87171',
      },
      zooms: [3, 20],
      zIndex: 120,
    });
    heat.setDataSet({
      // 固定上限：与来源无关，铁路/公路两侧观感一致
      max: 12,
      data: points,
    });
    heat.show?.();
  } catch (e) {
    console.warn('[atlas] HeatMap failed', e);
    heatSupported.value = false;
    heatOn.value = false;
    heat = null;
  }
}

function renderNetwork() {
  if (!map || !AMapRef) return;
  for (const c of corridors.value) {
    if (c.polyline.length < 2) continue;
    const line = new AMapRef.Polyline({
      path: c.polyline,
      strokeColor: '#7a8494',
      strokeWeight: 1.5,
      strokeOpacity: 0.42,
      strokeStyle: 'solid',
      lineJoin: 'round',
      lineCap: 'round',
      zIndex: 30,
      // 底图路网只作示意：不可点。选中线路走侧栏/搜索，避免密线区误触弹出蓝线
      clickable: false,
      bubble: true,
      cursor: 'default',
    });
    map.add(line);
    baseLines.push(line);
    lineByCorridor.set(c.id, line);
  }
}

function getMapChromeInsets(): [number, number, number, number] {
  // setFitView avoid：[上, 右, 下, 左]，为单位像素
  const edge = 36;
  const dock = document.querySelector('.atlas-dock') as HTMLElement | null;
  const mapRect = mapEl.value?.getBoundingClientRect();
  if (!dock || dock.classList.contains('is-collapsed') || !mapRect) {
    return [edge, edge, edge, edge];
  }
  const rect = dock.getBoundingClientRect();
  // 相对地图容器换算，避免窗口坐标与 map 像素坐标系错位
  const dockRight = rect.right - mapRect.left;
  const dockTop = rect.top - mapRect.top;
  const vw = mapRect.width || window.innerWidth;
  const vh = mapRect.height || window.innerHeight;
  if (vw <= 720) {
    // 底栏：景点落在底栏上方可视区中心
    const bottom = Math.max(edge, Math.ceil(vh - dockTop) + 10);
    return [edge + 8, edge, bottom, edge];
  }
  // 左侧栏：景点落在侧栏右侧可视区中心
  const left = Math.max(edge, Math.ceil(dockRight) + 12);
  return [edge, edge, edge, left];
}

function mapPixelSize(): { w: number; h: number } {
  const el = mapEl.value;
  if (el?.clientWidth && el?.clientHeight) {
    return { w: el.clientWidth, h: el.clientHeight };
  }
  const size = map?.getSize?.();
  const w = Number(size?.width ?? size?.getWidth?.() ?? 0);
  const h = Number(size?.height ?? size?.getHeight?.() ?? 0);
  return { w, h };
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
  const prevAnimate = map.getStatus?.()?.animateEnable;
  try {
    map.setStatus?.({ animateEnable: false });
  } catch {
    /* ignore */
  }
  try {
    map.setZoomAndCenter(preferZoom, [lng, lat]);
  } catch {
    try {
      map.setZoom(preferZoom, true);
    } catch {
      map.setZoom(preferZoom);
    }
    try {
      map.setCenter([lng, lat], true);
    } catch {
      map.setCenter([lng, lat]);
    }
  }

  if (w && h) {
    const availW = Math.max(1, w - left - right);
    const availH = Math.max(1, h - top - bottom);
    // 可视区水平约 40%（居中偏左），垂直约 42%（略偏上给信息窗）
    const panX = left + availW * 0.4 - w / 2;
    const panY = top + availH * 0.42 - h / 2;
    if (Number.isFinite(panX) && Number.isFinite(panY) && (Math.abs(panX) >= 1 || Math.abs(panY) >= 1)) {
      try {
        map.panBy(panX, panY);
      } catch {
        /* ignore */
      }
    }
  }

  try {
    map.setStatus?.({ animateEnable: prevAnimate !== false });
  } catch {
    /* ignore */
  }
}

function clearFocusMarker() {
  if (!focusMarker) return;
  try {
    map?.remove(focusMarker);
  } catch {
    /* ignore */
  }
  focusMarker = null;
}

function showFocusMarker(spot: AtlasSpotLite) {
  if (!map || !AMapRef) return;
  clearFocusMarker();
  const color = spotMarkerColor(spot);
  focusMarker = new AMapRef.Marker({
    position: [spot.lng, spot.lat],
    anchor: 'center',
    zIndex: 320,
    content: `<span class="atlas-focus" style="--dot:${color}" title="${escHtml(spot.name)}"><i></i></span>`,
    offset: new AMapRef.Pixel(0, 0),
  });
  focusMarker.on('click', () => openSpotInfo(spot));
  map.add(focusMarker);
}

function clearCorridorHighlight() {
  selectedCorridorId.value = '';
  if (!highlightLine) return;
  try {
    map?.remove(highlightLine);
  } catch {
    /* ignore */
  }
  highlightLine = null;
}

function focusCorridor(id: string) {
  const line = lineByCorridor.get(id);
  const target = corridors.value.find((c) => c.id === id);
  if (!line || !target || !map) return;
  selectedCorridorId.value = id;
  if (highlightLine) {
    try {
      map.remove(highlightLine);
    } catch {
      /* ignore */
    }
  }
  highlightLine = new AMapRef.Polyline({
    path: target.polyline,
    strokeColor: '#4d9fff',
    strokeWeight: 5,
    strokeOpacity: 0.95,
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: 50,
    // 高亮线同样不抢景点点击
    clickable: false,
    bubble: true,
  });
  map.add(highlightLine);
  try {
    map.setFitView([highlightLine], false, getMapChromeInsets());
  } catch {
    map.setZoomAndCenter(7, target.polyline[0]!);
  }
}

function selectSpot(spot: AtlasSpotLite) {
  if (!map || !spot) return;
  const lng = Number(spot.lng);
  const lat = Number(spot.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
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
  if (!map || !AMapRef) {
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
    clearFocusMarker();
    focusCorridor(hit.id);
  } else {
    focusSpotById(hit.id);
  }
}

function resetView() {
  if (!map) return;
  clearFocusMarker();
  closeSpotInfo();
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

/** 聚焦一条编号公路：加粗高亮 + fitView（与铁路走廊同一套交互） */
function focusRoad(key: string) {
  const target = roadCorridors.value.find((r) => r.key === key);
  if (!target || !map || !AMapRef) return;
  selectedCorridorId.value = key;
  if (highlightLine) {
    try {
      map.remove(highlightLine);
    } catch {
      /* ignore */
    }
  }
  highlightLine = new AMapRef.Polyline({
    path: target.polyline,
    strokeColor: roadColor(target.class),
    strokeWeight: 5,
    strokeOpacity: 0.95,
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: 50,
    clickable: false,
    bubble: true,
  });
  map.add(highlightLine);
  try {
    map.setFitView([highlightLine], false, getMapChromeInsets());
  } catch {
    map.setZoomAndCenter(7, target.polyline[0]!);
  }
}

/** 公路榜单击详情 */
function goRoadBoard(boardId: string) {
  void router.push(`/drive/rankings/${encodeURIComponent(boardId)}`);
}

async function loadPlugins() {
  if (!map || !AMapRef) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      // 官方示例用 map.plugin；AMap.plugin 作兜底
      const loader = typeof map.plugin === 'function' ? map.plugin.bind(map) : AMapRef.plugin?.bind(AMapRef);
      if (!loader) {
        finish();
        return;
      }
      loader(['AMap.MarkerCluster', 'AMap.HeatMap'], () => finish());
    } catch {
      finish();
    }
    window.setTimeout(finish, 8000);
  });
  heatSupported.value = !!resolveHeatMapCtor();
}

async function initMap() {
  const key = import.meta.env.VITE_AMAP_KEY;
  if (!key) {
    mapError.value = '未配置 VITE_AMAP_KEY（apps/web/.env），地图不可用';
    return;
  }
  try {
    AMapRef = await loadAmap(key, import.meta.env.VITE_AMAP_SECURITY);
  } catch {
    mapError.value = '高德地图脚本加载失败，请检查网络或 Key 配置';
    return;
  }
  if (!mapEl.value) return;
  map = new AMapRef.Map(mapEl.value, {
    zoom: 4.4,
    center: [104.5, 34.5],
    viewMode: '2D',
    mapStyle: AMAP_MAP_STYLE,
  });
  map.getContainer().addEventListener('click', (event: MouseEvent) => {
    const t = event.target as HTMLElement;
    if (t.closest?.('[data-info-close]')) {
      closeSpotInfo();
      return;
    }
    // 省聚合标记：点击只看该省（事件委托，见 onMapClickDelegated 注释）
    onMapClickDelegated(event);
  });
  // 点空白处收起高亮蓝线（路网已不可点，避免密线区误触）
  map.on('click', () => {
    clearCorridorHighlight();
  });
  await loadPlugins();
  renderNetwork();
  renderSpots();
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
    renderNetwork();
    renderSpots();
    if (roadLayerOn.value) renderRoadLayer();
  }
}

onMounted(async () => {
  await load();
  await initMap();
  // /drive/atlas 模式：默认打开公路图层（铁路图层共存，可再手动切换）
  if (props.drive && map) {
    roadLayerOn.value = true;
    await loadRoad();
    renderRoadLayer();
  } else if (spotOrigin.value === 'all') {
    // 默认「全部」来源：首屏渲染完成后再后台拉公路（3.8MB），不阻塞地图可用。
    // 否则用户看到统计只有铁路 624 处，会以为数据缺失。
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
  clearFocusMarker();
  clearCluster();
  clearRoadSpots();
  for (const l of baseLines) {
    try {
      map?.remove(l);
    } catch {
      /* ignore */
    }
  }
  baseLines = [];
  for (const l of roadPolylines) {
    try {
      map?.remove(l);
    } catch {
      /* ignore */
    }
  }
  roadPolylines = [];
  lineByCorridor.clear();
  if (highlightLine) {
    try {
      map?.remove(highlightLine);
    } catch {
      /* ignore */
    }
    highlightLine = null;
  }
  if (heat) {
    try {
      heat.setMap?.(null);
    } catch {
      /* ignore */
    }
    heat = null;
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
watch(heatOn, () => renderHeat());
// 切到含公路的来源时才拉公路明细（按需加载，避免默认路径背 4.4MB）
watch(spotOrigin, (v) => {
  if (v === 'road' || v === 'all') void loadRoad();
});
</script>

<template>
  <div class="atlas-page">
    <div ref="mapEl" class="atlas-map"></div>

    <!-- 外层必须是 .atlas-dock：样式 / fitView 避让都认这个类；勿改回 atlas-side（会沉到地图下面） -->
    <aside class="atlas-dock" :class="{ 'is-collapsed': !sidebarOpen }">
      <template v-if="sidebarOpen">
        <header class="atlas-dock__head">
          <div class="atlas-dock__nav">
            <button type="button" class="map-back-btn" @click="goBack">
              <span class="map-back-btn__icon" aria-hidden="true">‹</span>
              返回
            </button>
            <button
              type="button"
              class="map-new-trip-btn"
              :class="{ 'is-active': roadLayerOn }"
              :disabled="!!mapError"
              @click="toggleRoadLayer"
            >
              公路 {{ roadLayerOn ? '开' : '关' }}
            </button>
            <button
              type="button"
              class="map-new-trip-btn"
              :class="{ 'is-active': heatOn }"
              :disabled="!heatSupported || !!mapError"
              @click="heatOn = !heatOn"
            >
              热力 {{ heatOn ? '开' : '关' }}
            </button>
            <button type="button" class="map-new-trip-btn" @click="sidebarOpen = false">
              收起
            </button>
          </div>
          <div class="atlas-dock__title">
            <div class="atlas-dock__identity">
              <span class="train-badge">全国</span>
              <h1 class="atlas-dock__name">全国景点地图</h1>
            </div>
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

        <section class="atlas-block">
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
                铁路 {{ spots.length }} · 公路 {{ roadLoaded ? roadSpots.length : (stats?.roadSpotCount ?? 0) }}
              </template>
            </span>
            <button v-if="activeDims.length || activeProvinces.length" type="button" class="atlas-link" @click="clearFilters">
              清空筛选
            </button>
          </div>
          <!-- 公路侧为省级聚合标记，密度请配合热力图查看 -->
          <p class="atlas-block__note">
            地图上公路景点按省份聚合显示（数字为该省景点数）；
            开启「热力图」可查看全国密度分布。
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

        <section class="atlas-block">
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
            <span class="atlas-count">{{ filteredSpots.length }} / {{ spotsByOrigin.length }} 处</span>
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
                  {{ s.score ?? '—' }} 分
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
      <button v-else type="button" class="atlas-dock__open" @click="sidebarOpen = true">›</button>
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
  background: var(--bg-base);
  color: var(--text-secondary);
}

.atlas-map {
  position: absolute;
  inset: 0;
  z-index: 0;
}

/* ── 左侧统一面板（导航 + 标题 + 筛选/榜单，避免顶栏与侧栏叠压） ── */
.atlas-dock {
  position: fixed;
  top: calc(8px + var(--safe-top));
  left: calc(12px + var(--safe-left));
  bottom: calc(12px + var(--safe-bottom));
  z-index: 200;
  width: min(320px, calc(100vw - 24px - var(--safe-left) - var(--safe-right)));
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-default);
  background: color-mix(in srgb, var(--surface-0) 94%, transparent);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  box-shadow: var(--elev-3);
  overflow: hidden;
  pointer-events: auto;
  transition: width var(--dur-base) var(--ease-out);
}

.atlas-dock.is-collapsed {
  width: 40px;
}

.atlas-dock__head {
  flex-shrink: 0;
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--line-hairline);
}

.atlas-dock__nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.atlas-dock__title {
  display: grid;
  gap: var(--space-1);
}

.atlas-dock__identity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.atlas-dock__name {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: 700;
  line-height: var(--lh-tight);
  color: var(--text-1);
}

.atlas-dock__sub {
  margin: 0;
  font-size: var(--fs-micro);
  line-height: var(--lh-snug);
  color: var(--text-3);
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
  width: 100%;
  height: 100%;
  min-height: 40px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--fill-subtle);
  color: var(--text-2);
  font-size: 18px;
  cursor: pointer;
}

.atlas-block {
  display: grid;
  gap: 6px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--line-hairline);
  background: var(--surface-sunken);
}

.atlas-block--sel {
  border-color: var(--accent-border);
  background: var(--accent-container);
}

.atlas-block__title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.atlas-block__hint {
  margin-left: 4px;
  font-weight: 400;
  font-size: 10.5px;
  color: var(--text-muted);
}

/* ── 搜索 ── */
.atlas-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 9px;
  border: 1px solid var(--border-default);
  background: var(--bg-raised);
}

.atlas-search__icon {
  color: var(--text-muted);
  font-size: 14px;
}

.atlas-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-secondary);
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
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.atlas-result:hover {
  background: var(--accent-container);
}

.atlas-result__kind {
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--border-hairline);
  color: var(--text-muted);
  font-size: 10px;
  align-self: center;
}

.atlas-result__name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.atlas-result__desc {
  grid-column: 2;
  font-size: 10.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atlas-none {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
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
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: var(--border-hairline);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 11.5px;
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
  border-radius: 999px;
  background: var(--dot, var(--text-muted));
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
  font-size: 10.5px;
  color: var(--text-muted);
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
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.atlas-top-row:hover,
.atlas-top-row.is-active {
  background: var(--accent-container);
}

.atlas-top-row__no {
  font-size: 10.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.atlas-top-row__name {
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atlas-top-row__bar {
  height: 5px;
  border-radius: 999px;
  background: var(--border-hairline);
  overflow: hidden;
}

.atlas-top-row__fill {
  display: block;
  height: 100%;
  width: 100%;
  transform-origin: 0 50%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--info));
  transition: transform var(--dur-slow) var(--ease-out);
}

.atlas-top-row__num {
  font-size: 10.5px;
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
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.atlas-rank-row:hover,
.atlas-rank-row.is-active {
  background: var(--accent-container);
}

.atlas-rank-row__name {
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atlas-rank-row__src {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-muted);
}

/* ── 选中卡片 ── */
.atlas-sel-meta {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.atlas-sel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.atlas-btn {
  padding: 6px 12px;
  border-radius: 9px;
  border: none;
  background: linear-gradient(180deg, var(--accent), var(--accent-press));
  color: var(--bg-base);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.atlas-foot {
  margin: 0;
  font-size: 10px;
  color: var(--text-muted);
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
  border-radius: 999px;
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  font-size: 11.5px;
  color: var(--text-secondary);
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
  border-color: rgba(223, 179, 87, 0.36);
  color: var(--warning);
}

@media (max-width: 720px) {
  .atlas-dock {
    top: auto;
    left: calc(10px + var(--safe-left));
    right: calc(10px + var(--safe-right));
    bottom: calc(10px + var(--safe-bottom));
    width: auto;
    /* 默认只占下半偏少，多留地图；内容在面板内滚动 */
    max-height: min(38vh, calc(100dvh - 96px - var(--safe-bottom)));
  }

  .atlas-dock.is-collapsed {
    width: 44px;
    max-height: 44px;
  }

  .atlas-dock__head {
    gap: var(--space-1);
    padding: var(--space-2) var(--space-2) var(--space-1);
  }

  .atlas-dock__sub {
    display: none;
  }

  .atlas-dock__body {
    padding: var(--space-1) var(--space-2) var(--space-2);
    gap: var(--space-1);
  }

  .atlas-block {
    padding: 7px 8px;
  }

  .atlas-top-list {
    max-height: 22vh;
    overflow-y: auto;
  }

  .atlas-rank-list {
    max-height: 16vh;
    overflow-y: auto;
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
  border-radius: 999px;
  overflow: hidden;
  background: var(--fill-subtle);
}

.atlas-split__rail {
  background: var(--accent);
}

.atlas-split__road {
  background: #ffb84d;
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
  border-radius: 999px;
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

.atlas-province:hover {
  border-color: var(--line-default);
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
/* AMap 注入 DOM 的全局片段 */
.atlas-dot {
  display: block;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--dot, #94a3b8);
  box-shadow:
    0 0 0 2px rgba(11, 14, 20, 0.85),
    0 2px 8px rgba(0, 0, 0, 0.35);
}

.atlas-cluster {
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cluster, #4d9fff) 32%, rgba(11, 14, 20, 0.82));
  border: 1.5px solid var(--cluster, #4d9fff);
  color: #f0f4fa;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
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
  border-radius: 999px;
  border: 2px solid var(--dot, #4d9fff);
  opacity: 0.55;
  animation: atlas-focus-pulse 1.4s var(--ease-standard, ease) infinite;
}

.atlas-focus i {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--dot, #4d9fff);
  box-shadow:
    0 0 0 3px rgba(11, 14, 20, 0.9),
    0 4px 12px rgba(0, 0, 0, 0.45);
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

.atlas-iw {
  position: relative;
  max-width: 240px;
  padding: 9px 32px 11px 11px;
  border-radius: 10px;
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.atlas-iw__close {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: var(--border-hairline);
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.atlas-iw__close:hover {
  background: var(--border-default);
  color: var(--text-primary);
}

.atlas-iw__name {
  margin: 0;
  padding-right: 4px;
  font-size: 12.5px;
  font-weight: 700;
}

.atlas-iw__line {
  margin: 3px 0 0;
  font-size: 10.5px;
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
  border-radius: 999px;
  background: var(--dot, var(--text-muted));
  color: var(--bg-base);
  font-size: 10px;
  font-weight: 700;
}

.atlas-iw__intro {
  margin: 5px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* ══════════════════════════════════════════════════════════════════
   v0.6.4 布局修复
   下面这组样式在 ba6d8d6「走廊全屏地图页」那次提交里连同旧侧栏结构
   一起被删除，但模板仍在引用它们，后果是：
     · .atlas-side 退化成无样式的裸块流 —— 侧栏横跨整个屏幕压住地图；
     · 顶部条与「公路图层 / 热力图 / 收起侧栏」按钮失去玻璃质感、挤在左上角。
   按 c00bc19 原样恢复，并补齐同批引入的 .atlas-dock* 内部结构样式
   （那批只改了模板结构、没写样式）。
   ══════════════════════════════════════════════════════════════════ */

/* ── 顶部条 ── */
.atlas-top {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid var(--border-default);
  background: var(--bg-raised);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.atlas-top__title {
  flex: 1;
  min-width: 0;
}

.atlas-top__eyebrow {
  margin: 0;
  font-size: 9.5px;
  letter-spacing: 0.22em;
  color: var(--accent);
  font-weight: 700;
}

.atlas-top__title h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 图层 / 热力图 / 收起侧栏 开关 ── */
.atlas-toggle {
  flex: none;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}

.atlas-toggle.is-on {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  border-color: color-mix(in srgb, var(--accent) 52%, transparent);
  color: var(--text-primary);
}

.atlas-toggle:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── 侧栏：地图之上的窄栏（≤720vp 落到底部） ── */
.atlas-side {
  position: absolute;
  top: 66px;
  left: 12px;
  bottom: 12px;
  z-index: 4;
  width: 302px;
  padding: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 12px;
  border: 1px solid var(--border-default);
  background: var(--bg-raised);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: grid;
  gap: 10px;
  align-content: start;
  transition: width var(--dur-base) var(--ease-out), padding var(--dur-base) var(--ease-out);
}

.atlas-side.is-collapsed {
  width: 34px;
  padding: 6px;
  overflow: hidden;
}

.atlas-side__open,
.atlas-dock__open {
  width: 100%;
  height: 40px;
  border: none;
  border-radius: 8px;
  background: var(--border-hairline);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}

/* ── 侧栏内部结构（ba6d8d6 引入的 dock 结构） ── */
.atlas-dock__head {
  display: grid;
  gap: 8px;
}

.atlas-dock__nav {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.atlas-dock__title {
  display: grid;
  gap: 2px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-hairline);
}

.atlas-dock__identity {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.atlas-dock__name {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: 700;
  line-height: 1.3;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.atlas-dock__sub {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--text-muted);
}

.atlas-dock__body {
  display: grid;
  gap: 8px;
  align-content: start;
}

/* 线路聚焦时地图上的定位点 */
.route-dot {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--dot, var(--accent));
  color: var(--bg-base);
  font-size: 10px;
  font-weight: 700;
}

/* 公路景点：琥珀色小点（与铁路侧的六维着色区分） */
.atlas-dot--road {
  --dot: #ffb84d;
  width: 7px;
  height: 7px;
  box-shadow: 0 0 6px rgba(255, 184, 77, 0.55);
}

/*
 * 公路侧省级聚合标记。
 * 1.2 万个点逐个画 Marker 实测产生 10.7 秒主线程长任务（≈2.7ms/个），
 * 页面直接卡死；改为按省聚合（30 来个标记）后瞬时完成，
 * 密度分布交给热力图层（AMap.HeatMap 走 canvas，1.2 万点无压力）。
 */
.atlas-prov-cluster {
  display: grid;
  place-content: center;
  gap: 0;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 184, 77, 0.75);
  background: radial-gradient(circle at 35% 30%, rgba(255, 208, 138, 0.95), rgba(255, 160, 40, 0.85));
  color: #1a1206;
  font-weight: 700;
  text-align: center;
  box-shadow: 0 0 14px rgba(255, 168, 60, 0.45);
  cursor: pointer;
  /* 数字为主、省名为辅：省名太长会挤爆小圆，截断即可 */
  white-space: nowrap;
  overflow: hidden;
}

.atlas-prov-cluster__name {
  font-size: 8px;
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

/* ── 响应式：窄屏侧栏改为底部抽屉 ── */
@media (max-width: 720px) {
  .atlas-side {
    top: auto;
    bottom: 12px;
    left: 12px;
    right: 12px;
    width: auto;
    max-height: 46vh;
  }

  .atlas-top {
    right: 12px;
  }
}
</style>
