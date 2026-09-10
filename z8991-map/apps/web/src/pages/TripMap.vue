<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  buildRailwayMetrics,
  computeCalibrationOffset,
  formatDepartBadge,
  formatOffsetLabel,
  formatSpotTimeLabel,
  formatStationSchedule,
  formatTime,
  getCalibratableStations,
  getStationAnchorTime,
  getUpcoming,
  isNearScheduledArrival,
  pointAtProgress,
  resolveProgress,
  resolveSchedule,
  shiftDate,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
  type CalibrationRecord,
  type Stop,
} from '@railvista/shared';
import { api } from '../api/client';
import { loadAmap } from '../map/amap';
import { readSimulatedProgress, useGeolocation, useNow } from '../composables/useGeolocation';
import { usePrefsStore } from '../stores/prefsStore';
import { useTripStore } from '../stores/tripStore';

const route = useRoute();
const router = useRouter();
const trip = useTripStore();
const prefs = usePrefsStore();
const { gps, available: gpsAvailable } = useGeolocation();
const now = useNow();

const mapEl = ref<HTMLElement | null>(null);
const error = ref('');
const compact = ref(false);
const progress = ref(0);
const mode = ref('时刻表估算');
const legendOpen = ref(false);
const calibrateOpen = ref(false);
const departOpen = ref(false);
const departInput = ref('');
const confirmOpen = ref(false);
const confirmText = ref('');
const pendingStation = ref<Stop | null>(null);
const toast = ref('');
let toastTimer: number | undefined;

let map: any;
let railLine: any;
let trainMarker: any;
let gpsMarker: any;
let spotMarkers: any[] = [];
let stationMarkers: any[] = [];
let pathMetrics = { path: [] as ReturnType<typeof buildRailwayMetrics>['path'], lengthKm: 0 };

const segment = computed(() => trip.segment);
const schedule = computed(() => {
  const seg = segment.value;
  if (!seg) return null;
  return resolveSchedule(seg.baseDepartureIso, seg.baseArrivalIso, prefs.departureIso);
});

const shifted = (iso: string) => shiftDate(iso, schedule.value?.offsetMs || 0);

function showToast(msg: string) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = '';
  }, 2800);
}

async function ensureTripLoaded() {
  if (trip.segment) {
    prefs.loadForCurrentTrip();
    return;
  }
  const trainCode = String(route.query.trainCode || '');
  const date = String(route.query.date || '');
  const from = String(route.query.from || '');
  const to = String(route.query.to || '');
  if (route.query.demo === '1' || /^Z8991$/i.test(trainCode)) {
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
    trip.setTrip({
      trainCode: preset.meta.train,
      trainNo: preset.meta.trainNo || 'demo',
      date: date || preset.meta.date || '2026-08-11',
      fromName: from || preset.meta.from,
      toName: to || preset.meta.to,
      stops: demoStops,
      spots: (preset.scenicSpots || []).map((s) => ({
        id: String(s.id),
        name: s.name,
        lng: s.lng,
        lat: s.lat,
        intro: s.intro,
        timeLabel: s.timeLabel,
        at: s.at,
        nightOnly: s.nightOnly,
        source: 'preset' as const,
        trainCode: 'Z8991',
      })),
      preciseRailway: (preset.railway as [number, number][] | undefined) || null,
    });
    prefs.loadForCurrentTrip();
    return;
  }
  if (!trainCode || !date || !from || !to) {
    router.replace('/');
    return;
  }
  throw new Error('行程未加载，请从选车页重新进入');
}

function updateOverlayMetrics() {
  const top = document.querySelector('.top-bar')?.getBoundingClientRect().height || 72;
  const bottom = document.querySelector('.bottom-panel')?.getBoundingClientRect().height || 118;
  document.documentElement.style.setProperty('--top-overlay', `${Math.ceil(top) + 16}px`);
  document.documentElement.style.setProperty('--bottom-overlay', `${Math.ceil(bottom) + 12}px`);
  map?.resize();
}

function getMapPadding() {
  const side = compact.value ? 20 : 48;
  const top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--top-overlay'), 10) || 72;
  const bottom =
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bottom-overlay'), 10) || 118;
  return [top, side, bottom, side];
}

function tick() {
  const seg = segment.value;
  const sch = schedule.value;
  if (!seg || !sch) return;
  const forceSchedule = pathMetrics.path.length < 2;
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
  });
  progress.value = result.progress;
  mode.value = result.mode;
  const point = pointAtProgress(pathMetrics.path, pathMetrics.lengthKm, result.progress);
  if (trainMarker) trainMarker.setPosition([point.lng, point.lat]);
  if (gpsMarker) {
    const g = gps.value;
    const stale = !gpsAvailable.value || !g || Date.now() - g.timestamp > 120000;
    if (stale || !prefs.layers.gps) gpsMarker.hide();
    else {
      gpsMarker.setPosition([g!.lng, g!.lat]);
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
  });
  const spot = trip.scenicSpots.find((s) => s.name === u.name);
  const timeLabel = spot?.at
    ? formatSpotTimeLabel(spot.timeLabel, shifted(spot.at))
    : u.timeLabel;
  return { ...u, timeLabel };
});

const locationInfo = computed(() => {
  const seg = segment.value;
  if (!seg) return { segment: '', meta: '' };
  const pct = Math.round(progress.value * 100);
  const km = pathMetrics.lengthKm;
  if (progress.value <= 0) {
    return {
      segment: `${seg.fromName}站 · 尚未发车`,
      meta: `全程约 ${Math.round(km)} 公里 · 进度 ${pct}%`,
    };
  }
  if (progress.value >= 1) {
    return {
      segment: `${seg.toName}站 · 已到达`,
      meta: `全程 ${Math.round(km)} 公里 · 进度 100%`,
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
    meta: `已行约 ${Math.round(progress.value * km)} km · 剩余 ${Math.round((1 - progress.value) * km)} km · ${pct}%`,
  };
});

const clockText = computed(() =>
  compact.value
    ? now.value.toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : now.value.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'numeric',
        day: 'numeric',
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
  if (trainMarker) prefs.layers.train ? trainMarker.show() : trainMarker.hide();
}

async function initMap() {
  const key = import.meta.env.VITE_AMAP_KEY;
  if (!key) {
    error.value = '请配置 VITE_AMAP_KEY（apps/web/.env）';
    return;
  }
  const AMap = await loadAmap(key, import.meta.env.VITE_AMAP_SECURITY);
  const seg = segment.value!;
  const coords =
    trip.railwayCoords.length >= 2
      ? trip.railwayCoords
      : seg.stops
          .filter((s) => s.lng != null && s.lat != null)
          .map((s) => [s.lng!, s.lat!] as [number, number]);
  pathMetrics = buildRailwayMetrics(coords);
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
    mapStyle: 'amap://styles/grey',
  });

  if (coords.length >= 2) {
    railLine = new AMap.Polyline({
      path: coords,
      strokeColor: '#38bdf8',
      strokeWeight: compact.value ? 4 : 5,
      strokeOpacity: 0.85,
      lineJoin: 'round',
    });
    map.add(railLine);
  }

  spotMarkers = trip.scenicSpots.map((spot, idx) => {
    const marker = new AMap.Marker({
      position: [spot.lng, spot.lat],
      title: spot.name,
      anchor: 'bottom-center',
      content: `<div class="spot-marker${compact.value ? ' spot-marker--compact' : ''}">${spot.id || idx + 1}</div>`,
    });
    marker.on('click', () => {
      const label = spot.at ? formatSpotTimeLabel(spot.timeLabel, shifted(spot.at)) : spot.timeLabel || '';
      const info = new AMap.InfoWindow({
        content: `<div style="max-width:min(280px,78vw);padding:6px 4px;font-size:14px;line-height:1.5;color:#334155;">
          <strong style="color:#111827;font-size:15px;">${spot.name}</strong><br/>
          <span style="color:#0369a1;font-weight:600;">${label}</span><br/>
          <span style="color:#64748b;">${spot.intro || ''}</span>
        </div>`,
        offset: new AMap.Pixel(0, -28),
      });
      info.open(map, marker.getPosition());
    });
    map.add(marker);
    return marker;
  });

  stationMarkers = seg.stops.map((s) => {
    const marker = new AMap.Marker({
      position: [s.lng!, s.lat!],
      title: s.name,
      content: `<div class="station-marker${compact.value ? ' station-marker--compact' : ''}"><span class="station-dot"></span><span class="station-label">${s.name}</span></div>`,
      anchor: 'center',
      zIndex: 150,
    });
    marker.on('click', () => {
      const scheduleText = formatStationSchedule(s, shifted);
      const calibrateBtn =
        getCalibratableStations([s]).length > 0
          ? `<br/><button type="button" class="info-calibrate-btn" data-station="${s.name}">我在 ${s.name} 站</button>`
          : '';
      const info = new AMap.InfoWindow({
        content: `<div style="max-width:min(260px,78vw);padding:6px 4px;font-size:14px;line-height:1.5;color:#334155;">
          <strong style="color:#111827;font-size:15px;">${s.name}</strong><br/>
          <span style="color:#0369a1;font-weight:600;">${scheduleText}</span>
          ${s.intro ? `<br/><span style="color:#64748b;">${s.intro}</span>` : ''}${calibrateBtn}
        </div>`,
        offset: new AMap.Pixel(0, -20),
      });
      info.open(map, marker.getPosition());
    });
    if (s.lng != null && s.lat != null) map.add(marker);
    return marker;
  });

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

  map.getContainer().addEventListener('click', (event: MouseEvent) => {
    const btn = (event.target as HTMLElement).closest?.('[data-station]') as HTMLElement | null;
    if (!btn) return;
    const station = seg.stops.find((item) => item.name === btn.dataset.station);
    if (station) openCalibrateConfirm(station);
  });

  applyLayers();
  await nextTick();
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
  trip.clear();
  router.push('/');
}

onMounted(async () => {
  try {
    await ensureTripLoaded();
    await initMap();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '地图初始化失败';
  }
});

watch([now, gps, () => prefs.calibration, () => prefs.departureIso, () => prefs.layers], () => {
  tick();
  applyLayers();
});

onUnmounted(() => {
  map?.destroy?.();
});
</script>

<template>
  <div class="trip-page">
    <div ref="mapEl" id="map" class="map-root" />

    <div v-if="error" class="error-overlay show">
      <div class="error-card">
        <p>{{ error }}</p>
        <button type="button" class="btn primary" @click="goBackToSelect">返回选车</button>
      </div>
    </div>

    <template v-if="segment && schedule">
      <header class="top-bar">
        <button type="button" class="map-back-btn" @click="goBackToSelect">
          <span class="map-back-btn__icon" aria-hidden="true">‹</span>
          重选路线
        </button>
        <div class="top-bar__cluster">
          <div class="status-card">
            <div class="status-row status-row--primary">
              <span class="train-badge">{{ segment.trainCode }}</span>
              <span class="route-text">{{ segment.fromName }} → {{ segment.toName }}</span>
              <button type="button" class="depart-text" @click="openDepartEditor">
                {{ formatDepartBadge(schedule.departure) }}
              </button>
              <button
                type="button"
                class="calibrate-btn"
                :class="{ 'is-active': !!prefs.calibration }"
                @click="calibrateOpen = !calibrateOpen"
              >
                校准
              </button>
              <time class="clock">{{ clockText }}</time>
            </div>
            <div class="status-row status-row--secondary">
              <span>进度 <strong>{{ Math.round(progress * 100) }}%</strong></span>
              <span class="status-divider">·</span>
              <span>定位 <strong>{{ mode }}</strong></span>
            </div>
            <p class="rail-hint">{{ trip.polylineHint }}</p>
          </div>

          <div v-if="calibrateOpen" class="calibrate-popover">
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
      <button type="button" class="legend-toggle" @click="legendOpen = !legendOpen">图例</button>
      <div class="legend" :class="{ 'is-open': legendOpen }">
        <button
          v-for="layer in (['rail', 'station', 'spot', 'train', 'gps'] as const)"
          :key="layer"
          type="button"
          class="legend-item legend-item--toggle"
          :aria-pressed="prefs.layers[layer]"
          @click="prefs.setLayer(layer, !prefs.layers[layer])"
        >
          {{
            { rail: '示意铁路', station: '经停站', spot: '风景', train: '列车估算', gps: '手机 GPS' }[
              layer
            ]
          }}
        </button>
      </div>

      <footer class="bottom-panel">
        <section class="location-card">
          <div class="location-card__head">
            <h2>当前位置</h2>
            <span class="location-mode" :class="{ 'is-schedule': mode.includes('时刻表') }">{{ mode }}</span>
          </div>
          <div class="location-segment">{{ locationInfo.segment }}</div>
          <div class="location-meta">{{ locationInfo.meta }}</div>
        </section>
        <div class="panel-divider" />
        <section class="upcoming-card">
          <div class="bottom-panel__head">
            <h2>{{ progress >= 1 ? '已到达' : progress <= 0 ? '发车后首站' : '即将到达' }}</h2>
            <span class="progress-text">{{ Math.round(progress * 100) }}%</span>
          </div>
          <div class="next-name">{{ upcoming?.name }}</div>
          <div class="next-meta">
            <template v-if="upcoming?.timeLabel">计划 {{ upcoming.timeLabel }} · </template>
            {{ upcoming?.reason }}
          </div>
          <div class="progress-track"><div class="progress-bar" :style="{ width: `${progress * 100}%` }" /></div>
        </section>
      </footer>
    </template>

    <div v-if="departOpen" class="schedule-dialog">
      <div class="schedule-dialog__backdrop" @click="departOpen = false" />
      <div class="schedule-dialog__card">
        <h3>修改发车时间</h3>
        <input v-model="departInput" type="datetime-local" />
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
        <p style="white-space: pre-wrap">{{ confirmText }}</p>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" @click="confirmOpen = false">取消</button>
          <button type="button" class="btn primary" @click="applyCalibration">确认校准</button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
