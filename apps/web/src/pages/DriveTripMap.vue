<script setup lang="ts">
/**
 * 万里路书 · 沿程全屏地图（/drive/trip/map）
 *
 * 布局对齐 TripMap / CorridorMap：高德底图 + 顶栏 + 底栏 + 右侧控件。
 * 标记与气泡使用公路专用样式（drive-map-*），与铁路 spot-marker 区分。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  buildChapterVisualScale,
  buildPath,
  kmToVisualPct,
  projectToRoute,
  simplifyDP,
  visualPctToKm,
  type AlongSpot,
  type RoadChapter,
  type RoadRoute,
} from '@railvista/shared';
import { api } from '../api/client';
import { useGeolocation } from '../composables/useGeolocation';
import { escHtml } from '../data/spotDimensions';
import { DRIVE_TIER_COLORS, ROAD_COLORS, driveTierColor } from '../data/roadColors';
import { AMAP_MAP_STYLE, loadAmap } from '../map/amap';

const route = useRoute();
const router = useRouter();

const OFF_ROUTE_MAX_M = 5000;
const UPCOMING_LOOKAHEAD_KM = 80;
const SATELLITE_PREF_KEY = 'railvista:map:satellite';
const STATUS_COLLAPSE_KEY = 'railvista:drivemap:statusCollapsed';
/** 每帧最多挂多少个景点 Marker，避免首屏主线程卡死 */
const MARKER_CHUNK = 28;

const loading = ref(true);
const loadError = ref('');
const mapError = ref('');
const roadRoute = ref<RoadRoute | null>(null);
const spots = ref<AlongSpot[]>([]);
/** 未贯通段景点：地图可打点，不参与章节/即将到达进度 */
const orphanSpots = ref<AlongSpot[]>([]);
const spotStats = ref<{ main: number; orphan: number } | null>(null);
const chapters = ref<RoadChapter[]>([]);
const progress = ref(0);
/** 用户开启实时跟随（点「定位」开启；拖进度条暂停） */
const liveTracking = ref(true);
/** 镜头是否跟随 GPS（点定位后开启，拖进度/全览关闭） */
const cameraFollow = ref(false);
/** 最近一次投影是否在路线缓冲内 */
const gpsOnRoute = ref(false);
const gpsOffRouteM = ref<number | null>(null);
const toast = ref('');
let toastTimer: number | undefined;
const compact = ref(false);
const legendOpen = ref(false);
const statusCollapsed = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(STATUS_COLLAPSE_KEY) === '1',
);
const satelliteOn = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SATELLITE_PREF_KEY) === '1',
);

const showTierA = ref(true);
const showTierB = ref(true);
const showTierC = ref(true);
const showRoute = ref(true);
const showVehicle = ref(true);
const showGps = ref(true);

const mapEl = ref<HTMLElement | null>(null);
const pageEl = ref<HTMLElement | null>(null);

let map: any = null;
let AMapRef: any = null;
let routeLine: any = null;
let routeShadow: any = null;
let vehicleMarker: any = null;
let gpsMarker: any = null;
/** 已挂载的景点 Marker（含 tier，图例开关只 show/hide，避免整层重建闪烁） */
let spotMarkers: { marker: any; tier: string }[] = [];
let satelliteLayer: any = null;
let roadNetLayer: any = null;
let openInfo: any = null;
let openSpot: AlongSpot | null = null;
/** 分批挂载景点 Marker 的 rAF / 超时句柄 */
let markerBatchRaf = 0;
let markerBatchTimer = 0;

const entryMode = computed<'od' | 'road' | 'route'>(() => {
  if (route.query.road) return 'road';
  if (route.query.route) return 'route';
  return 'od';
});

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
const spanKm = computed(() => {
  const span = Math.max(chapterSpanKm.value, chainKm.value);
  return span > 0 ? span : nominalKm.value;
});

const progressKm = computed(() => progress.value * spanKm.value);

const chapterVisualScale = computed(() =>
  buildChapterVisualScale(chapters.value, spanKm.value),
);

const progressPct = computed(() => kmToVisualPct(chapterVisualScale.value, progressKm.value));

const progressPartial = computed(
  () => nominalKm.value > 0 && spanKm.value > 0 && spanKm.value / nominalKm.value < 0.92,
);

const chaptersExpanded = ref(false);

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

const routeEndpoints = computed(() => {
  if (!chapters.value.length) return { start: '', end: '' };
  const split = (title: string) => {
    const parts = title.split(/\s*[—–-]\s*/);
    if (parts.length >= 2) return { from: parts[0]!.trim(), to: parts[parts.length - 1]!.trim() };
    return { from: title.trim(), to: '' };
  };
  const first = split(chapters.value[0]!.title);
  const last = split(chapters.value[chapters.value.length - 1]!.title);
  return { start: first.from, end: last.to || last.from };
});

/** 地图可打点景点（主链 + 未贯通段）；图例显隐不改这份列表，只 show/hide Marker */
const mapSpots = computed(() =>
  [...spots.value, ...orphanSpots.value].filter(
    (s) => Number.isFinite(s.lng) && Number.isFinite(s.lat),
  ),
);

function isTierVisible(tier: string): boolean {
  if (tier === 'A') return showTierA.value;
  if (tier === 'B') return showTierB.value;
  if (tier === 'C') return showTierC.value;
  return true;
}

const upcomingSpot = computed(() => {
  const km = progressKm.value;
  return (
    spots.value
      .filter((s) => s.progressKm > km - 0.2 && s.progressKm <= km + UPCOMING_LOOKAHEAD_KM)
      .sort((a, b) => a.progressKm - b.progressKm || b.score - a.score)[0] ?? null
  );
});

function chapterLeftPct(_ch: RoadChapter, index: number): number {
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

function syncProgressToMap() {
  updateVehicleMarker();
  if (!map || !showVehicle.value) return;
  const pos = vehiclePosition();
  try {
    map.panTo(pos);
  } catch {
    /* ignore */
  }
}

function jumpToProgress(event: MouseEvent) {
  const track = event.currentTarget as HTMLElement;
  const rect = track.getBoundingClientRect();
  const visualRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  liveTracking.value = false;
  cameraFollow.value = false;
  if (!spanKm.value) {
    progress.value = visualRatio;
  } else {
    const km = visualPctToKm(chapterVisualScale.value, visualRatio * 100);
    progress.value = Math.max(0, Math.min(1, km / spanKm.value));
  }
  syncProgressToMap();
}

function nudgeProgress(visualDelta: number) {
  liveTracking.value = false;
  cameraFollow.value = false;
  if (!spanKm.value) {
    progress.value = Math.max(0, Math.min(1, progress.value + visualDelta));
  } else {
    const nextPct = Math.max(0, Math.min(100, progressPct.value + visualDelta * 100));
    const km = visualPctToKm(chapterVisualScale.value, nextPct);
    progress.value = Math.max(0, Math.min(1, km / spanKm.value));
  }
  syncProgressToMap();
}

function jumpToChapter(index: number) {
  const ch = chapters.value[index];
  if (!ch || !spanKm.value) return;
  liveTracking.value = false;
  cameraFollow.value = false;
  progress.value = Math.min(1, Math.max(0, (ch.fromKm + 0.001) / spanKm.value));
  syncProgressToMap();
}

const { gps, available: gpsAvailable } = useGeolocation();

const gpsStatus = computed(() => {
  if (!gpsAvailable.value && !gps.value) return 'waiting' as const;
  if (!gps.value) return 'denied' as const;
  if (!liveTracking.value) return 'paused' as const;
  if (gpsOffRouteM.value != null && gpsOffRouteM.value > OFF_ROUTE_MAX_M) return 'offroute' as const;
  if (gpsOnRoute.value) return 'live' as const;
  return 'fixing' as const;
});

const gpsStatusText = computed(() => {
  switch (gpsStatus.value) {
    case 'live':
      return '实时定位';
    case 'fixing':
      return '定位中';
    case 'paused':
      return '进度预览';
    case 'offroute':
      return gpsOffRouteM.value != null
        ? `偏离约 ${gpsOffRouteM.value >= 1000 ? `${(gpsOffRouteM.value / 1000).toFixed(1)} km` : `${Math.round(gpsOffRouteM.value)} m`}`
        : '偏离路线';
    case 'denied':
      return '定位未授权';
    default:
      return '等待定位';
  }
});

/** 兼容模板里原先的 gpsFollowing 语义：实时且贴线 */
const gpsFollowing = computed(() => gpsStatus.value === 'live');

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = '';
  }, 2200);
}

const TIER_LABEL: Record<string, string> = { A: '讲解级', B: '沿途可看', C: '小确幸' };
const SIDE_LABEL: Record<string, string> = { left: '左侧', right: '右侧', unknown: '侧向待定' };
const VIS_LABEL: Record<string, string> = {
  roadside: '就在路边',
  detour5: '5 分钟能绕到',
  detour20: '20 分钟能绕到',
  distant: '远景可见',
};

function tierColor(tier: string): string {
  return driveTierColor(tier);
}

function kmText(km: number): string {
  return `K${Math.round(km)}`;
}

function categoryLabel(cat: string): string {
  const [dim, sub] = cat.split('.');
  const dimLabel: Record<string, string> = {
    nature: '自然',
    culture: '人文',
    engineering: '工程',
    viewpoint: '观景',
    experience: '体验',
    service: '服务',
  };
  return `${dimLabel[dim] ?? dim}${sub ? ' · ' + sub : ''}`;
}

function detourText(s: AlongSpot): string {
  if (s.visibility === 'distant') return '远景可见 · 不引导绕行';
  if (s.detourKm <= 0) return '就在路边，可停车即看';
  const min = Math.max(4, Math.round((s.detourKm / 30) * 60 / 4) * 4);
  return `绕行 ${s.detourKm} 公里 · 约 ${min} 分钟`;
}

function pointAtKm(coords: [number, number][], km: number): [number, number] {
  const { path, lengthKm } = buildPath(coords);
  if (!path.length) return [104, 35];
  const target = Math.max(0, Math.min(km, lengthKm));
  for (let i = 1; i < path.length; i += 1) {
    if (path[i].distFromStart >= target) {
      const prev = path[i - 1];
      const curr = path[i];
      const segLen = curr.distFromStart - prev.distFromStart || 1;
      const t = (target - prev.distFromStart) / segLen;
      return [prev.lng + (curr.lng - prev.lng) * t, prev.lat + (curr.lat - prev.lat) * t];
    }
  }
  const last = path[path.length - 1];
  return [last.lng, last.lat];
}

function routeCoords(): [number, number][] {
  const coords = roadRoute.value?.coords;
  if (!coords?.length) return [];
  return coords.map(([lng, lat]) => [lng, lat] as [number, number]);
}

function vehiclePosition(): [number, number] {
  const coords = routeCoords();
  if (coords.length < 2) return coords[0] ?? [104, 35];
  return pointAtKm(coords, progressKm.value);
}

async function load() {
  loadError.value = '';
  try {
    const params: Parameters<typeof api.getDriveAlong>[0] = {};
    if (entryMode.value === 'road') params.road = String(route.query.road);
    else if (entryMode.value === 'route') params.route = String(route.query.route);
    else {
      params.from = String(route.query.from ?? '');
      params.to = String(route.query.to ?? '');
      if (!params.from || !params.to) {
        loadError.value = '缺少起终点参数';
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
    const p = Number(route.query.progress);
    if (Number.isFinite(p)) progress.value = Math.max(0, Math.min(1, p));
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '加载失败';
  }
}

function toggleStatusCollapsed() {
  statusCollapsed.value = !statusCollapsed.value;
  try {
    localStorage.setItem(STATUS_COLLAPSE_KEY, statusCollapsed.value ? '1' : '0');
  } catch {
    /* ignore */
  }
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

function routeStrokeOptions() {
  const color = ROAD_COLORS.national;
  return satelliteOn.value
    ? { strokeColor: ROAD_COLORS.national, strokeOpacity: 0.95 }
    : { strokeColor: color, strokeOpacity: 0.88 };
}

function applySatelliteLayers() {
  if (!map || !AMapRef) return;
  if (satelliteOn.value) {
    if (!satelliteLayer) {
      satelliteLayer = new AMapRef.TileLayer.Satellite();
      roadNetLayer = new AMapRef.TileLayer.RoadNet();
    }
    map.add([satelliteLayer, roadNetLayer]);
  } else {
    if (satelliteLayer) map.remove(satelliteLayer);
    if (roadNetLayer) map.remove(roadNetLayer);
  }
  routeLine?.setOptions?.(routeStrokeOptions());
}

function updateOverlayMetrics() {
  const top = document.querySelector('.drive-map-page .top-bar')?.getBoundingClientRect().height || 72;
  const vh = window.innerHeight;
  const panel = document.querySelector('.drive-map-page .bottom-panel')?.getBoundingClientRect();
  const legend = document.querySelector('.drive-map-page .legend')?.getBoundingClientRect();

  // 底栏较高（里程 + 前方景点），给足下限，避免图例踩到「偏离约 / 预览」徽标
  let panelClearance = compact.value ? 190 : 210;
  if (panel && panel.height > 0) {
    panelClearance = Math.max(panelClearance, Math.ceil(vh - panel.top));
  }

  const legendH = legend && legend.height > 0 ? Math.ceil(legend.height) : 0;
  // 桌面常显图例：右侧按钮叠在图例顶边之上
  const controlsLift = legendH > 0 ? legendH + 16 : 210;

  const root = pageEl.value || document.documentElement;
  root.style.setProperty('--top-overlay', `${Math.ceil(top) + 16}px`);
  root.style.setProperty('--bottom-panel-clearance', `${panelClearance}px`);
  root.style.setProperty('--bottom-overlay', `${panelClearance + 16}px`);
  root.style.setProperty('--drive-map-controls-lift', `${controlsLift}px`);
  document.documentElement.style.setProperty('--bottom-overlay', `${panelClearance + 16}px`);
  document.documentElement.style.setProperty('--drive-map-controls-lift', `${controlsLift}px`);
  try {
    map?.resize?.();
  } catch {
    /* ignore */
  }
}

let bottomPanelObserver: ResizeObserver | null = null;

function bindOverlayObserver() {
  bottomPanelObserver?.disconnect();
  bottomPanelObserver = null;
  if (typeof ResizeObserver === 'undefined') return;
  const panel = document.querySelector('.drive-map-page .bottom-panel');
  const legend = document.querySelector('.drive-map-page .legend');
  if (!panel && !legend) return;
  bottomPanelObserver = new ResizeObserver(() => {
    updateOverlayMetrics();
  });
  if (panel) bottomPanelObserver.observe(panel);
  if (legend) bottomPanelObserver.observe(legend);
}

function buildSpotMarker(spot: AlongSpot) {
  const color = tierColor(spot.tier);
  // A 级保留里程徽标；B/C 用轻量圆点，减少首屏 DOM/布局成本
  const content =
    spot.tier === 'A'
      ? `<div class="drive-map-pin is-tier-a${compact.value ? ' is-compact' : ''}" style="--pin-color:${color}">
      <span class="drive-map-pin__head"><span class="drive-map-pin__km">${kmText(spot.progressKm)}</span></span>
      <span class="drive-map-pin__tail" aria-hidden="true"></span>
    </div>`
      : `<div class="drive-map-pin is-dot is-tier-${spot.tier.toLowerCase()}" style="--pin-color:${color}" title="${escHtml(spot.name)}"></div>`;
  const marker = new AMapRef.Marker({
    position: [spot.lng, spot.lat],
    title: spot.name,
    anchor: spot.tier === 'A' ? 'bottom-center' : 'center',
    zIndex: spot.tier === 'A' ? 170 : spot.tier === 'B' ? 165 : 160,
    content,
  });
  marker.on('click', () => openSpotCard(spot));
  return marker;
}

function closeOpenInfo() {
  try {
    openInfo?.close?.();
  } catch {
    /* ignore */
  }
  openInfo = null;
  openSpot = null;
  try {
    map?.clearInfoWindow?.();
  } catch {
    /* ignore */
  }
}

function openSpotCard(spot: AlongSpot) {
  if (!map || !AMapRef) return;
  if (!isTierVisible(spot.tier)) return;
  const color = tierColor(spot.tier);
  const badges = [
    `<span class="drive-map-card__badge is-tier-${spot.tier.toLowerCase()}">${TIER_LABEL[spot.tier] ?? spot.tier}</span>`,
    `<span class="drive-map-card__badge">${escHtml(categoryLabel(spot.category))}</span>`,
    `<span class="drive-map-card__badge">${SIDE_LABEL[spot.side] ?? spot.side}</span>`,
    spot.visibility
      ? `<span class="drive-map-card__badge is-vis">${VIS_LABEL[spot.visibility] ?? spot.visibility}</span>`
      : '',
  ]
    .filter(Boolean)
    .join('');
  const info = new AMapRef.InfoWindow({
    isCustom: true,
    autoMove: true,
    closeWhenClickMap: true,
    content: `<div class="drive-map-card" style="--card-accent:${color}">
      <button type="button" class="drive-map-card__close" data-info-close aria-label="关闭">×</button>
      <div class="drive-map-card__km">${kmText(spot.progressKm)}</div>
      <div class="drive-map-card__title">${escHtml(spot.name)}</div>
      <div class="drive-map-card__meta">${badges}</div>
      <p class="drive-map-card__detour">${escHtml(detourText(spot))} · 距路线 ${spot.distKm} km</p>
      ${spot.intro ? `<p class="drive-map-card__intro">${escHtml(spot.intro)}</p>` : ''}
      <div class="drive-map-card__arrow" aria-hidden="true"></div>
    </div>`,
    offset: new AMapRef.Pixel(0, -36),
  });
  closeOpenInfo();
  openInfo = info;
  openSpot = spot;
  info.open(map, [spot.lng, spot.lat]);
}

function cancelMarkerBatch() {
  if (markerBatchRaf) {
    cancelAnimationFrame(markerBatchRaf);
    markerBatchRaf = 0;
  }
  if (markerBatchTimer) {
    window.clearTimeout(markerBatchTimer);
    markerBatchTimer = 0;
  }
}

function clearSpotMarkers() {
  cancelMarkerBatch();
  closeOpenInfo();
  if (!map || !spotMarkers.length) {
    spotMarkers = [];
    return;
  }
  const markers = spotMarkers.map((e) => e.marker);
  try {
    map.remove(markers);
  } catch {
    for (const m of markers) {
      try {
        map.remove(m);
      } catch {
        /* ignore */
      }
    }
  }
  spotMarkers = [];
}

/** 图例开关：只显隐，不销毁重建（避免其它等级闪一下） */
function applySpotTierVisibility() {
  for (const { marker, tier } of spotMarkers) {
    try {
      if (isTierVisible(tier)) marker.show();
      else marker.hide();
    } catch {
      /* ignore */
    }
  }
  if (openSpot && !isTierVisible(openSpot.tier)) closeOpenInfo();
}

function rebuildSpotMarkers() {
  if (!map || !AMapRef) return;
  clearSpotMarkers();
  const list = mapSpots.value;
  if (!list.length) return;

  let i = 0;
  const step = () => {
    markerBatchRaf = 0;
    if (!map || !AMapRef) return;
    const batch: any[] = [];
    const end = Math.min(i + MARKER_CHUNK, list.length);
    for (; i < end; i += 1) {
      const spot = list[i]!;
      const marker = buildSpotMarker(spot);
      batch.push(marker);
      spotMarkers.push({ marker, tier: spot.tier });
    }
    if (batch.length) {
      try {
        map.add(batch);
      } catch {
        for (const m of batch) map.add(m);
      }
      // 先挂上地图再 hide，避免高德对未入图 Marker 的 hide 状态异常
      for (const { marker, tier } of spotMarkers.slice(spotMarkers.length - batch.length)) {
        if (!isTierVisible(tier)) {
          try {
            marker.hide();
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (i < list.length) {
      markerBatchRaf = requestAnimationFrame(step);
    }
  };
  // 先让路线 fitView / 瓦片绘制一帧，再开始挂 Marker
  markerBatchTimer = window.setTimeout(() => {
    markerBatchTimer = 0;
    markerBatchRaf = requestAnimationFrame(step);
  }, 0);
}

function updateVehicleMarker() {
  if (!vehicleMarker) return;
  const pos = vehiclePosition();
  vehicleMarker.setPosition(pos);
  if (showVehicle.value) vehicleMarker.show();
  else vehicleMarker.hide();
}

function updateGpsMarker() {
  if (!gpsMarker) return;
  const g = gps.value;
  const stale = !g || Date.now() - g.timestamp > 120_000;
  if (stale || !showGps.value) {
    gpsMarker.hide();
    return;
  }
  gpsMarker.setPosition([g.lng, g.lat]);
  gpsMarker.show();
}

function applyLayerVisibility() {
  if (routeLine) showRoute.value ? routeLine.show() : routeLine.hide();
  if (routeShadow) showRoute.value ? routeShadow.show() : routeShadow.hide();
  updateVehicleMarker();
  updateGpsMarker();
}

function fitRoute() {
  cameraFollow.value = false;
  if (!map) return;
  const overlays = [routeLine, routeShadow].filter(Boolean);
  if (!overlays.length) return;
  try {
    // immediately=true：跳过镜头动画，避免与大批量 Marker/瓦片抢主线程导致卡顿
    map.setFitView(overlays, true, [72, 48, 180, 48]);
  } catch {
    /* ignore */
  }
}

function locateLive() {
  liveTracking.value = true;
  cameraFollow.value = true;
  showGps.value = true;
  const g = gps.value;
  if (!g) {
    showToast(gpsAvailable.value ? '正在获取位置…' : '请允许浏览器定位权限');
    return;
  }
  if (!map) return;
  updateGpsMarker();
  map.panTo([g.lng, g.lat]);
  if ((map.getZoom?.() ?? 0) < 12) map.setZoom(14);
  if (gpsOnRoute.value) {
    showToast('已开启实时定位跟随');
  } else if (gpsOffRouteM.value != null && gpsOffRouteM.value > OFF_ROUTE_MAX_M) {
    showToast('已定位 · 当前偏离路线，进度暂不推进');
  } else {
    showToast('已定位到当前位置');
  }
}

/** 绘制用折线：过密时 DP 简化，进度投影仍用原 coords */
function displayPath(coords: [number, number][]): [number, number][] {
  if (coords.length <= 800) return coords;
  if (coords.length <= 2500) return simplifyDP(coords, 40);
  if (coords.length <= 8000) return simplifyDP(coords, 80);
  return simplifyDP(coords, 120);
}

function goBack() {
  void router.push({ path: '/drive/trip', query: { ...route.query, progress: String(progress.value) } });
}

async function drawMap() {
  if (!map || !AMapRef) return;
  const coords = routeCoords();
  if (coords.length < 2) {
    mapError.value = '路线坐标不足，无法绘制';
    return;
  }

  if (routeShadow) {
    try {
      map.remove(routeShadow);
    } catch {
      /* ignore */
    }
  }
  if (routeLine) {
    try {
      map.remove(routeLine);
    } catch {
      /* ignore */
    }
  }

  const path = displayPath(coords);
  routeShadow = new AMapRef.Polyline({
    path,
    strokeColor: '#0a1628',
    strokeOpacity: satelliteOn.value ? 0.55 : 0.35,
    strokeWeight: compact.value ? 9 : 11,
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: 50,
    bubble: true,
  });
  routeLine = new AMapRef.Polyline({
    path,
    strokeWeight: compact.value ? 5 : 6,
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: 60,
    bubble: true,
    ...routeStrokeOptions(),
  });
  map.add([routeShadow, routeLine]);

  if (!vehicleMarker) {
    vehicleMarker = new AMapRef.Marker({
      position: vehiclePosition(),
      anchor: 'center',
      zIndex: 200,
      content: `<div class="drive-map-vehicle${compact.value ? ' is-compact' : ''}"><span class="drive-map-vehicle__core"></span><span class="drive-map-vehicle__ring"></span></div>`,
    });
    map.add(vehicleMarker);
  } else {
    updateVehicleMarker();
  }

  if (!gpsMarker) {
    gpsMarker = new AMapRef.Marker({
      position: gps.value ? [gps.value.lng, gps.value.lat] : vehiclePosition(),
      anchor: 'center',
      zIndex: 195,
      content: '<div class="drive-map-gps"><span class="drive-map-gps__pulse"></span></div>',
    });
    map.add(gpsMarker);
  }
  updateGpsMarker();

  applyLayerVisibility();
  fitRoute();
  // 景点 Marker 延后分批挂载，避免挡住首屏路线显示
  rebuildSpotMarkers();
}

async function initMap() {
  const key = import.meta.env.VITE_AMAP_KEY;
  if (!key) {
    mapError.value = '请配置 VITE_AMAP_KEY（apps/web/.env）';
    return;
  }
  if (!AMapRef) {
    try {
      AMapRef = await loadAmap(key, import.meta.env.VITE_AMAP_SECURITY);
    } catch (e) {
      mapError.value = e instanceof Error ? e.message : '地图脚本加载失败';
      return;
    }
  }
  if (!mapEl.value) return;
  compact.value = window.matchMedia('(max-width: 640px)').matches;
  const coords = routeCoords();
  map = new AMapRef.Map(mapEl.value, {
    zoom: 5,
    center: coords[0] || [104, 35],
    viewMode: '2D',
    mapStyle: AMAP_MAP_STYLE,
    // 关掉默认动画，进入页时不跟镜头缓动抢帧
    animateEnable: false,
    jogEnable: false,
  });
  // 首屏路线画完后再开交互动画（拖拽惯性等）
  map.getContainer().addEventListener('click', (event: MouseEvent) => {
    const t = event.target as HTMLElement;
    if (t.closest?.('[data-info-close]')) {
      map?.clearInfoWindow?.();
      openInfo = null;
    }
  });
  applySatelliteLayers();
  await drawMap();
  try {
    map.setStatus?.({ animateEnable: true, jogEnable: true });
  } catch {
    /* ignore */
  }
  updateOverlayMetrics();
}

/** 数据与高德脚本并行拉取，再初始化地图——缩短「进入地图 → 看见路线」空窗 */
async function boot() {
  loading.value = true;
  mapError.value = '';
  const key = import.meta.env.VITE_AMAP_KEY as string | undefined;
  const security = import.meta.env.VITE_AMAP_SECURITY as string | undefined;
  try {
    await Promise.all([
      load(),
      key
        ? loadAmap(key, security)
            .then((AMap) => {
              AMapRef = AMap;
            })
            .catch((e) => {
              mapError.value = e instanceof Error ? e.message : '地图脚本加载失败';
            })
        : Promise.resolve(),
    ]);
    if (loadError.value) return;
    if (!key) {
      mapError.value = '请配置 VITE_AMAP_KEY（apps/web/.env）';
      return;
    }
    if (mapError.value && !AMapRef) return;
    await initMap();
  } finally {
    loading.value = false;
  }
}

function onWindowResize() {
  compact.value = window.matchMedia('(max-width: 640px)').matches;
  updateOverlayMetrics();
}

watch(gps, (sample) => {
  if (!sample) {
    updateGpsMarker();
    return;
  }
  updateGpsMarker();

  const coords = roadRoute.value?.coords;
  if (!coords || coords.length < 2 || !spanKm.value) return;

  const proj = projectToRoute(coords, sample.lng, sample.lat);
  gpsOffRouteM.value = proj.offRouteM;
  gpsOnRoute.value = proj.offRouteM <= OFF_ROUTE_MAX_M;

  if (liveTracking.value && gpsOnRoute.value) {
    progress.value = Math.max(0, Math.min(1, proj.alongKm / spanKm.value));
    updateVehicleMarker();
  }

  if (cameraFollow.value && map && showGps.value) {
    try {
      map.panTo([sample.lng, sample.lat]);
    } catch {
      /* ignore */
    }
  }
});

watch(progress, () => {
  updateVehicleMarker();
});

watch(
  () => [showTierA.value, showTierB.value, showTierC.value],
  () => {
    applySpotTierVisibility();
  },
);

watch([showRoute, showVehicle, showGps], applyLayerVisibility);

watch(gpsStatusText, async () => {
  await nextTick();
  updateOverlayMetrics();
});

watch(
  () => route.fullPath,
  async () => {
    loading.value = true;
    try {
      await load();
      if (loadError.value) return;
      if (map) await drawMap();
      else if (!mapError.value) await initMap();
    } finally {
      loading.value = false;
    }
    await nextTick();
    updateOverlayMetrics();
    bindOverlayObserver();
  },
);

onMounted(async () => {
  await boot();
  await nextTick();
  updateOverlayMetrics();
  bindOverlayObserver();
  window.addEventListener('resize', onWindowResize, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize);
  bottomPanelObserver?.disconnect();
  bottomPanelObserver = null;
  cancelMarkerBatch();
  if (toastTimer) window.clearTimeout(toastTimer);
  try {
    openInfo?.close?.();
  } catch {
    /* ignore */
  }
  clearSpotMarkers();
  try {
    map?.destroy?.();
  } catch {
    /* ignore */
  }
  map = null;
});
</script>

<template>
  <div ref="pageEl" class="trip-page drive-map-page">
    <div ref="mapEl" id="map" class="map-root" />

    <div v-if="loading" class="error-overlay show">
      <div class="error-card">
        <p>正在加载沿程地图…</p>
      </div>
    </div>

    <div v-else-if="loadError || mapError" class="error-overlay show">
      <div class="error-card">
        <p>{{ loadError || mapError }}</p>
        <button type="button" class="btn primary" @click="goBack">返回沿程页</button>
      </div>
    </div>

    <template v-else-if="roadRoute">
      <header class="top-bar">
        <div class="map-nav-actions">
          <button type="button" class="map-back-btn" @click="goBack">
            <span class="map-back-btn__icon" aria-hidden="true">‹</span>
            返回沿程
          </button>
        </div>

        <div class="top-bar__cluster">
          <div class="status-card drive-map-status" :class="{ 'is-collapsed': statusCollapsed }">
            <div class="status-head">
              <div class="status-identity">
                <span class="train-badge drive-map-status__badge">公路</span>
                <span class="route-text">{{ roadRoute.name }}</span>
              </div>
              <button
                type="button"
                class="status-collapse-btn"
                :aria-expanded="!statusCollapsed"
                :aria-label="statusCollapsed ? '展开路线面板' : '收起路线面板'"
                @click="toggleStatusCollapsed"
              >
                {{ statusCollapsed ? '展开' : '收起' }}
              </button>
            </div>

            <Transition name="status-expand">
              <div v-if="!statusCollapsed" class="status-body">
                <div class="status-meta">
                  <div class="status-meta__item">
                    <span class="status-meta__k">全程</span>
                    <span class="status-meta__v">{{ roadRoute.lengthKm }} km</span>
                  </div>
                  <div class="status-meta__item">
                    <span class="status-meta__k">景点</span>
                    <span class="status-meta__v">
                      {{ spotStats?.main ?? spots.length }} 处
                      <template v-if="(spotStats?.orphan ?? orphanSpots.length) > 0">
                        ·未贯通{{ spotStats?.orphan ?? orphanSpots.length }}
                      </template>
                    </span>
                  </div>
                  <div class="status-meta__item">
                    <span class="status-meta__k">定位</span>
                    <span class="status-meta__v">{{ gpsStatusText }}</span>
                  </div>
                </div>
              </div>
            </Transition>
          </div>

          <section
            v-if="chapters.length && !statusCollapsed"
            class="drive-chprog drive-map-chprog"
            data-spotlight
          >
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
                章节覆盖已贯通主链 {{ Math.round(spanKm) }} km · 全线名义 {{ Math.round(nominalKm) }} km
              </p>

              <div v-if="!chaptersExpanded && activeChapter" class="drive-chprog__now">
                <span class="drive-chprog__now-badge">第 {{ activeChapterIndex + 1 }}/{{ chapters.length }} 段</span>
                <span class="drive-chprog__now-title">{{ activeChapter.title }}</span>
                <span class="drive-chprog__hint">
                  <template v-if="gpsFollowing">实时定位中 · </template>
                  <template v-else-if="gpsStatus === 'offroute'">已偏离路线 · </template>
                  点击标题展开全部章节 · 点进度条可预览
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
        </div>
      </header>

      <button
        type="button"
        class="locate-btn"
        :class="{ 'is-live': liveTracking && !!gps }"
        @click="locateLive"
      >
        {{ liveTracking && gps ? '实时中' : '定位' }}
      </button>
      <button type="button" class="satellite-btn" :class="{ 'is-active': satelliteOn }" @click="toggleSatellite">
        {{ satelliteOn ? '标准地图' : '卫星地图' }}
      </button>
      <button type="button" class="drive-map-fit-btn" @click="fitRoute">全览</button>
      <button type="button" class="legend-toggle" @click="legendOpen = !legendOpen">图例</button>

      <div class="legend drive-map-legend" :class="{ 'is-open': legendOpen }">
        <button
          type="button"
          class="legend-item legend-item--toggle"
          :aria-pressed="showRoute"
          @click="showRoute = !showRoute"
        >
          <i class="rail" aria-hidden="true" />
          路线走向
        </button>
        <button
          type="button"
          class="legend-item legend-item--toggle"
          :aria-pressed="showVehicle"
          @click="showVehicle = !showVehicle"
        >
          <i class="train" aria-hidden="true" />
          路线进度
        </button>
        <button
          type="button"
          class="legend-item legend-item--toggle"
          :aria-pressed="showGps"
          @click="showGps = !showGps"
        >
          <i class="gps" aria-hidden="true" />
          实时定位
        </button>
        <button
          type="button"
          class="legend-item legend-item--toggle"
          :aria-pressed="showTierA"
          @click="showTierA = !showTierA"
        >
          <i class="spot spot-tier-a" :style="{ background: DRIVE_TIER_COLORS.A }" aria-hidden="true" />
          讲解级 (A)
        </button>
        <button
          type="button"
          class="legend-item legend-item--toggle"
          :aria-pressed="showTierB"
          @click="showTierB = !showTierB"
        >
          <i class="spot spot-tier-b" :style="{ background: DRIVE_TIER_COLORS.B }" aria-hidden="true" />
          沿途可看 (B)
        </button>
        <button
          type="button"
          class="legend-item legend-item--toggle"
          :aria-pressed="showTierC"
          @click="showTierC = !showTierC"
        >
          <i class="spot spot-tier-c" :style="{ background: DRIVE_TIER_COLORS.C }" aria-hidden="true" />
          小确幸 (C)
        </button>
      </div>

      <footer class="bottom-panel drive-map-bottom">
        <section class="location-card">
          <div class="location-card__head">
            <h2>当前里程</h2>
            <span
              class="location-mode"
              :class="{
                'is-live': gpsStatus === 'live',
                'is-schedule': gpsStatus === 'paused' || gpsStatus === 'waiting',
                'is-off': gpsStatus === 'offroute' || gpsStatus === 'denied',
              }"
            >{{ gpsStatusText }}</span>
          </div>
          <div class="location-segment">{{ Math.round(progressKm) }} / {{ Math.round(spanKm) }} km</div>
          <div class="location-meta">
            沿程进度 {{ progressPct }}%
            <template v-if="gps && gps.accuracy"> · 精度 ±{{ Math.round(gps.accuracy) }} m</template>
          </div>
        </section>
        <div class="panel-divider" />
        <section class="upcoming-card">
          <div class="bottom-panel__head">
            <h2>前方景点</h2>
          </div>
          <div class="next-name">{{ upcomingSpot?.name || '—' }}</div>
          <div v-if="upcomingSpot" class="next-meta">
            {{ kmText(upcomingSpot.progressKm) }} · {{ categoryLabel(upcomingSpot.category) }}
          </div>
          <div class="progress-track" role="progressbar" :aria-valuenow="progressPct" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar drive-map-progress" :style="{ transform: `scaleX(${progress})` }" />
          </div>
          <div class="progress-foot">
            <span>全程进度</span>
            <span class="progress-foot__pct">{{ progressPct }}%</span>
          </div>
        </section>
      </footer>

      <div v-if="toast" class="toast">{{ toast }}</div>
    </template>
  </div>
</template>
