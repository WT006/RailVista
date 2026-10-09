<script setup lang="ts">
/**
 * 万里路书 · 单条路书详情。
 *
 * 按需求顺序组织：
 *   ① 整体介绍（最佳季节 / 建议天数 / 难度 / 适合人群）
 *   ② 道路分段表（国道 Gxxx、省道 Sxxx + 起止 + 里程 + 路况）
 *   ③ 逐日行程
 *   ④ 沿途核心景点（名称 + 所在省市 + 特色 + 介绍）
 *   ⑤ 实用信息（无车方案 / 证件 / 加油 / 信号 / 装备 / 警示）
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import { TRAVEL_LAYER_LABEL, type TravelRouteDetail } from '@railvista/shared';

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const error = ref('');
const detail = ref<TravelRouteDetail | null>(null);
const activeTab = ref<'overview' | 'roads' | 'plan' | 'spots' | 'tips'>('overview');

const TABS = [
  { key: 'overview', label: '整体介绍' },
  { key: 'roads', label: '道路分段' },
  { key: 'plan', label: '逐日行程' },
  { key: 'spots', label: '沿途景点' },
  { key: 'tips', label: '实用信息' },
] as const;

const DIFFICULTY: Record<number, string> = { 1: '轻松', 2: '休闲', 3: '中等', 4: '较难', 5: '挑战' };
const SHAPE: Record<string, string> = { loop: '环线', point: '单程', outback: '往返', corridor: '走廊' };
const TIER: Record<string, string> = { national: '国家级', regional: '区域级', city: '城市级' };
const MODE: Record<string, string> = {
  selfdrive: '自驾',
  charter: '包车/拼车',
  public: '公共交通',
  cycling: '骑行',
  hiking: '徒步',
  mixed: '混合玩法',
};
const CATEGORY: Record<string, string> = {
  mountain: '雪山冰川',
  water: '湖泊河流',
  landform: '地貌奇观',
  grassland: '草原牧场',
  forest: '森林峡谷',
  desert: '沙漠戈壁',
  village: '古村古镇',
  temple: '寺庙宗教',
  ruin: '遗址古迹',
  culture: '人文民俗',
  cityview: '城市景观',
  roadside: '沿途小景',
  food: '风味美食',
};

const modeLabel = (k: string) => MODE[k] ?? k;
const seasonText = (months: number[]): string => {
  if (!months.length || months.length === 12) return '全年';
  return [...new Set(months)].sort((a, b) => a - b).join('、') + ' 月';
};

/** 分段 → 该段覆盖的景点，用于详情页里「这段路能看到什么」 */
const poisBySection = computed(() => {
  const d = detail.value;
  if (!d) return [];
  return d.segments.map((s) => ({
    seg: s,
    pois: s.poiIds.map((id) => d.pois.find((p) => p.id === id)).filter(Boolean),
  }));
});

const mustSeeSpots = computed(() => detail.value?.pois.filter((p) => p.mustSee) ?? []);

const practicalRows = computed(() => {
  const p = detail.value?.practical;
  if (!p) return [];
  const rows: { label: string; value: string }[] = [
    { label: '证件与预约', value: p.permit ?? '' },
    { label: '海拔提示', value: p.altitudeNote ?? '' },
    { label: '无车方案', value: p.carFree ?? '' },
    { label: '加油充电', value: p.fuelNote ?? '' },
    { label: '信号通讯', value: p.signalNote ?? '' },
    { label: '装备', value: p.gearNote ?? '' },
    { label: '预订提示', value: p.bookingNote ?? '' },
  ];
  return rows.filter((r) => r.value);
});

onMounted(async () => {
  const id = String(route.params.routeId ?? '');
  if (!id) {
    error.value = '缺少路书 id';
    loading.value = false;
    return;
  }
  try {
    detail.value = await api.getTravelRoute(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="rv-page">
    <main class="rv-shell">
      <div v-if="loading" class="rd-state">正在加载路书…</div>
      <div v-else-if="error" class="rd-state rd-state--error">
        {{ error }}
        <button class="rd-back" @click="router.push('/roadbook')">返回路书库</button>
      </div>

      <div
        v-else-if="detail"
        class="rd-detail"
        :class="detail.layer ? `is-${detail.layer}` : ''"
      >
        <nav class="rd-crumb">
          <RouterLink to="/roadbook">路书库</RouterLink>
          <span>/</span>
          <span>{{ detail.provinces.join(' · ') }}</span>
          <span>/</span>
          <b>{{ detail.name }}</b>
        </nav>

        <header class="rd-hero">
          <div class="rd-card-badges">
            <span
              v-if="detail.layer"
              class="rd-badge rd-badge--layer"
              :class="`is-${detail.layer}`"
            >
              {{ TRAVEL_LAYER_LABEL[detail.layer] ?? detail.layer }}
            </span>
            <span class="rd-badge rd-badge--shape" :class="`is-${detail.shape}`">
              {{ SHAPE[detail.shape] ?? detail.shape }}
            </span>
            <span class="rd-badge">{{ TIER[detail.tier] ?? detail.tier }}</span>
          </div>
          <h1>{{ detail.name }}</h1>
          <p class="rd-subtitle">{{ detail.subtitle }}</p>

          <ul class="rd-metrics" aria-label="路线要点">
            <li><b>{{ detail.days }}</b><span>天</span></li>
            <li><b>{{ detail.totalKm }}</b><span>km</span></li>
            <li class="rd-diff" :class="`is-d${detail.difficulty}`">
              <b>{{ DIFFICULTY[detail.difficulty] ?? detail.difficulty }}</b><span>难度</span>
            </li>
            <li class="rd-season"><b>{{ seasonText(detail.bestSeason) }}</b><span>季节</span></li>
            <li><b>{{ detail.pois.length }}</b><span>景点</span></li>
          </ul>

          <div class="rd-route-line">
            <span class="rd-node-pin">{{ detail.startNode }}</span>
            <span class="rd-line" aria-hidden="true" />
            <span class="rd-node-pin rd-node-pin--end">{{ detail.endNode }}</span>
            <span v-if="detail.cities.length" class="rd-cities">{{ detail.cities.join(' · ') }}</span>
          </div>

          <div class="rd-modes">
            <span v-for="m in detail.modes" :key="m" class="rd-tag rd-tag--mode">
              {{ modeLabel(m) }}
            </span>
            <span v-for="ref in detail.roadRefs.slice(0, 8)" :key="ref" class="rd-tag rd-tag--road">
              {{ ref }}
            </span>
            <span v-for="t in detail.tags.slice(0, 6)" :key="t" class="rd-tag">#{{ t }}</span>
          </div>

          <p class="rd-summary">{{ detail.summary }}</p>
        </header>

        <nav class="rd-tabs" aria-label="路书章节">
          <button
            v-for="t in TABS"
            :key="t.key"
            type="button"
            class="rd-tab"
            :class="{ on: activeTab === t.key }"
            @click="activeTab = t.key"
          >
            {{ t.label }}
          </button>
        </nav>

        <!-- ① 整体介绍 -->
        <section v-if="activeTab === 'overview'" class="rd-section">
          <p class="rd-lede">{{ detail.intro.overview }}</p>

          <div class="rd-info-grid">
            <div class="rd-info-card">
              <h3>最佳季节</h3>
              <p>{{ detail.intro.bestSeason }}</p>
              <ul v-if="detail.intro.seasonNotes?.length" class="rd-mini-list">
                <li v-for="(sn, i) in detail.intro.seasonNotes" :key="i">
                  <b>{{ seasonText(sn.months) }}</b>：{{ sn.note }}
                </li>
              </ul>
            </div>
            <div class="rd-info-card">
              <h3>建议天数</h3>
              <p><b>{{ detail.intro.days }}</b> 天</p>
              <p v-if="detail.intro.daysNote" class="rd-note">{{ detail.intro.daysNote }}</p>
            </div>
            <div class="rd-info-card">
              <h3>难度说明</h3>
              <p>
                <b>{{ DIFFICULTY[detail.intro.difficulty] ?? detail.intro.difficulty }}</b>
                （{{ detail.intro.difficulty }}/5）
              </p>
              <p class="rd-note">{{ detail.intro.difficultyNote }}</p>
            </div>
            <div class="rd-info-card">
              <h3>适合人群</h3>
              <ul class="rd-mini-list">
                <li v-for="(a, i) in detail.intro.audience" :key="i">{{ a }}</li>
              </ul>
              <p v-if="detail.intro.avoid?.length" class="rd-note rd-note--warn">
                不建议：{{ detail.intro.avoid.join('；') }}
              </p>
            </div>
          </div>

          <p v-if="detail.mileageNote" class="rd-foot-note">{{ detail.mileageNote }}</p>
        </section>

        <!-- ② 道路分段 -->
        <section v-else-if="activeTab === 'roads'" class="rd-section">
          <p class="rd-lede-sm">
            全线 {{ detail.segments.length }} 个路段。道路编号取自本项目内的公路索引，
            没有公开稳定编号的路段以俗称标注。
          </p>
          <ol class="rd-seg-list">
            <li v-for="row in poisBySection" :key="row.seg.id" class="rd-seg">
              <div class="rd-seg-head">
                <span class="rd-seg-idx">{{ row.seg.index }}</span>
                <div>
                  <h3>{{ row.seg.name }}</h3>
                  <p class="rd-seg-nodes">
                    {{ row.seg.fromNode }} → {{ row.seg.toNode }}
                    <span v-if="row.seg.via?.length"> · 途经 {{ row.seg.via.join(' / ') }}</span>
                  </p>
                </div>
                <div class="rd-seg-km">
                  <b>{{ row.seg.distanceKm }}</b> km
                  <span v-if="row.seg.driveHours">约 {{ row.seg.driveHours }}h</span>
                </div>
              </div>
              <div class="rd-seg-refs">
                <span v-for="ref in row.seg.roadRefs" :key="ref" class="rd-road">{{ ref }}</span>
                <span class="rd-class">{{ row.seg.roadClass }}</span>
                <span v-if="row.seg.toll" class="rd-class">收费</span>
                <span v-if="row.seg.refPending" class="rd-class rd-class--pending">编号待核</span>
                <span v-if="row.seg.altRange?.length" class="rd-class">
                  {{ row.seg.altRange[0] }}–{{ row.seg.altRange[1] }}m
                </span>
              </div>
              <p v-if="row.seg.condition" class="rd-seg-note">{{ row.seg.condition }}</p>
              <p v-if="row.seg.note" class="rd-seg-note rd-seg-note--warn">{{ row.seg.note }}</p>
              <div v-if="row.pois.length" class="rd-seg-pois">
                沿途：
                <span v-for="p in row.pois" :key="p!.id">{{ p!.name }}</span>
              </div>
            </li>
          </ol>
        </section>

        <!-- ③ 逐日行程 -->
        <section v-else-if="activeTab === 'plan'" class="rd-section">
          <ol class="rd-plan">
            <li v-for="d in detail.plan" :key="d.day" class="rd-day">
              <div class="rd-day-head">
                <span class="rd-day-no">D{{ d.day }}</span>
                <h3>{{ d.title }}</h3>
                <span class="rd-day-km">{{ d.distanceKm }} km</span>
              </div>
              <p class="rd-day-line">
                {{ d.fromNode }} → {{ d.toNode }}
                <span v-if="d.driveHours"> · 车程约 {{ d.driveHours }}h</span>
                <span> · 住 {{ d.stayCity }}</span>
                <span v-if="d.roadRefs.length"> · {{ d.roadRefs.join(' / ') }}</span>
              </p>
              <p class="rd-day-summary">{{ d.summary }}</p>
              <ul v-if="d.tips?.length" class="rd-tips">
                <li v-for="(t, i) in d.tips" :key="i">{{ t }}</li>
              </ul>
            </li>
          </ol>
        </section>

        <!-- ④ 沿途景点 -->
        <section v-else-if="activeTab === 'spots'" class="rd-section">
          <p class="rd-lede-sm">
            共 {{ detail.pois.length }} 个景点，其中 {{ mustSeeSpots.length }} 个标记为必去。
          </p>
          <article
            v-for="p in detail.pois"
            :key="p.id"
            class="rd-spot"
            :class="{ 'is-must': p.mustSee }"
          >
            <header class="rd-spot-head">
              <h3>
                {{ p.name }}
                <span v-if="p.mustSee" class="rd-must">必去</span>
              </h3>
              <p class="rd-spot-loc">
                {{ p.province }} · {{ p.city }}
                <span class="rd-cat">{{ CATEGORY[p.category] ?? p.category }}</span>
                <span v-if="p.level" class="rd-level">{{ p.level }}</span>
              </p>
            </header>
            <p class="rd-spot-tagline">{{ p.tagline }}</p>
            <p class="rd-spot-intro">{{ p.intro }}</p>
            <div class="rd-spot-meta">
              <span v-if="p.visitHours">建议停留 {{ p.visitHours }}h</span>
              <span v-if="p.bestTime">最佳：{{ p.bestTime }}</span>
              <span v-if="p.detourKm">绕行 {{ p.detourKm }}km</span>
            </div>
            <p v-if="p.ticketNote" class="rd-spot-ticket">门票/预约：{{ p.ticketNote }}</p>
          </article>
        </section>

        <!-- ⑤ 实用信息 -->
        <section v-else class="rd-section">
          <div class="rd-prac">
            <div v-for="row in practicalRows" :key="row.label" class="rd-prac-row">
              <span class="rd-prac-label">{{ row.label }}</span>
              <p class="rd-prac-value">{{ row.value }}</p>
            </div>
          </div>

          <div v-if="detail.practical.warnings?.length" class="rd-warn">
            <h3>风险提示</h3>
            <ul>
              <li v-for="(w, i) in detail.practical.warnings" :key="i">{{ w }}</li>
            </ul>
          </div>

          <div v-if="detail.sources?.length" class="rd-sources">
            <h3>资料来源</h3>
            <ul>
              <li v-for="(s, i) in detail.sources" :key="i">
                {{ s.title }}
                <span v-if="s.publisher">（{{ s.publisher }}）</span>
                <span v-if="s.usedFor" class="rd-source-use"> · 用于{{ s.usedFor }}</span>
              </li>
            </ul>
          </div>
        </section>

        <footer class="rd-footer">
          <button class="rd-back" @click="router.push('/roadbook')">← 返回路书库</button>
          <span v-if="detail.updatedAt">最后更新 {{ detail.updatedAt }}</span>
        </footer>
      </div>
    </main>
  </div>
</template>

<style scoped>
.rd-state {
  padding: var(--space-8) var(--space-4);
  color: var(--text-3);
  text-align: center;
}

.rd-state--error {
  color: #ff8f8f;
}

.rd-crumb {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-5) 0 var(--space-1);
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.rd-crumb a {
  color: var(--rd-tone, var(--accent));
  text-decoration: none;
}

.rd-crumb b {
  color: var(--text-1);
  font-weight: 500;
}

.rd-detail {
  --rd-tone: var(--accent);
  --rd-tone-soft: var(--accent-soft);
  --rd-tone-border: var(--accent-border);
}

.rd-detail.is-L3 {
  --rd-tone: var(--train);
  --rd-tone-soft: rgba(116, 189, 137, 0.14);
  --rd-tone-border: rgba(116, 189, 137, 0.42);
}
.rd-detail.is-L4 {
  --rd-tone: var(--accent);
  --rd-tone-soft: var(--accent-soft);
  --rd-tone-border: var(--accent-border);
}
.rd-detail.is-L2 {
  --rd-tone: var(--warning);
  --rd-tone-soft: var(--warning-soft);
  --rd-tone-border: rgba(224, 177, 85, 0.42);
}
.rd-detail.is-L1 {
  --rd-tone: var(--purple);
  --rd-tone-soft: var(--purple-soft);
  --rd-tone-border: rgba(157, 140, 240, 0.42);
}
.rd-detail.is-L5 {
  --rd-tone: var(--spot);
  --rd-tone-soft: rgba(224, 145, 90, 0.14);
  --rd-tone-border: rgba(224, 145, 90, 0.42);
}

.rd-hero {
  margin: 0 calc(-1 * var(--space-4, 16px));
  padding: var(--space-4) var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: linear-gradient(165deg, var(--rd-tone-soft) 0%, transparent 48%);
}

.rd-card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-bottom: var(--space-2);
}

.rd-hero h1 {
  margin: 0;
  font-size: var(--fs-display);
  font-weight: 600;
  color: var(--text-1);
  line-height: 1.3;
}

.rd-badge {
  padding: 1px 8px;
  border: 1px solid var(--line-default);
  border-radius: var(--radius-xs);
  color: var(--text-3);
  font-size: var(--fs-micro);
}

.rd-badge--layer {
  border-color: var(--rd-tone-border);
  background: var(--rd-tone-soft);
  color: var(--rd-tone);
}

.rd-badge--shape.is-loop {
  border-color: rgba(116, 189, 137, 0.35);
  color: var(--train);
  background: rgba(116, 189, 137, 0.1);
}
.rd-badge--shape.is-outback {
  border-color: rgba(127, 180, 216, 0.35);
  color: var(--info);
  background: rgba(127, 180, 216, 0.1);
}
.rd-badge--shape.is-point {
  border-color: rgba(224, 177, 85, 0.35);
  color: var(--warning);
  background: var(--warning-soft);
}
.rd-badge--shape.is-corridor {
  border-color: rgba(157, 140, 240, 0.35);
  color: var(--purple);
  background: var(--purple-soft);
}

.rd-subtitle {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
  line-height: 1.55;
}

.rd-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-2);
  margin: var(--space-4) 0 0;
  padding: 0;
  list-style: none;
}

.rd-metrics li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  text-align: center;
  min-width: 0;
}

.rd-metrics b {
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rd-metrics span {
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.rd-diff.is-d1 b,
.rd-diff.is-d2 b {
  color: var(--success);
}
.rd-diff.is-d3 b {
  color: var(--warning);
}
.rd-diff.is-d4 b,
.rd-diff.is-d5 b {
  color: var(--danger);
}
.rd-diff.is-d1,
.rd-diff.is-d2 {
  background: var(--success-soft);
}
.rd-diff.is-d3 {
  background: var(--warning-soft);
}
.rd-diff.is-d4,
.rd-diff.is-d5 {
  background: var(--danger-soft);
}

.rd-season b {
  color: var(--info);
}

.rd-modes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.rd-tag {
  padding: 2px var(--space-2);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-xs);
  color: var(--text-3);
  font-size: var(--fs-cap);
}

.rd-tag--mode {
  border-color: var(--rd-tone-border);
  background: var(--rd-tone-soft);
  color: var(--rd-tone);
}

.rd-tag--road {
  font-variant-numeric: tabular-nums;
}

.rd-summary {
  margin: var(--space-4) 0 0;
  max-width: 68ch;
  font-size: var(--fs-body);
  line-height: 1.8;
  color: var(--text-2);
}

.rd-route-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
  font-size: var(--fs-meta);
}

.rd-node-pin {
  padding: 2px var(--space-3);
  border: 1px solid var(--rd-tone-border);
  border-radius: var(--radius-full);
  color: var(--rd-tone);
}

.rd-node-pin--end {
  border-color: var(--line-strong);
  color: var(--text-2);
}

.rd-line {
  flex: 0 1 48px;
  height: 1px;
  background: var(--line-strong);
}

.rd-cities {
  color: var(--text-3);
  font-size: var(--fs-cap);
}

/* ── Tab（吸顶，方便长文切换） ─────────────────────────────────────────── */
.rd-tabs {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  gap: var(--space-1);
  margin: var(--space-4) 0;
  padding: var(--space-1);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-0) 72%, var(--surface-1));
  backdrop-filter: blur(var(--glass-blur-tile));
  overflow-x: auto;
}

.rd-tab {
  flex: 0 0 auto;
  padding: 8px var(--space-4);
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-2);
  font-size: var(--fs-meta);
  white-space: nowrap;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-standard);
}

.rd-tab:hover {
  color: var(--text-1);
}

.rd-tab.on {
  background: var(--rd-tone-soft, var(--accent-soft));
  color: var(--rd-tone, var(--accent));
}

.rd-section {
  padding-bottom: var(--space-10);
}

.rd-lede {
  margin: 0 0 var(--space-5);
  max-width: 72ch;
  font-size: var(--fs-body);
  line-height: 1.9;
  color: var(--text-2);
}

.rd-lede-sm {
  margin: 0 0 var(--space-4);
  font-size: var(--fs-meta);
  color: var(--text-3);
}

.rd-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
}

.rd-info-card {
  padding: var(--space-4);
  border: 1px solid var(--line-default);
  border-left: 3px solid var(--rd-tone-border, var(--accent-border));
  border-radius: var(--radius-md);
  background: var(--surface-1);
}

.rd-info-card h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
}

.rd-info-card p {
  margin: 0;
  font-size: var(--fs-meta);
  line-height: 1.8;
  color: var(--text-2);
}

.rd-note {
  margin-top: var(--space-2) !important;
  color: var(--text-3) !important;
}

.rd-note--warn {
  color: #ffb84d !important;
}

.rd-mini-list {
  margin: var(--space-2) 0 0;
  padding-left: 1.1em;
  font-size: var(--fs-meta);
  line-height: 1.8;
  color: var(--text-2);
}

.rd-mini-list b {
  color: var(--text-1);
}

/* ── 路段 ─────────────────────────────────────────────────────────────── */
.rd-seg-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.rd-seg {
  padding: var(--space-4);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-1);
}

.rd-seg-head {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}

.rd-seg-idx {
  flex: 0 0 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  background: var(--rd-tone-soft, var(--accent-soft));
  color: var(--rd-tone, var(--accent));
  font-size: var(--fs-micro);
  font-weight: 600;
}

.rd-seg-head h3 {
  margin: 0;
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
}

.rd-seg-nodes {
  margin: 2px 0 0;
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.rd-seg-km {
  margin-left: auto;
  text-align: right;
  font-size: var(--fs-cap);
  color: var(--text-3);
  white-space: nowrap;
}

.rd-seg-km b {
  display: block;
  font-size: var(--fs-h3);
  color: var(--text-1);
}

.rd-seg-refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-3) 0;
}

.rd-road {
  padding: 2px var(--space-2);
  border: 1px solid var(--rd-tone-border, var(--accent-border));
  border-radius: var(--radius-xs);
  background: var(--rd-tone-soft, var(--accent-soft));
  color: var(--rd-tone, var(--accent));
  font-size: var(--fs-cap);
  font-variant-numeric: tabular-nums;
}

.rd-class {
  padding: 2px var(--space-2);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-xs);
  color: var(--text-3);
  font-size: var(--fs-micro);
}

.rd-class--pending {
  border-color: rgba(255, 184, 77, 0.4);
  color: #ffb84d;
}

.rd-seg-note {
  margin: 0;
  font-size: var(--fs-meta);
  line-height: 1.75;
  color: var(--text-2);
}

.rd-seg-note--warn {
  margin-top: var(--space-1);
  color: #ffb84d;
}

.rd-seg-pois {
  margin-top: var(--space-2);
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.rd-seg-pois span:not(:last-child)::after {
  content: '、';
  margin-right: 2px;
}

.rd-seg-pois span {
  margin-left: 2px;
}

/* ── 逐日 ─────────────────────────────────────────────────────────────── */
.rd-plan {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.rd-day {
  padding: var(--space-4);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-1);
}

.rd-day-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.rd-day-no {
  padding: 2px var(--space-2);
  border-radius: var(--radius-xs);
  background: var(--rd-tone-soft, var(--accent-soft));
  color: var(--rd-tone, var(--accent));
  font-size: var(--fs-cap);
  font-weight: 600;
}

.rd-day-head h3 {
  margin: 0;
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
}

.rd-day-km {
  margin-left: auto;
  color: var(--text-3);
  font-size: var(--fs-cap);
}

.rd-day-line {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.rd-day-summary {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-meta);
  line-height: 1.8;
  color: var(--text-2);
}

.rd-tips {
  margin: var(--space-3) 0 0;
  padding-left: 1.1em;
  font-size: var(--fs-cap);
  line-height: 1.8;
  color: var(--text-3);
}

/* ── 景点 ─────────────────────────────────────────────────────────────── */
.rd-spot {
  margin-bottom: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-1);
}

.rd-spot.is-must {
  border-color: var(--rd-tone-border, var(--accent-border));
  background: color-mix(in srgb, var(--rd-tone-soft, var(--accent-soft)) 55%, var(--surface-1));
}

.rd-spot-head h3 {
  margin: 0;
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
}

.rd-must {
  margin-left: var(--space-2);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  background: var(--rd-tone-soft, var(--accent-soft));
  color: var(--rd-tone, var(--accent));
  font-size: var(--fs-micro);
  font-weight: 400;
}

.rd-spot-loc {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.rd-cat,
.rd-level {
  margin-left: var(--space-2);
  padding: 1px 6px;
  border: 1px solid var(--line-default);
  border-radius: var(--radius-xs);
  font-size: var(--fs-micro);
}

.rd-level {
  border-color: rgba(255, 184, 77, 0.4);
  color: #ffb84d;
}

.rd-spot-tagline {
  margin: var(--space-3) 0 0;
  font-size: var(--fs-meta);
  color: var(--rd-tone, var(--accent));
}

.rd-spot-intro {
  margin: var(--space-2) 0 0;
  max-width: 72ch;
  font-size: var(--fs-body);
  line-height: 1.85;
  color: var(--text-2);
}

.rd-spot-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.rd-spot-ticket {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-cap);
  line-height: 1.7;
  color: var(--text-3);
}

/* ── 实用信息 ─────────────────────────────────────────────────────────── */
.rd-prac {
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  overflow: hidden;
}

.rd-prac-row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--line-hairline);
}

.rd-prac-row:last-child {
  border-bottom: none;
}

.rd-prac-label {
  color: var(--text-3);
  font-size: var(--fs-meta);
}

.rd-prac-value {
  margin: 0;
  font-size: var(--fs-meta);
  line-height: 1.8;
  color: var(--text-2);
}

.rd-warn,
.rd-sources {
  margin-top: var(--space-4);
  padding: var(--space-4);
  border: 1px solid rgba(255, 184, 77, 0.3);
  border-radius: var(--radius-md);
  background: rgba(255, 184, 77, 0.06);
}

.rd-sources {
  border-color: var(--line-default);
  background: var(--surface-sunken);
}

.rd-warn h3,
.rd-sources h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
}

.rd-warn ul,
.rd-sources ul {
  margin: 0;
  padding-left: 1.1em;
  font-size: var(--fs-meta);
  line-height: 1.9;
  color: var(--text-2);
}

.rd-source-use {
  color: var(--text-3);
}

.rd-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) 0 var(--space-10);
  border-top: 1px solid var(--line-default);
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.rd-back {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-full);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: var(--fs-meta);
  cursor: pointer;
}

.rd-back:hover {
  color: var(--rd-tone, var(--text-1));
  border-color: var(--rd-tone-border, var(--line-strong));
  background: var(--rd-tone-soft, var(--surface-2));
}

@media (max-width: 720px) {
  .rd-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .rd-prac-row {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }

  .rd-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rd-tabs {
    top: 0;
  }
}
</style>
