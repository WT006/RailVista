<script setup lang="ts">
/**
 * 万里路书 · 单条公路详情页（PRD §2.3 DriveRoad）。
 *
 * G318 这类编号页：全线里程、起点终点、途经省市、分段（几何 nodes）、
 * 沿线景点（走 C2 整条公路入口）、诚实边界标注（估算里程 / 走向还原）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import AppTopBar from '../components/AppTopBar.vue';
import DriveSubNav from '../components/DriveSubNav.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import { useRoadDraw } from '../composables/useRoadDraw';

usePointerSpotlight();
import outlineRaw from '../assets/china-outline.svg?raw';
import { CHINA_OUTLINE_VIEWBOX, lngLatToViewBox } from '../data/chinaBackdrop';
import { ROAD_COLORS, roadColor, roadClassLabel, classOfRef } from '../data/roadColors';
import type { AlongSpot, RoadIndexEntry, RoadRoute } from '@railvista/shared';

const route = useRoute();
const router = useRouter();
const code = String(route.params.code ?? '');

function tierColor(tier: string): string {
  if (tier === 'A') return ROAD_COLORS.expressway;
  if (tier === 'C') return ROAD_COLORS.provincial;
  return ROAD_COLORS.national;
}

const routePathRef = ref<SVGPathElement | null>(null);
useRoadDraw(routePathRef);

const VIEW_W = CHINA_OUTLINE_VIEWBOX.width;
const VIEW_H = CHINA_OUTLINE_VIEWBOX.height;
const outlinePaths = (() => {
  const m = /<g[^>]*>([\s\S]*?)<\/g>/.exec(outlineRaw);
  return m ? m[1].trim() : '';
})();

const loading = ref(true);
const error = ref('');
const entry = ref<RoadIndexEntry | null>(null);
const roadRoute = ref<RoadRoute | null>(null);
const spots = ref<AlongSpot[]>([]);
const geometryNote = ref('');

const routePath = computed(() => {
  const coords = roadRoute.value?.coords;
  if (!coords || coords.length < 2) return '';
  let d = '';
  coords.forEach(([lng, lat], i) => {
    const [x, y] = lngLatToViewBox(lng, lat);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return d;
});

/** 多段几何（orphan 链）SVG 路径：虚线渲染未贯通段 */
const segmentPaths = computed(() => {
  const segs = roadRoute.value?.segments;
  if (!segs?.length) return [];
  return segs
    .map((seg) => {
      if (seg.length < 2) return '';
      let d = '';
      seg.forEach(([lng, lat], i) => {
        const [x, y] = lngLatToViewBox(lng, lat);
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      });
      return d;
    })
    .filter(Boolean);
});

/** 段间断点标注 */
const gapAnnotations = computed(() => roadRoute.value?.gapAnnotations ?? []);
const hasGaps = computed(() => gapAnnotations.value.length > 0);
const gapKmTotal = computed(() =>
  Math.round(gapAnnotations.value.reduce((s, g) => s + g.gapKm, 0)),
);

const viewBoxAttr = computed(() => {
  const coords = roadRoute.value?.coords;
  if (!coords?.length) return `0 0 ${VIEW_W} ${VIEW_H}`;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [lng, lat] of coords) {
    const [x, y] = lngLatToViewBox(lng, lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const padX = Math.max((maxX - minX) * 0.08, 20);
  const padY = Math.max((maxY - minY) * 0.08, 20);
  return `${(minX - padX).toFixed(1)} ${(minY - padY).toFixed(1)} ${(maxX - minX + padX * 2).toFixed(1)} ${(maxY - minY + padY * 2).toFixed(1)}`;
});

/** 里程分段：按几何 nodes（端点/城市）切段 */
const segments = computed(() => {
  const r = roadRoute.value;
  if (!r?.chapters?.length) return [];
  return r.chapters;
});

/** 沿线景点 Top（按分数） */
const topSpots = computed(() => [...spots.value].sort((a, b) => b.score - a.score).slice(0, 12));

onMounted(async () => {
  loading.value = true;
  try {
    const [roadData, alongData] = await Promise.all([
      api.getDriveRoad(code),
      api.getDriveAlong({ road: code, max: 200 }),
    ]);
    entry.value = roadData.entry;
    geometryNote.value = roadData.note ?? '';
    roadRoute.value = alongData.route;
    spots.value = alongData.spots;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
});

function goTripLive() {
  void router.push(`/drive/trip?road=${encodeURIComponent(code)}&mode=live`);
}
</script>

<template>
  <div class="drive-page">
    <AppTopBar />

    <main class="rv-shell">
      <DriveSubNav />

      <div v-if="loading" class="drive-skeleton">
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
        <div class="drive-skeleton__line drive-skeleton__line--mid" />
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
        <div class="drive-skeleton__line drive-skeleton__line--narrow" />
        <div class="drive-skeleton__line drive-skeleton__line--mid" />
      </div>
      <div v-else-if="error || !entry" class="drive-empty drive-empty--error">{{ error || '公路不在册' }}</div>

      <template v-else>
        <header class="drive-hero">
          <p class="drive-stat__label">
            <span class="drive-trip-roadkey" :style="{ '--prefix-color': roadColor(entry.class) }">{{ entry.ref }}</span>
            {{ roadClassLabel(entry.class) }}
            <template v-if="entry.name"> · {{ entry.name }}</template>
          </p>
          <h1>{{ entry.ref }}　{{ entry.fromPlace }} — {{ entry.toPlace }}</h1>
          <div class="drive-route-card__meta" style="margin-top: 12px">
            <span>{{ roadRoute ? roadRoute.lengthKm + ' km（OSM 估算）' : `官方里程约 ${entry.lengthKm} km` }}</span>
            <span v-if="entry.provinces.length">途经 {{ entry.provinces.join(' · ') }}</span>
            <span>{{ spots.length }} 处沿线景点</span>
            <span v-if="entry.source === 'osm_only'">OSM 还原 · unverified</span>
          </div>
        </header>

        <!-- 几何待补的诚实提示 -->
        <p v-if="geometryNote" class="drive-empty rv-card" style="padding: 16px">
          {{ geometryNote }}
        </p>

        <div v-if="roadRoute" class="drive-trip-grid drive-road-grid">
          <section class="drive-trip-map rv-card" data-spotlight>
            <svg :viewBox="viewBoxAttr" class="drive-trip-map__svg" role="img" aria-label="路线示意图">
              <g class="drive-netmap__outline" v-html="outlinePaths" />
              <path ref="routePathRef" class="drive-trip-map__route" :d="routePath" :stroke="roadColor(entry.class)" />
              <path
                v-for="(d, i) in segmentPaths"
                :key="'seg-' + i"
                class="drive-trip-map__segment"
                :d="d"
                :stroke="roadColor(entry.class)"
                stroke-dasharray="4 3"
                opacity="0.45"
              />
              <circle
                v-for="s in spots.slice(0, 160)"
                :key="s.id"
                class="drive-trip-map__dot"
                :cx="lngLatToViewBox(s.lng, s.lat)[0]"
                :cy="lngLatToViewBox(s.lng, s.lat)[1]"
                r="2.4"
                :fill="tierColor(s.tier)"
              >
                <title>{{ s.name }} · K{{ Math.round(s.progressKm) }}</title>
              </circle>
            </svg>
            <p class="drive-trip-map__hint">全线走向示意（OSM 众包还原，非官方线位）</p>
            <p v-if="hasGaps" class="drive-trip-map__gap-note">
              ⚠ {{ gapAnnotations.length }} 处未贯通（合计约 {{ gapKmTotal }} km），虚线段为示意连接
            </p>
          </section>

          <aside class="drive-trip-side">
            <section v-if="segments.length" class="rv-card drive-chapters">
              <h2 class="drive-block-title">分段</h2>
              <ul class="drive-chapterlist">
                <li v-for="(ch, i) in segments" :key="i">
                  <span class="drive-chapterlist__range">{{ Math.round(ch.fromKm) }}—{{ Math.round(ch.toKm) }} km</span>
                  {{ ch.title }}
                </li>
              </ul>
            </section>

            <section class="rv-card">
              <h2 class="drive-block-title">沿线景点 Top{{ topSpots.length }}</h2>
              <ul class="drive-road-spots">
                <li v-for="s in topSpots" :key="s.id">
                  <span class="drive-spot__km">K{{ Math.round(s.progressKm) }}</span>
                  <span class="drive-road-spot__name">{{ s.name }}</span>
                  <span class="drive-spot__tier" :class="'is-' + s.tier">{{ s.tier }}</span>
                </li>
              </ul>
              <div class="drive-actions">
                <router-link class="btn primary btn-sm" :to="`/drive/trip?road=${encodeURIComponent(code)}`">
                  看全部沿程景点 →
                </router-link>
                <button type="button" class="btn ghost btn-sm" @click="goTripLive">实时态（我在哪）</button>
              </div>
            </section>
          </aside>
        </div>

        <footer class="drive-footnote">
          路网数据来自 OpenStreetMap 众包数据，里程与走向为估算，不作为导航依据。
        </footer>
      </template>
    </main>
  </div>
</template>
