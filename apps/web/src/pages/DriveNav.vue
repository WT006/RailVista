<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client';
import AppTopBar from '../components/AppTopBar.vue';
import AppNavLinks from '../components/AppNavLinks.vue';
import { highlightColor, highlightLabel } from '../data/highlightColors';
import { useDriveRadar, pointOnRoute } from '../composables/useDriveRadar';
import { useTrackRecorder } from '../composables/useTrackRecorder';
import type { DriveHighlight, DriveRoute } from '@railvista/shared';

const route = useRoute();
const routeId = String(route.params.routeId);

const routeRef = ref<DriveRoute | null>(null);
const highlightsRef = ref<DriveHighlight[]>([]);
const loading = ref(true);
const error = ref('');

const progress = ref(0);
const speedKmh = ref(60);

const { radar, simulate } = useDriveRadar(routeRef, highlightsRef);
const recorder = useTrackRecorder(routeId);
const { recording, track } = recorder;

const currentChapter = computed(() => {
  const r = routeRef.value;
  if (!r) return '';
  const km = progress.value * r.totalKm;
  const ch = r.chapters.find((c) => km >= c.fromKm && km < c.toKm);
  return ch?.title ?? '';
});

const activeAlert = computed(() => {
  const r = routeRef.value;
  if (!r || !radar.value) return null;
  const km = radar.value.alongKm;
  return r.alerts.find((a) => km >= a.fromKm && km <= a.toKm) ?? null;
});

const bandLabel = computed(() => {
  const b = radar.value?.band;
  return b === 'fast' ? '巡航 · 高速' : b === 'slow' ? '低速 · 可停车' : '巡航';
});

onMounted(async () => {
  try {
    const d = await api.getDriveRoute(routeId);
    routeRef.value = d.route;
    highlightsRef.value = d.highlights;
    // 读取调试参数：?progress=0.5&speed=92
    const p = Number(new URLSearchParams(location.search).get('progress'));
    const s = Number(new URLSearchParams(location.search).get('speed'));
    if (Number.isFinite(p)) progress.value = Math.max(0, Math.min(1, p));
    if (Number.isFinite(s)) speedKmh.value = s;
    simulate(progress.value, speedKmh.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
});

watch([progress, speedKmh], () => {
  simulate(progress.value, speedKmh.value);
  if (recorder.recording.value) feedTrack();
});

function feedTrack() {
  const r = routeRef.value;
  if (!r) return;
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
  const r = routeRef.value;
  if (!r) return;
  if (recorder.recording.value) {
    recorder.finish();
  } else {
    recorder.start(highlightsRef.value, r.chapters);
    feedTrack();
  }
}

const speedOptions = [20, 40, 60, 80, 100, 120];
</script>

<template>
  <div class="drive-page">
    <AppTopBar>
      <template #nav><AppNavLinks /></template>
    </AppTopBar>

    <main class="rv-shell">
      <div v-if="loading" class="drive-empty">正在启动伴随导航…</div>
      <div v-else-if="error || !routeRef" class="drive-empty">{{ error || '未找到该线路' }}</div>

      <template v-else>
        <div class="drive-navbar">
          <span class="drive-navbar__title">{{ currentChapter || routeRef.name }}</span>
          <span class="drive-navbar__milepost">
            {{ radar ? radar.alongKm.toFixed(1) : 0 }} / {{ routeRef.totalKm }} km
          </span>
        </div>

        <div class="drive-radar">
          <div v-if="radar?.primary" class="drive-radar-card">
            <div class="drive-radar-card__distance">
              {{ radar.primary.aheadKm >= 1 ? radar.primary.aheadKm.toFixed(1) + ' 公里' : Math.round(radar.primary.aheadKm * 1000) + ' 米' }}
            </div>
            <div class="drive-radar-card__name">小确幸：{{ radar.primary.highlight.name }}</div>
            <div class="drive-radar-card__meta">
              {{ radar.primary.sideText || '前方' }} · {{ highlightLabel(radar.primary.highlight.category) }}
              <template v-if="radar.primary.highlight.walkMinutes"> · 停车走 {{ radar.primary.highlight.walkMinutes }} 分钟</template>
            </div>
            <div class="drive-radar-card__intro">{{ radar.primary.highlight.intro }}</div>
          </div>
          <div v-else class="drive-radar-card is-empty">
            <div class="drive-radar-card__name">前方暂无可推送的小确幸</div>
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
              <span>{{ routeRef.provinces.join(' · ') }}</span>
            </div>
          </div>

          <div class="drive-speed">
            <span class="drive-speed__value">{{ speedKmh }}</span>
            <span class="drive-speed__unit">km/h</span>
            <span class="drive-speed__band" :class="'drive-speed__band--' + (radar?.band ?? 'cruise')">{{ bandLabel }}</span>
          </div>

          <div v-if="activeAlert" class="drive-alert" :class="'drive-alert--' + activeAlert.severity">
            <span class="drive-alert__icon">⚠</span>
            <span>{{ activeAlert.text }}</span>
          </div>

          <div v-if="radar?.missed" class="drive-alert drive-alert--info">
            <span class="drive-alert__icon">↩</span>
            <span>你刚错过：{{ radar.missed.highlight.name }}（{{ radar.missed.highlight.intro }}）</span>
          </div>

          <div class="drive-actions">
            <button type="button" class="btn" :class="{ primary: !recording }" @click="toggleRecord">
              {{ recording ? '结束记录' : '开始记录轨迹' }}
            </button>
            <span v-if="recording" class="drive-route-card__meta" style="align-self: center">
              已记 {{ track?.points.length ?? 0 }} 个关键点 · 打卡 {{ track?.checkinCount ?? 0 }} 处
            </span>
          </div>

          <!-- 模拟控制（Web 预览用） -->
          <div class="drive-progress" style="margin-top: 8px">
            <label class="drive-stat__label" for="drive-progress-slider">模拟进度（Web 预览）</label>
            <input
              id="drive-progress-slider"
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
        </div>
      </template>
    </main>
  </div>
</template>
