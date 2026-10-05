<script setup lang="ts">
/**
 * 「我在哪」实时面板（主功能 C3，PRD §5.4）：由 v0.3.0 的独立页 DriveNav.vue
 * 改造为嵌进 DriveTrip 的面板。小确幸雷达 + 轨迹记录 + 车速带规则全部复用 v1：
 *   >80km/h 只推 worthSlowDown；40~80 推 worthSlowDown + canPark；<40 只推 canPark
 *   前视距离 clamp(speedKmh × 0.05, 3, 15) km
 *
 * 进度来源：
 *   1. GPS（默认）：watchPosition → 投影到折线 → 推进 progress / 左侧进度条
 *   2. 模拟滑条：无定位或主动拖动时回退到 Web 预览
 */
import { computed, ref, watch } from 'vue';
import { highlightLabel } from '../data/highlightColors';
import { pointOnRoute, useDriveRadar } from '../composables/useDriveRadar';
import { useGeolocation } from '../composables/useGeolocation';
import { useTrackRecorder } from '../composables/useTrackRecorder';
import type { DriveHighlight, DriveRoute } from '@railvista/shared';

const props = defineProps<{
  route: DriveRoute;
  highlights: DriveHighlight[];
}>();

const progress = defineModel<number>('progress', { default: 0 });
const speedKmh = defineModel<number>('speedKmh', { default: 60 });

/** 偏离路线超过此阈值（米）时不推进进度，避免城市里误投影 */
const OFF_ROUTE_MAX_M = 5000;

const routeRef = ref<DriveRoute | null>(props.route);
const highlightsRef = ref<DriveHighlight[]>(props.highlights);
watch(
  () => props.route,
  (r) => {
    routeRef.value = r;
  },
);
watch(
  () => props.highlights,
  (h) => {
    highlightsRef.value = h;
  },
);

const { radar, update, simulate } = useDriveRadar(routeRef, highlightsRef);
const { gps, available: gpsAvailable } = useGeolocation();
const recorder = useTrackRecorder(props.route.id);
const { recording, track } = recorder;

/** gps = 定位推进；sim = 手动/预览 */
const trackingSource = ref<'gps' | 'sim'>('gps');

const currentChapter = computed(() => {
  const r = props.route;
  const km = progress.value * r.totalKm;
  return r.chapters.find((c) => km >= c.fromKm && km < c.toKm)?.title ?? '';
});

const bandLabel = computed(() => {
  const b = radar.value?.band;
  return b === 'fast' ? '巡航 · 高速' : b === 'slow' ? '低速 · 可停车' : '巡航';
});

const gpsStatus = computed(() => {
  if (!gpsAvailable.value && !gps.value) return 'waiting' as const;
  if (!gps.value) return 'denied' as const;
  const off = radar.value?.offRouteM;
  if (off != null && off > OFF_ROUTE_MAX_M) return 'offroute' as const;
  if (trackingSource.value === 'gps') return 'live' as const;
  return 'paused' as const;
});

const gpsStatusText = computed(() => {
  switch (gpsStatus.value) {
    case 'live':
      return 'GPS 跟随中';
    case 'paused':
      return '已暂停跟随 · 使用模拟进度';
    case 'offroute':
      return `偏离路线约 ${Math.round((radar.value?.offRouteM ?? 0) / 1000)} km，未推进`;
    case 'denied':
      return '定位不可用（需授权，且 HTTPS / localhost）';
    default:
      return '正在获取定位…';
  }
});

watch(gps, (sample) => {
  if (!sample || !props.route.totalKm) return;
  update({
    lng: sample.lng,
    lat: sample.lat,
    speedMs: sample.speed,
    heading: sample.heading,
  });
  const r = radar.value;
  if (!r) return;

  // 偏离太远：只更新雷达偏离态，不抢进度
  if (r.offRouteM > OFF_ROUTE_MAX_M) return;

  trackingSource.value = 'gps';
  progress.value = Math.max(0, Math.min(1, r.alongKm / props.route.totalKm));
  if (sample.speed != null && sample.speed >= 0) {
    speedKmh.value = Math.max(0, Math.round(sample.speed * 3.6));
  }
  if (recorder.recording.value) {
    recorder.feed({
      lng: sample.lng,
      lat: sample.lat,
      ts: sample.timestamp,
      speedKmh: speedKmh.value,
      heading: sample.heading,
      alongKm: Math.round(r.alongKm * 10) / 10,
    });
  }
});

watch([progress, speedKmh], () => {
  // GPS 推进时由 update() 维护雷达；模拟才用折线上的虚拟点
  if (trackingSource.value === 'gps' && gps.value) return;
  simulate(progress.value, speedKmh.value);
  if (recorder.recording.value) feedTrackSim();
});

function feedTrackSim() {
  const r = props.route;
  const p = pointOnRoute(r, progress.value);
  recorder.feed({
    lng: p.lng,
    lat: p.lat,
    ts: Date.now(),
    speedKmh: speedKmh.value,
    heading: p.heading,
    alongKm: Math.round(progress.value * r.totalKm * 10) / 10,
  });
}

function toggleRecord() {
  const r = props.route;
  if (recorder.recording.value) {
    recorder.finish();
  } else {
    recorder.start(props.highlights, r.chapters);
    if (trackingSource.value === 'gps' && gps.value && radar.value) {
      recorder.feed({
        lng: gps.value.lng,
        lat: gps.value.lat,
        ts: gps.value.timestamp,
        speedKmh: speedKmh.value,
        heading: gps.value.heading,
        alongKm: Math.round(radar.value.alongKm * 10) / 10,
      });
    } else {
      feedTrackSim();
    }
  }
}

function onSimProgressInput() {
  trackingSource.value = 'sim';
}

function resumeGps() {
  trackingSource.value = 'gps';
  if (gps.value) {
    update({
      lng: gps.value.lng,
      lat: gps.value.lat,
      speedMs: gps.value.speed,
      heading: gps.value.heading,
    });
    if (radar.value && radar.value.offRouteM <= OFF_ROUTE_MAX_M && props.route.totalKm) {
      progress.value = Math.max(0, Math.min(1, radar.value.alongKm / props.route.totalKm));
    }
  }
}

const speedOptions = [20, 40, 60, 80, 100, 120];
</script>

<template>
  <section class="drive-live">
    <div class="drive-navbar">
      <span class="drive-navbar__title">{{ currentChapter || route.name }}</span>
      <span class="drive-navbar__milepost">
        {{ radar ? radar.alongKm.toFixed(1) : (progress * route.totalKm).toFixed(1) }} / {{ Math.round(route.totalKm) }} km
      </span>
    </div>

    <p class="drive-live__gps" :data-status="gpsStatus">{{ gpsStatusText }}</p>

    <div v-if="radar?.primary" class="drive-radar-card">
      <div class="drive-radar-card__distance">
        {{ radar.primary.aheadKm >= 1 ? radar.primary.aheadKm.toFixed(1) + ' 公里' : Math.round(radar.primary.aheadKm * 1000) + ' 米' }}
      </div>
      <div class="drive-radar-card__name">前方 · {{ radar.primary.highlight.name }}</div>
      <div class="drive-radar-card__meta">
        {{ radar.primary.sideText || '前方' }} · {{ highlightLabel(radar.primary.highlight.category) }}
        <template v-if="radar.primary.highlight.walkMinutes"> · 停车走 {{ radar.primary.highlight.walkMinutes }} 分钟</template>
      </div>
      <div class="drive-radar-card__intro">{{ radar.primary.highlight.intro }}</div>
    </div>
    <div v-else class="drive-radar-card is-empty">
      <div class="drive-radar-card__name">前方暂无可推送的景点</div>
      <div class="drive-radar-card__meta">继续行驶，惊喜在路上</div>
    </div>

    <div v-if="radar?.secondary" class="drive-radar-card" style="box-shadow: none; border-color: var(--line-default)">
      <div class="drive-radar-card__meta">下一个 · 前方 {{ radar.secondary.aheadKm.toFixed(1) }} 公里</div>
      <div class="drive-radar-card__name" style="font-size: var(--fs-h3)">{{ radar.secondary.highlight.name }}</div>
    </div>

    <div class="drive-progress">
      <div class="drive-progress__track">
        <div class="drive-progress__bar" :style="{ width: (progress * 100).toFixed(1) + '%' }" />
      </div>
      <div class="drive-progress__meta">
        <span>{{ (progress * 100).toFixed(0) }}%</span>
        <span>{{ route.provinces.join(' · ') }}</span>
      </div>
    </div>

    <div class="drive-speed">
      <span class="drive-speed__value">{{ Math.round(speedKmh) }}</span>
      <span class="drive-speed__unit">km/h</span>
      <span class="drive-speed__band" :class="'drive-speed__band--' + (radar?.band ?? 'cruise')">{{ bandLabel }}</span>
    </div>

    <div class="drive-actions">
      <button type="button" class="btn" :class="{ primary: !recording }" @click="toggleRecord">
        {{ recording ? '结束记录轨迹' : '开始记录轨迹' }}
      </button>
      <button
        v-if="gpsStatus === 'paused' || gpsStatus === 'offroute'"
        type="button"
        class="btn ghost btn-sm"
        @click="resumeGps"
      >
        恢复 GPS 跟随
      </button>
      <span v-if="recording" class="drive-route-card__meta" style="align-self: center">
        已记 {{ track?.points.length ?? 0 }} 个关键点 · 打卡 {{ track?.checkinCount ?? 0 }} 处
      </span>
    </div>

    <!-- 模拟控制：无定位 / 预览验收（?progress=0.36&speed=60） -->
    <div class="drive-progress" style="margin-top: 8px">
      <label class="drive-stat__label" for="drive-live-progress">
        {{ gpsStatus === 'live' ? '模拟进度（拖动将暂停 GPS 跟随）' : '模拟进度（Web 预览）' }}
      </label>
      <input
        id="drive-live-progress"
        v-model.number="progress"
        type="range"
        min="0"
        max="1"
        step="0.01"
        style="width: 100%"
        @pointerdown="onSimProgressInput"
        @input="onSimProgressInput"
      />
      <div class="drive-actions">
        <button
          v-for="s in speedOptions"
          :key="s"
          type="button"
          class="btn btn-sm"
          :class="{ primary: Math.round(speedKmh) === s }"
          @click="speedKmh = s; onSimProgressInput()"
        >
          {{ s }}
        </button>
      </div>
    </div>
  </section>
</template>
