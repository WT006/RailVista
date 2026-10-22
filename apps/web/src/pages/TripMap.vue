<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  buildRailwayMetrics,
  buildMileageAxis,
  buildScheduleCurve,
  computeCalibrationOffset,
  estimateSpotEtas,
  formatDepartBadge,
  formatOffsetLabel,
  formatSpotTimeLabel,
  formatStationSchedule,
  formatTime,
  geoSigmaFor,
  getCalibratableStations,
  getStationAnchorTime,
  getUpcoming,
  highlightEpisodes,
  isNearScheduledArrival,
  isNightAt,
  pointAtProgress,
  profileForTrain,
  resolveProgress,
  resolveSchedule,
  shiftDate,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
  approachWindow,
  honorLabels,
  withinApproach,
  TRAVEL_SHAPE_LABEL,
  spotWeatherParts,
  type CalibrationRecord,
  type ScenicSpot,
  type SpotEta,
  type SpotSide,
  type SpotWeather,
  type SkyMapResult,
  type SpotWeatherParts,
  type Stop,
  type TravelRouteSummary,
} from '@railvista/shared';
import { api } from '../api/client';
import { hydrateFromSnapshot, persistActiveTrip } from '../lib/persistTrip';
import { ticketConfigFromRailSegment } from '../lib/ticketFromTrip';
import { upsertTicketTrace } from '../lib/ticketTrace';
import {
  clearAutoResume,
  getAutoResumeTripKey,
  getSnapshot,
  markStayOnSelect,
  tripCacheKey,
} from '../lib/tripCache';
import { AMAP_MAP_STYLE, loadAmap } from '../map/amap';
import {
  ATLAS_RAIL_HOVER_STROKE,
  ATLAS_RAIL_STROKE,
  TRIP_GLOW_STROKE,
  TRIP_HIGHLIGHT_STROKE,
  TRIP_SKY_BLUE_STROKE,
  TRIP_SKY_GOLDEN_STROKE,
  TRIP_SKY_SUN_STROKE,
} from '../data/atlasColors';
import { readSimulatedProgress, useGeolocation, useNow } from '../composables/useGeolocation';
import DarkDateTimeField from '../components/DarkDateTimeField.vue';
import PreciseRoutePanel from '../components/PreciseRoutePanel.vue';
import SideBadge from '../components/SideBadge.vue';
import SkyJourneyPanel, { type SkyFocusPayload } from '../components/SkyJourneyPanel.vue';
import SpotApproachCard from '../components/SpotApproachCard.vue';
import StationFoodCard from '../components/StationFoodCard.vue';
import TicketFinishCard from '../components/TicketFinishCard.vue';
import { stationFood, stationFoodTop } from '../data/stationFoods';
import { placeOfStation } from '../lib/placeGuides';
import { usePlaceGuide } from '../composables/usePlaceGuide';
import { stationFoodCardHtml } from '../lib/stationFoodHtml';
import { usePrefsStore } from '../stores/prefsStore';
import { useTripStore } from '../stores/tripStore';
import { useTripFinishTicket } from '../composables/useTripFinishTicket';
import { useSmoothMarker } from '../composables/useSmoothMarker';

const route = useRoute();
const router = useRouter();
const trip = useTripStore();
const prefs = usePrefsStore();
const { gps, available: gpsAvailable } = useGeolocation();
const now = useNow();

const mapEl = ref<HTMLElement | null>(null);
const pageEl = ref<HTMLElement | null>(null);
const error = ref('');
const compact = ref(false);
const progress = ref(0);
const mode = ref('时刻表估算');
const stationKmRef = ref<number[]>([]);
const etasRef = ref<SpotEta[]>([]);
/** 景点 ETA 天气（按 spotId）；批量拉取，点击卡片直接读缓存 */
const weatherBySpotId = ref<Record<string, SpotWeather>>({});
let weatherFetchTimer: number | undefined;
let weatherFetchSeq = 0;
const legendOpen = ref(false);
const calibrateOpen = ref(false);
/** 天象模式：地图彩色路段/标注常驻；与面板展开无关 */
const skyMode = ref(false);
/** 时间轴列表抽屉（点天象直接展开；× 收起后可用「时间轴」按钮重开） */
const skyPanelOpen = ref(false);
/** 当前选中的时间轴片段（地图加粗高亮） */
const skyFocus = ref<SkyFocusPayload | null>(null);
/** 最近一次天象计算结果（迷你条摘要用） */
const skyMapPayload = ref<SkyMapResult | null>(null);
const STATUS_COLLAPSE_KEY = 'railvista:map:statusCollapsed';
const statusCollapsed = ref((() => {
  if (typeof localStorage === 'undefined') return false;
  const saved = localStorage.getItem(STATUS_COLLAPSE_KEY);
  if (saved !== null) return saved === '1';
  /** 无历史偏好时：手机竖屏默认收起状态卡，首屏优先呈现地图与时间轴 */
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 839px)').matches;
})());

function toggleStatusCollapsed() {
  statusCollapsed.value = !statusCollapsed.value;
  try {
    localStorage.setItem(STATUS_COLLAPSE_KEY, statusCollapsed.value ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (statusCollapsed.value) calibrateOpen.value = false;
}
const departOpen = ref(false);
const departInput = ref('');
const confirmOpen = ref(false);
const confirmText = ref('');
const confirmMode = ref<'calibrate' | 'newTrip'>('calibrate');
const pendingStation = ref<Stop | null>(null);
const toast = ref('');
let toastTimer: number | undefined;

const SATELLITE_PREF_KEY = 'railvista:map:satellite';
const satelliteOn = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SATELLITE_PREF_KEY) === '1',
);

let map: any;
let AMapRef: any;
let satelliteLayer: any;
let roadNetLayer: any;
let railLine: any;
let trainMarker: any;
let gpsMarker: any;
const trainTarget = ref<[number, number] | null>(null);
const gpsTarget = ref<[number, number] | null>(null);
let spotMarkers: any[] = [];
let stationMarkers: any[] = [];
/** P0-4：无坐标经停的灰色空心占位标记（位置为前后站间近似插值） */
let unresolvedMarkers: any[] = [];
let pathMetrics = { path: [] as ReturnType<typeof buildRailwayMetrics>['path'], lengthKm: 0 };
/** pathMetrics 不是响应式对象，单独用 ref 暴露里程给精度面板 */
const railLengthKm = ref(0);

const segment = computed(() => trip.segment);
const resumeKeyNow = ref<string | null>(getAutoResumeTripKey());
const isPinnedCurrent = computed(() => {
  const seg = segment.value;
  if (!seg || trip.isDemo) return false;
  return resumeKeyNow.value === tripCacheKey(seg);
});
const schedule = computed(() => {
  const seg = segment.value;
  if (!seg) return null;
  return resolveSchedule(seg.baseDepartureIso, seg.baseArrivalIso, prefs.departureIso);
});

/**
 * 列车当前里程（沿本次行程折线），用于临近景点与过站美食判定。
 * 读 railLengthKm 而非 pathMetrics.lengthKm：后者是普通变量，进度被固定在某一格
 * （模拟进度 / 停车等待）时 computed 不会重算，会拿到画线之前的 0。
 */
const currentKm = computed(() => progress.value * railLengthKm.value);

/**
 * 当前处于「临近窗口」内的景点：进入点前 5km 起提示，过境 2km 后淡出（§4.3）。
 * 多个同时命中时取最先到达的那个。
 * 尚未发车（progress≤0）不弹——起点附近景点会落在 5km 窗口内，否则一进地图就误报。
 */
const approachingSpot = computed<ScenicSpot | null>(() => {
  if (!prefs.layers.spot) return null;
  if (progress.value <= 0) return null;
  const list = trip.scenicSpots;
  if (!list?.length) return null;
  const km = currentKm.value;
  for (const s of list) {
    const enterKm = s.progressKm ?? 0;
    if (withinApproach(approachWindow({ alongKm: enterKm }), km)) return s;
  }
  return null;
});

const approachingWeather = computed(() => {
  const s = approachingSpot.value;
  if (!s) return null;
  const w = weatherBySpotId.value[String(s.id)];
  return w?.queried ? w : null;
});

const approachingWeatherParts = computed(() =>
  spotWeatherParts(approachingWeather.value, approachingSpot.value?.visibility),
);

/**
 * 过站美食窗口：比景点窗口略宽（站少、且要留出「快到城里了」的预告感）。
 */
const STATION_FOOD_LEAD_KM = 12;
const STATION_FOOD_TRAIL_KM = 5;

/** 当前落在过站窗口内的车站（取窗口内最后一个，优先表达「正在经过」） */
const approachingStation = computed(() => {
  if (!prefs.layers.station) return null;
  const stops = segment.value?.stops;
  const kms = stationKmRef.value;
  if (!stops?.length || !kms.length || kms.length !== stops.length) return null;
  const km = currentKm.value;
  let hit = -1;
  for (let i = 0; i < stops.length; i++) {
    // stationKm 轴是「米」（buildMileageAxis 内 L = lengthKm * 1000），currentKm 是公里，须先换算
    const atKm = kms[i] / 1000;
    if (!Number.isFinite(atKm)) continue;
    if (withinApproach(approachWindow({ alongKm: atKm }, STATION_FOOD_LEAD_KM, STATION_FOOD_TRAIL_KM), km)) hit = i;
  }
  if (hit < 0) return null;
  return {
    stop: stops[hit],
    seq: hit + 1,
    total: stops.length,
    isFirst: hit === 0,
    isLast: hit === stops.length - 1,
    passed: km >= kms[hit] / 1000,
  };
});

const approachingStationFood = computed(() => {
  const a = approachingStation.value;
  if (!a) return null;
  const food = stationFood(a.stop.name, { lng: a.stop.lng, lat: a.stop.lat });
  if (!food) return null;
  const kicker = a.isFirst ? '始发站' : a.isLast ? '已到达' : a.passed ? '正在经过' : '即将到达';
  return { station: a.stop.name, food, kicker, seq: a.seq, total: a.total };
});

/** 景点通告是否真的在屏上（它约 10s 自动收起，但临近窗口还在）：收起后过站美食卡应能补位 */
const spotCardRef = ref<InstanceType<typeof SpotApproachCard> | null>(null);
const spotToastVisible = computed(() => Boolean(spotCardRef.value?.visible));
const foodCardRef = ref<InstanceType<typeof StationFoodCard> | null>(null);
const foodToastVisible = computed(() => Boolean(foodCardRef.value?.visible));

/**
 * 下车站玩法推荐：本趟快到终点/已到达时，把这一所在地的路书库攻略常驻在底栏。
 * 放底栏而不是顶部浮层——面板高度是实测的（updateOverlayMetrics 会据此带动其它浮层），
 * 而顶部通告位在任何屏高上都要和景点卡、美食卡、完成引导条抢位置，短屏必然叠字。
 */
const destPlace = computed(() => {
  const seg = segment.value;
  if (!seg || progress.value < 0.97) return null;
  const last = seg.stops[seg.stops.length - 1];
  if (!last) return null;
  return placeOfStation({ name: last.name, lng: last.lng, lat: last.lat });
});
const { guide: destGuides } = usePlaceGuide(() => destPlace.value);

/** 底栏只列 2 条，其余交给「查看全部」；命中口径要写在标签上，同省兜底不能冒充当地攻略 */
const destGuideList = computed(() => destGuides.value?.routes.slice(0, 2) ?? []);
const destGuideScope = computed(() => {
  const g = destGuides.value;
  if (!g) return '';
  if (g.level === 'province') return `${g.place.province} · 精选`;
  if (g.level === 'keyword') return `涉及${g.place.city}`;
  return `${g.place.city} · 路书库`;
});

function destGuideMeta(r: TravelRouteSummary): string {
  return [
    TRAVEL_SHAPE_LABEL[r.shape] ?? '',
    r.totalKm ? `${Math.round(r.totalKm)} km` : '',
    r.days ? `${r.days} 天` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 图例用：左右侧含义说明 */
const SIDE_LEGEND: Array<{ side: SpotSide; text: string }> = [
  { side: 'left', text: '列车左侧' },
  { side: 'right', text: '列车右侧' },
  { side: 'both', text: '两侧均可' },
];

/**
 * 地图标记**不按左右分色**（颜色统一），左右侧只在点开详情后展示，
 * 避免在地图上铺开一片难辨含义的多色点阵。
 * 唯一例外：`unknown` 用虚线空心 —— 那表示「方位待人工复核」的数据问题，
 * 语义上属于数据质量提示，不是方位表达。
 */
function spotSideKey(spot: ScenicSpot): SpotSide {
  if (spot.sideNeedsReview) return 'unknown';
  const s = spot.sideRuntime ?? spot.side;
  return s && s !== 'unknown' ? s : 'unknown';
}

/** 定位文案拆成主状态 + 括号备注，避免挤在一行难读 */
const modeParts = computed(() => {
  const m = mode.value.trim();
  const hit = m.match(/^(.*?)[（(](.+?)[）)]\s*$/);
  if (hit) return { main: hit[1]!.trim(), note: hit[2]!.trim() };
  return { main: m, note: '' };
});

/** 窄屏仍占原位：把主状态+备注收成短标签，完整文案放 title */
const modeCompactLine = computed(() => {
  const { main, note } = modeParts.value;
  // 时刻表估算 → 时刻；GPS 实时 → GPS；已校准 → 校准
  let short = main
    .replace(/^时刻表估算$/, '时刻')
    .replace(/^时刻表$/, '时刻')
    .replace(/^GPS\s*实时.*$/, 'GPS')
    .replace(/^已校准.*$/, '校准');
  if (short === main && main.length > 4) short = main.slice(0, 2);
  if (!note) return short;
  const shortNote = note
    .replace(/^偏离铁路较远$/, '偏轨')
    .replace(/^偏离铁路$/, '偏轨')
    .replace(/^信号弱$/, '弱信号');
  return `${short}·${shortNote}`;
});

const progressPct = computed(() => Math.round(progress.value * 100));

const shifted = (iso: string) => shiftDate(iso, schedule.value?.offsetMs || 0);

function showToast(msg: string) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = '';
  }, 2800);
}

function escHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function ensureTripLoaded() {
  if (trip.segment) {
    if (!trip.isDemo) prefs.loadForCurrentTrip();
    return;
  }
  const trainCode = String(route.query.trainCode || '');
  const date = String(route.query.date || '');
  const from = String(route.query.from || '');
  const to = String(route.query.to || '');

  if (route.query.demo === '1') {
    const preset = await api.getPreset('z8991');
    const demoStops: Stop[] = preset.stations.map((s, i) => ({
      seq: i + 1,
      name: s.name,
      type: s.type,
      at: s.at,
      arrive: s.arrive,
      depart: s.depart,
      arriveTime: s.arrive || (s.type === 'arrive' ? s.at : null) || null,
      departTime: s.depart || (s.type === 'depart' ? s.at : null) || null,
      lng: s.lng,
      lat: s.lat,
      intro: s.intro,
    }));
    let spots: import('@railvista/shared').ScenicSpot[] = [];
    let preciseRailway = (preset.railway as [number, number][] | undefined) || null;
    try {
      const geo = await api.getRailGeometry({
        trainCode: preset.meta.train,
        mode: 'preset',
        stops: demoStops.map((s) => ({ name: s.name, lng: s.lng, lat: s.lat })),
      });
      if (geo.coords?.length >= 2) preciseRailway = geo.coords;
      if (geo.scenicSpots?.length) spots = geo.scenicSpots;
    } catch {
      /* ignore */
    }
    if (!spots.length && preset.scenicSpots?.length) {
      spots = preset.scenicSpots.map((s) => ({
        id: String(s.id),
        name: s.name,
        lng: s.lng,
        lat: s.lat,
        intro: s.intro,
        nightOnly: s.nightOnly,
        visibility: 'window' as const,
        source: 'preset' as const,
      }));
    }
    trip.setTrip({
      trainCode: preset.meta.train,
      trainNo: preset.meta.trainNo || 'demo',
      date: date || preset.meta.date || '2026-08-11',
      fromName: from || preset.meta.from,
      toName: to || preset.meta.to,
      stops: demoStops,
      spots,
      preciseRailway,
      isDemo: true,
    });
    prefs.loadForCurrentTrip();
    return;
  }

  if (trainCode && date && from && to) {
    const key = tripCacheKey({ trainCode, date, fromName: from, toName: to });
    const snap = await getSnapshot(key);
    if (snap) {
      hydrateFromSnapshot(snap);
      return;
    }
  }

  // query 未命中时，再试自动恢复指针（刷新 /trip 时常见）
  const resumeKey = getAutoResumeTripKey();
  if (resumeKey) {
    const snap = await getSnapshot(resumeKey);
    if (snap) {
      hydrateFromSnapshot(snap);
      await router.replace({
        path: '/trip',
        query: {
          trainCode: snap.segment.trainCode,
          date: snap.segment.date,
          from: snap.segment.fromName,
          to: snap.segment.toName,
        },
      });
      return;
    }
    clearAutoResume();
  }

  // 有 query 但无缓存：回首页（由选车页展示提示），避免卡在错误页
  try {
    sessionStorage.setItem('railvista:resumeHint', '无法恢复上次行程');
  } catch {
    /* */
  }
  markStayOnSelect();
  await router.replace('/');
}

function updateOverlayMetrics() {
  const root = pageEl.value;
  const scope = root || document;
  const top = scope.querySelector('.top-bar')?.getBoundingClientRect().height || 72;
  const vh = window.innerHeight;
  const panel = scope.querySelector('.bottom-panel')?.getBoundingClientRect();
  const legend = scope.querySelector('.legend')?.getBoundingClientRect();

  // 按底栏实测高度抬升右侧控件，避免天气条/前方景点撑高后盖住图例
  let panelClearance = compact.value ? 140 : 118;
  if (panel && panel.height > 0) {
    panelClearance = Math.max(panelClearance, Math.ceil(vh - panel.top));
  }

  const legendH = legend && legend.height > 0 ? Math.ceil(legend.height) : 0;
  // 桌面常显图例：按钮叠在图例顶边之上；手机点开图例时同样按实测抬升
  const controlsLift = legendH > 0 ? legendH + 12 : compact.value ? 48 : 158;

  const topOverlay = `${Math.ceil(top) + 16}px`;
  const bottomClearance = `${panelClearance}px`;
  const bottomOverlay = `${panelClearance + 12}px`;
  const lift = `${controlsLift}px`;

  if (root) {
    root.style.setProperty('--top-overlay', topOverlay);
    root.style.setProperty('--bottom-panel-clearance', bottomClearance);
    root.style.setProperty('--bottom-overlay', bottomOverlay);
    root.style.setProperty('--map-controls-lift', lift);
  }
  document.documentElement.style.setProperty('--top-overlay', topOverlay);
  document.documentElement.style.setProperty('--bottom-panel-clearance', bottomClearance);
  document.documentElement.style.setProperty('--bottom-overlay', bottomOverlay);
  document.documentElement.style.setProperty('--map-controls-lift', lift);
  try {
    map?.resize?.();
  } catch {
    /* */
  }
}

let bottomPanelObserver: ResizeObserver | null = null;

function bindOverlayObserver() {
  bottomPanelObserver?.disconnect();
  bottomPanelObserver = null;
  if (typeof ResizeObserver === 'undefined') return;
  const scope = pageEl.value || document;
  const panel = scope.querySelector('.bottom-panel');
  const legend = scope.querySelector('.legend');
  const topBar = scope.querySelector('.top-bar');
  if (!panel && !legend) return;
  bottomPanelObserver = new ResizeObserver(() => {
    updateOverlayMetrics();
  });
  if (panel) bottomPanelObserver.observe(panel);
  if (legend) bottomPanelObserver.observe(legend);
  if (topBar) bottomPanelObserver.observe(topBar);
}

function getMapPadding() {
  const side = compact.value ? 20 : 48;
  const top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--top-overlay'), 10) || 72;
  let bottom =
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bottom-overlay'), 10) || 118;
  // 手机天象短条占高；桌面无浮条
  if (skyMode.value && !skyPanelOpen.value && compact.value) bottom += 52;
  return [top, side, bottom, side];
}

/** 景点气泡 / 底栏共用：只展示时间区间 */
function formatEtaLabel(eta: SpotEta, departure: Date): string {
  return formatEtaRange(eta, departure) || '—';
}

/** 底栏：ETA 区间，如 03:49~04:11 / 次日 03:49~04:11 */
function formatEtaBrief(eta: SpotEta, departure: Date): string {
  return formatEtaRange(eta, departure);
}

/** 中心时刻 ±σ → 时间窗文案 */
function formatEtaRange(eta: SpotEta, departure: Date): string {
  if (!eta.etaIso) return '';
  const center = new Date(eta.etaIso);
  if (Number.isNaN(center.getTime())) return '';
  const sigmaMin = Math.max(0, Math.round(eta.sigmaMin ?? 0));
  const start = new Date(center.getTime() - sigmaMin * 60_000);
  const end = new Date(center.getTime() + sigmaMin * 60_000);
  const startStr = formatTime(start);
  const endStr = formatTime(end);
  const depDay = departure.getDate();
  const startNext = start.getDate() !== depDay;
  const endNext = end.getDate() !== depDay;

  if (sigmaMin <= 0) return startNext ? `次日 ${startStr}` : startStr;
  if (startNext && endNext) return `次日 ${startStr}~${endStr}`;
  if (!startNext && endNext) return `${startStr}~次日 ${endStr}`;
  return `${startStr}~${endStr}`;
}

function spotNight(spot: ScenicSpot, eta: SpotEta | undefined): boolean {
  if (eta?.etaIso) {
    return isNightAt({ lng: spot.lng, lat: spot.lat, isoTime: eta.etaIso, nightOnly: spot.nightOnly });
  }
  return spot.nightOnly ?? false;
}

function tick() {
  const seg = segment.value;
  const sch = schedule.value;
  if (!seg || !sch) return;
  const forceSchedule = pathMetrics.path.length < 2;
  const mileage = buildMileageAxis({
    stops: seg.stops,
    path: pathMetrics.path,
    lengthKm: pathMetrics.lengthKm,
  });
  stationKmRef.value = mileage.stationKm;
  const result = resolveProgress({
    now: now.value,
    departure: sch.departure,
    arrival: sch.arrival,
    stops: seg.stops,
    offsetMs: sch.offsetMs,
    calibration: prefs.calibration,
    gps: gpsAvailable.value ? gps.value : null,
    path: pathMetrics.path,
    lengthKm: pathMetrics.lengthKm,
    simulatedProgress: readSimulatedProgress(),
    forceSchedule,
    stationKm: mileage.stationKm,
    railwaySource: trip.railwaySource === 'precise' ? 'precise' : 'station',
  });
  progress.value = result.progress;
  mode.value = result.mode;

  try {
    const prof = profileForTrain(seg.trainCode);
    const curve = buildScheduleCurve({ stops: seg.stops, stationKm: mileage.stationKm, prof });
    etasRef.value = estimateSpotEtas({
      curve,
      spots: trip.scenicSpots,
      now: now.value.getTime(),
      prof,
      geoSigma: geoSigmaFor('station', 0),
      shiftMs: sch.offsetMs,
    });
  } catch {
    etasRef.value = [];
  }
  scheduleWeatherFetch();
  const point = pointAtProgress(pathMetrics.path, pathMetrics.lengthKm, result.progress);
  if (trainMarker) trainTarget.value = [point.lng, point.lat];
  if (gpsMarker) {
    const g = gps.value;
    const stale = !gpsAvailable.value || !g || Date.now() - g.timestamp > 120000;
    if (stale || !prefs.layers.gps) gpsMarker.hide();
    else {
      gpsTarget.value = [g!.lng, g!.lat];
      gpsMarker.show();
    }
  }
}

const upcoming = computed(() => {
  const seg = segment.value;
  const sch = schedule.value;
  if (!seg || !sch) return null;
  const u = getUpcoming({
    now: now.value,
    departure: sch.departure,
    arrival: sch.arrival,
    progress: progress.value,
    offsetMs: sch.offsetMs,
    calibration: prefs.calibration,
    spots: trip.scenicSpots,
    stops: seg.stops,
    path: pathMetrics.path,
    lengthKm: pathMetrics.lengthKm,
    etas: etasRef.value,
  });
  const spot = trip.scenicSpots.find((s) => s.name === u.name);
  const eta = etasRef.value.find((e) => e.spotId === String(spot?.id));

  // 底栏只展示简短时刻；气泡详情仍用 formatEtaLabel
  let timeBrief = '';
  if (eta?.etaIso) timeBrief = formatEtaBrief(eta, sch.departure);
  else if (spot?.at) timeBrief = formatSpotTimeLabel(spot.timeLabel, shifted(spot.at)) || '';
  else if (u.timeLabel) timeBrief = u.timeLabel;

  // 相对时间 / 状态提示：过滤掉「发车·首个计划风景点」这类冗长拼接
  let hint = '';
  if (progress.value >= 1) hint = '行程已结束';
  else if (progress.value <= 0) hint = u.kind === 'spot' ? '发车后经过' : '发车后到达';
  else if (u.reason && !u.reason.includes('发车') && !u.reason.includes('首个')) hint = u.reason;

  const weather = spot ? weatherBySpotId.value[String(spot.id)] : undefined;
  const wx = weather?.queried ? spotWeatherParts(weather, spot?.visibility) : null;

  /** 底栏常驻：方位 / 距轨 / 最佳时段（原 SpotApproachCard 展示项） */
  const side = spot ? spotSideKey(spot) : null;
  const sideLow = spot?.sideConfidence === 'low';
  const sideNeedsReview = Boolean(spot?.sideNeedsReview);
  const distKm = typeof spot?.distKm === 'number' ? spot.distKm : null;
  const distText =
    distKm == null
      ? ''
      : `距轨 ${distKm < 10 ? distKm.toFixed(1) : Math.round(distKm)} km`;
  const tod = spot?.bestView?.timeOfDay;
  const bestTime = tod
    ? ({ day: '白天最佳', dawn: '清晨最佳', dusk: '黄昏最佳', night: '夜间最佳', any: '全天可看' } as const)[
        tod
      ] ?? ''
    : spot?.nightOnly
      ? '夜间最佳'
      : '';

  return {
    ...u,
    timeBrief,
    hint,
    wx,
    spotId: spot ? String(spot.id) : '',
    visibility: spot?.visibility,
    side,
    sideLow,
    sideNeedsReview,
    distKm,
    distText,
    bestTime,
  };
});

const upcomingTitle = computed(() => {
  if (progress.value >= 1) return '已到达';
  const kind = upcoming.value?.kind;
  if (progress.value <= 0) {
    if (kind === 'spot') return '首个景点';
    if (kind === 'station') return '下一站';
    return '行程起点';
  }
  if (kind === 'spot') return '即将到达';
  if (kind === 'station') return '下一站';
  return '即将到达';
});

const upcomingMetaLine = computed(() => {
  const u = upcoming.value;
  if (!u) return '';
  const parts: string[] = [];
  if (u.timeBrief) parts.push(u.timeBrief);
  if (u.hint) parts.push(u.hint);
  return parts.join(' · ');
});

/** 底栏下一站/终点：车站类才挂风味，景点类保持原有信息密度 */
const upcomingFood = computed(() => {
  const u = upcoming.value;
  if (!u || (u.kind !== 'station' && u.kind !== 'end')) return null;
  const stop = segment.value?.stops.find((s) => s.name === u.name);
  return stationFoodTop(u.name, stop ? { lng: stop.lng, lat: stop.lat } : null, 3);
});

function wxHintClass(hint?: SpotWeatherParts['viewHint']): string {
  if (hint === 'good') return 'is-good';
  if (hint === 'poor') return 'is-poor';
  if (hint === 'fair') return 'is-fair';
  return '';
}

const locationInfo = computed(() => {
  const seg = segment.value;
  if (!seg) return { segment: '', meta: '' };
  const km = railLengthKm.value;
  if (progress.value <= 0) {
    return {
      segment: `${seg.fromName}站 · 尚未发车`,
      meta: `全程约 ${Math.round(km)} 公里`,
    };
  }
  if (progress.value >= 1) {
    return {
      segment: `${seg.toName}站 · 已到达`,
      meta: `全程 ${Math.round(km)} 公里`,
    };
  }
  const n = Math.max(seg.stops.length - 1, 1);
  let from = seg.stops[0];
  let to = seg.stops[seg.stops.length - 1];
  for (let i = 0; i < seg.stops.length - 1; i += 1) {
    if (progress.value >= i / n && progress.value <= (i + 1) / n) {
      from = seg.stops[i];
      to = seg.stops[i + 1];
      break;
    }
  }
  return {
    segment: `${from.name} → ${to.name}`,
    meta: `已行 ${Math.round(progress.value * km)} km · 剩余 ${Math.round((1 - progress.value) * km)} km`,
  };
});

const clockText = computed(() =>
  now.value.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }),
);

function applyLayers() {
  if (railLine) prefs.layers.rail ? railLine.show() : railLine.hide();
  spotMarkers.forEach((m) => (prefs.layers.spot ? m.show() : m.hide()));
  stationMarkers.forEach((m) => (prefs.layers.station ? m.show() : m.hide()));
  unresolvedMarkers.forEach((m) => (prefs.layers.station ? m.show() : m.hide()));
  if (trainMarker) prefs.layers.train ? trainMarker.show() : trainMarker.hide();
}

/**
 * P0-4：无真实坐标的经停站不允许凭空消失。在前后最近两个有坐标站之间按站序
 * 线性插值，并向弦的法向偏移约 5km，避免占位圈与蓝线/真实站标重叠。
 */
function placeholderPosition(stops: Stop[], idx: number): [number, number] | null {
  let p = idx - 1;
  while (p >= 0 && (stops[p].lng == null || stops[p].lat == null)) p -= 1;
  let n = idx + 1;
  while (n < stops.length && (stops[n].lng == null || stops[n].lat == null)) n += 1;
  if (p < 0 || n >= stops.length) return null;
  const a = stops[p];
  const b = stops[n];
  const f = (idx - p) / (n - p);
  const lng = a.lng! + (b.lng! - a.lng!) * f;
  const lat = a.lat! + (b.lat! - a.lat!) * f;
  const dx = b.lng! - a.lng!;
  const dy = b.lat! - a.lat!;
  const len = Math.hypot(dx, dy) || 1;
  // 法向偏移：经度 0.05°（35°N 约 4.5km）、纬度 0.045°（约 5km）
  return [lng + (-dy / len) * 0.05, lat + (dx / len) * 0.045];
}

function rebuildUnresolvedMarkers() {
  const seg = segment.value;
  if (!map || !AMapRef || !seg) return;
  unresolvedMarkers.forEach((m) => map.remove(m));
  unresolvedMarkers = [];
  const unresolvedNames = new Set(trip.unresolvedStops);
  seg.stops.forEach((s, i) => {
    if (s.lng != null && s.lat != null && Number.isFinite(s.lng) && Number.isFinite(s.lat)) return;
    // 仅渲染服务端明确标注未解析的站；服务端走廊 hint 兜底补到坐标后自动消失
    if (unresolvedNames.size && !unresolvedNames.has(s.name)) return;
    const pos = placeholderPosition(seg.stops, i);
    if (!pos) return;
    const marker = new AMapRef.Marker({
      position: pos,
      title: `${s.name}（坐标待补，当前为近似占位）`,
      content: `<div class="station-marker station-marker--unresolved${compact.value ? ' station-marker--compact' : ''}"><span class="station-dot station-dot--unresolved"></span><span class="station-label">${escHtml(s.name)}<em class="station-label__pending">坐标待补</em></span></div>`,
      anchor: 'center',
      zIndex: 140,
    });
    if (prefs.layers.station) map.add(marker);
    unresolvedMarkers.push(marker);
  });
}

/**
 * 轨道线配色：从设计令牌读取，保证与「图例」里的示意铁路色完全一致。
 *
 * 历史坑：这里曾硬编码旧品牌金 `#e4b25c`，而图例用 `var(--accent)`；
 * 一旦主题色改变（如本轮改为鸿蒙宇宙蓝），硬编码值不会跟随，图例与线路就会"两张皮"。
 * 因此改为运行时读取 CSS 变量，并保留兜底值以防变量缺失。
 */
function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function railStrokeOptions() {
  const rail = readToken('--rail', ATLAS_RAIL_STROKE);
  // 卫星底图偏亮，提高不透明度并略微提亮，保证线条仍可辨识
  return satelliteOn.value
    ? { strokeColor: readToken('--accent-hover', ATLAS_RAIL_HOVER_STROKE), strokeOpacity: 0.95 }
    : { strokeColor: rail, strokeOpacity: 0.85 };
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
  railLine?.setOptions?.(railStrokeOptions());
}

function toggleSatellite() {
  satelliteOn.value = !satelliteOn.value;
  try {
    localStorage.setItem(SATELLITE_PREF_KEY, satelliteOn.value ? '1' : '0');
  } catch {
    /* ignore quota */
  }
  applySatelliteLayers();
}

/** 未经过景点按 ETA 批量拉天气；签名不变则跳过，避免 tick 刷爆 */
function scheduleWeatherFetch() {
  if (typeof window === 'undefined') return;
  if (weatherFetchTimer) window.clearTimeout(weatherFetchTimer);
  weatherFetchTimer = window.setTimeout(() => {
    void fetchSpotWeathers();
  }, 900);
}

/** 后端单次最多 40 个景点；全程超过 40 个时分批拉取，避免后半程景点永远没有天气 */
const WEATHER_BATCH = 40;

async function fetchSpotWeathers() {
  const etas = etasRef.value;
  if (!etas.length) return;
  const spotMap = new Map(trip.scenicSpots.map((s) => [String(s.id), s]));
  const payload: Array<{
    spotId: string;
    lng: number;
    lat: number;
    atIso: string;
    visibility?: string;
  }> = [];
  for (const eta of etas) {
    if (eta.passed || !eta.etaIso) continue;
    const spot = spotMap.get(String(eta.spotId));
    if (!spot || !Number.isFinite(spot.lng) || !Number.isFinite(spot.lat)) continue;
    payload.push({
      spotId: String(spot.id),
      lng: spot.lng,
      lat: spot.lat,
      atIso: eta.etaIso,
      visibility: spot.visibility,
    });
  }
  if (!payload.length) return;

  const sig = payload.map((p) => `${p.spotId}:${p.atIso.slice(0, 13)}`).join('|');
  if (sig === (fetchSpotWeathers as { _sig?: string })._sig) return;
  (fetchSpotWeathers as { _sig?: string })._sig = sig;

  const seq = ++weatherFetchSeq;
  try {
    const next: Record<string, SpotWeather> = { ...weatherBySpotId.value };
    for (let i = 0; i < payload.length; i += WEATHER_BATCH) {
      const data = await api.getSpotWeathers(payload.slice(i, i + WEATHER_BATCH));
      if (seq !== weatherFetchSeq) return;
      for (const item of data.items || []) {
        if (item?.spotId) next[item.spotId] = item;
      }
      weatherBySpotId.value = next;
    }
  } catch {
    /* 天气失败不阻断行程主流程 */
  }
}

function weatherLineHtml(spotId: string, visibility?: string): string {
  const w = weatherBySpotId.value[String(spotId)];
  if (!w?.queried) return '';
  const p = spotWeatherParts(w, visibility);
  if (!p) return '';
  const hintClass =
    p.viewHint === 'good'
      ? 'is-good'
      : p.viewHint === 'poor'
        ? 'is-poor'
        : p.viewHint === 'fair'
          ? 'is-fair'
          : '';
  const temp = p.temp ? `<span class="wx-strip__temp">${escHtml(p.temp)}</span>` : '';
  const hint = p.hint
    ? `<span class="wx-strip__hint ${hintClass}">${escHtml(p.hint)}</span>`
    : p.vis
      ? `<span class="wx-strip__vis">${escHtml(p.vis)}</span>`
      : '';
  return `<div class="wx-strip map-info-card__wx">
      <div class="wx-strip__main">
        <span class="wx-strip__emoji" aria-hidden="true">${escHtml(p.emoji)}</span>
        ${p.cond ? `<span class="wx-strip__cond">${escHtml(p.cond)}</span>` : ''}
        ${temp}
      </div>
      ${hint}
    </div>`;
}

/**
 * 景点标记工厂：单个景点 → Marker（含点开后的详情气泡）。
 * 抽成函数是为了 B1：折线升级为精准路线后能整体重建标记层。
 */
function buildSpotMarker(spot: ScenicSpot, idx: number) {
  const AMap = AMapRef;
  // 只有「方位待确认」才换样式，左/右/两侧均使用统一的景点色
  const reviewStyle = spotSideKey(spot) === 'unknown' ? ' spot-marker--unknown' : '';
  const marker = new AMap.Marker({
    position: [spot.lng, spot.lat],
    title: spot.name,
    anchor: 'bottom-center',
    content: `<div class="spot-marker${reviewStyle}${compact.value ? ' spot-marker--compact' : ''}">${idx + 1}</div>`,
  });
  marker.on('click', () => {
    const visLabel =
      spot.visibility === 'distant'
        ? '远眺'
        : spot.visibility === 'on_track'
          ? '穿行'
          : spot.visibility === 'window'
            ? '窗外'
            : '';
    const visClass =
      spot.visibility === 'distant' || spot.visibility === 'on_track' || spot.visibility === 'window'
        ? spot.visibility
        : '';
    const eta = etasRef.value.find((e) => e.spotId === String(spot.id));
    const sch = schedule.value;
    const timeLabel = eta?.etaIso && sch
      ? formatEtaLabel(eta, sch.departure)
      : spot.at
        ? formatSpotTimeLabel(spot.timeLabel, shifted(spot.at))
        : spot.timeLabel || '';
    const isNight = spotNight(spot, eta);
    const weatherHtml = weatherLineHtml(String(spot.id), spot.visibility);
    // 有天气观景提示时，不再单独挂「远眺/窗外」，避免与「远眺条件好」重复
    const hideVisBadge = Boolean(
      weatherBySpotId.value[String(spot.id)]?.queried &&
        weatherBySpotId.value[String(spot.id)]?.viewHint,
    );
    const sideBadgeHtml = (() => {
      const key = spotSideKey(spot);
      const text =
        key === 'left'
          ? '列车左侧'
          : key === 'right'
            ? '列车右侧'
            : key === 'both'
              ? '两侧均可'
              : '方位待确认';
      const arrow = key === 'left' ? '←' : key === 'right' ? '→' : key === 'both' ? '↔' : '?';
      return `<span class="map-info-card__badge map-info-card__badge--side map-info-card__badge--side-${key}">${arrow} ${text}</span>`;
    })();
    const honors = honorLabels(spot.honors);
    const honorHtml = honors.length
      ? `<div class="map-info-card__honors">${honors
          .slice(0, 4)
          .map((h) => `<span class="map-info-card__honor">${escHtml(h)}</span>`)
          .join('')}${honors.length > 4 ? `<span class="map-info-card__honor map-info-card__honor--more">+${honors.length - 4}</span>` : ''}</div>`
      : '';
    const badges = [
      sideBadgeHtml,
      !hideVisBadge && visLabel && visClass
        ? `<span class="map-info-card__badge map-info-card__badge--${visClass}">${escHtml(visLabel)}</span>`
        : '',
      isNight ? `<span class="map-info-card__badge map-info-card__badge--night">夜间</span>` : '',
      timeLabel
        ? `<span class="map-info-card__badge map-info-card__badge--time">${escHtml(timeLabel)}</span>`
        : '',
    ]
      .filter(Boolean)
      .join('');
    const info = new AMap.InfoWindow({
      isCustom: true,
      autoMove: true,
      closeWhenClickMap: true,
      content: `<div class="map-info-card">
          <button type="button" class="map-info-card__close" data-info-close aria-label="关闭">×</button>
          <div class="map-info-card__title">${escHtml(spot.name)}</div>
          ${badges ? `<div class="map-info-card__meta">${badges}</div>` : ''}
          ${weatherHtml}
          ${honorHtml}
          ${spot.intro ? `<p class="map-info-card__intro">${escHtml(spot.intro)}</p>` : ''}
          <div class="map-info-card__arrow" aria-hidden="true"></div>
        </div>`,
      offset: new AMap.Pixel(0, -34),
    });
    info.open(map, marker.getPosition());
  });
  return marker;
}

/**
 * B1 [P0] 重建整层景点标记。
 * 旧实现只在 initMap() 里建一次且没有监听，导致「折线刷新了、景点还是示意线那一组」。
 * 这里采用与 rebuildUnresolvedMarkers 一致的整体重建策略：稳健、无残留。
 */
function rebuildSpotMarkers() {
  if (!map || !AMapRef) return;
  // 重建前关掉已打开的气泡，避免它停在已失效的位置
  try {
    map.clearInfoWindow?.();
  } catch {
    /* ignore */
  }
  for (const m of spotMarkers) {
    try {
      map.remove(m);
    } catch {
      /* ignore */
    }
  }
  spotMarkers = [];
  trip.scenicSpots.forEach((spot, idx) => {
    if (!Number.isFinite(spot.lng) || !Number.isFinite(spot.lat)) return;
    const marker = buildSpotMarker(spot, idx);
    map.add(marker);
    if (!prefs.layers.spot) marker.hide();
    spotMarkers.push(marker);
  });
}

// ── 天象观景：时间轴结果 → 地图标注 ─────────────────────────────────────────
let skyOverlays: any[] = [];
let skyFocusOverlays: any[] = [];

function removeMapOverlays(list: any[]) {
  if (!map) return;
  for (const m of list) {
    try {
      map.remove(m);
    } catch {
      /* ignore */
    }
  }
}

function clearSkyFocusOverlay() {
  removeMapOverlays(skyFocusOverlays);
  skyFocusOverlays = [];
}

function clearSkyOverlay() {
  clearSkyFocusOverlay();
  removeMapOverlays(skyOverlays);
  skyOverlays = [];
  skyFocus.value = null;
  skyMapPayload.value = null;
}

/** 天象标注配色：霞=暖橙 / 金=琥珀 / 蓝=冰蓝 / 日=朱红 / 月=靛紫（与面板 k-* 语义一致） */
const SKY_EPISODE_CLS: Record<string, string> = {
  dawnGlow: 'is-glow',
  duskGlow: 'is-glow',
  goldenMorning: 'is-golden',
  goldenEvening: 'is-golden',
  blueMorning: 'is-blue',
  blueEvening: 'is-blue',
  sunrise: 'is-sun',
  sunset: 'is-sun',
};

function skyStrokeForKind(kind: string): string {
  if (kind === 'dawnGlow' || kind === 'duskGlow') return TRIP_GLOW_STROKE;
  if (kind === 'goldenMorning' || kind === 'goldenEvening') return TRIP_SKY_GOLDEN_STROKE;
  if (kind === 'blueMorning' || kind === 'blueEvening') return TRIP_SKY_BLUE_STROKE;
  if (kind === 'sunrise' || kind === 'sunset') return TRIP_SKY_SUN_STROKE;
  return TRIP_HIGHLIGHT_STROKE;
}

function skyLineWeight(kind: string): number {
  if (kind === 'dawnGlow' || kind === 'duskGlow') return 7;
  if (kind === 'goldenMorning' || kind === 'goldenEvening') return 7;
  if (kind === 'blueMorning' || kind === 'blueEvening') return 6;
  if (kind === 'sunrise' || kind === 'sunset') return 6;
  if (kind === 'nautical' || kind === 'astroTwilight') return 4;
  return 5;
}

function skyLineOpacity(kind: string): number {
  if (kind === 'nautical' || kind === 'astroTwilight') return 0.55;
  if (kind === 'night') return 0.85;
  return 0.92;
}

/** 白天段不上色（会盖满全线）；短夜段跳过避免碎线 */
function shouldPaintSkyEpisode(kind: string, startMs: number, endMs: number): boolean {
  if (kind === 'day') return false;
  if (kind === 'night' && endMs - startMs < 90 * 60_000) return false;
  return true;
}

function skyMarkerClsForKind(kind: string): string {
  if (kind === 'dawnGlow' || kind === 'duskGlow') return 'is-glow';
  if (kind === 'goldenMorning' || kind === 'goldenEvening') return 'is-golden';
  if (kind === 'blueMorning' || kind === 'blueEvening') return 'is-blue';
  if (kind === 'sunrise' || kind === 'sunset') return 'is-sun';
  if (kind === 'moonrise' || kind === 'moonset') return 'is-moon';
  return 'is-star';
}

function episodeToFocus(e: {
  id: string;
  kind: string;
  title: string;
  lng: number;
  lat: number;
  startKm: number;
  endKm: number;
  startMs: number;
  endMs: number;
}): SkyFocusPayload {
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    lng: e.lng,
    lat: e.lat,
    startKm: e.startKm,
    endKm: e.endKm,
    startMs: e.startMs,
    endMs: e.endMs,
  };
}

/** 里程区间 → 路线折线切片（画路段高亮用） */
function pathSliceKm(startKm: number, endKm: number): [number, number][] {
  const path = pathMetrics.path;
  const total = pathMetrics.lengthKm;
  if (!path || path.length < 2 || total <= 0) return [];
  const out: [number, number][] = [];
  const a = pointAtProgress(path, total, startKm / total);
  out.push([a.lng, a.lat]);
  for (const p of path) {
    if (p.distFromStart > startKm && p.distFromStart < endKm) out.push([p.lng, p.lat]);
  }
  const b = pointAtProgress(path, total, endKm / total);
  out.push([b.lng, b.lat]);
  return out;
}

/** 车窗左右侧短后缀：· 右 / · 左 */
function sideShort(side: string): string {
  return side === 'right' ? '· 右' : side === 'left' ? '· 左' : '';
}

/** 迷你条一行状态（不再跟第二行白字） */
const skyPeekKicker = computed(() => {
  if (!skyMapPayload.value) return '天象计算中…';
  const f = skyFocus.value;
  if (f) return `已定位 · ${f.title}`;
  return '路线已按天象上色';
});

/**
 * 天象时间轴 → 地图：
 *   1) 各看点时段彩色路段（蓝/霞/金/日/夜…），可点击聚焦；
 *   2) 日月时刻与看点标注。
 */
function rebuildSkyOverlay(payload: SkyMapResult | null) {
  if (!map || !AMapRef) return;
  skyMapPayload.value = payload;
  clearSkyFocusOverlay();
  removeMapOverlays(skyOverlays);
  skyOverlays = [];
  if (!payload || !skyMode.value) return;
  const { result, scores } = payload;

  const items: Array<{
    lng: number;
    lat: number;
    text: string;
    title: string;
    cls: string;
    focus?: SkyFocusPayload;
  }> = [];

  // 1) 全时段色带（白天除外）
  for (const e of result.episodes) {
    if (!shouldPaintSkyEpisode(e.kind, e.startMs, e.endMs)) continue;
    const coords = pathSliceKm(e.startKm, e.endKm);
    if (coords.length < 2) continue;
    const focus = episodeToFocus(e);
    const line = new AMapRef.Polyline({
      path: coords,
      strokeColor: skyStrokeForKind(e.kind),
      strokeWeight: skyLineWeight(e.kind),
      strokeOpacity: skyLineOpacity(e.kind),
      lineJoin: 'round',
      lineCap: 'round',
      zIndex: 150,
      cursor: 'pointer',
      bubble: true,
    });
    line.on?.('click', () => onSkyFocus(focus));
    map.add(line);
    skyOverlays.push(line);
  }

  // 2) 路段中点标注：霞 / 高分夜段
  for (const e of result.episodes) {
    const isGlow = e.kind === 'dawnGlow' || e.kind === 'duskGlow';
    const score = scores[e.id];
    const isStar = e.kind === 'night' && (score?.score ?? 0) >= 55;
    if (!isGlow && !isStar) continue;
    const midKm = (e.startKm + e.endKm) / 2;
    const mid = pointAtProgress(
      pathMetrics.path,
      pathMetrics.lengthKm,
      midKm / (pathMetrics.lengthKm || 1),
    );
    const t = formatTime(new Date((e.startMs + e.endMs) / 2));
    if (isGlow) {
      items.push({
        lng: mid.lng,
        lat: mid.lat,
        text: `${t} ${e.title} ${sideShort(e.sunSide.side)}`,
        title: `${e.title} ${t} · ${e.nearName || '沿途'} · ${e.sunSide.label} · 指数 ${score?.score ?? '—'}`,
        cls: 'is-glow',
        focus: episodeToFocus(e),
      });
    } else {
      const milky = (score?.note ?? '').includes('银河可见') ? ' · 银河' : '';
      items.push({
        lng: mid.lng,
        lat: mid.lat,
        text: `观星 ${score?.score ?? ''}${milky}`,
        title: `观星段 · ${e.nearName || '沿途'} · 指数 ${score?.score ?? '—'} · ${score?.note ?? ''}`,
        cls: 'is-star',
        focus: episodeToFocus(e),
      });
    }
  }

  // 3) 日月时刻标注
  for (const m of result.moments) {
    const isMoon = m.kind === 'moonrise' || m.kind === 'moonset';
    const t = formatTime(new Date(m.atMs));
    items.push({
      lng: m.lng,
      lat: m.lat,
      text: `${t} ${m.title} ${sideShort(m.sideInfo.side)}`,
      title: `${m.title} ${t} · ${m.nearName || '沿途'} · ${m.sideInfo.label}`,
      cls: isMoon ? 'is-moon' : 'is-sun',
      focus: {
        id: `moment-${m.kind}-${m.atMs}`,
        kind: m.kind,
        title: m.title,
        lng: m.lng,
        lat: m.lat,
        startMs: m.atMs,
        endMs: m.atMs,
      },
    });
  }

  // 4) 金/蓝时刻看点标注（霞/日已单独标注）
  for (const e of highlightEpisodes(result.episodes)) {
    const cls = SKY_EPISODE_CLS[e.kind];
    if (!cls || e.kind === 'sunrise' || e.kind === 'sunset') continue;
    if (e.kind === 'dawnGlow' || e.kind === 'duskGlow') continue;
    const t = formatTime(new Date((e.startMs + e.endMs) / 2));
    items.push({
      lng: e.lng,
      lat: e.lat,
      text: `${t} ${e.title} ${sideShort(e.sunSide.side)}`,
      title: `${e.title} · ${e.nearName || '沿途'} · ${e.sunSide.label}`,
      cls,
      focus: episodeToFocus(e),
    });
    if (items.length >= 28) break;
  }

  for (const it of items) {
    const marker = new AMapRef.Marker({
      position: [it.lng, it.lat],
      title: it.title,
      content: `<div class="sky-marker ${it.cls}${compact.value ? ' sky-marker--compact' : ''}"><span class="sky-marker__text">${escHtml(it.text)}</span><span class="sky-marker__dot"></span></div>`,
      anchor: 'bottom-center',
      zIndex: 160,
    });
    if (it.focus) {
      const focus = it.focus;
      marker.on?.('click', () => onSkyFocus(focus));
    }
    map.add(marker);
    skyOverlays.push(marker);
  }

  if (skyFocus.value) paintSkyFocus(skyFocus.value);
}

/** 选中片段：加粗鲜艳路段（或点标注）+ 视野对准 */
function paintSkyFocus(p: SkyFocusPayload) {
  if (!map || !AMapRef) return;
  clearSkyFocusOverlay();
  const color = skyStrokeForKind(p.kind);
  const cls = skyMarkerClsForKind(p.kind);
  let coords: [number, number][] = [];
  if (p.startKm != null && p.endKm != null && p.endKm > p.startKm) {
    coords = pathSliceKm(p.startKm, p.endKm);
  }

  if (coords.length >= 2) {
    const glow = new AMapRef.Polyline({
      path: coords,
      strokeColor: color,
      strokeWeight: 16,
      strokeOpacity: 0.32,
      lineJoin: 'round',
      lineCap: 'round',
      zIndex: 168,
      bubble: true,
    });
    const line = new AMapRef.Polyline({
      path: coords,
      strokeColor: color,
      strokeWeight: 10,
      strokeOpacity: 1,
      lineJoin: 'round',
      lineCap: 'round',
      zIndex: 169,
      bubble: true,
    });
    map.add([glow, line]);
    skyFocusOverlays.push(glow, line);
    try {
      map.setFitView([line], false, getMapPadding(), 14);
    } catch {
      map.setZoomAndCenter(Math.max(map.getZoom?.() ?? 6, 10), [p.lng, p.lat], false, 300);
    }
  } else {
    map.setZoomAndCenter(Math.max(map.getZoom?.() ?? 6, 10), [p.lng, p.lat], false, 300);
  }

  const t =
    p.startMs != null
      ? p.endMs != null && p.endMs !== p.startMs
        ? `${formatTime(new Date(p.startMs))}~${formatTime(new Date(p.endMs))}`
        : formatTime(new Date(p.startMs))
      : '';
  const text = t ? `${t} ${p.title}` : p.title;
  const marker = new AMapRef.Marker({
    position: [p.lng, p.lat],
    title: p.title,
    content: `<div class="sky-marker sky-marker--focus ${cls}"><span class="sky-marker__text">${escHtml(text)}</span><span class="sky-marker__dot"></span></div>`,
    anchor: 'bottom-center',
    zIndex: 175,
  });
  map.add(marker);
  skyFocusOverlays.push(marker);
}

function toggleSky() {
  if (skyMode.value) {
    skyMode.value = false;
    skyPanelOpen.value = false;
    clearSkyOverlay();
  } else {
    // 打开天象直接展开时间轴列表，无需再点「时间轴」按钮
    skyMode.value = true;
    skyPanelOpen.value = true;
  }
  nextTick(() => updateOverlayMetrics());
}

/** 面板 ×：只收起，保留地图天象层 */
function closeSkyPanel() {
  skyPanelOpen.value = false;
  nextTick(() => updateOverlayMetrics());
}

function openSkyPanel() {
  skyPanelOpen.value = true;
  nextTick(() => updateOverlayMetrics());
}

function exitSkyMode() {
  skyMode.value = false;
  skyPanelOpen.value = false;
  clearSkyOverlay();
  nextTick(() => updateOverlayMetrics());
}

/** 点时间轴/日月时刻 → 收起面板，高亮并对准路段 */
function onSkyFocus(p: SkyFocusPayload) {
  skyFocus.value = p;
  skyPanelOpen.value = false;
  paintSkyFocus(p);
  nextTick(() => updateOverlayMetrics());
}

async function initMap() {
  const key = import.meta.env.VITE_AMAP_KEY;
  if (!key) {
    error.value = '请配置 VITE_AMAP_KEY（apps/web/.env）';
    return;
  }
  const AMap = await loadAmap(key, import.meta.env.VITE_AMAP_SECURITY);
  AMapRef = AMap;
  const seg = segment.value!;
  const coords =
    trip.railwayCoords.length >= 2
      ? trip.railwayCoords
      : seg.stops
          .filter((s) => s.lng != null && s.lat != null)
          .map((s) => [s.lng!, s.lat!] as [number, number]);
  pathMetrics = buildRailwayMetrics(coords);
  railLengthKm.value = pathMetrics.lengthKm;
  compact.value = window.matchMedia('(max-width: 640px)').matches;

  if (coords.length < 2) {
    error.value =
      '经停站缺少坐标，无法绘制线路。请返回重试；若仍失败，请检查网络（需访问 OpenStreetMap）。';
    return;
  }

  map = new AMap.Map(mapEl.value, {
    zoom: 5,
    center: coords[0] || [104, 35],
    viewMode: '2D',
    mapStyle: AMAP_MAP_STYLE,
  });

  if (coords.length >= 2) {
    railLine = new AMap.Polyline({
      path: coords,
      strokeWeight: compact.value ? 4 : 5,
      lineJoin: 'round',
      ...railStrokeOptions(),
    });
    map.add(railLine);
  }

  rebuildSpotMarkers();

  stationMarkers = seg.stops.map((s) => {
    const marker = new AMap.Marker({
      position: [s.lng!, s.lat!],
      title: s.name,
      content: `<div class="station-marker${compact.value ? ' station-marker--compact' : ''}"><span class="station-dot"></span><span class="station-label">${escHtml(s.name)}</span></div>`,
      anchor: 'center',
      zIndex: 150,
    });
    marker.on('click', () => {
      const scheduleText = formatStationSchedule(s, shifted);
      const calibrateBtn =
        getCalibratableStations([s]).length > 0
          ? `<button type="button" class="info-calibrate-btn" data-station="${escHtml(s.name)}">我在 ${escHtml(s.name)} 站</button>`
          : '';
      const foodHtml = stationFoodCardHtml(stationFood(s.name, { lng: s.lng, lat: s.lat }));
      const info = new AMap.InfoWindow({
        isCustom: true,
        autoMove: true,
        closeWhenClickMap: true,
        content: `<div class="map-info-card">
          <button type="button" class="map-info-card__close" data-info-close aria-label="关闭">×</button>
          <div class="map-info-card__title">${escHtml(s.name)}</div>
          ${scheduleText ? `<p class="map-info-card__schedule">${escHtml(scheduleText)}</p>` : ''}
          ${s.intro ? `<p class="map-info-card__intro">${escHtml(s.intro)}</p>` : ''}
          ${foodHtml}
          ${calibrateBtn}
          <div class="map-info-card__arrow" aria-hidden="true"></div>
        </div>`,
        offset: new AMap.Pixel(0, -22),
      });
      info.open(map, marker.getPosition());
    });
    if (s.lng != null && s.lat != null) map.add(marker);
    return marker;
  });

  // P0-4：缺坐标经停的灰色占位（applyLayers 会统一控制显隐）
  rebuildUnresolvedMarkers();

  trainMarker = new AMap.Marker({
    position: coords[0] || [104, 35],
    content: `<div class="train-marker-wrap"><div class="train-marker${compact.value ? ' train-marker--compact' : ''}"></div><span class="train-marker-label">列车</span></div>`,
    anchor: 'center',
    zIndex: 200,
  });
  map.add(trainMarker);

  gpsMarker = new AMap.Marker({
    position: coords[0] || [104, 35],
    content: '<div class="gps-marker"></div>',
    anchor: 'center',
    zIndex: 190,
  });
  map.add(gpsMarker);
  gpsMarker.hide();

  trainTarget.value = (coords[0] as [number, number]) || [104, 35];
  gpsTarget.value = trainTarget.value;
  useSmoothMarker(trainTarget, (p) => trainMarker?.setPosition(p), 0.12);
  useSmoothMarker(gpsTarget, (p) => gpsMarker?.setPosition(p), 0.18);

  map.getContainer().addEventListener('click', (event: MouseEvent) => {
    const t = event.target as HTMLElement;
    if (t.closest?.('[data-info-close]')) {
      map?.clearInfoWindow?.();
      return;
    }
    const btn = t.closest?.('[data-station]') as HTMLElement | null;
    if (!btn) return;
    const station = seg.stops.find((item) => item.name === btn.dataset.station);
    if (station) openCalibrateConfirm(station);
  });

  applyLayers();
  applySatelliteLayers();
  await nextTick();
  bindOverlayObserver();
  updateOverlayMetrics();
  if (coords.length) map.setFitView(null, false, getMapPadding());
  tick();
}

function openCalibrateConfirm(station: Stop) {
  const sch = schedule.value;
  if (!sch) return;
  const anchor = getStationAnchorTime(station, shifted);
  if (!anchor) {
    showToast('该站不支持校准');
    return;
  }
  const offsetMs = computeCalibrationOffset(now.value, anchor);
  pendingStation.value = station;
  confirmMode.value = 'calibrate';
  confirmText.value = `确认您现在在「${station.name}」？\n图定到点 ${formatTime(anchor)}，当前 ${formatTime(now.value)}（${formatOffsetLabel(offsetMs)}）。\n确认后，后续估算将整体${offsetMs >= 0 ? '延后' : '提前'} ${Math.abs(Math.round(offsetMs / 60000))} 分钟。`;
  confirmOpen.value = true;
  map?.clearInfoWindow?.();
}

function applyCalibration() {
  const station = pendingStation.value;
  if (!station) return;
  const anchor = getStationAnchorTime(station, shifted);
  if (!anchor) return;
  const record: CalibrationRecord = {
    stationName: station.name,
    offsetMs: computeCalibrationOffset(now.value, anchor),
    calibratedAt: now.value.toISOString(),
    anchorIso: anchor.toISOString(),
  };
  prefs.setCalibration(record);
  confirmOpen.value = false;
  calibrateOpen.value = false;
  showToast(`已按「${record.stationName}」校准`);
  tick();
}

function openDepartEditor() {
  if (!schedule.value) return;
  departInput.value = toDatetimeLocalValue(schedule.value.departure);
  departOpen.value = true;
}

function saveDeparture() {
  const iso = fromDatetimeLocalValue(departInput.value);
  if (!iso || Number.isNaN(new Date(iso).getTime())) return;
  prefs.setDeparture(iso);
  departOpen.value = false;
  tick();
}

function resetDeparture() {
  prefs.setDeparture(null);
  departOpen.value = false;
  tick();
}

function locateTrain() {
  if (!trainMarker || !map) return;
  const pos = trainMarker.getPosition();
  map.panTo(pos);
  if (map.getZoom() < 7) map.setZoom(7);
}

function goBackToSelect() {
  // 仅清内存；保留 autoResume。标记本次留在首页，避免立刻又被自动拉回地图。
  markStayOnSelect();
  trip.clear();
  router.push('/');
}

function openStartNewTrip() {
  confirmMode.value = 'newTrip';
  confirmText.value =
    '开始新行程后，下次打开将不再自动进入本趟。最近访问列表仍会保留，可随时再选。';
  confirmOpen.value = true;
}

// ── 行程完成 → 纪念票 ───────────────────────────────────────────────────────
const currentTripKey = computed(() => (segment.value ? tripCacheKey(segment.value) : ''));

/**
 * 到终点是终态：每一趟只提示一次（本机记住），用户关掉就不再纠缠。
 * 演示行程不参与——它不是一次真实走完的旅行。
 */
const {
  visible: finishVisible,
  dismiss: dismissFinish,
  go: goFinishTicket,
} = useTripFinishTicket({
  key: () => currentTripKey.value,
  finished: () => progress.value >= 1 && !trip.isDemo,
  makeTicket: () =>
    segment.value
      ? ticketConfigFromRailSegment(segment.value, { mileageKm: railLengthKm.value })
      : null,
  src: 'trip',
});

const finishTitle = computed(() => {
  const seg = segment.value;
  if (!seg) return '本趟行程';
  return [seg.trainCode, `${seg.fromName} → ${seg.toName}`].filter(Boolean).join(' · ');
});

async function setAsCurrentTrip() {
  if (trip.isDemo || !segment.value) return;
  if (isPinnedCurrent.value) {
    clearAutoResume();
    resumeKeyNow.value = null;
    showToast('已取消当前行程');
    return;
  }
  const snap = await persistActiveTrip({ bumpOpenedAt: true, setResume: true });
  resumeKeyNow.value = getAutoResumeTripKey();
  if (snap) {
    try {
      upsertTicketTrace({
        sourceKey: snap.key,
        config: ticketConfigFromRailSegment(snap.segment, { mileageKm: railLengthKm.value }),
      });
    } catch {
      /* 痕迹落盘失败不影响设为当前 */
    }
    showToast('已设为当前行程，纪念票已留下痕迹');
  } else showToast('设置失败，请稍后重试');
}

function confirmDialogAction() {
  if (confirmMode.value === 'newTrip') {
    confirmOpen.value = false;
    clearAutoResume();
    resumeKeyNow.value = null;
    markStayOnSelect();
    trip.clear();
    router.push('/');
    return;
  }
  applyCalibration();
}

function refreshRailLine() {
  if (!railLine || !map) return;
  const coords = trip.railwayCoords;
  if (coords.length < 2) return;
  railLine.setPath(coords);
  pathMetrics = buildRailwayMetrics(coords);
  railLengthKm.value = pathMetrics.lengthKm;
  tick();
}

function refreshStationMarkers() {
  const seg = segment.value;
  if (!map || !seg) return;
  seg.stops.forEach((s, i) => {
    const marker = stationMarkers[i];
    if (!marker) return;
    if (s.lng == null || s.lat == null || !Number.isFinite(s.lng) || !Number.isFinite(s.lat)) {
      return;
    }
    marker.setPosition([s.lng, s.lat]);
    // 进图时无坐标的站未上图；补坐标后需要动态 map.add
    const onMap = typeof marker.getMap === 'function' ? marker.getMap() : null;
    if (!onMap) {
      map.add(marker);
      if (!prefs.layers.station) marker.hide();
    }
  });
  // 服务端补坐标 / unresolved 清单变化时，重建灰色占位标记
  rebuildUnresolvedMarkers();
}

/**
 * U1 面板操作（获取 / 重试 / 取消）结束后同步地图：折线 + 景点标记 + 视野 + 结果提示。
 * 终态才提示，避免进行中的每次刷新都弹 toast。
 */
function onPreciseRefresh() {
  refreshStationMarkers();
  refreshRailLine();
  rebuildSpotMarkers();
  if (trip.railwayCoords.length >= 2) {
    map?.setFitView(null, false, getMapPadding());
  }
  const st = trip.preciseJob?.status;
  if (trip.preciseError) {
    showToast(trip.preciseError);
    return;
  }
  if (st === 'done') {
    const tier = trip.preciseJob?.qualityTier;
    if (tier === 'soft') showToast('近似轨道已加载（跨站补缝）');
    else if (tier === 'corridor' || tier === 'network') showToast('精品精确路线已加载');
    else if (tier === 'local') showToast('本地轨网路线已加载');
    else showToast('精确路线已加载');
  } else if (st === 'partial') {
    showToast(trip.preciseJob?.message || '部分精确，缺口为示意');
  }
}

function onPageHidePersist() {
  void persistActiveTrip({ bumpOpenedAt: false, setResume: false });
}

function onVisibilityPersist() {
  if (document.visibilityState === 'hidden') {
    void persistActiveTrip({ bumpOpenedAt: false, setResume: false });
  }
}

function onWindowResize() {
  compact.value = window.matchMedia('(max-width: 640px)').matches;
  updateOverlayMetrics();
}

onMounted(async () => {
  try {
    await ensureTripLoaded();
    if (!trip.segment) return;
    resumeKeyNow.value = getAutoResumeTripKey();
    await initMap();
    window.addEventListener('pagehide', onPageHidePersist);
    document.addEventListener('visibilitychange', onVisibilityPersist);
    window.addEventListener('resize', onWindowResize, { passive: true });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '地图初始化失败';
  }
});

watch([now, gps, () => prefs.calibration, () => prefs.departureIso, () => prefs.layers], () => {
  tick();
  applyLayers();
});

watch(
  () => trip.railwayCoords,
  () => {
    refreshRailLine();
  },
  { deep: true },
);

/**
 * B1 景点签名：成员/顺序/方位/里程任一变化即重建标记层。
 * 用 id 为主键，避免每次轮询都整体重建（轮询只改 coords，不改景点集合）。
 */
watch(
  () =>
    trip.scenicSpots
      .map((s) => `${s.id}:${s.sideRuntime ?? s.side ?? ''}:${Math.round(s.progressKm ?? 0)}`)
      .join('|'),
  () => {
    rebuildSpotMarkers();
  },
);

watch(
  () => segment.value?.stops.map((s) => `${s.name}:${s.lng},${s.lat}`).join('|'),
  () => {
    refreshStationMarkers();
  },
);

watch(
  () => trip.unresolvedStops.join('|'),
  () => {
    rebuildUnresolvedMarkers();
  },
);

watch(approachingSpot, async () => {
  await nextTick();
  updateOverlayMetrics();
});

watch(legendOpen, async () => {
  await nextTick();
  updateOverlayMetrics();
});

watch(statusCollapsed, async () => {
  await nextTick();
  updateOverlayMetrics();
});

onUnmounted(() => {
  if (weatherFetchTimer) window.clearTimeout(weatherFetchTimer);
  bottomPanelObserver?.disconnect();
  bottomPanelObserver = null;
  window.removeEventListener('pagehide', onPageHidePersist);
  document.removeEventListener('visibilitychange', onVisibilityPersist);
  window.removeEventListener('resize', onWindowResize);
  void persistActiveTrip({ bumpOpenedAt: false, setResume: false });
  trip.stopPrecisePoll();
  map?.destroy?.();
});
</script>

<template>
  <div ref="pageEl" class="trip-page">
    <div ref="mapEl" id="map" class="map-root" />

    <div v-if="error" class="error-overlay show">
      <div class="error-card">
        <p>{{ error }}</p>
        <button type="button" class="btn primary" @click="goBackToSelect">返回选车</button>
      </div>
    </div>

    <template v-if="segment && schedule">
      <header class="top-bar">
        <div class="map-nav-actions">
          <button type="button" class="map-back-btn" @click="goBackToSelect">
            <span class="map-back-btn__icon" aria-hidden="true">‹</span>
            重选路线
          </button>
          <button
            v-if="!trip.isDemo"
            type="button"
            class="map-pin-trip-btn"
            :class="{ 'is-active': isPinnedCurrent }"
            @click="setAsCurrentTrip"
          >
            {{ isPinnedCurrent ? '取消当前行程' : '设为当前行程' }}
          </button>
          <button
            v-if="!trip.isDemo"
            type="button"
            class="map-new-trip-btn"
            @click="openStartNewTrip"
          >
            开始新行程
          </button>
        </div>
        <div class="top-bar__cluster">
          <div class="status-card" :class="{ 'is-collapsed': statusCollapsed }">
            <div class="status-head">
              <div class="status-identity">
                <span class="train-badge">{{ segment.trainCode }}</span>
                <span class="route-text">{{ segment.fromName }} → {{ segment.toName }}</span>
              </div>
              <time v-show="!statusCollapsed" class="clock">{{ clockText }}</time>
              <button
                type="button"
                class="status-collapse-btn"
                :aria-expanded="!statusCollapsed"
                :aria-label="statusCollapsed ? '展开行程面板' : '收起行程面板'"
                :title="statusCollapsed ? '展开' : '收起，少挡地图'"
                @click="toggleStatusCollapsed"
              >
                {{ statusCollapsed ? '展开' : '收起' }}
              </button>
            </div>

            <Transition name="status-expand">
              <div v-if="!statusCollapsed" class="status-body">
              <div class="status-progress" :aria-label="`行程进度 ${progressPct}%`">
                <div class="status-progress__track">
                  <div class="status-progress__bar" :style="{ transform: `scaleX(${progress})` }" />
                </div>
                <span class="status-progress__pct">{{ progressPct }}%</span>
              </div>

              <div class="status-meta">
                <button type="button" class="status-meta__item status-meta__item--btn" @click="openDepartEditor">
                  <span class="status-meta__k">发车</span>
                  <span class="status-meta__v">{{ formatDepartBadge(schedule.departure) }}</span>
                </button>
                <div
                  class="status-meta__item status-meta__item--mode"
                  :class="{ 'is-warn': !!modeParts.note }"
                  :title="mode"
                >
                  <span class="status-meta__k">定位</span>
                  <span
                    class="status-meta__v"
                    :class="{ 'status-meta__v--warn': !!modeParts.note }"
                  >{{ compact ? modeCompactLine : modeParts.main }}</span>
                  <span
                    v-if="!compact && modeParts.note"
                    class="status-meta__note"
                  >{{ modeParts.note }}</span>
                </div>
                <button
                  type="button"
                  class="calibrate-btn"
                  :class="{ 'is-active': !!prefs.calibration }"
                  :aria-expanded="calibrateOpen"
                  :title="prefs.calibration ? `已校准 · ${prefs.calibration.stationName}` : '站点校准'"
                  @click="calibrateOpen = !calibrateOpen"
                >
                  {{
                    prefs.calibration
                      ? `校准·${prefs.calibration.stationName}`
                      : compact
                        ? '校准'
                        : '站点校准'
                  }}
                </button>
              </div>

              <PreciseRoutePanel
                :length-km="railLengthKm"
                :spot-count="trip.scenicSpots.length"
                :compact="compact"
                @refresh="onPreciseRefresh"
              />
              <p v-if="trip.unresolvedStops.length" class="rail-unresolved-hint">
                {{ trip.unresolvedStops.join('、') }} 坐标待补，地图上为灰色近似占位
              </p>
              </div>
            </Transition>
          </div>

          <div v-if="calibrateOpen && !statusCollapsed" class="calibrate-popover">
            <div class="calibrate-popover__head">
              <span>站点校准</span>
              <span>{{ prefs.calibration ? `已校准·${prefs.calibration.stationName}` : '未校准' }}</span>
            </div>
            <p class="calibrate-panel__hint">到站后点选当前站，后续估算将整体平移（仅本机生效）。</p>
            <div class="calibrate-stations">
              <button
                v-for="s in getCalibratableStations(segment.stops)"
                :key="s.name"
                type="button"
                class="calibrate-station-btn"
                :class="{
                  'is-active': prefs.calibration?.stationName === s.name,
                  'is-near': isNearScheduledArrival(now, s, shifted),
                }"
                @click="openCalibrateConfirm(s)"
              >
                {{ s.name }}
              </button>
            </div>
            <button
              v-if="prefs.calibration"
              type="button"
              class="calibrate-clear"
              @click="prefs.setCalibration(null); showToast('已清除站点校准'); tick()"
            >
              清除校准
            </button>
          </div>
        </div>
      </header>

      <button type="button" class="locate-btn" @click="locateTrain">定位</button>
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
      <!-- 天象模式中：时间轴并入右侧控件列，避免再浮一条挡地图 -->
      <button
        v-if="skyMode && !skyPanelOpen"
        type="button"
        class="sky-timeline-btn"
        @click="openSkyPanel"
      >
        时间轴
      </button>
      <button
        type="button"
        class="sky-btn"
        :class="{ 'is-active': skyMode }"
        :aria-pressed="skyMode"
        :title="skyMode ? '关闭天象模式' : '打开天象观景'"
        @click="toggleSky"
      >
        天象
      </button>
      <div class="legend" :class="{ 'is-open': legendOpen }">
        <button
          v-for="layer in (['rail', 'station', 'spot', 'train', 'gps'] as const)"
          :key="layer"
          type="button"
          class="legend-item legend-item--toggle"
          :aria-pressed="prefs.layers[layer]"
          @click="prefs.setLayer(layer, !prefs.layers[layer])"
        >
          <i :class="layer" aria-hidden="true" />
          <span>{{
            { rail: '示意铁路', station: '经停站', spot: '风景', train: '列车估算', gps: '手机 GPS' }[
              layer
            ]
          }}</span>
        </button>
        <!-- 桌面默认不展开；手机即使用 legendOpen 也由 CSS 隐藏，避免挡主屏 -->
        <div v-if="legendOpen" class="legend-side">
          <span class="legend-side__title">车窗方位徽标（点开景点可见）</span>
          <SideBadge v-for="item in SIDE_LEGEND" :key="item.side" :side="item.side" compact />
          <SideBadge side="unknown" compact />
          <span class="legend-side__note">
            按本次车次行进方向判定；地图上的虚线空心点 = 方位待人工复核
          </span>
        </div>
      </div>

      <SkyJourneyPanel
        v-if="skyMode"
        :open="skyPanelOpen"
        :train-code="segment.trainCode"
        :from-name="segment.fromName"
        :to-name="segment.toName"
        :path="pathMetrics.path"
        :length-km="railLengthKm"
        :stops="segment.stops"
        :spots="trip.scenicSpots"
        :departure-ms="schedule.departure.getTime()"
        :arrival-ms="schedule.arrival.getTime()"
        :offset-ms="schedule.offsetMs"
        :compact="compact"
        @close="closeSkyPanel"
        @focus="onSkyFocus"
        @result="rebuildSkyOverlay"
      />

      <!-- 仅手机保留底栏短条；桌面用右侧「时间轴」+「天象」高亮，不再浮卡 -->
      <div v-if="skyMode && !skyPanelOpen && compact" class="sky-peek" role="status">
        <span class="sky-peek__kicker">{{ skyPeekKicker }}</span>
        <div class="sky-peek__actions">
          <button type="button" class="sky-peek__list" @click="openSkyPanel">时间轴</button>
          <button type="button" class="sky-peek__exit" @click="exitSkyMode">退出</button>
        </div>
      </div>

      <SpotApproachCard
        v-if="approachingSpot"
        ref="spotCardRef"
        :spot="approachingSpot"
        :current-km="currentKm"
        :compact="compact"
        :weather="approachingWeatherParts"
      />

      <!-- 过站美食与临近景点共用顶部通告位：景点通告有时效性且更该先看，仅它真的在屏上时让位 -->
      <StationFoodCard
        v-if="!spotToastVisible && approachingStationFood"
        ref="foodCardRef"
        :station="approachingStationFood.station"
        :food="approachingStationFood.food"
        :kicker="approachingStationFood.kicker"
        :seq="approachingStationFood.seq"
        :total="approachingStationFood.total"
        :compact="compact"
      />

      <!-- 走完本趟：把「留下这张票」递到眼前。顶部通告位有卡（景点 / 过站美食）时它先让位：
           短屏（1280×720 一类）通告位到底栏之间只剩一两百像素，同屏必然叠字。 -->
      <TicketFinishCard
        v-if="finishVisible && !spotToastVisible && !foodToastVisible"
        :title="finishTitle"
        :compact="compact"
        @primary="goFinishTicket"
        @dismiss="dismissFinish"
      />

      <footer class="bottom-panel">
        <section class="location-card">
          <div class="location-card__head">
            <h2>当前位置</h2>
            <span
              class="location-mode"
              :class="{ 'is-schedule': mode.includes('时刻表') }"
              :title="modeParts.note ? mode : undefined"
            >
              {{ modeParts.main }}
            </span>
          </div>
          <div class="location-segment">{{ locationInfo.segment }}</div>
          <div v-if="locationInfo.meta" class="location-meta">{{ locationInfo.meta }}</div>
        </section>
        <div class="panel-divider" />
        <section class="upcoming-card">
          <div class="bottom-panel__head">
            <h2>{{ upcomingTitle }}</h2>
          </div>
          <div class="next-name-row">
            <div class="next-name">{{ upcoming?.name || '—' }}</div>
            <SideBadge
              v-if="upcoming?.kind === 'spot' && upcoming.side"
              :side="upcoming.side"
              :dist-km="upcoming.distKm"
              :needs-review="upcoming.sideNeedsReview"
              :low="upcoming.sideLow"
              compact
              text-only
            />
          </div>
          <div
            v-if="upcoming?.kind === 'spot' && (upcoming.bestTime || upcoming.distText)"
            class="next-tags"
          >
            <span v-if="upcoming.bestTime" class="next-tag next-tag--best">{{ upcoming.bestTime }}</span>
            <span v-if="upcoming.distText" class="next-tag next-tag--dist">{{ upcoming.distText }}</span>
          </div>
          <div v-if="upcomingMetaLine" class="next-meta">{{ upcomingMetaLine }}</div>
          <div v-if="upcomingFood" class="next-food">
            <div class="next-food__head">
              <span class="next-food__label">本站风味</span>
              <span class="next-food__place">{{ upcomingFood.city }}{{ upcomingFood.tag ? ` · ${upcomingFood.tag}` : '' }}</span>
            </div>
            <div class="next-food__list">
              <span v-for="dish in upcomingFood.dishes" :key="dish.name" class="next-food__chip">
                {{ dish.name }}
              </span>
            </div>
          </div>
          <!-- 下车站玩法：路书库里这一地的线路，到站就能翻攻略（与「本站风味」同一套 chip 行密度） -->
          <div v-if="destGuideList.length" class="next-guide">
            <div class="next-guide__head">
              <span class="next-guide__label">下车玩法</span>
              <span class="next-guide__scope">{{ destGuideScope }}</span>
            </div>
            <div class="next-guide__list">
              <RouterLink
                v-for="r in destGuideList"
                :key="r.id"
                class="next-guide__chip"
                :to="`/roadbook/${r.id}`"
                :title="destGuideMeta(r)"
              >
                {{ r.name }}
              </RouterLink>
              <RouterLink
                class="next-guide__chip next-guide__chip--more"
                :to="{ path: '/roadbook', query: { q: destGuides?.place.city } }"
              >
                查看全部 ›
              </RouterLink>
            </div>
          </div>
          <div v-if="upcoming?.wx" class="wx-strip">
            <div class="wx-strip__main">
              <span class="wx-strip__emoji" aria-hidden="true">{{ upcoming.wx.emoji }}</span>
              <span v-if="upcoming.wx.cond" class="wx-strip__cond">{{ upcoming.wx.cond }}</span>
              <span v-if="upcoming.wx.temp" class="wx-strip__temp">{{ upcoming.wx.temp }}</span>
            </div>
            <span
              v-if="upcoming.wx.hint"
              class="wx-strip__hint"
              :class="wxHintClass(upcoming.wx.viewHint)"
            >{{ upcoming.wx.hint }}</span>
            <span v-else-if="upcoming.wx.vis" class="wx-strip__vis">{{ upcoming.wx.vis }}</span>
          </div>
          <div class="progress-track" role="progressbar" :aria-valuenow="progressPct" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar" :style="{ transform: `scaleX(${progress})` }" />
          </div>
          <div class="progress-foot">
            <span>全程进度</span>
            <span class="progress-foot__pct">{{ progressPct }}%</span>
          </div>
        </section>
      </footer>
    </template>

    <div v-if="departOpen" class="schedule-dialog">
      <div class="schedule-dialog__backdrop" @click="departOpen = false" />
      <div class="schedule-dialog__card schedule-dialog__card--wide">
        <h3>修改发车时间</h3>
        <p class="schedule-dialog__hint">按实际发车时刻校准，地图进度与估算位置会同步更新。</p>
        <div class="schedule-dialog__field">
          <span>发车时间</span>
          <DarkDateTimeField v-model="departInput" mode="datetime" inline />
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" @click="resetDeparture">恢复默认</button>
          <button type="button" class="btn ghost" @click="departOpen = false">取消</button>
          <button type="button" class="btn primary" @click="saveDeparture">保存</button>
        </div>
      </div>
    </div>

    <div v-if="confirmOpen" class="schedule-dialog">
      <div class="schedule-dialog__backdrop" @click="confirmOpen = false" />
      <div class="schedule-dialog__card">
        <h3 v-if="confirmMode === 'newTrip'">开始新行程？</h3>
        <p style="white-space: pre-wrap">{{ confirmText }}</p>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" @click="confirmOpen = false">取消</button>
          <button type="button" class="btn primary" @click="confirmDialogAction">
            {{ confirmMode === 'newTrip' ? '确认开始新行程' : '确认校准' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
