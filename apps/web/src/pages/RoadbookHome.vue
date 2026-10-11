<script setup lang="ts">
/**
 * 万里路书 · 路书库首页。
 *
 * 三层结构对应需求 5：省份 → 城市 → 路线。
 * 信息架构（对标旅行类 App 渐进披露）：
 *   - 首屏只留搜索 + 省份横滑 + 已选摘要，路线列表尽早出现
 *   - 分层 / 天数 / 玩法收入「筛选」面板，默认收起
 * 筛选全部走 GET /api/travel/routes，与 shared 层共用同一套 matchTravelRoute。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import { RECOMMEND_LAYER_ROTATION, TRAVEL_LAYER_LABEL } from '@railvista/shared';
import type { RoadbookProvince, TravelLayer, TravelRouteSummary } from '@railvista/shared';

const router = useRouter();

const loading = ref(true);
const error = ref('');
const provinces = ref<RoadbookProvince[]>([]);
const routes = ref<TravelRouteSummary[]>([]);
const total = ref(0);
const overview = ref({ totalRoutes: 0, totalPois: 0, latestUpdated: '' });

const province = ref('');
const city = ref('');
const mode = ref('');
/** 内容分层（L1~L5）。缺省 = 全部层 */
const layer = ref<TravelLayer | ''>('');
const keyword = ref('');
const sort = ref('recommend');
/** 天数上限。'' = 全部（默认不筛，避免隐藏存量长线）。语义是「N 天以内」，见 §4.3。 */
const maxDays = ref<number | ''>('');

const DAY_FILTERS: { key: number | ''; label: string }[] = [
  { key: '', label: '全部' },
  { key: 3, label: '3 天以内' },
  { key: 5, label: '5 天以内' },
  { key: 6, label: '6 天以内' },
  { key: 7, label: '7 天以内' },
];
const daysLabel = (k: number | '') => DAY_FILTERS.find((d) => d.key === k)?.label ?? '';

const MODES: { key: string; label: string }[] = [
  { key: 'selfdrive', label: '自驾' },
  { key: 'charter', label: '包车/拼车' },
  { key: 'public', label: '公共交通' },
  { key: 'cycling', label: '骑行' },
  { key: 'hiking', label: '徒步' },
  { key: 'mixed', label: '混合玩法' },
];

/**
 * 内容分层 chips。
 *
 * 顺序 = `RECOMMEND_LAYER_ROTATION`（L3 → L4 → L2 → L1 → L5），与后端默认排序的轮转层序同源，
 * 「列表首屏出现的先后」与「chip 从左到右」是一回事，改 shared 常量即可，前端不留第二份顺序。
 * 文案取 `TRAVEL_LAYER_LABEL`，同样避免与后端漂移。
 */
const LAYERS: { key: TravelLayer; label: string }[] = RECOMMEND_LAYER_ROTATION.map((k) => ({
  key: k,
  label: TRAVEL_LAYER_LABEL[k],
}));

const EMPTY_LAYER_COUNTS: Record<TravelLayer, number> = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 };
/** 分层路线数（取服务端 counts.byLayer，全库口径，不随筛选变化） */
const layerCounts = ref<Record<TravelLayer, number>>({ ...EMPTY_LAYER_COUNTS });
/** 每省路线数（取服务端 counts.byProvince 全库口径，避免从被 limit 截断的 routes 本地统计导致缺省） */
const provinceCounts = ref<Record<string, number>>({});

const SORTS: { key: string; label: string; hint: string }[] = [
  { key: 'recommend', label: '推荐序', hint: '按内容分层轮转推荐' },
  { key: 'layer', label: '按层级', hint: '同层路线排在一起' },
  { key: 'days-asc', label: '天数少→多', hint: '优先短途行程' },
  { key: 'km-desc', label: '里程长→短', hint: '优先长线穿越' },
  { key: 'km-asc', label: '里程短→长', hint: '优先短里程' },
];

const DIFFICULTY: Record<number, string> = { 1: '轻松', 2: '休闲', 3: '中等', 4: '较难', 5: '挑战' };
const SHAPE: Record<string, string> = { loop: '环线', point: '单程', outback: '往返', corridor: '走廊' };
const modeLabel = (k: string) => MODES.find((m) => m.key === k)?.label ?? k;
const layerLabel = (k: string) => LAYERS.find((l) => l.key === k)?.label ?? k;
const sortLabel = computed(() => SORTS.find((s) => s.key === sort.value)?.label ?? '排序');

/** 更多筛选（分层 / 天数 / 玩法）默认收起，避免首屏被 chip 墙占满 */
const filtersOpen = ref(false);
/** 省份默认只露两行，避免窄屏横滑裁切又不易发现 */
const provinceExpanded = ref(false);
/** 自定义排序菜单（替代原生 select，避免系统菜单裁切与风格割裂） */
const sortOpen = ref(false);

const moreFilterCount = computed(() => {
  let n = 0;
  if (mode.value) n += 1;
  if (layer.value) n += 1;
  if (maxDays.value !== '') n += 1;
  return n;
});

const hasActiveFilters = computed(
  () =>
    Boolean(province.value || city.value || mode.value || layer.value || keyword.value.trim()) ||
    maxDays.value !== '',
);

/** 当前选中省的城市列表（含覆盖标记），用于二级联动 */
const citiesOfProvince = computed(() => {
  const p = provinces.value.find((x) => x.shortName === province.value);
  return p ? p.cities : [];
});

const selectableCities = computed(() => citiesOfProvince.value.filter((c) => c.routeIds?.length));

/** 每个省挂了几条路线（用于 chips 上的角标）：优先用服务端全量 counts.byProvince，
 *  回退到从当前页 routes 本地统计（仅当服务端未返回时） */
const routeCountByProvince = computed(() => {
  if (Object.keys(provinceCounts.value).length) return provinceCounts.value;
  const map = new Map<string, number>();
  for (const r of routes.value) {
    for (const p of r.provinces) map.set(p, (map.get(p) ?? 0) + 1);
  }
  return Object.fromEntries(map);
});

async function loadOverview() {
  const data = await api.getTravelOverview();
  provinces.value = data.provinces;
  overview.value = {
    totalRoutes: data.totalRoutes,
    totalPois: data.totalPois,
    latestUpdated: data.latestUpdated,
  };
}

async function loadRoutes() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.getTravelRoutes({
      province: province.value || undefined,
      city: city.value || undefined,
      mode: mode.value || undefined,
      layer: layer.value || undefined,
      maxDays: maxDays.value === '' ? undefined : maxDays.value,
      q: keyword.value.trim() || undefined,
      sort: sort.value,
      limit: 100,
    });
    routes.value = data.routes;
    total.value = data.total;
    layerCounts.value = data.counts?.byLayer ?? { ...EMPTY_LAYER_COUNTS };
    provinceCounts.value = data.counts?.byProvince ?? {};
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

function pickSort(key: string) {
  sort.value = key;
  sortOpen.value = false;
}

function onDocPointerDown(e: PointerEvent) {
  if (!sortOpen.value) return;
  const t = e.target;
  if (t instanceof Element && t.closest('.rb-sort')) return;
  sortOpen.value = false;
}

onMounted(async () => {
  document.addEventListener('pointerdown', onDocPointerDown, true);
  try {
    await loadOverview();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '区划数据加载失败';
  }
  await loadRoutes();
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true);
});

// 省份切换时清空城市；其余条件变化时重新拉列表
watch(
  [() => province.value, () => mode.value, () => layer.value, () => sort.value, () => maxDays.value],
  () => {
    city.value = '';
    loadRoutes();
  },
);

let keywordTimer: ReturnType<typeof setTimeout> | undefined;
watch(keyword, () => {
  if (keywordTimer) clearTimeout(keywordTimer);
  keywordTimer = setTimeout(loadRoutes, 300);
});

function pickProvince(name: string) {
  province.value = province.value === name ? '' : name;
  if (name) provinceExpanded.value = true;
}

function pickCity(name: string) {
  city.value = city.value === name ? '' : name;
  loadRoutes();
}

/** 分层 chip 与省份/玩法是「与」关系；再点一次取消选择（传 '' 表示回到「全部」） */
function pickLayer(key: TravelLayer | '') {
  layer.value = layer.value === key ? '' : key;
}

/** 与省份/玩法/分层是「与」关系；再点一次取消（回到「全部」） */
function pickDays(key: number | '') {
  maxDays.value = maxDays.value === key ? '' : key;
}

function reset() {
  province.value = '';
  city.value = '';
  mode.value = '';
  layer.value = '';
  maxDays.value = '';
  keyword.value = '';
  sort.value = 'recommend';
  filtersOpen.value = false;
  provinceExpanded.value = false;
  sortOpen.value = false;
  loadRoutes();
}

function clearProvince() {
  province.value = '';
  city.value = '';
}

function clearCity() {
  city.value = '';
  loadRoutes();
}

function clearMode() {
  mode.value = '';
}

function clearLayer() {
  layer.value = '';
}

function clearDays() {
  maxDays.value = '';
}

function clearKeyword() {
  keyword.value = '';
}

function openDetail(id: string) {
  router.push(`/roadbook/${id}`);
}

/** 卡片用短季节：4-5·9-11月，避免指标格被「4、5、9、10、11 月」撑爆 */
function seasonText(months: number[]): string {
  if (!months.length || months.length === 12) return '全年';
  const sorted = [...new Set(months)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0]!;
  let end = start;
  for (let i = 1; i <= sorted.length; i += 1) {
    const n = sorted[i];
    if (n === end + 1) {
      end = n;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    if (n == null) break;
    start = n;
    end = n;
  }
  return `${ranges.join('·')}月`;
}
</script>

<template>
  <div class="rv-page">
    <main class="rv-shell">
      <header class="rb-hero">
        <div class="rb-hero__row">
          <div>
            <p class="rb-eyebrow">ROUTE BOOK</p>
            <h1>路书库</h1>
          </div>
          <p class="rb-stat">
            <b>{{ overview.totalRoutes }}</b> 条 ·
            <b>{{ provinces.length }}</b> 省
          </p>
        </div>
        <p class="rb-sub">按省份挑路线，点卡片看完整行程。</p>
      </header>

      <!-- 搜索 + 筛选入口 + 排序：始终占一行工具条 -->
      <section class="rb-toolbar" aria-label="搜索与筛选">
        <input
          v-model="keyword"
          class="rb-input"
          type="search"
          placeholder="搜路线 / 城市 / G318"
          enterkeyhint="search"
        />
        <div class="rb-toolbar__actions">
          <button
            type="button"
            class="rb-filter-toggle"
            :class="{ on: filtersOpen || moreFilterCount > 0 }"
            :aria-expanded="filtersOpen"
            aria-controls="rb-more-filters"
            @click="filtersOpen = !filtersOpen"
          >
            筛选
            <i v-if="moreFilterCount" class="rb-chip-n">{{ moreFilterCount }}</i>
          </button>
          <button
            v-if="hasActiveFilters"
            type="button"
            class="rb-reset"
            @click="reset"
          >
            重置
          </button>
        </div>
      </section>

      <!-- 已选条件：可点掉，避免展开面板才能改 -->
      <div v-if="hasActiveFilters" class="rb-active-bar" aria-label="已选条件">
        <button v-if="province" type="button" class="rb-active-chip" @click="clearProvince">
          {{ province }} ×
        </button>
        <button v-if="city" type="button" class="rb-active-chip" @click="clearCity">
          {{ city }} ×
        </button>
        <button v-if="layer" type="button" class="rb-active-chip" @click="clearLayer">
          {{ layerLabel(layer) }} ×
        </button>
        <button v-if="maxDays !== ''" type="button" class="rb-active-chip" @click="clearDays">
          {{ daysLabel(maxDays) }} ×
        </button>
        <button v-if="mode" type="button" class="rb-active-chip" @click="clearMode">
          {{ modeLabel(mode) }} ×
        </button>
        <button
          v-if="keyword.trim()"
          type="button"
          class="rb-active-chip"
          @click="clearKeyword"
        >
          “{{ keyword.trim() }}” ×
        </button>
      </div>

      <!-- 省份：换行展示，默认收成两行，避免窄屏横滑裁切 -->
      <section class="rb-filter-block rb-filter-block--slim">
        <div class="rb-filter-head rb-filter-head--row">
          <span>省份</span>
          <button
            type="button"
            class="rb-expand"
            @click="provinceExpanded = !provinceExpanded"
          >
            {{ provinceExpanded ? '收起' : '展开全部' }}
          </button>
        </div>
        <div
          class="rb-chips"
          :class="{ 'is-clamped': !provinceExpanded }"
          role="listbox"
          aria-label="选择省份"
        >
          <button
            type="button"
            class="rb-chip"
            :class="{ on: !province }"
            @click="pickProvince('')"
          >
            全部
          </button>
          <button
            v-for="p in provinces"
            :key="p.shortName"
            type="button"
            class="rb-chip"
            :class="{ on: province === p.shortName }"
            @click="pickProvince(p.shortName)"
          >
            {{ p.shortName }}
            <i v-if="routeCountByProvince[p.shortName]" class="rb-chip-n">
              {{ routeCountByProvince[p.shortName] }}
            </i>
          </button>
        </div>

        <template v-if="citiesOfProvince.length">
          <div class="rb-filter-head">{{ province }} · 城市</div>
          <div class="rb-chips">
            <button
              type="button"
              class="rb-chip sm"
              :class="{ on: !city }"
              @click="pickCity('')"
            >
              全部
            </button>
            <button
              v-for="c in selectableCities"
              :key="c.name"
              type="button"
              class="rb-chip sm"
              :class="{ on: city === c.name }"
              @click="pickCity(c.name)"
            >
              {{ c.name }}
              <i class="rb-chip-n">{{ c.routeIds?.length ?? 0 }}</i>
            </button>
          </div>
        </template>
      </section>

      <!-- 更多筛选：分层 / 天数 / 玩法 -->
      <section
        v-show="filtersOpen"
        id="rb-more-filters"
        class="rb-filter-block rb-filter-block--more"
      >
        <div class="rb-filter-group">
          <div
            class="rb-filter-head"
            title="顺序与推荐列表一致：景区几日游 → 周末周边 → 区域环线 → 国家级大环线 → 小众目的地"
          >
            内容分层
          </div>
          <div class="rb-chips">
            <button
              type="button"
              class="rb-chip"
              :class="{ on: !layer }"
              @click="pickLayer('')"
            >
              全部
            </button>
            <button
              v-for="l in LAYERS"
              :key="l.key"
              type="button"
              class="rb-chip"
              :class="[{ on: layer === l.key }, `tone-${l.key}`]"
              :title="l.label"
              @click="pickLayer(l.key)"
            >
              {{ l.label }}
              <i class="rb-chip-n">{{ layerCounts[l.key] ?? 0 }}</i>
            </button>
          </div>
        </div>

        <div class="rb-filter-group">
          <div class="rb-filter-head" title="按天数上限筛选，更短的周末线也会出现">天数</div>
          <div class="rb-chips">
            <button
              type="button"
              class="rb-chip"
              :class="{ on: maxDays === '' }"
              @click="pickDays('')"
            >
              全部
            </button>
            <button
              v-for="d in DAY_FILTERS.slice(1)"
              :key="d.key"
              type="button"
              class="rb-chip"
              :class="{ on: maxDays === d.key }"
              @click="pickDays(d.key)"
            >
              {{ d.label }}
            </button>
          </div>
        </div>

        <div class="rb-filter-group">
          <div class="rb-filter-head">玩法</div>
          <div class="rb-chips">
            <button
              type="button"
              class="rb-chip"
              :class="{ on: !mode }"
              @click="mode = ''"
            >
              不限
            </button>
            <button
              v-for="m in MODES"
              :key="m.key"
              type="button"
              class="rb-chip"
              :class="{ on: mode === m.key }"
              @click="mode = m.key"
            >
              {{ m.label }}
            </button>
          </div>
        </div>
      </section>

      <div class="rb-result-head">
        <span class="rb-result-head__count">共 <b>{{ total }}</b> 条</span>
        <div class="rb-sort">
          <button
            type="button"
            class="rb-sort__trigger"
            :aria-expanded="sortOpen"
            aria-haspopup="listbox"
            @click="sortOpen = !sortOpen"
          >
            <span class="rb-sort__label">{{ sortLabel }}</span>
            <svg class="rb-sort__chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M6 9l6 6 6-6"
              />
            </svg>
          </button>
          <ul
            v-show="sortOpen"
            class="rb-sort__menu"
            role="listbox"
            aria-label="排序方式"
          >
            <li v-for="s in SORTS" :key="s.key" role="option" :aria-selected="sort === s.key">
              <button
                type="button"
                class="rb-sort__item"
                :class="{ on: sort === s.key }"
                @click="pickSort(s.key)"
              >
                <span class="rb-sort__item-label">{{ s.label }}</span>
                <span class="rb-sort__item-hint">{{ s.hint }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="loading" class="rb-empty">正在加载路书…</div>
      <div v-else-if="error" class="rb-empty rb-empty--error">{{ error }}</div>
      <div v-else-if="!routes.length" class="rb-empty">
        这个组合暂时还没有路线。换个省份或玩法试试 —— 全国 393 个地级行政区正在逐一补全。
      </div>

      <section v-else class="rb-grid">
        <article
          v-for="r in routes"
          :key="r.id"
          class="rb-card"
          role="link"
          tabindex="0"
          @click="openDetail(r.id)"
          @keydown.enter.prevent="openDetail(r.id)"
        >
          <div class="rb-card-badges">
            <span class="rb-layer" :class="`is-${r.layer}`">{{ layerLabel(r.layer) }}</span>
            <span class="rb-shape" :class="`is-${r.shape}`">{{ SHAPE[r.shape] ?? r.shape }}</span>
          </div>
          <h2 class="rb-card-title">{{ r.name }}</h2>
          <p class="rb-card-sub">{{ r.subtitle }}</p>

          <ul class="rb-metrics" aria-label="路线要点">
            <li><b>{{ r.days }}</b><span>天</span></li>
            <li><b>{{ r.totalKm }}</b><span>km</span></li>
            <li class="rb-diff" :class="`is-d${r.difficulty}`">
              <b>{{ DIFFICULTY[r.difficulty] ?? r.difficulty }}</b><span>难度</span>
            </li>
            <li class="rb-season"><b>{{ seasonText(r.bestSeason) }}</b><span>季节</span></li>
          </ul>

          <footer class="rb-card-foot">
            <span class="rb-card-place">
              {{ r.provinces.slice(0, 2).join(' · ') }}
              <template v-if="r.cities?.length"> · {{ r.cities[0] }}</template>
            </span>
            <span class="rb-more">详情</span>
          </footer>
        </article>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* 与 select-hero / drive-hero / ticket-hero 同级字号 */
.rb-hero {
  margin: 0 0 var(--space-5);
  padding: 0;
}

.rb-hero__row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
}

.rb-eyebrow {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-eyebrow);
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
}

.rb-hero h1 {
  margin: 0;
  font-size: var(--fs-display);
  font-weight: 700;
  line-height: var(--lh-tight);
  letter-spacing: -0.01em;
  color: var(--text-1);
}

.rb-sub {
  margin: var(--space-2) 0 0;
  max-width: 36em;
  font-size: var(--fs-meta);
  line-height: var(--lh-normal);
  color: var(--text-2);
}

.rb-stat {
  margin: 0;
  flex-shrink: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
  text-align: right;
  line-height: 1.4;
}

.rb-stat b {
  color: var(--text-1);
  font-weight: 600;
}

/* 搜索 + 筛选入口 */
.rb-toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.rb-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.rb-filter-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: var(--fs-cap);
  font-weight: 600;
  cursor: pointer;
}

.rb-filter-toggle.on {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--text-1);
}

/* 已选摘要：横滑可点掉 */
.rb-active-bar {
  display: flex;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.rb-active-bar::-webkit-scrollbar {
  display: none;
}

.rb-active-chip {
  flex-shrink: 0;
  min-height: 32px;
  padding: 4px var(--space-3);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-full);
  background: var(--accent-soft);
  color: var(--text-1);
  font-size: var(--fs-cap);
  cursor: pointer;
  white-space: nowrap;
}

.rb-filter-block {
  margin-bottom: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  backdrop-filter: blur(var(--glass-blur-tile));
}

.rb-filter-block--slim {
  padding-block: var(--space-2) var(--space-3);
}

.rb-filter-block--more {
  display: grid;
  gap: var(--space-3);
}

.rb-filter-group + .rb-filter-group {
  padding-top: var(--space-3);
  border-top: 1px solid var(--line-hairline);
}

.rb-filter-head {
  margin-bottom: var(--space-2);
  font-size: var(--fs-meta);
  font-weight: 600;
  color: var(--text-2);
}

.rb-filter-head--row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.rb-expand {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-cap);
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  min-height: 32px;
  padding: 0 var(--space-1);
}

.rb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* 省份默认两行，点「展开全部」看齐 */
.rb-chips.is-clamped {
  max-height: calc(36px * 2 + var(--space-2));
  overflow: hidden;
}

.rb-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 36px;
  padding: 6px var(--space-3);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-full);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: var(--fs-cap);
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard);
}

.rb-chip.sm {
  min-height: 32px;
  padding: 4px var(--space-3);
  font-size: var(--fs-cap);
}

/* 触控命中区扩展：≥44×44（视觉尺寸保持紧凑） */
.rb-chip::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: max(100%, var(--hit-min));
  height: max(100%, var(--hit-min));
  transform: translate(-50%, -50%);
}

@media (hover: hover) and (pointer: fine) {
  .rb-chip:hover {
    color: var(--text-1);
    border-color: var(--line-strong);
  }
}

.rb-chip.on {
  color: var(--text-1);
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.rb-chip.tone-L3.on {
  color: var(--train);
  border-color: rgba(116, 189, 137, 0.45);
  background: rgba(116, 189, 137, 0.14);
}
.rb-chip.tone-L4.on {
  color: var(--accent);
  border-color: var(--accent-border);
  background: var(--accent-soft);
}
.rb-chip.tone-L2.on {
  color: var(--warning);
  border-color: rgba(224, 177, 85, 0.45);
  background: var(--warning-soft);
}
.rb-chip.tone-L1.on {
  color: var(--purple);
  border-color: rgba(157, 140, 240, 0.45);
  background: var(--purple-soft);
}
.rb-chip.tone-L5.on {
  color: var(--spot);
  border-color: rgba(224, 145, 90, 0.45);
  background: rgba(224, 145, 90, 0.14);
}

.rb-chip-n {
  font-style: normal;
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.rb-chip.on .rb-chip-n {
  color: inherit;
  opacity: 0.85;
}

.rb-input {
  width: 100%;
  min-height: 46px;
  padding: 0 var(--space-3);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-1);
  font-size: var(--fs-input);
}

.rb-input::placeholder {
  color: var(--text-3);
}

.rb-reset {
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: var(--fs-cap);
  cursor: pointer;
  font-family: inherit;
}

@media (hover: hover) and (pointer: fine) {
  .rb-reset:hover {
    color: var(--text-1);
    border-color: var(--line-strong);
  }
}

.rb-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0 0 var(--space-3);
  font-size: var(--fs-meta);
  color: var(--text-3);
}

.rb-result-head__count b {
  color: var(--text-1);
}

/* 自定义排序菜单：对齐暗色玻璃风格，选项完整可见 */
.rb-sort {
  position: relative;
  flex-shrink: 0;
}

.rb-sort__trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  padding: 0 var(--space-2) 0 var(--space-3);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-full);
  background: var(--surface-2);
  color: var(--text-1);
  font-size: var(--fs-cap);
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}

.rb-sort__trigger[aria-expanded='true'] {
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.rb-sort__chev {
  color: var(--text-3);
  transition: transform var(--dur-fast) var(--ease-standard);
}

.rb-sort__trigger[aria-expanded='true'] .rb-sort__chev {
  transform: rotate(180deg);
  color: var(--accent);
}

.rb-sort__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  min-width: min(240px, 78vw);
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  border: 1px solid var(--line-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  box-shadow: var(--elev-3);
}

.rb-sort__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-1);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.rb-sort__item-label {
  font-size: var(--fs-meta);
  font-weight: 600;
}

.rb-sort__item-hint {
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.rb-sort__item.on {
  background: var(--accent-soft);
  color: var(--text-1);
}

.rb-sort__item.on .rb-sort__item-hint {
  color: color-mix(in srgb, var(--accent) 70%, var(--text-3));
}

@media (hover: hover) and (pointer: fine) {
  .rb-sort__item:hover {
    background: var(--fill-accent);
  }
}

.rb-empty {
  padding: var(--space-8) var(--space-4);
  border: 1px dashed var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-3);
  font-size: var(--fs-meta);
  text-align: center;
  line-height: 1.8;
}

.rb-empty--error {
  color: var(--danger);
}

/* ── 精简卡片：一眼扫完，点进详情看全文 ───────────────────────────────── */
.rb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-3);
  padding-bottom: var(--space-10);
}

.rb-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 188px;
  padding: var(--space-4);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  backdrop-filter: blur(var(--glass-blur-tile));
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard),
    box-shadow var(--dur-base) var(--ease-standard);
}

.rb-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent);
  opacity: 0.75;
}

.rb-card:focus-visible {
  border-color: var(--accent-border);
  transform: translateY(-2px);
  outline: none;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
}

@media (hover: hover) and (pointer: fine) {
  .rb-card:hover {
    border-color: var(--accent-border);
    transform: translateY(-2px);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
  }
}

.rb-card:hover .rb-more,
.rb-card:focus-visible .rb-more {
  color: var(--accent-hover);
}

.rb-card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.rb-layer,
.rb-shape {
  padding: 1px 8px;
  border: 1px solid var(--line-default);
  border-radius: var(--radius-xs);
  background: var(--fill-subtle);
  color: var(--text-3);
  font-size: var(--fs-micro);
  white-space: nowrap;
}

.rb-card-title {
  margin: 0;
  font-size: var(--fs-h2);
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-1);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rb-card-sub {
  margin: 0;
  font-size: var(--fs-cap);
  line-height: 1.5;
  color: var(--text-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rb-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-1);
  margin: var(--space-1) 0 0;
  padding: 0;
  list-style: none;
}

.rb-metrics li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-1);
  border-radius: var(--radius-xs);
  background: var(--surface-2);
  text-align: center;
  min-width: 0;
}

.rb-metrics b {
  font-size: var(--fs-meta);
  font-weight: 600;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rb-metrics span {
  font-size: var(--fs-micro);
  color: var(--text-3);
}

/* 列表卡统一灰蓝底，难度仅用字色轻区分，不铺色块 */
.rb-diff.is-d1 b,
.rb-diff.is-d2 b {
  color: var(--success);
}
.rb-diff.is-d3 b {
  color: var(--warning);
}
.rb-diff.is-d4 b,
.rb-diff.is-d5 b {
  color: var(--danger);
}

.rb-card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  margin-top: auto;
  padding-top: var(--space-3);
  border-top: 1px solid var(--line-hairline);
  font-size: var(--fs-cap);
}

.rb-card-place {
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rb-more {
  flex-shrink: 0;
  color: var(--accent);
  font-weight: 500;
}

.rb-more::after {
  content: ' →';
}

@media (min-width: 720px) {
  .rb-toolbar {
    flex-direction: row;
    align-items: center;
  }

  .rb-input {
    flex: 1 1 auto;
  }

  .rb-toolbar__actions {
    flex-shrink: 0;
  }

  /* 宽屏省份直接铺开，不必再点展开 */
  .rb-chips.is-clamped {
    max-height: none;
    overflow: visible;
  }

  .rb-expand {
    display: none;
  }
}

@media (max-width: 599px) {
  .rb-grid {
    grid-template-columns: 1fr;
  }

  .rb-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .rb-chip,
  .rb-card,
  .rb-reset {
    transition: none;
  }
}
</style>
