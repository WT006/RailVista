<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import DriveBackdropMap from '../components/DriveBackdropMap.vue';
import AppTopBar from '../components/AppTopBar.vue';
import DriveSubNav from '../components/DriveSubNav.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import { highlightColor, highlightLabel } from '../data/highlightColors';
import type { DriveHighlight, DriveRoute } from '@railvista/shared';

usePointerSpotlight();

const route = useRoute();
const router = useRouter();
const routeId = String(route.params.routeId);

const data = ref<{ route: DriveRoute; highlights: DriveHighlight[] } | null>(null);
const loading = ref(true);
const error = ref('');

const highlightsById = computed(() => {
  const map = new Map<string, DriveHighlight>();
  for (const h of data.value?.highlights ?? []) map.set(h.id, h);
  return map;
});

const difficultyText = computed(() => {
  const d = data.value?.route.difficulty ?? 1;
  return ['轻松', '休闲', '中等', '较难', '挑战'][d - 1] ?? '中等';
});

const bestSeasonText = computed(() => {
  const months = data.value?.route.bestSeason ?? [];
  return months.length ? `${months.join('、')} 月` : '全年';
});

onMounted(async () => {
  try {
    data.value = await api.getDriveRoute(routeId);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
});

function startNav() {
  // v0.4.0：伴随导航不再是独立页，改为沿程页实时态（PRD §8）
  void router.push(`/drive/trip?route=${encodeURIComponent(routeId)}&mode=live`);
}
</script>

<template>
  <div class="drive-page">
    <DriveBackdropMap />
    <AppTopBar />

    <main class="rv-shell">
      <DriveSubNav />
      <div v-if="loading" class="drive-empty">正在翻开路书…</div>
      <div v-else-if="error || !data" class="drive-empty drive-empty--error">{{ error || '未找到该线路' }}</div>

      <template v-else>
        <header class="drive-hero">
          <p class="drive-stat__label">万里路书 · {{ data.route.tier === 'national' ? '国家级主干线' : '省级精品线' }}</p>
          <h1>{{ data.route.name }}</h1>
          <p class="sub">{{ data.route.summary }}</p>
          <div class="drive-route-card__meta" style="margin-top: 12px">
            <span>{{ data.route.provinces.join(' · ') }}</span>
            <span>{{ data.route.totalKm }} km</span>
            <span>约 {{ data.route.driveDays }} 天</span>
            <span>难度 {{ difficultyText }}</span>
            <span>最佳 {{ bestSeasonText }}</span>
          </div>
          <div class="drive-actions">
            <button type="button" class="btn primary" @click="startNav">开始伴随导航</button>
          </div>
        </header>

        <section class="drive-toc">
          <article
            v-for="ch in data.route.chapters"
            :key="ch.id"
            class="drive-chapter"
          >
            <span class="drive-chapter__dot" />
            <div>
              <span class="drive-chapter__title">{{ ch.title }}</span>
              <span class="drive-chapter__range" style="margin-left: 8px">
                {{ ch.fromKm }} — {{ ch.toKm }} km
              </span>
            </div>
            <p class="drive-chapter__summary">{{ ch.summary }}</p>
            <p v-if="ch.towns?.length" class="drive-chapter__range">途经 {{ ch.towns.join('、') }}</p>

            <div
              v-for="hid in ch.highlightIds"
              :key="hid"
              class="drive-highlight"
              :style="{ '--hl-color': highlightColor(highlightsById.get(hid)?.category ?? '') }"
            >
              <template v-if="highlightsById.get(hid)">
                <div class="drive-highlight__head">
                  <span class="drive-highlight__name">{{ highlightsById.get(hid)!.name }}</span>
                  <span class="drive-highlight__badge">{{ highlightLabel(highlightsById.get(hid)!.category) }}</span>
                </div>
                <p class="drive-highlight__intro">{{ highlightsById.get(hid)!.intro }}</p>
                <p v-if="highlightsById.get(hid)!.howToPlay" class="drive-highlight__howto">
                  「怎么玩」{{ highlightsById.get(hid)!.howToPlay }}
                </p>
                <p v-if="highlightsById.get(hid)!.safetyNote" class="drive-highlight__safety">
                  ⚠ {{ highlightsById.get(hid)!.safetyNote }}
                </p>
                <span class="drive-highlight__milepost">
                  {{ highlightsById.get(hid)!.roadRef ?? '' }} K{{ highlightsById.get(hid)!.alongKm }}
                </span>
              </template>
            </div>

            <p v-if="ch.tips?.length" class="drive-chapter__range">提示：{{ ch.tips.join(' ') }}</p>
          </article>
        </section>

        <p v-if="data.route.status !== 'calibrated'" class="drive-empty" style="margin-top: 16px">
          本线路几何为 {{ data.route.status }} 状态，里程与走向待官方线路表校准。
        </p>
      </template>
    </main>
  </div>
</template>
