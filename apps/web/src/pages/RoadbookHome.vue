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

function seasonText(months: number[]): string {
  if (!months.length || months.length === 12) return '全年';
  const sorted = [...new Set(months)].sort((a, b) => a - b);
  return sorted.join('、') + ' 月';
}
</script>

<template>
  <div class="rv-page">
    <main class="rv-shell">
      <header class="rb-hero">
        <p class="rb-eyebrow">ROUTE BOOK</p>
        <h1>路书库</h1>
        <p class="rb-sub">
          按「省份 → 城市」组织的旅行路线库。路线类型不限于自驾——同一条线路通常同时支持
          包车、公共交通、骑行或徒步，每条的路书里都写清楚了无车怎么走。
        </p>
        <p class="rb-stat">
          收录 <b>{{ overview.totalRoutes }}</b> 条路线 ·
          <b>{{ overview.totalPois }}</b> 个景点 ·
          覆盖全国 <b>{{ provinces.length }}</b> 个省级行政区
          <span v-if="overview.latestUpdated"> · 更新于 {{ overview.latestUpdated }}</span>
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
          <div class="rb-filter-head">
            {{ province }} 的城市
            <span class="rb-filter-hint">
              （灰显表示尚未收录独立路线；数字为已有路线数）
            </span>
          </div>
          <div class="rb-chips">
            <button class="rb-chip sm" :class="{ on: !city }" @click="pickCity('')">全部城市</button>
            <button
              v-for="c in citiesOfProvince"
              :key="c.name"
              class="rb-chip sm"
              :class="{ on: city === c.name, todo: !c.routeIds?.length }"
              @click="pickCity(c.name)"
            >
              {{ c.name }}
              <i v-if="c.routeIds?.length" class="rb-chip-n">{{ c.routeIds.length }}</i>
            </button>
          </div>
        </template>
      </section>

      <!-- 内容分层 L1~L5（颗粒度维度，与省份 / 玩法是「与」关系） -->
      <section class="rb-filter-block">
        <div class="rb-filter-head">
          内容分层
          <span class="rb-filter-hint">
            （顺序与推荐列表的出现先后一致：景区几日游 → 周末周边 → 区域环线 → 国家级大环线 → 小众目的地）
          </span>
        </div>
        <div class="rb-chips">
          <button class="rb-chip" :class="{ on: !layer }" @click="pickLayer('')">全部</button>
          <button
            v-for="l in LAYERS"
            :key="l.key"
            class="rb-chip"
            :class="{ on: layer === l.key }"
            @click="pickLayer(l.key)"
          >
            {{ l.label }}
            <i class="rb-chip-n">{{ layerCounts[l.key] ?? 0 }}</i>
          </button>
        </div>
      </section>

      <!-- 玩法 + 关键词 + 排序 -->
      <section class="rb-filter-block">
        <div class="rb-filter-head">玩法</div>
        <div class="rb-chips">
          <button class="rb-chip" :class="{ on: !mode }" @click="mode = ''">不限</button>
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
            placeholder="搜路线名 / 城市 / 公路编号（如 G318）"
          />
          <select v-model="sort" class="rb-select">
            <option v-for="s in SORTS" :key="s.key" :value="s.key">{{ s.label }}</option>
          </select>
          <button class="rb-reset" @click="reset">重置</button>
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
          @click="openDetail(r.id)"
        >
          <header class="rb-card-head">
            <div class="rb-card-title">
              <h2>{{ r.name }}</h2>
              <span class="rb-layer">{{ layerLabel(r.layer) }}</span>
              <span class="rb-shape">{{ SHAPE[r.shape] ?? r.shape }}</span>
            </div>
            <p class="rb-card-sub">{{ r.subtitle }}</p>
          </header>

          <div class="rb-metrics">
            <span class="rb-metric"><i>{{ r.days }}</i>天</span>
            <span class="rb-metric"><i>{{ r.totalKm }}</i>km</span>
            <span class="rb-metric">难度 <i>{{ DIFFICULTY[r.difficulty] ?? r.difficulty }}</i></span>
            <span class="rb-metric">{{ seasonText(r.bestSeason) }}</span>
          </div>

          <p class="rb-summary">{{ r.summary }}</p>

          <div class="rb-modes">
            <span v-for="m in r.modes" :key="m" class="rb-tag rb-tag--mode">{{ modeLabel(m) }}</span>
          </div>

          <div class="rb-roads">
            <span v-for="ref in r.roadRefs.slice(0, 6)" :key="ref" class="rb-road">{{ ref }}</span>
          </div>

          <footer class="rb-card-foot">
            <span>{{ r.poiCount }} 个景点 · {{ r.planCount }} 天行程 · {{ r.segmentCount }} 段公路</span>
            <span class="rb-more">查看路书 →</span>
          </footer>
        </article>
      </section>
    </main>
  </div>
</template>

<style scoped>
.rb-page-shell {
  min-height: 100%;
}

.rb-hero {
  padding: var(--space-6) 0 var(--space-5);
}

.rb-eyebrow {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-eyebrow);
  letter-spacing: 0.18em;
  color: var(--text-3);
}

.rb-hero h1 {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-display);
  font-weight: 600;
  color: var(--text-1);
}

.rb-sub,
.rb-stat {
  margin: 0;
  max-width: 62ch;
  font-size: var(--fs-body);
  line-height: 1.7;
  color: var(--text-2);
}

.rb-stat {
  margin-top: var(--space-3);
  font-size: var(--fs-meta);
  color: var(--text-3);
}

.rb-stat b {
  color: var(--text-1);
  font-weight: 600;
}

/* ── 筛选区 ───────────────────────────────────────────────────────────── */
.rb-filter-block {
  margin-bottom: var(--space-5);
  padding: var(--space-4);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  backdrop-filter: blur(var(--glass-blur-tile));
}

.rb-filter-head {
  margin-bottom: var(--space-3);
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
}

.rb-filter-hint {
  margin-left: var(--space-2);
  font-size: var(--fs-cap);
  font-weight: 400;
  color: var(--text-3);
}

.rb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.rb-chips:last-child {
  margin-bottom: 0;
}

.rb-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 6px var(--space-3);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-full);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: var(--fs-meta);
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard);
}

.rb-chip.sm {
  padding: 4px var(--space-3);
  font-size: var(--fs-cap);
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

/* 尚无路线的城市：保留可见性但弱化，把「还没补」这件事透明化 */
.rb-chip.todo {
  opacity: 0.42;
  cursor: not-allowed;
}

.rb-chip-n {
  font-style: normal;
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.rb-chip.on .rb-chip-n {
  color: var(--accent);
}

.rb-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
}

.rb-input {
  flex: 1 1 260px;
  min-height: 40px;
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
  min-height: 40px;
  padding: 0 var(--space-3);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: var(--fs-meta);
  cursor: pointer;
}

.rb-reset:hover {
  color: var(--text-1);
  border-color: var(--line-strong);
}

.rb-result-head {
  margin: var(--space-4) 0 var(--space-3);
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
  color: #ff8f8f;
}

/* ── 路线卡片 ─────────────────────────────────────────────────────────── */
.rb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: var(--space-4);
  padding-bottom: var(--space-10);
}

.rb-card {
  display: flex;
  flex-direction: column;
  padding: var(--pad-card);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  backdrop-filter: blur(var(--glass-blur-tile));
  cursor: pointer;
  transition:
    border-color var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}

.rb-card:hover {
  border-color: var(--accent-border);
  transform: translateY(-2px);
}

.rb-card-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.rb-card-title h2 {
  margin: 0;
  font-size: var(--fs-h2);
  font-weight: 600;
  color: var(--text-1);
}

/* 内容分层角标：轮转排序会把 5 个层混排，卡片上必须能一眼看出这条是哪一层 */
.rb-layer {
  padding: 1px 8px;
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-xs);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--fs-micro);
  white-space: nowrap;
}

.rb-shape {
  padding: 1px 8px;
  border: 1px solid var(--line-default);
  border-radius: var(--radius-xs);
  color: var(--text-3);
  font-size: var(--fs-micro);
}

.rb-card-sub {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-meta);
  color: var(--text-2);
  line-height: 1.6;
}

.rb-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-3) 0;
}

.rb-metric {
  padding: 2px var(--space-2);
  border-radius: var(--radius-xs);
  background: var(--surface-2);
  color: var(--text-3);
  font-size: var(--fs-cap);
}

.rb-metric i {
  font-style: normal;
  font-weight: 600;
  color: var(--text-1);
}

.rb-summary {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-meta);
  line-height: 1.75;
  color: var(--text-2);
}

.rb-modes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-bottom: var(--space-2);
}

.rb-tag {
  padding: 2px var(--space-2);
  border-radius: var(--radius-xs);
  font-size: var(--fs-cap);
}

.rb-tag--mode {
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
  color: var(--accent);
}

.rb-roads {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
}

.rb-road {
  padding: 1px 6px;
  border: 1px solid var(--line-default);
  border-radius: var(--radius-xs);
  color: var(--text-3);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
}

.rb-card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  padding-top: var(--space-3);
  border-top: 1px solid var(--line-hairline);
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.rb-more {
  color: var(--accent);
}

@media (max-width: 640px) {
  .rb-grid {
    grid-template-columns: 1fr;
  }

  .rb-input {
    flex-basis: 100%;
  }
}
</style>
