<script setup lang="ts">
/**
 * 万里路书 · 沿程页（PRD §2.3 DriveTrip，本版最重要的页面）。
 *
 * 三种入口共用同一套沿程匹配器（PRD §5.4）：
 *   C1 点对点   /drive/trip?from=上海&to=拉萨     规划引擎出折线
 *   C2 整条公路 /drive/trip?road=G318              L1 几何直接就是折线
 *   C3 我在哪   /drive/trip?...&mode=live          雷达车速带 + 前方推送
 *   路书条目    /drive/trip?route=qinghai-gansu-ring（v1 打样）
 *
 * 布局：左路线卡 / 中地图 + 章节条 / 右沿程景点流（progressKm 升序）。
 * 地图为离线 SVG（中国轮廓 + 动态取景框），零密钥依赖，与首页公路网同源。
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import DriveBackdropMap from '../components/DriveBackdropMap.vue';
import AppTopBar from '../components/AppTopBar.vue';
import DriveSubNav from '../components/DriveSubNav.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import { useRoadDraw } from '../composables/useRoadDraw';
import { useScrollReveal } from '../composables/useScrollReveal';

usePointerSpotlight();
const routePathRef = ref<SVGPathElement | null>(null);
useRoadDraw(routePathRef);
// A1：内容在异步 load 完成后才渲染，需在 finally 里主动 rescan 一次，
//确保骨架屏切换后新出现的 .drive-spot 被纳入观察。
const { rescan: rescanReveal } = useScrollReveal('.drive-scroll-reveal');
import DriveLivePanel from '../components/DriveLivePanel.vue';
import outlineRaw from '../assets/china-outline.svg?raw';
import { CHINA_OUTLINE_VIEWBOX, lngLatToViewBox } from '../data/chinaBackdrop';
import { ROAD_COLORS, roadColor } from '../data/roadColors';
import type {
  AlongSpot,
  DriveHighlight,
  DriveRoute,
  RoadChapter,
  RoadRoute,
} from '@railvista/shared';

const route = useRoute();
const router = useRouter();

const VIEW_W = CHINA_OUTLINE_VIEWBOX.width;
const VIEW_H = CHINA_OUTLINE_VIEWBOX.height;
const outlinePaths = (() => {
  const m = /<g[^>]*>([\s\S]*?)<\/g>/.exec(outlineRaw);
  return m ? m[1].trim() : '';
})();

// ── 数据加载 ─────────────────────────────────────────────────────────────────
const loading = ref(true);
const error = ref('');
const roadRoute = ref<RoadRoute | null>(null);
const spots = ref<AlongSpot[]>([]);
const chapters = ref<RoadChapter[]>([]);
const spotLibrary = ref<{ count: number; updated: string; note?: string } | null>(null);
const liveMode = ref(false);
const progress = ref(0);
const speedKmh = ref(60);

const entryMode = computed<'od' | 'road' | 'route'>(() => {
  if (route.query.road) return 'road';
  if (route.query.route) return 'route';
  return 'od';
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params: Parameters<typeof api.getDriveAlong>[0] = {};
    if (entryMode.value === 'road') params.road = String(route.query.road);
    else if (entryMode.value === 'route') params.route = String(route.query.route);
    else {
      params.from = String(route.query.from ?? '');
      params.to = String(route.query.to ?? '');
      if (!params.from || !params.to) {
        error.value = '缺少起终点：回到首页输入起点与终点';
        return;
      }
    }
    const data = await api.getDriveAlong(params);
    roadRoute.value = data.route;
    spots.value = data.spots;
    chapters.value = data.chapters ?? [];
    spotLibrary.value = data.spotLibrary ?? null;

    liveMode.value = route.query.mode === 'live';
    const p = Number(route.query.progress);
    const s = Number(route.query.speed);
    if (Number.isFinite(p)) progress.value = Math.max(0, Math.min(1, p));
    if (Number.isFinite(s)) speedKmh.value = s;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
    // A1：DOM 已从骨架屏切换为内容，主动重扫一次揭示动画
    void nextTick(rescanReveal);
  }
}

onMounted(load);

// ── 地图（离线 SVG，动态取景框） ─────────────────────────────────────────────
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

const focusBbox = computed<[number, number, number, number]>(() => {
  const coords = roadRoute.value?.coords;
  if (!coords || !coords.length) return [0, 0, VIEW_W, VIEW_H];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [lng, lat] of coords) {
    const [x, y] = lngLatToViewBox(lng, lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const padX = Math.max((maxX - minX) * 0.12, 30);
  const padY = Math.max((maxY - minY) * 0.12, 30);
  return [minX - padX, minY - padY, maxX + padX, maxY + padY];
});

const viewBoxAttr = computed(() => {
  const [x, y, w, h] = focusBbox.value;
  return `${x.toFixed(1)} ${y.toFixed(1)} ${Math.max(w, 4).toFixed(1)} ${Math.max(h, 4).toFixed(1)}`;
});

function spotPos(s: AlongSpot): [number, number] {
  return lngLatToViewBox(s.lng, s.lat);
}

const expandedSpotId = ref('');

function toggleSpot(s: AlongSpot) {
  expandedSpotId.value = expandedSpotId.value === s.id ? '' : s.id;
}

// ── 景点流过滤 ────────────────────────────────────────────────────────────────
const CATEGORY_FILTERS = [
  { key: 'nature', label: '自然' },
  { key: 'culture', label: '人文' },
  { key: 'engineering', label: '工程' },
  { key: 'viewpoint', label: '观景' },
  { key: 'experience', label: '体验' },
  { key: 'service', label: '服务' },
];
const activeCategories = ref<string[]>([]);
const onlyDetour = ref(false);

const filteredSpots = computed(() => {
  let list = spots.value;
  if (activeCategories.value.length) {
    list = list.filter((s) => activeCategories.value.some((c) => s.category.startsWith(c)));
  }
  if (onlyDetour.value) {
    list = list.filter((s) => s.visibility !== 'distant' && s.detourKm > 0);
  }
  return list;
});

function toggleCategory(key: string) {
  const i = activeCategories.value.indexOf(key);
  if (i >= 0) activeCategories.value.splice(i, 1);
  else activeCategories.value.push(key);
}

// ── 展示辅助 ─────────────────────────────────────────────────────────────────
const TIER_LABEL: Record<string, string> = { A: '讲解级', B: '沿途可看', C: '小确幸' };
const SIDE_LABEL: Record<string, string> = { left: '左侧', right: '右侧', unknown: '侧向待定' };
const VIS_LABEL: Record<string, string> = {
  roadside: '就在路边',
  detour5: '5 分钟能绕到',
  detour20: '20 分钟能绕到',
  distant: '远景可见',
};

function tierColor(tier: string): string {
  // PRD §11.2：沿程标记只能从 ROAD_COLORS 取色（A 琥珀 / B 宇宙蓝 / C 青绿）
  if (tier === 'A') return ROAD_COLORS.expressway;
  if (tier === 'C') return ROAD_COLORS.provincial;
  return ROAD_COLORS.national;
}

function detourText(s: AlongSpot): string {
  if (s.visibility === 'distant') return '远景可见 · 不引导绕行';
  if (s.detourKm <= 0) return '就在路边，可停车即看';
  const min = Math.max(4, Math.round((s.detourKm / 30) * 60 / 4) * 4);
  return `绕行 ${s.detourKm} 公里 · 约 ${min} 分钟`;
}

function kmText(km: number): string {
  return `K${Math.round(km)}`;
}

function categoryLabel(cat: string): string {
  const [dim, sub] = cat.split('.');
  const dimLabel: Record<string, string> = {
    nature: '自然', culture: '人文', engineering: '工程',
    viewpoint: '观景', experience: '体验', service: '服务',
  };
  return `${dimLabel[dim] ?? dim}${sub ? ' · ' + sub : ''}`;
}

// ── C3 实时态：把 AlongSpot 转成雷达可用的 DriveHighlight ────────────────────
const routeLike = computed<DriveRoute | null>(() => {
  const r = roadRoute.value;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    tier: 'national',
    provinces: r.provinces,
    summary: '',
    tags: [],
    totalKm: r.lengthKm,
    driveDays: 1,
    bestSeason: [],
    difficulty: 1,
    roadRefs: r.roadKeys,
    startName: '',
    endName: '',
    waypoints: [],
    geometry: r.coords,
    chapters: chapters.value.map((ch, i) => ({
      id: `ch-${i}`,
      index: i + 1,
      title: ch.title,
      fromKm: ch.fromKm,
      toKm: ch.toKm,
      summary: '',
      roadRefs: [],
      towns: [],
      highlightIds: [],
      spotIds: [],
      tips: [],
    })),
    highlightIds: [],
    spotIds: [],
    alerts: [],
    status: 'geometry_ready',
    updatedAt: '',
  };
});

const radarHighlights = computed<DriveHighlight[]>(() => {
  // 车速带规则复用 v1 radar：worthSlowDown（值得减速看一眼）取高分景点，
  // canPark 取可停或近路景点；advanceKm 沿用默认 5km
  return spots.value.slice(0, 80).map((s) => ({
    id: s.id,
    routeId: roadRoute.value?.id ?? '',
    name: s.name,
    lng: s.lng,
    lat: s.lat,
    alongKm: s.progressKm,
    side: s.side,
    category: 'viewpoint' as const,
    worthSlowDown: s.score >= 60,
    canPark: s.canPark ?? s.distKm <= 1,
    stopMinutes: s.stayMin,
    intro: s.intro ?? '',
    howToPlay: '',
  }));
});

function switchMode(mode: 'plan' | 'live') {
  const query = { ...route.query };
  if (mode === 'live') query.mode = 'live';
  else delete query.mode;
  void router.replace({ query });
  liveMode.value = mode === 'live';
}
</script>

<template>
  <div class="drive-page">
    <DriveBackdropMap />
    <AppTopBar />

    <main class="rv-shell">
      <DriveSubNav />

      <div v-if="loading" class="drive-skeleton">
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
        <div class="drive-skeleton__line drive-skeleton__line--mid" />
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
        <div class="drive-skeleton__line drive-skeleton__line--narrow" />
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
      </div>
      <div v-else-if="error || !roadRoute" class="drive-empty drive-empty--error">
        {{ error || '未找到路线' }}
        <div class="drive-actions" style="justify-content: center">
          <router-link class="btn ghost btn-sm" to="/drive">回首页重新规划</router-link>
        </div>
      </div>

      <template v-else>
        <!-- 三入口切换 + 实时态 -->
        <div class="drive-trip-top">
          <nav class="drive-trip-tabs" aria-label="入口切换">
            <router-link class="drive-trip-tab" :class="{ 'is-active': entryMode === 'od' }" to="/drive">
              点对点
            </router-link>
            <span class="drive-trip-tab" :class="{ 'is-active': entryMode === 'road' || entryMode === 'route' }">
              整条公路
            </span>
            <button
              type="button"
              class="drive-trip-tab"
              :class="{ 'is-active': liveMode }"
              @click="switchMode(liveMode ? 'plan' : 'live')"
            >
              我在哪（实时）
            </button>
          </nav>
          <span v-if="roadRoute.engineNote" class="drive-trip-engine">{{ roadRoute.engineNote }}</span>
        </div>

        <div class="drive-trip-grid">
          <!-- 左：路线卡 -->
          <aside class="drive-trip-side">
            <section class="rv-card drive-route-card is-flat" data-spotlight>
              <span class="drive-route-card__name" style="font-size: var(--fs-h3)">{{ roadRoute.name }}</span>
              <div class="drive-route-card__meta" style="flex-direction: column; align-items: flex-start; gap: 4px">
                <span>全程 {{ roadRoute.lengthKm }} km<template v-if="roadRoute.durationMin"> · 约 {{ Math.round(roadRoute.durationMin / 60) }} 小时</template></span>
                <span>沿程景点 {{ spots.length }} 处 · 章节 {{ chapters.length }} 段</span>
                <span v-if="roadRoute.roadKeys.length" class="drive-trip-roadkeys">
                  <span
                    v-for="k in roadRoute.roadKeys.slice(0, 6)"
                    :key="k"
                    class="drive-trip-roadkey"
                  >{{ k }}</span>
                </span>
              </div>
            </section>

            <!-- 章节条 -->
            <section v-if="chapters.length" class="rv-card drive-chapters">
              <h2 class="drive-block-title">沿程章节</h2>
              <div class="drive-chapterbar">
                <div
                  v-for="(ch, i) in chapters"
                  :key="i"
                  class="drive-chapterbar__seg"
                  :style="{ flex: Math.max(1, ch.toKm - ch.fromKm) }"
                  :title="`${ch.title}（${Math.round(ch.fromKm)}—${Math.round(ch.toKm)} km）`"
                  :data-title="`${ch.title}（${Math.round(ch.fromKm)}—${Math.round(ch.toKm)} km）`"
                >
                  <span class="drive-chapterbar__label">{{ ch.title }}</span>
                </div>
              </div>
              <ul class="drive-chapterlist">
                <li v-for="(ch, i) in chapters" :key="i">
                  <span class="drive-chapterlist__range">{{ Math.round(ch.fromKm) }}—{{ Math.round(ch.toKm) }} km</span>
                  {{ ch.title }}
                </li>
              </ul>
            </section>

            <!-- 实时态面板（C3） -->
            <Transition name="drive-trip-panel">
              <DriveLivePanel
                v-if="liveMode && routeLike"
                :route="routeLike"
                :highlights="radarHighlights"
                v-model:progress="progress"
                v-model:speed-kmh="speedKmh"
              />
            </Transition>
          </aside>

          <!-- 中：地图 -->
          <section class="drive-trip-map rv-card" data-spotlight>
            <svg :viewBox="viewBoxAttr" class="drive-trip-map__svg" role="img" aria-label="路线示意图">
              <g class="drive-netmap__outline" v-html="outlinePaths" />
              <path ref="routePathRef" class="drive-trip-map__route" :d="routePath" />
              <circle
                v-for="s in filteredSpots"
                :key="s.id"
                class="drive-trip-map__dot"
                :cx="spotPos(s)[0]"
                :cy="spotPos(s)[1]"
                r="2.4"
                :fill="tierColor(s.tier)"
                :class="{ 'is-expanded': expandedSpotId === s.id }"
                @click="toggleSpot(s)"
              >
                <title>{{ s.name }} · {{ kmText(s.progressKm) }}</title>
              </circle>
            </svg>
            <p class="drive-trip-map__hint">示意地图（OSM 众包还原，非导航） · 圆点 = 沿程景点（点按查看）</p>
          </section>

          <!-- 右：沿程景点流 -->
          <section class="drive-trip-flow">
            <div class="drive-flow-head">
              <h2 class="drive-block-title">沿程景点流<span>（按里程升序）</span></h2>
              <div class="drive-flow-filters">
                <button
                  v-for="f in CATEGORY_FILTERS"
                  :key="f.key"
                  type="button"
                  class="road-kbd__chip"
                  :class="{ 'is-on': activeCategories.includes(f.key) }"
                  @click="toggleCategory(f.key)"
                >
                  {{ f.label }}
                </button>
                <button
                  type="button"
                  class="road-kbd__chip"
                  :class="{ 'is-on': onlyDetour }"
                  @click="onlyDetour = !onlyDetour"
                >
                  只看值得绕行
                </button>
              </div>
            </div>

            <div class="drive-flow-list">
              <article
                v-for="s in filteredSpots"
                :key="s.id"
                class="drive-spot drive-scroll-reveal"
                :class="{ 'is-expanded': expandedSpotId === s.id }"
                :style="{ '--spot-color': tierColor(s.tier) }"
                @click="toggleSpot(s)"
              >
                <div class="drive-spot__head">
                  <span class="drive-spot__km">{{ kmText(s.progressKm) }}</span>
                  <span class="drive-spot__name">{{ s.name }}</span>
                  <span class="drive-spot__tier" :class="'is-' + s.tier">{{ TIER_LABEL[s.tier] ?? s.tier }}</span>
                </div>
                <div class="drive-spot__meta">
                  <span>{{ categoryLabel(s.category) }}</span>
                  <span>{{ SIDE_LABEL[s.side] ?? s.side }}</span>
                  <span>距路线 {{ s.distKm }} km</span>
                  <span v-if="s.honors?.length" class="drive-spot__honor">{{ s.honors.slice(0, 2).join(' · ') }}</span>
                </div>
                <div class="drive-spot__detour" :class="{ 'is-distant': s.visibility === 'distant' }">
                  {{ detourText(s) }}
                  <template v-if="s.stayMin"> · 建议停留 {{ s.stayMin }} 分钟</template>
                </div>
                <Transition name="drive-spot-expand">
                  <div v-if="expandedSpotId === s.id" class="drive-spot__expand">
                    <p v-if="s.intro" class="drive-spot__intro">{{ s.intro }}</p>
                    <p class="drive-spot__vis">{{ VIS_LABEL[s.visibility ?? 'detour20'] }} · {{ VIS_LABEL[s.visibility ?? 'detour20'] === '就在路边' ? '可即停即看' : '缓冲 ' + (s.visibility === 'distant' ? '35' : s.visibility === 'detour20' ? '12' : '3') + ' km' }}</p>
                  </div>
                </Transition>
              </article>
              <p v-if="!filteredSpots.length" class="drive-empty">
                该路段暂无匹配景点（试试放开筛选，或降低 minScore）
              </p>
            </div>

            <p v-if="spotLibrary" class="drive-footnote">
              景点库 {{ spotLibrary.count }} 条 · {{ spotLibrary.note ?? '持续扩充中' }} ·
              路网数据来自 OpenStreetMap 众包，里程与走向为估算，不作为导航依据
            </p>
          </section>
        </div>
      </template>
    </main>
  </div>
</template>
