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
import { loadAmap } from '../map/amap';
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
const selectedCorridorId = ref('');
const stats = ref<AtlasOverviewData['meta'] | null>(null);

const corridors = ref<AtlasCorridorLite[]>([]);
const spots = ref<AtlasSpotLite[]>([]);

let map: any = null;
let AMapRef: any = null;
let infoWindow: any = null;
let cluster: any = null;
let heat: any = null;
let highlightLine: any = null;
let focusMarker: any = null;
let baseLines: any[] = [];
let plainMarkers: any[] = [];
/** corridorId → 折线，供点击/搜索后 fitView */
const lineByCorridor = new Map<string, any>();

const corridorName = computed(() => {
  const map = new Map<string, string>();
  for (const c of corridors.value) map.set(c.id, c.name);
  return map;
});

const selectedCorridor = computed(
  () => corridors.value.find((c) => c.id === selectedCorridorId.value) || null,
);

/** 六维筛选：未选 = 全部；选中后 = 命中任一维度（含「其它」= 无有效维度的景点） */
const filteredSpots = computed(() => {
  if (!activeDims.value.length) return spots.value;
  const set = new Set(activeDims.value);
  return spots.value.filter((s) => {
    const dims = resolveSpotDimensions(s);
    if (!dims.length) return set.has('other');
    return dims.some((d) => set.has(d));
  });
});

const dimOptions = [...SPOT_DIMENSIONS, UNCLASSIFIED_DIMENSION];

/** 沿线景点最多的线路 Top10（按客户端统计的 spotCount） */
const topCorridors = computed(() =>
  corridors.value
    .filter((c) => c.spotCount > 0)
    .slice()
    .sort((a, b) => b.spotCount - a.spotCount || b.lengthKm - a.lengthKm)
    .slice(0, 10),
);

const maxSpotCount = computed(() => topCorridors.value[0]?.spotCount || 1);

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

/** 聚合气泡主色：取簇内出现最多的维度色 */
function dominantClusterColor(items: unknown[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const raw = item as { spot?: AtlasSpotLite } | AtlasSpotLite | null;
    const spot = raw && typeof raw === 'object' && 'spot' in raw ? raw.spot : (raw as AtlasSpotLite | undefined);
    if (!spot?.id) continue;
    const color = dimensionColor(spot.dimensions, spot.category);
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
  const list = filteredSpots.value;
  const data = list.map((s) => ({ lnglat: [s.lng, s.lat], spot: s }));

  if (typeof AMapRef.MarkerCluster === 'function') {
    // 着色逻辑变更后必须重建，避免沿用旧的全蓝 renderClusterMarker
    clearCluster();
    cluster = new AMapRef.MarkerCluster(map, data, {
      gridSize: 70,
      maxZoom: 12,
      averageCenter: true,
      clusterByZoomChange: false,
      renderClusterMarker: (context: any) => {
        const count = context.count || 0;
        const size = count < 10 ? 30 : count < 50 ? 36 : 44;
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
        const color = dimensionColor(spot.dimensions, spot.category);
        context.marker.setContent(
          `<span class="atlas-dot" style="--dot:${color}" title="${escHtml(spot.name)}"></span>`,
        );
        context.marker.setOffset(new AMapRef.Pixel(-6, -6));
        context.marker.on('click', () => selectSpot(spot));
      },
    });
    return;
  }

  // 降级：聚合插件不可用时直接画普通 Marker（点位上限 600，避免过载）
  clearCluster();
  for (const item of data.slice(0, 600)) {
    const spot = item.spot;
    const m = new AMapRef.Marker({
      position: item.lnglat,
      anchor: 'center',
      title: spot.name,
      content: `<span class="atlas-dot" style="--dot:${dimensionColor(spot.dimensions, spot.category)}"></span>`,
    });
    m.on('click', () => selectSpot(spot));
    map.add(m);
    plainMarkers.push(m);
  }
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

  // HeatMap 走 canvas，颜色必须是实色；CSS 变量无效会导致整层不渲染
  const points = filteredSpots.value
    .filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat))
    .map((s) => ({ lng: s.lng, lat: s.lat, count: 1 }));
  if (!points.length) return;

  try {
    heat = new HeatMapCtor(map, {
      radius: 28,
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
      max: Math.max(3, Math.ceil(points.length / 80)),
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
  const color = dimensionColor(spot.dimensions, spot.category);
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
  const spot = spots.value.find((s) => s.id === id);
  if (!spot) return;
  selectSpot(spot);
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
    mapStyle: 'amap://styles/dark',
  });
  map.getContainer().addEventListener('click', (event: MouseEvent) => {
    const t = event.target as HTMLElement;
    if (t.closest?.('[data-info-close]')) {
      closeSpotInfo();
      return;
    }
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
    spots.value = data.spots || [];
    stats.value = data.meta || null;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '地图数据加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  await initMap();
});

onUnmounted(() => {
  try {
    infoWindow?.close();
  } catch {
    /* ignore */
  }
  clearFocusMarker();
  clearCluster();
  for (const l of baseLines) {
    try {
      map?.remove(l);
    } catch {
      /* ignore */
    }
  }
  baseLines = [];
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
</script>

<template>
  <div class="atlas-page">
    <div ref="mapEl" class="atlas-map"></div>

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
              :class="{ 'is-active': heatOn }"
              :disabled="!heatSupported || !!mapError"
              @click="heatOn = !heatOn"
            >
              热力图 {{ heatOn ? '开' : '关' }}
            </button>
            <button type="button" class="map-new-trip-btn" @click="sidebarOpen = false">
              收起
            </button>
          </div>
          <div class="atlas-dock__title">
            <div class="atlas-dock__identity">
              <span class="train-badge">全国</span>
              <h1 class="atlas-dock__name">铁路景点地图</h1>
            </div>
            <p class="atlas-dock__sub">浏览全国铁路线与沿线风景，点击线路可查看详情</p>
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
            <span class="atlas-count">{{ filteredSpots.length }} / {{ spots.length }} 处</span>
            <button v-if="activeDims.length" type="button" class="atlas-link" @click="clearDims">
              清空筛选
            </button>
          </div>
        </section>

        <section class="atlas-block">
          <h2 class="atlas-block__title">沿线景点最多的线路 Top10</h2>
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
          <h2 class="atlas-block__title">排行榜线路快捷入口</h2>
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
    <p v-else-if="loadError" class="atlas-status atlas-status--err">{{ loadError }}</p>
    <p v-else-if="mapError" class="atlas-status atlas-status--err">{{ mapError }}</p>
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
  font-size: var(--fs-h3);
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
</style>

<style>
/* AMap 注入 DOM 的全局片段 */
.atlas-dot {
  display: block;
  width: 12px;
  height: 12px;
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
</style>
