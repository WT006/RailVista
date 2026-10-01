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
  isKnownDimension,
} from '../data/spotDimensions';
import { loadAmap } from '../map/amap';
import { roadColor } from '../data/roadColors';

const props = defineProps<{
  /** 公路图层模式（/drive/atlas 复用本页，PRD §2.1：公路图层与铁路图层共存、可切换） */
  drive?: boolean;
}>();

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
let baseLines: any[] = [];
let plainMarkers: any[] = [];
/** corridorId → 折线，供点击/搜索后 fitView */
const lineByCorridor = new Map<string, any>();

// ── 公路图层（/drive/atlas）：与铁路图层共存，独立开关 ────────────────────────
const roadLayerOn = ref(false);
const roadLines = ref<Array<{ key: string; ref: string; name?: string; class: string; polyline: [number, number][]; lengthKm: number }>>([]);
let roadPolylines: any[] = [];

async function loadRoadLayer() {
  if (roadLines.value.length) return;
  try {
    const data = await api.getDriveNetworkOverview();
    roadLines.value = data.roads;
  } catch {
    /* 公路图层加载失败不影响铁路图 */
  }
}

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
  for (const r of roadLines.value) {
    if (r.polyline.length < 2) continue;
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
      void router.push(`/drive/road/${encodeURIComponent(r.key)}`);
    });
    map.add(line);
    roadPolylines.push(line);
  }
}

async function toggleRoadLayer() {
  roadLayerOn.value = !roadLayerOn.value;
  if (roadLayerOn.value) await loadRoadLayer();
  renderRoadLayer();
}

const corridorName = computed(() => {
  const map = new Map<string, string>();
  for (const c of corridors.value) map.set(c.id, c.name);
  return map;
});

const selectedCorridor = computed(
  () => corridors.value.find((c) => c.id === selectedCorridorId.value) || null,
);

/** 六维筛选：未选 = 全部；选中后 = 命中任一维度（含「其它」= 无维度标签的景点） */
const filteredSpots = computed(() => {
  if (!activeDims.value.length) return spots.value;
  const set = new Set(activeDims.value);
  return spots.value.filter((s) => {
    const dims = (s.dimensions || []).filter((d) => isKnownDimension(d));
    if (!dims.length) return set.has('other');
    return dims.some((d) => set.has(d));
  });
});

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
  const i = activeDims.value.indexOf(key);
  if (i >= 0) activeDims.value.splice(i, 1);
  else activeDims.value.push(key);
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

function openSpotInfo(spot: AtlasSpotLite) {
  if (!map || !AMapRef) return;
  const dims = (spot.dimensions || [])
    .filter((d) => isKnownDimension(d))
    .map(
      (d) =>
        `<span class="atlas-iw-dim" style="--dot:${dimensionColor([d])}">${escHtml(dimensionMeta(d).short)}</span>`,
    )
    .join('');
  const html = `<div class="atlas-iw">
    <p class="atlas-iw__name">${escHtml(spot.name)}</p>
    <p class="atlas-iw__line">${escHtml(corridorSpotsText(spot))}</p>
    ${dims ? `<p class="atlas-iw__dims">${dims}</p>` : ''}
    ${spot.intro ? `<p class="atlas-iw__intro">${escHtml(spot.intro)}</p>` : ''}
  </div>`;
  if (!infoWindow) {
    infoWindow = new AMapRef.InfoWindow({ offset: new AMapRef.Pixel(0, -10), isCustom: true });
  }
  infoWindow.setContent(html);
  infoWindow.open(map, [spot.lng, spot.lat]);
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
  clearCluster();
  const list = filteredSpots.value;
  const data = list.map((s) => ({ lnglat: [s.lng, s.lat], spot: s }));

  if (typeof AMapRef.MarkerCluster === 'function') {
    cluster = new AMapRef.MarkerCluster(map, data, {
      gridSize: 70,
      maxZoom: 12,
      averageCenter: true,
      clusterByZoomChange: false,
      renderClusterMarker: (context: any) => {
        const count = context.count || 0;
        const size = count < 10 ? 30 : count < 50 ? 36 : 44;
        context.marker.setContent(
          `<div class="atlas-cluster" style="width:${size}px;height:${size}px">${count}</div>`,
        );
        context.marker.setOffset(new AMapRef.Pixel(-size / 2, -size / 2));
      },
      renderMarker: (context: any) => {
        const raw = Array.isArray(context.data) ? context.data[0] : context.data;
        const spot: AtlasSpotLite | undefined = raw?.spot || raw;
        if (!spot) return;
        const color = dimensionColor(spot.dimensions);
        context.marker.setContent(
          `<span class="atlas-dot" style="--dot:${color}" title="${escHtml(spot.name)}"></span>`,
        );
        context.marker.setOffset(new AMapRef.Pixel(-5, -5));
        context.marker.on('click', () => openSpotInfo(spot));
      },
    });
    return;
  }

  // 降级：聚合插件不可用时直接画普通 Marker（点位上限 600，避免过载）
  for (const item of data.slice(0, 600)) {
    const spot = item.spot;
    const m = new AMapRef.Marker({
      position: item.lnglat,
      anchor: 'center',
      title: spot.name,
      content: `<span class="atlas-dot" style="--dot:${dimensionColor(spot.dimensions)}"></span>`,
    });
    m.on('click', () => openSpotInfo(spot));
    map.add(m);
    plainMarkers.push(m);
  }
}

function renderHeat() {
  if (!map || !AMapRef) return;
  if (heat) {
    try {
      heat.setMap?.(null);
    } catch {
      /* ignore */
    }
    heat = null;
  }
  if (!heatOn.value) return;
  if (typeof AMapRef.HeatMap !== 'function') {
    heatSupported.value = false;
    heatOn.value = false;
    return;
  }
  heat = new AMapRef.HeatMap(map, {
    radius: 26,
    opacity: [0, 0.75],
    gradient: {
      0.2: 'var(--accent-press)',
      0.45: 'var(--info)',
      0.65: 'var(--warning)',
      1: 'var(--danger)',
    },
    zooms: [3, 18],
  });
  heat.setDataSet({
    max: 4,
    data: filteredSpots.value.map((s) => ({ lng: s.lng, lat: s.lat, count: 1 })),
  });
}

function renderNetwork() {
  if (!map || !AMapRef) return;
  for (const c of corridors.value) {
    if (c.polyline.length < 2) continue;
    const line = new AMapRef.Polyline({
      path: c.polyline,
      strokeColor: 'var(--text-secondary)',
      strokeWeight: 1.4,
      strokeOpacity: 0.38,
      strokeStyle: 'solid',
      lineJoin: 'round',
      lineCap: 'round',
      zIndex: 30,
      bubble: true,
      // L1 明确不响应 hover；仅 click 用于选中（性能优先）
      cursor: 'default',
    });
    line.on('click', () => focusCorridor(c.id));
    map.add(line);
    baseLines.push(line);
    lineByCorridor.set(c.id, line);
  }
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
    strokeColor: 'var(--accent)',
    strokeWeight: 4,
    strokeOpacity: 0.95,
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: 50,
    bubble: true,
  });
  map.add(highlightLine);
  try {
    map.setFitView([highlightLine], false, [50, 60, 50, 60]);
  } catch {
    map.setZoomAndCenter(7, target.polyline[0]!);
  }
}

function focusSpotById(id: string) {
  const spot = spots.value.find((s) => s.id === id);
  if (!spot || !map) return;
  map.setZoomAndCenter(10, [spot.lng, spot.lat]);
  openSpotInfo(spot);
}

function onResultClick(hit: { kind: 'corridor' | 'spot'; id: string }) {
  if (hit.kind === 'corridor') focusCorridor(hit.id);
  else focusSpotById(hit.id);
}

function resetView() {
  if (!map) return;
  selectedCorridorId.value = '';
  if (highlightLine) {
    try {
      map.remove(highlightLine);
    } catch {
      /* ignore */
    }
    highlightLine = null;
  }
  map.setZoomAndCenter(4.4, [104.5, 34.5]);
}

function goBack() {
  void router.push('/');
}

function goRouteDetail() {
  if (!selectedCorridorId.value) return;
  void router.push(`/route/${selectedCorridorId.value}`);
}

async function loadPlugins() {
  if (!AMapRef?.plugin) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      AMapRef.plugin(['AMap.MarkerCluster', 'AMap.HeatMap'], () => finish());
    } catch {
      finish();
    }
    // 插件加载无回调（网络异常）时的兜底超时，避免页面卡在「加载中」
    window.setTimeout(finish, 5000);
  });
  if (typeof AMapRef.HeatMap !== 'function') heatSupported.value = false;
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
    mapStyle: 'amap://styles/grey',
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
  // /drive/atlas 模式：默认打开公路图层（铁路图层共存，可再手动切换）
  if (props.drive && map) {
    roadLayerOn.value = true;
    await loadRoadLayer();
    renderRoadLayer();
  }
});

onUnmounted(() => {
  try {
    infoWindow?.close();
  } catch {
    /* ignore */
  }
  clearCluster();
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
</script>

<template>
  <div class="atlas-page">
    <div ref="mapEl" class="atlas-map"></div>

    <header class="atlas-top">
      <button type="button" class="back-link" aria-label="返回首页" @click="goBack">‹</button>
      <div class="atlas-top__title">
        <p class="atlas-top__eyebrow">{{ drive ? 'ROAD ATLAS' : 'RAIL ATLAS' }}</p>
        <h1>{{ drive ? '全国公路旅游网' : '全国铁路景点地图' }}</h1>
      </div>
      <button
        type="button"
        class="atlas-toggle"
        :class="{ 'is-on': roadLayerOn }"
        :disabled="!!mapError"
        @click="toggleRoadLayer"
      >
        公路图层 {{ roadLayerOn ? '开' : '关' }}
      </button>
      <button
        type="button"
        class="atlas-toggle"
        :class="{ 'is-on': heatOn }"
        :disabled="!heatSupported || !!mapError"
        @click="heatOn = !heatOn"
      >
        热力图 {{ heatOn ? '开' : '关' }}
      </button>
      <button type="button" class="atlas-toggle" @click="sidebarOpen = !sidebarOpen">
        {{ sidebarOpen ? '收起侧栏' : '展开侧栏' }}
      </button>
    </header>

    <aside class="atlas-side" :class="{ 'is-collapsed': !sidebarOpen }">
      <template v-if="sidebarOpen">
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
              v-for="d in [...SPOT_DIMENSIONS, UNCLASSIFIED_DIMENSION]"
              :key="d.key"
              type="button"
              class="atlas-dim"
              :class="{ 'is-on': activeDims.includes(d.key) }"
              :style="{ '--dot': d.color }"
              @click="toggleDim(d.key)"
            >
              <span class="route-dot" :style="{ '--dot': d.color }"></span>{{ d.short }}
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
            <button type="button" class="atlas-btn" @click="goRouteDetail">查看线路详情 ›</button>
            <button type="button" class="atlas-link" @click="resetView">重置视野</button>
          </div>
        </section>

        <p v-if="stats" class="atlas-foot">
          共 {{ stats.corridorCount }} 条线路 · {{ stats.spotCount }} 处景点 · 聚合耗时
          {{ stats.buildMs }}ms
        </p>
      </template>
      <button v-else type="button" class="atlas-side__open" @click="sidebarOpen = true">›</button>
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

/* ── 顶栏 ── */
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.atlas-toggle {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: var(--border-hairline);
  color: var(--text-secondary);
  font-size: 11.5px;
  cursor: pointer;
}

.atlas-toggle.is-on {
  border-color: var(--accent-border);
  background: var(--accent-container);
  color: var(--accent-hover);
}

.atlas-toggle:disabled {
  opacity: 0.45;
  cursor: default;
}

/* ── 侧栏 ── */
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

.atlas-side__open {
  width: 100%;
  height: 40px;
  border: none;
  border-radius: 8px;
  background: var(--border-hairline);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}

.atlas-block {
  display: grid;
  gap: 6px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-hairline);
  background: var(--bg-elevated);
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
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: var(--border-hairline);
  color: var(--text-secondary);
  font-size: 11.5px;
  cursor: pointer;
}

.atlas-dim.is-on {
  border-color: var(--dot, var(--accent));
  background: var(--accent-container);
  color: var(--accent-hover);
  font-weight: 600;
}

.route-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--dot, var(--text-muted));
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

<style>
/* AMap 注入 DOM 的全局片段 */
.atlas-dot {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--dot, var(--text-muted));
  box-shadow: 0 0 0 2px var(--bg-raised);
}

.atlas-cluster {
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--accent-container);
  border: 1px solid var(--accent-border);
  color: var(--accent-hover);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.atlas-iw {
  max-width: 240px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.atlas-iw__name {
  margin: 0;
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
