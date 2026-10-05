<script setup lang="ts">
/**
 * 万里路书 · 沿程页（PRD §2.3 DriveTrip，本版最重要的页面）。
 *
 * 入口共用同一套沿程匹配器（PRD §5.4）：
 *   C1 点对点   /drive/trip?from=上海&to=拉萨     规划引擎出折线
 *   C2 整条公路 /drive/trip?road=G318              L1 几何直接就是折线
 *   路书条目    /drive/trip?route=qinghai-gansu-ring（v1 打样）
 *
 * 布局：左路线卡 + 进度 + 即将到达 / 中地图 / 右沿程景点流。
 * 有定位时静默投影到折线推进进度；无定位可点进度条预览。
 * 地图为离线 SVG（中国轮廓 + 动态取景框），零密钥依赖。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { projectToRoute, type AlongSpot, type RoadChapter, type RoadRoute } from '@railvista/shared';
import { api } from '../api/client';
import DriveSubNav from '../components/DriveSubNav.vue';
import { useGeolocation } from '../composables/useGeolocation';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import { useRoadDraw } from '../composables/useRoadDraw';
import outlineRaw from '../assets/china-outline.svg?raw';
import { CHINA_OUTLINE_VIEWBOX, lngLatToViewBox } from '../data/chinaBackdrop';
import { ROAD_COLORS } from '../data/roadColors';

usePointerSpotlight();
const routePathRef = ref<SVGPathElement | null>(null);
useRoadDraw(routePathRef);

const route = useRoute();

const VIEW_W = CHINA_OUTLINE_VIEWBOX.width;
const VIEW_H = CHINA_OUTLINE_VIEWBOX.height;
const outlinePaths = (() => {
  const m = /<g[^>]*>([\s\S]*?)<\/g>/.exec(outlineRaw);
  return m ? m[1].trim() : '';
})();

/** 偏离路线超过此阈值（米）时不推进进度 */
const OFF_ROUTE_MAX_M = 5000;
/** 即将到达：前方多少公里内的景点 */
const UPCOMING_LOOKAHEAD_KM = 80;
const UPCOMING_LIMIT = 5;

// ── 数据加载 ─────────────────────────────────────────────────────────────────
const loading = ref(true);
const error = ref('');
const roadRoute = ref<RoadRoute | null>(null);
const spots = ref<AlongSpot[]>([]);
const chapters = ref<RoadChapter[]>([]);
const spotLibrary = ref<{ count: number; updated: string; note?: string } | null>(null);
const progress = ref(0);

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

    const p = Number(route.query.progress);
    if (Number.isFinite(p)) progress.value = Math.max(0, Math.min(1, p));
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
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
  const absorb = (lng: number, lat: number) => {
    const [x, y] = lngLatToViewBox(lng, lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const [lng, lat] of coords) absorb(lng, lat);
  // 景点一并纳入取景，避免圆点贴边或被裁掉
  for (const s of spots.value.slice(0, 80)) absorb(s.lng, s.lat);

  const contentW = Math.max(maxX - minX, 4);
  const contentH = Math.max(maxY - minY, 4);
  const padX = Math.max(contentW * 0.14, 24);
  const padY = Math.max(contentH * 0.14, 24);
  // ⚠️ 必须返回 [x, y, width, height]。此前误把 maxX/maxY 当作 w/h，
  // 视野被撑到「原点附近一整块中国」，路线只剩左上角一小撮。
  return [minX - padX, minY - padY, contentW + padX * 2, contentH + padY * 2];
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
const filterPulse = ref(false);

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

function pulseFilterList() {
  filterPulse.value = false;
  void nextTick(() => {
    filterPulse.value = true;
  });
}

function toggleCategory(key: string) {
  const i = activeCategories.value.indexOf(key);
  if (i >= 0) activeCategories.value.splice(i, 1);
  else activeCategories.value.push(key);
  pulseFilterList();
}

function toggleOnlyDetour() {
  onlyDetour.value = !onlyDetour.value;
  pulseFilterList();
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

// ── 沿程进度跨度 ─────────────────────────────────────────────────────────────
// lengthKm 常是「全线名义/去重后里程」（含未贯通分量），章节与主链 cumKm 只覆盖
// 已贯通主链。进度条若用 lengthKm 当分母，分段会全部挤在左侧（G331 实测
// 章节止于 ~1.5k km，而 lengthKm=9373）。
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
/** 进度条可走跨度（主链 + 章节覆盖） */
const spanKm = computed(() => {
  const span = Math.max(chapterSpanKm.value, chainKm.value);
  return span > 0 ? span : nominalKm.value;
});
const progressPartial = computed(
  () => nominalKm.value > 0 && spanKm.value > 0 && spanKm.value / nominalKm.value < 0.92,
);

// ── 沿程进度 / 章节 / 即将到达 ───────────────────────────────────────────────
const chaptersExpanded = ref(false);
const gpsFollowing = ref(false);

const progressKm = computed(() => progress.value * spanKm.value);
const progressPct = computed(() => {
  if (!spanKm.value) return 0;
  return Math.min(100, (progressKm.value / spanKm.value) * 100);
});

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
    if (parts.length >= 2) return { from: parts[0].trim(), to: parts[parts.length - 1].trim() };
    return { from: title.trim(), to: '' };
  };
  const first = split(chapters.value[0].title);
  const last = split(chapters.value[chapters.value.length - 1].title);
  return { start: first.from, end: last.to || last.from };
});

const upcomingSpots = computed(() => {
  const km = progressKm.value;
  return spots.value
    .filter((s) => s.progressKm > km - 0.2 && s.progressKm <= km + UPCOMING_LOOKAHEAD_KM)
    .sort((a, b) => a.progressKm - b.progressKm || b.score - a.score)
    .slice(0, UPCOMING_LIMIT);
});

function aheadText(s: AlongSpot): string {
  const d = s.progressKm - progressKm.value;
  if (d < 0.3) return '即将到达';
  if (d < 1) return `${Math.round(d * 1000)} 米`;
  return `${d.toFixed(1)} 公里`;
}

function chapterLeftPct(ch: RoadChapter): number {
  if (!spanKm.value) return 0;
  return Math.max(0, Math.min(100, (ch.fromKm / spanKm.value) * 100));
}

function chapterWidthPct(ch: RoadChapter): number {
  if (!spanKm.value) return 0;
  const w = ((ch.toKm - ch.fromKm) / spanKm.value) * 100;
  return Math.max(0.8, Math.min(100 - chapterLeftPct(ch), w));
}

function spotsInChapter(ch: RoadChapter): number {
  return spots.value.filter((s) => s.progressKm >= ch.fromKm && s.progressKm < ch.toKm).length;
}

function toggleChaptersExpanded() {
  chaptersExpanded.value = !chaptersExpanded.value;
}

function jumpToChapter(index: number) {
  const ch = chapters.value[index];
  if (!ch || !spanKm.value) return;
  gpsFollowing.value = false;
  progress.value = Math.min(1, Math.max(0, (ch.fromKm + 0.001) / spanKm.value));
}

function jumpToProgress(event: MouseEvent) {
  const track = event.currentTarget as HTMLElement;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  gpsFollowing.value = false;
  progress.value = ratio;
}

function nudgeProgress(delta: number) {
  gpsFollowing.value = false;
  progress.value = Math.max(0, Math.min(1, progress.value + delta));
}

// 有定位时静默推进进度（无独立「我在哪」面板）
const { gps } = useGeolocation();
watch(gps, (sample) => {
  if (!sample || !spanKm.value) return;
  const coords = roadRoute.value?.coords;
  if (!coords || coords.length < 2) return;
  const proj = projectToRoute(coords, sample.lng, sample.lat);
  if (proj.offRouteM > OFF_ROUTE_MAX_M) {
    gpsFollowing.value = false;
    return;
  }
  gpsFollowing.value = true;
  progress.value = Math.max(0, Math.min(1, proj.alongKm / spanKm.value));
});
</script>

<template>
  <div class="drive-page">

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
        <div class="drive-trip-top">
          <router-link class="drive-trip-back" to="/drive">← 返回选路线</router-link>
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

            <!-- 沿程进度：默认进度条，点击展开全部章节 -->
            <section v-if="chapters.length" class="rv-card drive-chprog">
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
                      :style="{ left: chapterLeftPct(ch) + '%', width: chapterWidthPct(ch) + '%' }"
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
                    <template v-if="gpsFollowing">定位跟随中 · </template>点击标题展开全部章节
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

            <!-- 即将到达（按当前进度前方景点） -->
            <section class="rv-card drive-upcoming">
              <div class="drive-upcoming__head">
                <h2 class="drive-block-title">即将到达</h2>
                <span class="drive-upcoming__range">前方 {{ UPCOMING_LOOKAHEAD_KM }} km</span>
              </div>
              <ul v-if="upcomingSpots.length" class="drive-upcoming__list">
                <li v-for="(s, i) in upcomingSpots" :key="s.id">
                  <button
                    type="button"
                    class="drive-upcoming__item"
                    :class="{ 'is-next': i === 0, 'is-on': expandedSpotId === s.id }"
                    @click="toggleSpot(s)"
                  >
                    <span class="drive-upcoming__ahead">{{ aheadText(s) }}</span>
                    <span class="drive-upcoming__body">
                      <span class="drive-upcoming__name">{{ s.name }}</span>
                      <span class="drive-upcoming__meta">
                        {{ kmText(s.progressKm) }} · {{ categoryLabel(s.category) }} · {{ detourText(s) }}
                      </span>
                    </span>
                    <span class="drive-spot__tier" :class="'is-' + s.tier">{{ TIER_LABEL[s.tier] ?? s.tier }}</span>
                  </button>
                </li>
              </ul>
              <p v-else class="drive-upcoming__empty">前方暂无匹配景点，点进度条可预览沿途</p>
            </section>
          </aside>

          <!-- 中：地图 -->
          <section class="drive-trip-map rv-card" data-spotlight>
            <svg
              :viewBox="viewBoxAttr"
              preserveAspectRatio="xMidYMid meet"
              class="drive-trip-map__svg"
              role="img"
              aria-label="路线示意图"
            >
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
                  @click="toggleOnlyDetour"
                >
                  只看值得绕行
                </button>
              </div>
            </div>

            <div
              class="drive-flow-list"
              :class="{ 'is-filter-pulse': filterPulse }"
              @animationend="filterPulse = false"
            >
              <article
                v-for="s in filteredSpots"
                :key="s.id"
                class="drive-spot"
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
                    <div class="drive-spot__expand-inner">
                      <p v-if="s.intro" class="drive-spot__intro">{{ s.intro }}</p>
                      <p class="drive-spot__vis">{{ VIS_LABEL[s.visibility ?? 'detour20'] }} · {{ VIS_LABEL[s.visibility ?? 'detour20'] === '就在路边' ? '可即停即看' : '缓冲 ' + (s.visibility === 'distant' ? '35' : s.visibility === 'detour20' ? '12' : '3') + ' km' }}</p>
                    </div>
                  </div>
                </Transition>
              </article>
            </div>
            <p v-if="!filteredSpots.length" class="drive-empty">
              该路段暂无匹配景点（试试放开筛选，或降低 minScore）
            </p>

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
