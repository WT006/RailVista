<script setup lang="ts">
/**
 * 主页「中国最美铁路 · 排行榜」模块。
 * 纯展示：数据来自 apps/web/src/data/beautifulRailings.ts（内嵌，来源可核验），
 * 不请求后端、不改动 data/presets/**。
 *
 * 交互要点（见主页改版指令 §2）：
 * - 胶囊 Tab 切换，200ms 淡入 / 位移动画；
 * - 前三名大卡（金/银/铜渐变描边），第 4 名起紧凑列表行；
 * - corridorId === null 条目弱化：无「查看线路」箭头，点击只展开亮点与说明；
 * - 点击有 corridorId 的条目 → /route/:corridorId，并在 localStorage 累计「我的关注」；
 * - 底部来源脚注外链 target="_blank"；模块下方是全国铁路景点地图入口。
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  RANKINGS,
  RANKING_SOURCE_LINKS,
  bumpFocus,
  focusKeyOf,
  readFocusCounts,
  type RankItem,
} from '../../data/beautifulRailings';

const router = useRouter();

const activeId = ref(RANKINGS[0]!.id);
const expandedKey = ref<string | null>(null);
const focus = ref<Record<string, number>>(readFocusCounts());

const active = computed(() => RANKINGS.find((r) => r.id === activeId.value) || RANKINGS[0]!);
const top3 = computed(() => active.value.items.filter((i) => i.rank <= 3));
const rest = computed(() => active.value.items.filter((i) => i.rank > 3));

function medal(rank: number): 'gold' | 'silver' | 'bronze' {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';
}

function itemKey(item: RankItem): string {
  return `${active.value.id}::${item.rank}`;
}

function isExpanded(item: RankItem): boolean {
  return expandedKey.value === itemKey(item);
}

function focusCountOf(item: RankItem): number {
  return focus.value[focusKeyOf(active.value.id, item.name)] || 0;
}

function onItemClick(item: RankItem) {
  focus.value = bumpFocus(active.value.id, item.name);
  if (!item.corridorId) {
    // 无线路地图：只展开亮点与说明，不跳转
    expandedKey.value = isExpanded(item) ? null : itemKey(item);
    return;
  }
  const q: Record<string, string> = {};
  if (item.from) q.from = item.from;
  if (item.to) q.to = item.to;
  void router.push({ path: `/route/${item.corridorId}`, query: q });
}

function goAtlas() {
  void router.push('/atlas');
}

/** 「我的关注」：本机点击计数降序，最多 5 条 */
const focusTop = computed(() => {
  const entries = RANKINGS.flatMap((r) =>
    r.items.map((item) => ({
      ranking: r,
      item,
      count: focus.value[focusKeyOf(r.id, item.name)] || 0,
    })),
  )
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return entries;
});

function onFocusClick(rankingId: string, item: RankItem) {
  if (!item.corridorId) return;
  void router.push({
    path: `/route/${item.corridorId}`,
    query: { from: item.from, to: item.to },
  });
}
</script>

<template>
  <section class="rankings">
    <header class="rankings__head">
      <p class="rankings__eyebrow">RAIL RANKINGS</p>
      <h2 class="rankings__title">中国最美铁路</h2>
      <p class="rankings__sub">从权威票选到官媒认证的风景长廊</p>
    </header>

    <div class="rankings__tabs" role="tablist" aria-label="榜单切换">
      <button
        v-for="r in RANKINGS"
        :key="r.id"
        type="button"
        role="tab"
        class="rankings__tab"
        :class="{ 'is-active': r.id === activeId }"
        :aria-selected="r.id === activeId"
        @click="activeId = r.id; expandedKey = null"
      >
        {{ r.title }}
      </button>
    </div>

    <Transition name="rank-swap" mode="out-in">
      <div :key="active.id" class="rankings__body">
        <p class="rankings__source">
          <span class="rankings__source-nature">{{ active.source.nature }}</span>
          {{ active.source.name }} · {{ active.source.year }}
        </p>

        <div class="rankings__podium">
          <article
            v-for="item in top3"
            :key="item.rank"
            class="rank-card"
            :class="[`rank-card--${medal(item.rank)}`, { 'is-muted': !item.corridorId }]"
            role="button"
            tabindex="0"
            :aria-label="`${item.name} ${item.from}到${item.to}`"
            @click="onItemClick(item)"
            @keydown.enter.prevent="onItemClick(item)"
            @keydown.space.prevent="onItemClick(item)"
          >
            <span class="rank-card__badge">{{ item.rank }}</span>
            <h3 class="rank-card__name">{{ item.name }}</h3>
            <span class="rank-od">{{ item.from }} → {{ item.to }}</span>
            <p class="rank-card__tagline">{{ item.tagline }}</p>
            <p class="rank-card__meta">
              <span v-if="item.lengthKm">{{ item.lengthKm }} km</span>
              <span v-if="item.openedYear">{{ item.openedYear }} 年通车</span>
              <span v-if="focusCountOf(item)" class="rank-card__focus">看过 {{ focusCountOf(item) }} 次</span>
            </p>
            <span v-if="item.corridorId" class="rank-card__go">查看线路 ›</span>
            <span v-else class="rank-card__none">暂无线路地图</span>
            <p v-if="!item.corridorId && isExpanded(item)" class="rank-card__note">
              {{ item.note || '该线路暂无轨道数据，未收录进线路地图' }}
            </p>
          </article>
        </div>

        <div class="rankings__divider" aria-hidden="true" />

        <ul class="rankings__list">
          <li
            v-for="item in rest"
            :key="item.rank"
            class="rank-row"
            :class="{ 'is-muted': !item.corridorId, 'is-open': isExpanded(item) }"
            role="button"
            tabindex="0"
            @click="onItemClick(item)"
            @keydown.enter.prevent="onItemClick(item)"
            @keydown.space.prevent="onItemClick(item)"
          >
            <span class="rank-row__no">{{ item.rank }}</span>
            <span class="rank-row__main">
              <span class="rank-row__line">
                <span class="rank-row__name">{{ item.name }}</span>
                <span class="rank-od">{{ item.from }} → {{ item.to }}</span>
              </span>
              <span class="rank-row__tagline">{{ item.tagline }}</span>
              <span v-if="!item.corridorId && isExpanded(item)" class="rank-row__note">
                {{ item.note || '该线路暂无轨道数据，未收录进线路地图' }}
              </span>
            </span>
            <span class="rank-row__src">{{ active.source.nature }}</span>
            <span v-if="item.corridorId" class="rank-row__go" aria-hidden="true">›</span>
          </li>
        </ul>
      </div>
    </Transition>

    <div v-if="focusTop.length" class="rankings__focus">
      <p class="rankings__focus-title">我的关注<span class="rankings__focus-hint">（本机点击统计，非全网热度）</span></p>
      <ol class="rankings__focus-list">
        <li v-for="(f, i) in focusTop" :key="`${f.ranking.id}-${f.item.name}`">
          <button
            type="button"
            class="rankings__focus-btn"
            :disabled="!f.item.corridorId"
            @click="onFocusClick(f.ranking.id, f.item)"
          >
            <span class="rankings__focus-no">{{ i + 1 }}</span>
            <span class="rankings__focus-name">{{ f.item.name }}</span>
            <span class="rankings__focus-count">{{ f.count }} 次</span>
            <span class="rankings__focus-src">{{ f.ranking.title }}</span>
          </button>
        </li>
      </ol>
    </div>

    <button type="button" class="atlas-entry" @click="goAtlas">
      <span class="atlas-entry__main">
        <span class="atlas-entry__title">全国铁路景点地图</span>
        <span class="atlas-entry__desc">一眼看遍中国铁路沿线的风景</span>
      </span>
      <span class="atlas-entry__go" aria-hidden="true">进入 ›</span>
    </button>

    <footer class="rankings__sources">
      <p class="rankings__sources-title">榜单来源（排名口径与年份以来源为准，不代表官方统一评选）</p>
      <ul>
        <li v-for="s in RANKING_SOURCE_LINKS" :key="s.url">
          <a :href="s.url" target="_blank" rel="noopener noreferrer">{{ s.label }}</a>
        </li>
      </ul>
      <p class="rankings__sources-note">
        线路排名为线路级展示，不精确到车次；「我的关注」仅记录本机点击，不伪造搜索量。
      </p>
    </footer>
  </section>
</template>

<style scoped>
.rankings {
  max-width: 560px;
  margin: 0 auto 16px;
  display: grid;
  gap: 12px;
  padding: 16px 14px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.55), rgba(15, 23, 42, 0.72));
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 rgba(148, 163, 184, 0.08);
}

.rankings__head {
  display: grid;
  gap: 2px;
}

.rankings__eyebrow {
  margin: 0;
  font-size: 10.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #38bdf8;
  font-weight: 700;
}

.rankings__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #f1f5f9;
}

.rankings__sub {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.45;
}

/* ── 胶囊 Tab ── */
.rankings__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rankings__tab {
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(148, 163, 184, 0.08);
  color: #94a3b8;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.rankings__tab:hover {
  color: #e2e8f0;
  border-color: rgba(148, 163, 184, 0.4);
}

.rankings__tab.is-active {
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.28), rgba(14, 165, 233, 0.18));
  border-color: rgba(56, 189, 248, 0.55);
  color: #e0f2fe;
  font-weight: 600;
}

/* 切换动画：200ms 淡入 + 位移 */
.rank-swap-enter-active,
.rank-swap-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.rank-swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.rank-swap-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.rankings__body {
  display: grid;
  gap: 10px;
}

.rankings__source {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.5;
}

.rankings__source-nature {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.12);
  color: #7dd3fc;
  font-size: 10.5px;
}

/* ── 前三名大卡 ── */
.rankings__podium {
  display: grid;
  gap: 8px;
}

.rank-card {
  position: relative;
  display: grid;
  gap: 5px;
  padding: 11px 12px 11px 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(15, 23, 42, 0.5);
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.rank-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 999px;
}

.rank-card--gold::before {
  background: linear-gradient(180deg, #fde68a, #f59e0b);
}
.rank-card--silver::before {
  background: linear-gradient(180deg, #e2e8f0, #94a3b8);
}
.rank-card--bronze::before {
  background: linear-gradient(180deg, #fdba74, #c2703c);
}

.rank-card:hover {
  transform: translateY(-2px);
  border-color: rgba(148, 163, 184, 0.38);
  background: rgba(30, 41, 59, 0.66);
}

.rank-card.is-muted {
  opacity: 0.72;
}

.rank-card__badge {
  position: absolute;
  right: 10px;
  top: 10px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #0f172a;
}

.rank-card--gold .rank-card__badge {
  background: linear-gradient(135deg, #fde68a, #f59e0b);
}
.rank-card--silver .rank-card__badge {
  background: linear-gradient(135deg, #f1f5f9, #cbd5e1);
}
.rank-card--bronze .rank-card__badge {
  background: linear-gradient(135deg, #fed7aa, #c2703c);
}

.rank-card__name {
  margin: 0;
  padding-right: 30px;
  font-size: 14px;
  font-weight: 700;
  color: #f1f5f9;
}

.rank-od {
  justify-self: start;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(148, 163, 184, 0.1);
  color: #cbd5e1;
  font-size: 11px;
}

.rank-card__tagline {
  margin: 0;
  font-size: 12px;
  color: #cbd5e1;
  line-height: 1.5;
}

.rank-card__meta {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.rank-card__focus {
  color: #7dd3fc;
}

.rank-card__go {
  font-size: 11.5px;
  color: #38bdf8;
  font-weight: 600;
}

.rank-card__none {
  font-size: 11px;
  color: #64748b;
}

.rank-card__note {
  margin: 0;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.5;
}

/* 渐变分隔线 */
.rankings__divider {
  height: 1px;
  background: linear-gradient(90deg, rgba(56, 189, 248, 0.35), rgba(148, 163, 184, 0.05));
}

/* ── 第 4 名起：紧凑列表行 ── */
.rankings__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.rank-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 7px 9px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.rank-row:hover {
  transform: translateY(-1px);
  background: rgba(148, 163, 184, 0.1);
  border-color: rgba(148, 163, 184, 0.26);
}

.rank-row.is-muted {
  opacity: 0.68;
}

.rank-row.is-open {
  background: rgba(148, 163, 184, 0.1);
  border-color: rgba(148, 163, 184, 0.24);
  opacity: 1;
}

.rank-row__no {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.14);
  color: #cbd5e1;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rank-row__main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.rank-row__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.rank-row__name {
  font-size: 12.5px;
  font-weight: 600;
  color: #e2e8f0;
}

.rank-row__tagline {
  font-size: 11.5px;
  color: #94a3b8;
  line-height: 1.45;
}

.rank-row__note {
  margin-top: 2px;
  font-size: 11px;
  color: #cbd5e1;
  line-height: 1.45;
}

.rank-row__src {
  flex-shrink: 0;
  align-self: center;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.1);
  color: #64748b;
  font-size: 10.5px;
}

.rank-row__go {
  flex-shrink: 0;
  align-self: center;
  color: #38bdf8;
  font-size: 14px;
  line-height: 1;
}

/* ── 我的关注 ── */
.rankings__focus {
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px dashed rgba(56, 189, 248, 0.3);
  background: rgba(14, 165, 233, 0.06);
}

.rankings__focus-title {
  margin: 0 0 6px;
  font-size: 11.5px;
  font-weight: 700;
  color: #7dd3fc;
}

.rankings__focus-hint {
  margin-left: 4px;
  font-weight: 400;
  color: #64748b;
  font-size: 10.5px;
}

.rankings__focus-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 3px;
}

.rankings__focus-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #cbd5e1;
  font-size: 11.5px;
  cursor: pointer;
  text-align: left;
}

.rankings__focus-btn:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.1);
}

.rankings__focus-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.rankings__focus-no {
  width: 16px;
  text-align: center;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.rankings__focus-name {
  font-weight: 600;
}

.rankings__focus-count {
  color: #7dd3fc;
  font-variant-numeric: tabular-nums;
}

.rankings__focus-src {
  margin-left: auto;
  color: #64748b;
  font-size: 10.5px;
}

/* ── 全国铁路景点地图入口 ── */
.atlas-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 13px;
  border-radius: 12px;
  border: 1px solid rgba(56, 189, 248, 0.32);
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.16), rgba(30, 41, 59, 0.6));
  color: #e0f2fe;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease;
}

.atlas-entry:hover {
  transform: translateY(-2px);
  border-color: rgba(56, 189, 248, 0.55);
}

.atlas-entry__main {
  display: grid;
  gap: 2px;
  text-align: left;
}

.atlas-entry__title {
  font-size: 14px;
  font-weight: 700;
}

.atlas-entry__desc {
  font-size: 11.5px;
  color: #94a3b8;
}

.atlas-entry__go {
  flex-shrink: 0;
  font-size: 12px;
  color: #38bdf8;
  font-weight: 600;
}

/* ── 来源脚注 ── */
.rankings__sources {
  display: grid;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
}

.rankings__sources-title {
  margin: 0;
  font-size: 10.5px;
  color: #64748b;
}

.rankings__sources ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.rankings__sources a {
  font-size: 10.5px;
  color: #7dd3fc;
  text-decoration: none;
  line-height: 1.5;
}

.rankings__sources a:hover {
  text-decoration: underline;
}

.rankings__sources-note {
  margin: 2px 0 0;
  font-size: 10.5px;
  color: #475569;
  line-height: 1.5;
}

@media (max-width: 480px) {
  .rankings {
    padding: 13px 11px 12px;
    border-radius: 14px;
  }

  .rank-row {
    flex-wrap: wrap;
  }

  .rank-row__src {
    order: 3;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rank-card,
  .rank-row,
  .atlas-entry,
  .rankings__tab {
    transition: none;
  }
}
</style>
