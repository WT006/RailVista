<script setup lang="ts">
/**
 * 万里路书 · 路书库首页。
 *
 * 三层结构对应需求 5：省份 → 城市 → 路线。
 *   - 省份横向 chips（覆盖率一眼可见：已开 vs 待补）
 *   - 选中省后展示该省地级城市，点击即按城市筛选（coverage=todo 的不可选）
 *   - 玩法 chips 明确「不限于自驾」：自驾 / 包车 / 公共交通 / 骑行 / 徒步 / 混合
 * 筛选全部走 GET /api/travel/routes，与 shared 层共用同一套 matchTravelRoute。
 */
import { computed, onMounted, ref, watch } from 'vue';
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

const SORTS: { key: string; label: string }[] = [
  { key: 'recommend', label: '推荐序' },
  { key: 'layer', label: '按层级' },
  { key: 'days-asc', label: '天数少→多' },
  { key: 'km-desc', label: '里程长→短' },
  { key: 'km-asc', label: '里程短→长' },
];

const DIFFICULTY: Record<number, string> = { 1: '轻松', 2: '休闲', 3: '中等', 4: '较难', 5: '挑战' };
const SHAPE: Record<string, string> = { loop: '环线', point: '单程', outback: '往返', corridor: '走廊' };
const modeLabel = (k: string) => MODES.find((m) => m.key === k)?.label ?? k;
const layerLabel = (k: string) => LAYERS.find((l) => l.key === k)?.label ?? k;

/** 当前选中省的城市列表（含覆盖标记），用于二级联动 */
const citiesOfProvince = computed(() => {
  const p = provinces.value.find((x) => x.shortName === province.value);
  return p ? p.cities : [];
});

const selectableCities = computed(() => citiesOfProvince.value.filter((c) => c.routeIds?.length));

/** 每个省挂了几条路线（用于 chips 上的角标） */
const routeCountByProvince = computed(() => {
  const map = new Map<string, number>();
  for (const r of routes.value) {
    for (const p of r.provinces) map.set(p, (map.get(p) ?? 0) + 1);
  }
  return map;
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
      q: keyword.value.trim() || undefined,
      sort: sort.value,
      limit: 100,
    });
    routes.value = data.routes;
    total.value = data.total;
    layerCounts.value = data.counts?.byLayer ?? { ...EMPTY_LAYER_COUNTS };
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    await loadOverview();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '区划数据加载失败';
  }
  await loadRoutes();
});

// 省份切换时清空城市；其余条件变化时重新拉列表
watch([() => province.value, () => mode.value, () => layer.value, () => sort.value], () => {
  city.value = '';
  loadRoutes();
});

let keywordTimer: ReturnType<typeof setTimeout> | undefined;
watch(keyword, () => {
  if (keywordTimer) clearTimeout(keywordTimer);
  keywordTimer = setTimeout(loadRoutes, 300);
});

function pickProvince(name: string) {
  province.value = province.value === name ? '' : name;
}

function pickCity(name: string) {
  city.value = city.value === name ? '' : name;
  loadRoutes();
}

/** 分层 chip 与省份/玩法是「与」关系；再点一次取消选择（传 '' 表示回到「全部」） */
function pickLayer(key: TravelLayer | '') {
  layer.value = layer.value === key ? '' : key;
}

function reset() {
  province.value = '';
  city.value = '';
  mode.value = '';
  layer.value = '';
  keyword.value = '';
  sort.value = 'recommend';
  loadRoutes();
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
        <p class="rb-eyebrow">ROUTE BOOK</p>
        <h1>路书库</h1>
        <p class="rb-sub">
          按省份与城市挑选路线。自驾、包车、公共交通、骑行、徒步均可；点进卡片看完整行程。
        </p>
        <p class="rb-stat">
          <b>{{ overview.totalRoutes }}</b> 条路线 ·
          <b>{{ overview.totalPois }}</b> 处景点 ·
          <b>{{ provinces.length }}</b> 省区
          <span v-if="overview.latestUpdated"> · {{ overview.latestUpdated }}</span>
        </p>
      </header>

      <!-- 省 → 市 两级联动 -->
      <section class="rb-filter-block">
        <div class="rb-filter-head">省份</div>
        <div class="rb-chips">
          <button class="rb-chip" :class="{ on: !province }" @click="pickProvince('')">全部</button>
          <button
            v-for="p in provinces"
            :key="p.shortName"
            class="rb-chip"
            :class="{ on: province === p.shortName }"
            @click="pickProvince(p.shortName)"
          >
            {{ p.shortName }}
            <i v-if="routeCountByProvince.get(p.shortName)" class="rb-chip-n">
              {{ routeCountByProvince.get(p.shortName) }}
            </i>
          </button>
        </div>

        <template v-if="citiesOfProvince.length">
          <div class="rb-filter-head">{{ province }} · 城市</div>
          <div class="rb-chips">
            <button class="rb-chip sm" :class="{ on: !city }" @click="pickCity('')">全部</button>
            <button
              v-for="c in selectableCities"
              :key="c.name"
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

      <section class="rb-filter-block rb-filter-block--tools">
        <div class="rb-tools">
          <div class="rb-chips rb-chips--inline">
            <button class="rb-chip" :class="{ on: !layer }" @click="pickLayer('')">全部层</button>
            <button
              v-for="l in LAYERS"
              :key="l.key"
              class="rb-chip"
              :class="[{ on: layer === l.key }, `tone-${l.key}`]"
              :title="l.label"
              @click="pickLayer(l.key)"
            >
              {{ l.label }}
              <i class="rb-chip-n">{{ layerCounts[l.key] ?? 0 }}</i>
            </button>
          </div>
          <div class="rb-chips rb-chips--inline">
            <button class="rb-chip" :class="{ on: !mode }" @click="mode = ''">玩法不限</button>
            <button
              v-for="m in MODES"
              :key="m.key"
              class="rb-chip"
              :class="{ on: mode === m.key }"
              @click="mode = m.key"
            >
              {{ m.label }}
            </button>
          </div>
          <div class="rb-row">
            <input
              v-model="keyword"
              class="rb-input"
              type="search"
              placeholder="搜路线 / 城市 / G318"
            />
            <select v-model="sort" class="rb-select">
              <option v-for="s in SORTS" :key="s.key" :value="s.key">{{ s.label }}</option>
            </select>
            <button class="rb-reset" @click="reset">重置</button>
          </div>
        </div>
      </section>

      <div class="rb-result-head">
        共 <b>{{ total }}</b> 条
        <span v-if="province || city || mode || layer || keyword" class="rb-active">
          ·
          <span v-if="province">{{ province }}</span>
          <span v-if="city"> / {{ city }}</span>
          <span v-if="mode"> / {{ modeLabel(mode) }}</span>
          <span v-if="layer"> / {{ layerLabel(layer) }}</span>
          <span v-if="keyword.trim()"> / “{{ keyword.trim() }}”</span>
        </span>
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
.rb-hero {
  padding: var(--space-5) 0 var(--space-4);
}

.rb-eyebrow {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-eyebrow);
  letter-spacing: 0.18em;
  color: var(--text-3);
}

.rb-hero h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-display);
  font-weight: 600;
  color: var(--text-1);
}

.rb-sub,
.rb-stat {
  margin: 0;
  max-width: 52ch;
  font-size: var(--fs-body);
  line-height: 1.65;
  color: var(--text-2);
}

.rb-stat {
  margin-top: var(--space-2);
  font-size: var(--fs-meta);
  color: var(--text-3);
}

.rb-stat b {
  color: var(--text-1);
  font-weight: 600;
}

.rb-filter-block {
  margin-bottom: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  backdrop-filter: blur(var(--glass-blur-tile));
}

.rb-filter-block--tools {
  padding-bottom: var(--space-4);
}

.rb-filter-head {
  margin-bottom: var(--space-2);
  font-size: var(--fs-meta);
  font-weight: 600;
  color: var(--text-2);
}

.rb-tools {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.rb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.rb-chips--inline {
  margin: 0;
}

.rb-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 5px var(--space-3);
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
  padding: 3px var(--space-2);
}

.rb-chip:hover {
  color: var(--text-1);
  border-color: var(--line-strong);
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

.rb-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
}

.rb-input {
  flex: 1 1 220px;
  min-height: 36px;
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

.rb-select,
.rb-reset {
  min-height: 36px;
  padding: 0 var(--space-3);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: var(--fs-cap);
  cursor: pointer;
}

.rb-reset:hover {
  color: var(--text-1);
  border-color: var(--line-strong);
}

.rb-result-head {
  margin: var(--space-3) 0 var(--space-3);
  font-size: var(--fs-meta);
  color: var(--text-3);
}

.rb-result-head b {
  color: var(--text-1);
}

.rb-active span {
  margin-left: 2px;
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

.rb-card:hover,
.rb-card:focus-visible {
  border-color: var(--accent-border);
  transform: translateY(-2px);
  outline: none;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
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

@media (max-width: 640px) {
  .rb-grid {
    grid-template-columns: 1fr;
  }

  .rb-input {
    flex-basis: 100%;
  }

  .rb-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
