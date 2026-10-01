<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import AppTopBar from '../components/AppTopBar.vue';
import type { DriveRouteLite } from '@railvista/shared';

const router = useRouter();
const routes = ref<DriveRouteLite[]>([]);
const stats = ref({ routeCount: 0, totalKm: 0, highlightCount: 0, updated: '' });
const loading = ref(true);
const error = ref('');

const GROUP_LABELS: Record<string, string> = {
  ring: '三环',
  horizontal: '四横',
  vertical: '五纵',
};

function groupLabel(g?: string): string {
  return g ? GROUP_LABELS[g] ?? '省级精品线' : '省级精品线';
}

onMounted(async () => {
  try {
    const [r, s] = await Promise.all([api.getDriveRoutes(), api.getDriveStats()]);
    routes.value = r.routes;
    stats.value = s;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
});

function openRoute(id: string) {
  router.push({ name: 'drive-roadbook', params: { routeId: id } });
}
</script>

<template>
  <div class="drive-page">
    <AppTopBar />

    <main class="rv-shell">
      <header class="drive-hero">
        <h1>万里路书 · 精品自驾公路</h1>
        <p class="sub">
          对标《精品自驾旅游公路实施方案》（交公路发〔2026〕100号）「三环、四横、五纵」主骨架，
          把全国国道省道连成可翻阅的公路路书。途中还有小确幸雷达、公路故事与轨迹记录。
        </p>
      </header>

      <div v-if="loading" class="drive-empty">正在加载线路…</div>
      <div v-else-if="error" class="drive-empty">{{ error }}</div>

      <template v-else>
        <section class="drive-stats">
          <div class="drive-stat">
            <div class="drive-stat__value">{{ stats.routeCount }}</div>
            <div class="drive-stat__label">精品线路</div>
          </div>
          <div class="drive-stat">
            <div class="drive-stat__value">{{ stats.totalKm }}</div>
            <div class="drive-stat__label">主骨架里程（km）</div>
          </div>
          <div class="drive-stat">
            <div class="drive-stat__value">{{ stats.highlightCount }}</div>
            <div class="drive-stat__label">小确幸点位</div>
          </div>
        </section>

        <section class="drive-route-grid">
          <button
            v-for="r in routes"
            :key="r.id"
            type="button"
            class="drive-route-card"
            @click="openRoute(r.id)"
          >
            <span class="drive-route-card__group">{{ groupLabel(r.group) }}</span>
            <span class="drive-route-card__name">{{ r.name }}</span>
            <span class="drive-route-card__summary">{{ r.summary ?? '' }}</span>
            <span class="drive-route-card__meta">
              <span>{{ r.provinces.join(' · ') }}</span>
              <span>{{ r.totalKm }} km</span>
              <span>约 {{ r.driveDays }} 天</span>
              <span>{{ r.highlightCount }} 处小确幸</span>
            </span>
            <span class="drive-route-card__tags">
              <span v-for="t in r.tags" :key="t" class="drive-tag">{{ t }}</span>
            </span>
          </button>
        </section>

        <p v-if="routes.length === 0" class="drive-empty">
          暂无线路数据。运行 <code>node scripts/build-drive-route.mjs</code> 生成。
        </p>
      </template>
    </main>
  </div>
</template>
