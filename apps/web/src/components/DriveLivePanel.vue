<script setup lang="ts">
/**
 * 「我在哪」实时面板（主功能 C3，PRD §5.4）：由 v0.3.0 的独立页 DriveNav.vue
 * 改造为嵌进 DriveTrip 的面板。小确幸雷达 + 轨迹记录 + 车速带规则全部复用 v1：
 *   >80km/h 只推 worthSlowDown；40~80 推 worthSlowDown + canPark；<40 只推 canPark
 *   前视距离 clamp(speedKmh × 0.05, 3, 15) km
 */
import { computed, ref, watch } from 'vue';
import { highlightLabel } from '../data/highlightColors';
import { pointOnRoute, useDriveRadar } from '../composables/useDriveRadar';
import { useTrackRecorder } from '../composables/useTrackRecorder';
import type { DriveHighlight, DriveRoute } from '@railvista/shared';

const props = defineProps<{
  route: DriveRoute;
  highlights: DriveHighlight[];
}>();

const progress = defineModel<number>('progress', { default: 0 });
const speedKmh = defineModel<number>('speedKmh', { default: 60 });

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

const { radar, simulate } = useDriveRadar(routeRef, highlightsRef);
const recorder = useTrackRecorder(props.route.id);
const { recording, track } = recorder;

const currentChapter = computed(() => {
  const r = props.route;
  const km = progress.value * r.totalKm;
  return r.chapters.find((c) => km >= c.fromKm && km < c.toKm)?.title ?? '';
});

const bandLabel = computed(() => {
  const b = radar.value?.band;
  return b === 'fast' ? '巡航 · 高速' : b === 'slow' ? '低速 · 可停车' : '巡航';
});

watch([progress, speedKmh], () => {
  simulate(progress.value, speedKmh.value);
  if (recorder.recording.value) feedTrack();
});

function feedTrack() {
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
    feedTrack();
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
      <span class="drive-speed__value">{{ speedKmh }}</span>
      <span class="drive-speed__unit">km/h</span>
      <span class="drive-speed__band" :class="'drive-speed__band--' + (radar?.band ?? 'cruise')">{{ bandLabel }}</span>
    </div>

    <div class="drive-actions">
      <button type="button" class="btn" :class="{ primary: !recording }" @click="toggleRecord">
        {{ recording ? '结束记录轨迹' : '开始记录轨迹' }}
      </button>
      <span v-if="recording" class="drive-route-card__meta" style="align-self: center">
        已记 {{ track?.points.length ?? 0 }} 个关键点 · 打卡 {{ track?.checkinCount ?? 0 }} 处
      </span>
    </div>

    <!-- 模拟控制（Web 预览 / 验收 #9：?progress=0.36&speed=60） -->
    <div class="drive-progress" style="margin-top: 8px">
      <label class="drive-stat__label" for="drive-live-progress">模拟进度（Web 预览）</label>
      <input
        id="drive-live-progress"
        v-model.number="progress"
        type="range"
        min="0"
        max="1"
        step="0.01"
        style="width: 100%"
      />
      <div class="drive-actions">
        <button
          v-for="s in speedOptions"
          :key="s"
          type="button"
          class="btn btn-sm"
          :class="{ primary: speedKmh === s }"
          @click="speedKmh = s"
        >
          {{ s }}
        </button>
      </div>
    </div>
  </section>
</template>
