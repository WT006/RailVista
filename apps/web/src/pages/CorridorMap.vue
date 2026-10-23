<script setup lang="ts">
/**
 * 线路全屏地图 /route/:corridorId/map
 *
 * 布局对齐 TripMap：top-bar / status-card / 右侧定位·卫星·图例。
 * 不依赖车次时刻表；「选车次出行」才回首页预填 OD。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type AtlasCorridorDetail, type AtlasCorridorSpot } from '../api/client';
import { findRankingsByCorridor } from '../data/beautifulRailings';
import { ATLAS_RAIL_HOVER_STROKE, ATLAS_RAIL_STROKE } from '../data/atlasColors';
import {
  SPOT_DIMENSIONS,
  UNCLASSIFIED_DIMENSION,
  dimensionMeta,
  escHtml,
  isKnownDimension,
} from '../data/spotDimensions';
import {
  addMarker,
  addPolyline,
  createInfoWindow,
  createMap,
  loadMapEngine,
  type InfoWindowHandle,
  type MapHandle,
  type MarkerHandle,
  type PolylineHandle,
} from '../map/engine';

const route = useRoute();
const router = useRouter();

const corridorId = computed(() => String(route.params.corridorId || '').trim());

const detail = ref<AtlasCorridorDetail | null>(null);
const loading = ref(true);
const notFound = ref(false);
const loadError = ref('');
const mapError = ref('');
const legendOpen = ref(false);
const compact = ref(false);
const statusCollapsed = ref(false);
const selectedSpot = ref<AtlasCorridorSpot | null>(null);
/** 左侧列表：景点 / 站序；null 表示收起 */
const sideList = ref<'spots' | 'stations' | null>(null);

const STATUS_COLLAPSE_KEY = 'railvista:cormap:statusCollapsed';
const SATELLITE_PREF_KEY = 'railvista:map:satellite';

if (typeof localStorage !== 'undefined') {
  statusCollapsed.value = localStorage.getItem(STATUS_COLLAPSE_KEY) === '1';
}

const satelliteOn = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SATELLITE_PREF_KEY) === '1',
);

const mapEl = ref<HTMLElement | null>(null);
const pageEl = ref<HTMLElement | null>(null);
let map: MapHandle | null = null;
let railLine: PolylineHandle | null = null;
let drawnOverlays: Array<PolylineHandle | MarkerHandle> = [];
let openInfo: InfoWindowHandle | null = null;

const rankHits = computed(() => findRankingsByCorridor(corridorId.value));

const displayFrom = computed(() => {
  const q = route.query.from;
  if (typeof q === 'string' && q.trim()) return q.trim();
  if (rankHits.value.length) return rankHits.value[0]!.item.from;
  const hint = detail.value?.stationsHint || [];
  return hint.length ? hint[0]! : '';
});

const displayTo = computed(() => {
  const q = route.query.to;
  if (typeof q === 'string' && q.trim()) return q.trim();
  if (rankHits.value.length) return rankHits.value[0]!.item.to;
  const hint = detail.value?.stationsHint || [];
  return hint.length ? hint[hint.length - 1]! : '';
});

const lengthKm = computed(() => {
  const fromRank = rankHits.value.find((h) => h.item.lengthKm)?.item.lengthKm;
  return fromRank || detail.value?.lengthKm || 0;
});

const tagline = computed(
  () => rankHits.value[0]?.item.tagline || detail.value?.note || '沿线风景与轨道走向',
);

const corridorTitle = computed(() => detail.value?.name || corridorId.value || '线路');

/** 当前 OD 切片内的站名（与地图示意站一致） */
const displayStationNames = computed(() => {
  const hints = detail.value?.stationsHint || [];
  const from = displayFrom.value;
  const to = displayTo.value;
  if (from && to) {
    const iF = hints.indexOf(from);
    const iT = hints.indexOf(to);
    if (iF >= 0 && iT >= 0) {
      const a = Math.min(iF, iT);
      const b = Math.max(iF, iT);
      return hints.slice(a, b + 1);
    }
  }
  return hints;
});

function toggleSideList(mode: 'spots' | 'stations') {
  sideList.value = sideList.value === mode ? null : mode;
}

function closeSideList() {
  sideList.value = null;
}

function sliceRailway(
  railway: [number, number][],
  stationsHint: string[],
  from: string,
  to: string,
): [number, number][] {
  if (!from || !to || railway.length < 2 || stationsHint.length < 2) return railway;
  const iF = stationsHint.indexOf(from);
  const iT = stationsHint.indexOf(to);
  if (iF < 0 || iT < 0) return railway;
  const a = Math.min(iF, iT);
  const b = Math.max(iF, iT);
  const toIdx = (i: number) =>
    Math.min(railway.length - 1, Math.round((i / (stationsHint.length - 1)) * (railway.length - 1)));
  const s = toIdx(a);
  const e = toIdx(b);
  if (e - s < 2) return railway;
  return railway.slice(s, e + 1);
}

const displayPath = computed<[number, number][]>(() => {
  const d = detail.value;
  if (!d || !d.railway.length) return [];
  return sliceRailway(d.railway, d.stationsHint || [], displayFrom.value, displayTo.value);
});

function pointNearPath(lng: number, lat: number, path: [number, number][]): boolean {
  if (path.length < 2) return false;
  let minD = Number.POSITIVE_INFINITY;
  for (const [x, y] of path) {
    const dx = (lng - x) * 100;
    const dy = (lat - y) * 100;
    const d = dx * dx + dy * dy;
    if (d < minD) minD = d;
  }
  return minD <= 0.35 * 0.35 * 100 * 100;
}

const visibleSpots = computed(() => {
  const path = displayPath.value;
  const spots = detail.value?.spots || [];
  if (!path.length) return spots;
  return spots.filter((s) => pointNearPath(s.lng, s.lat, path));
});

const sortedSpots = computed(() =>
  [...visibleSpots.value].sort((a, b) => a.alongKm - b.alongKm),
);

/** 把 stationsHint 按进度投影到折线上（示意站位，非真站坐标） */
function projectedStations(
  path: [number, number][],
  hints: string[],
): Array<{ name: string; pos: [number, number] }> {
  if (path.length < 2 || !hints.length) return [];
  const from = displayFrom.value;
  const to = displayTo.value;
  let slice = hints;
  if (from && to) {
    const iF = hints.indexOf(from);
    const iT = hints.indexOf(to);
    if (iF >= 0 && iT >= 0) {
      const a = Math.min(iF, iT);
      const b = Math.max(iF, iT);
      slice = hints.slice(a, b + 1);
    }
  }
  const n = Math.max(slice.length - 1, 1);
  return slice.map((name, i) => {
    const idx = Math.min(path.length - 1, Math.round((i / n) * (path.length - 1)));
    return { name, pos: path[idx]! };
  });
}

function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function railStrokeOptions() {
  const rail = readToken('--rail', ATLAS_RAIL_STROKE);
  return satelliteOn.value
    ? { strokeColor: readToken('--accent-hover', ATLAS_RAIL_HOVER_STROKE), strokeOpacity: 0.95 }
    : { strokeColor: rail, strokeOpacity: 0.85 };
}

function clearOverlays() {
  try {
    openInfo?.close();
  } catch {
    /* ignore */
  }
  openInfo = null;
  map?.clearInfoWindow();
  for (const o of drawnOverlays) {
    try {
      o.remove();
    } catch {
      /* ignore */
    }
  }
  drawnOverlays = [];
  railLine = null;
}

function applySatelliteLayers() {
  if (!map) return;
  map.setBasemapMode(satelliteOn.value ? 'satellite' : 'standard');
  const stroke = railStrokeOptions();
  railLine?.setStyle({ color: stroke.strokeColor, opacity: stroke.strokeOpacity });
}

function toggleSatellite() {
  satelliteOn.value = !satelliteOn.value;
  try {
    localStorage.setItem(SATELLITE_PREF_KEY, satelliteOn.value ? '1' : '0');
  } catch {
    /* ignore */
  }
  applySatelliteLayers();
}

function toggleStatusCollapsed() {
  statusCollapsed.value = !statusCollapsed.value;
  try {
    localStorage.setItem(STATUS_COLLAPSE_KEY, statusCollapsed.value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** 无底栏：右侧图例/全览/卫星只需留安全区边距 */
function updateOverlayMetrics() {
  const h = 12;
  const root = pageEl.value || document.documentElement;
  root.style.setProperty('--bottom-overlay', `${h}px`);
  document.documentElement.style.setProperty('--bottom-overlay', `${h}px`);
}

function openSpotCard(spot: AtlasCorridorSpot) {
  selectedSpot.value = spot;
  if (!map) return;
  const dims = (spot.dimensions || [])
    .filter((d) => isKnownDimension(d))
    .map((d) => dimensionMeta(d).short);
  const dimHtml = (dims.length ? dims : [UNCLASSIFIED_DIMENSION.short])
    .map(
      (label) =>
        `<span class="map-info-card__badge map-info-card__badge--window">${escHtml(label)}</span>`,
    )
    .join('');
  const geo =
    spot.matchKind === 'geo'
      ? `<span class="map-info-card__badge map-info-card__badge--distant">距离推算</span>`
      : '';
  const html = `<div class="map-info-card">
      <button type="button" class="map-info-card__close" data-info-close aria-label="关闭">×</button>
      <div class="map-info-card__title">${escHtml(spot.name)}</div>
      <p class="map-info-card__schedule">沿线 ${spot.alongKm} km · 距线 ${spot.distKm} km</p>
      <div class="map-info-card__meta">${dimHtml}${geo}</div>
      ${spot.intro ? `<p class="map-info-card__intro">${escHtml(spot.intro)}</p>` : ''}
      <div class="map-info-card__arrow" aria-hidden="true"></div>
    </div>`;
  try {
    openInfo?.close();
  } catch {
    /* ignore */
  }
  openInfo = createInfoWindow({ offsetPx: [0, -22] });
  openInfo.setContent(html);
  openInfo.open(map, [spot.lng, spot.lat]);
}

function focusSpotFromList(spot: AtlasCorridorSpot) {
  openSpotCard(spot);
  if (!map) return;
  try {
    map.setZoomAndCenter(Math.max(map.getZoom() || 11, 12), [spot.lng, spot.lat]);
  } catch {
    map.setCenter([spot.lng, spot.lat]);
  }
}

function openStationCard(name: string, pos: [number, number]) {
  if (!map) return;
  const html = `<div class="map-info-card">
      <button type="button" class="map-info-card__close" data-info-close aria-label="关闭">×</button>
      <div class="map-info-card__title">${escHtml(name)}</div>
      <p class="map-info-card__meta">示意站位 · ${escHtml(corridorTitle.value)}</p>
      <div class="map-info-card__arrow" aria-hidden="true"></div>
    </div>`;
  try {
    openInfo?.close();
  } catch {
    /* ignore */
  }
  openInfo = createInfoWindow({ offsetPx: [0, -22] });
  openInfo.setContent(html);
  openInfo.open(map, pos);
}

function focusStationFromList(name: string) {
  const stations = projectedStations(displayPath.value, detail.value?.stationsHint || []);
  const hit = stations.find((s) => s.name === name);
  if (!hit) return;
  openStationCard(hit.name, hit.pos);
  if (!map) return;
  try {
    map.setZoomAndCenter(Math.max(map.getZoom() || 11, 12), hit.pos);
  } catch {
    map.setCenter(hit.pos);
  }
}

function fitRoute() {
  if (!map || !railLine) return;
  try {
    map.fitBounds(railLine.getBoundsCoords(), { top: 72, right: 48, bottom: 180, left: 48 }, false);
  } catch {
    /* ignore */
  }
}

async function drawMap() {
  if (!map) return;
  const path = displayPath.value;
  clearOverlays();
  selectedSpot.value = null;
  if (path.length < 2) return;

  const stroke = railStrokeOptions();
  const line = await addPolyline(map, {
    path,
    weight: compact.value ? 4 : 5,
    zIndex: 60,
    color: stroke.strokeColor,
    opacity: stroke.strokeOpacity,
  });
  drawnOverlays.push(line);
  railLine = line;

  const hints = detail.value?.stationsHint || [];
  const stations = projectedStations(path, hints);
  for (const s of stations) {
    const marker = addMarker(map, {
      position: s.pos,
      title: s.name,
      contentHtml: `<div class="station-marker${compact.value ? ' station-marker--compact' : ''}"><span class="station-dot"></span><span class="station-label">${escHtml(s.name)}</span></div>`,
      anchor: 'center',
      zIndex: 150,
    });
    marker.onClick(() => openStationCard(s.name, s.pos));
    drawnOverlays.push(marker);
  }

  visibleSpots.value.slice(0, 120).forEach((spot, idx) => {
    const marker = addMarker(map!, {
      position: [spot.lng, spot.lat],
      title: spot.name,
      anchor: 'bottom',
      zIndex: 160,
      contentHtml: `<div class="spot-marker${compact.value ? ' spot-marker--compact' : ''}">${idx + 1}</div>`,
    });
    marker.onClick(() => openSpotCard(spot));
    drawnOverlays.push(marker);
  });

  try {
    map.fitBounds(line.getBoundsCoords(), { top: 72, right: 48, bottom: 180, left: 48 }, false);
  } catch {
    map.setCenter(path[Math.floor(path.length / 2)]!);
  }
}

async function initMap() {
  if (!import.meta.env.VITE_TIANDITU_TK) {
    mapError.value = '请配置 VITE_TIANDITU_TK（apps/web/.env）';
    return;
  }
  try {
    await loadMapEngine();
  } catch {
    mapError.value = '地图引擎加载失败';
    return;
  }
  if (!mapEl.value) return;
  compact.value = window.matchMedia('(max-width: 640px)').matches;
  map = createMap(mapEl.value, {
    zoom: 5,
    center: displayPath.value[0] || [104, 35],
    basemap: satelliteOn.value ? 'satellite' : 'standard',
  });
  map.raw.getContainer().addEventListener('click', (event: MouseEvent) => {
    const t = event.target as HTMLElement;
    if (t.closest?.('[data-info-close]')) {
      map?.clearInfoWindow();
      openInfo = null;
    }
  });
  await new Promise<void>((resolve) => {
    if (map!.raw.isStyleLoaded()) resolve();
    else map!.raw.once('load', () => resolve());
  });
  await drawMap();
  updateOverlayMetrics();
}

async function load() {
  loading.value = true;
  notFound.value = false;
  loadError.value = '';
  detail.value = null;
  const id = corridorId.value;
  if (!id) {
    notFound.value = true;
    loading.value = false;
    return;
  }
  try {
    detail.value = await api.getAtlasCorridor(id);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'NOT_FOUND' || code === 'BAD_REQUEST') {
      notFound.value = true;
    } else {
      loadError.value = e instanceof Error ? e.message : '线路数据加载失败';
      mapError.value = loadError.value;
    }
  } finally {
    loading.value = false;
  }
}

function goBack() {
  const id = corridorId.value;
  if (id) {
    const q: Record<string, string> = {};
    if (displayFrom.value) q.from = displayFrom.value;
    if (displayTo.value) q.to = displayTo.value;
    void router.push({ path: `/route/${id}`, query: q });
    return;
  }
  if (window.history.length > 1) router.back();
  else void router.push('/');
}

function goSelectTrip() {
  const q: Record<string, string> = {};
  if (displayFrom.value) q.from = displayFrom.value;
  if (displayTo.value) q.to = displayTo.value;
  void router.push({ path: '/', query: q });
}

function onWindowResize() {
  compact.value = window.matchMedia('(max-width: 640px)').matches;
  updateOverlayMetrics();
}

onMounted(async () => {
  await load();
  if (!notFound.value) await initMap();
  window.addEventListener('resize', onWindowResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize);
  clearOverlays();
  try {
    map?.destroy?.();
  } catch {
    /* ignore */
  }
  map = null;
});

watch(corridorId, async () => {
  sideList.value = null;
  await load();
  if (map) await drawMap();
  else if (!notFound.value) await initMap();
  updateOverlayMetrics();
});

watch([displayFrom, displayTo], async () => {
  if (map && detail.value) await drawMap();
});
</script>

<template>
  <div ref="pageEl" class="trip-page corridor-map-page">
    <div ref="mapEl" id="map" class="map-root" />

    <div v-if="loading" class="error-overlay show">
      <div class="error-card">
        <p>正在加载线路地图…</p>
      </div>
    </div>

    <div v-else-if="notFound || mapError" class="error-overlay show">
      <div class="error-card">
        <p>{{ notFound ? '没有找到这条线路' : mapError }}</p>
        <button type="button" class="btn primary" @click="goBack">返回</button>
      </div>
    </div>

    <template v-else-if="detail">
      <header class="top-bar">
        <div class="map-nav-actions">
          <button type="button" class="map-back-btn" @click="goBack">
            <span class="map-back-btn__icon" aria-hidden="true">‹</span>
            线路详情
          </button>
          <button type="button" class="map-new-trip-btn" @click="goSelectTrip">选车次出行</button>
        </div>

        <div class="top-bar__cluster">
          <div class="status-card" :class="{ 'is-collapsed': statusCollapsed }">
            <div class="status-head">
              <div class="status-identity">
                <span class="train-badge">线路</span>
                <span class="route-text">{{ corridorTitle }}</span>
              </div>
              <button
                type="button"
                class="status-collapse-btn"
                :aria-expanded="!statusCollapsed"
                :aria-label="statusCollapsed ? '展开线路面板' : '收起线路面板'"
                @click="toggleStatusCollapsed"
              >
                {{ statusCollapsed ? '展开' : '收起' }}
              </button>
            </div>

            <Transition name="status-expand">
              <div v-if="!statusCollapsed" class="status-body">
                <p class="cormap-od-line">{{ displayFrom || '—' }} → {{ displayTo || '—' }}</p>
                <p class="cormap-tagline">{{ tagline }}</p>
                <div class="status-meta cormap-meta">
                  <div v-if="lengthKm" class="status-meta__item">
                    <span class="status-meta__k">里程</span>
                    <span class="status-meta__v">约 {{ lengthKm }} km</span>
                  </div>
                  <button
                    type="button"
                    class="status-meta__item status-meta__item--btn"
                    :class="{ 'is-active': sideList === 'spots' }"
                    :aria-pressed="sideList === 'spots'"
                    @click="toggleSideList('spots')"
                  >
                    <span class="status-meta__k">景点</span>
                    <span class="status-meta__v">{{ visibleSpots.length }} 处</span>
                  </button>
                  <button
                    v-if="detail.stationsHint?.length"
                    type="button"
                    class="status-meta__item status-meta__item--btn"
                    :class="{ 'is-active': sideList === 'stations' }"
                    :aria-pressed="sideList === 'stations'"
                    @click="toggleSideList('stations')"
                  >
                    <span class="status-meta__k">站序</span>
                    <span class="status-meta__v">{{ displayStationNames.length }} 站</span>
                  </button>
                </div>
              </div>
            </Transition>
          </div>

          <aside
            v-if="sideList"
            class="cormap-side"
            :aria-label="sideList === 'spots' ? '景点列表' : '站序列表'"
          >
            <header class="cormap-side__head">
              <h2 class="cormap-side__title">
                {{ sideList === 'spots' ? '沿线景点' : '站序' }}
                <span class="cormap-side__count">
                  {{ sideList === 'spots' ? sortedSpots.length : displayStationNames.length }}
                </span>
              </h2>
              <button
                type="button"
                class="cormap-side__close"
                aria-label="关闭列表"
                @click="closeSideList"
              >
                ×
              </button>
            </header>

            <ul v-if="sideList === 'spots'" class="cormap-side__list">
              <li v-for="(spot, i) in sortedSpots" :key="spot.id">
                <button
                  type="button"
                  class="cormap-side__row"
                  :class="{ 'is-active': selectedSpot?.id === spot.id }"
                  @click="focusSpotFromList(spot)"
                >
                  <span class="cormap-side__idx">{{ i + 1 }}</span>
                  <span class="cormap-side__main">
                    <span class="cormap-side__name">{{ spot.name }}</span>
                    <span class="cormap-side__meta">
                      沿线 {{ spot.alongKm }} km
                      <template v-if="spot.matchKind === 'geo'"> · 距离推算</template>
                    </span>
                  </span>
                </button>
              </li>
              <li v-if="!sortedSpots.length" class="cormap-side__empty">本段暂无景点</li>
            </ul>

            <ul v-else class="cormap-side__list">
              <li v-for="(name, i) in displayStationNames" :key="`${i}-${name}`">
                <button type="button" class="cormap-side__row" @click="focusStationFromList(name)">
                  <span class="cormap-side__idx">{{ i + 1 }}</span>
                  <span class="cormap-side__main">
                    <span class="cormap-side__name">{{ name }}</span>
                    <span
                      v-if="i === 0 || i === displayStationNames.length - 1"
                      class="cormap-side__meta"
                    >
                      {{ i === 0 ? '起点' : '终点' }}
                    </span>
                  </span>
                </button>
              </li>
              <li v-if="!displayStationNames.length" class="cormap-side__empty">暂无站序</li>
            </ul>
          </aside>
        </div>
      </header>

      <button type="button" class="locate-btn" @click="fitRoute">全览</button>
      <button
        type="button"
        class="satellite-btn"
        :class="{ 'is-active': satelliteOn }"
        :aria-pressed="satelliteOn"
        @click="toggleSatellite"
      >
        {{ satelliteOn ? '标准地图' : '卫星地图' }}
      </button>
      <button type="button" class="legend-toggle" @click="legendOpen = !legendOpen">图例</button>
      <div class="legend" :class="{ 'is-open': legendOpen }">
        <div class="legend-item--toggle" aria-pressed="true">
          <i class="rail" aria-hidden="true" />
          <span>示意铁路</span>
        </div>
        <div class="legend-item--toggle" aria-pressed="true">
          <i class="station" aria-hidden="true" />
          <span>经停站</span>
        </div>
        <div class="legend-item--toggle" aria-pressed="true">
          <i class="spot" aria-hidden="true" />
          <span>风景</span>
        </div>
        <div v-if="legendOpen" class="legend-side">
          <span class="legend-side__title">景点维度</span>
          <span
            v-for="d in [...SPOT_DIMENSIONS, UNCLASSIFIED_DIMENSION]"
            :key="d.key"
            class="cormap-legend-dim"
          >
            <span class="cormap-legend-dim__dot" :style="{ '--dot': d.color }"></span>
            {{ d.short }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cormap-od-line {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
  line-height: 1.3;
}

.cormap-tagline {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-2);
}

.cormap-meta {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.status-meta__item--btn.is-active {
  border-color: var(--accent-soft);
  background: var(--accent-soft);
}

.cormap-side {
  width: min(320px, 100%);
  max-height: min(52vh, calc(100vh - 160px));
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-default);
  background: color-mix(in srgb, var(--panel-bg, var(--surface-1)) 96%, transparent);
  backdrop-filter: blur(12px) saturate(1.2);
  -webkit-backdrop-filter: blur(12px) saturate(1.2);
  box-shadow: var(--elev-float-strong);
  overflow: hidden;
  pointer-events: auto;
}

.cormap-side__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 8px 12px;
  border-bottom: 1px solid var(--line-hairline);
}

.cormap-side__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-1);
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.cormap-side__count {
  font-size: 11px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

.cormap-side__close {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line-hairline);
  border-radius: 8px;
  background: var(--surface-sunken);
  color: var(--text-2);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.cormap-side__close:hover {
  border-color: var(--accent-soft);
  color: var(--text-1);
}

.cormap-side__list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.cormap-side__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  margin: 0 0 2px;
  padding: 8px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.cormap-side__row:hover {
  background: var(--surface-sunken);
  border-color: var(--line-hairline);
}

.cormap-side__row.is-active {
  background: var(--accent-soft);
  border-color: var(--accent-soft);
}

.cormap-side__idx {
  flex-shrink: 0;
  width: 1.6em;
  margin-top: 1px;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
  text-align: right;
}

.cormap-side__main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.cormap-side__name {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-1);
  line-height: 1.3;
}

.cormap-side__meta {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.35;
}

.cormap-side__empty {
  padding: 16px 10px;
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
}

.cormap-legend-dim {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-2);
}

.cormap-legend-dim__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dot, var(--spot));
}

/* 走廊图图例更矮：按钮紧贴图例上方，与图例右缘对齐成一列 */
@media (min-width: 641px) {
  .locate-btn {
    bottom: calc(var(--bottom-overlay) + 108px);
  }

  .satellite-btn {
    bottom: calc(var(--bottom-overlay) + 146px);
  }
}
</style>
