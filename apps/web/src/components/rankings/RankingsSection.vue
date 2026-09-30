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
  <!-- rv-card：统一卡片外观（圆角 / 描边 / 阴影 / 悬停光影）；
       data-spotlight：把指针位置写入 --mx/--my，供 CSS 绘制光晕与顶部高光流转 -->
  <section class="rankings rv-card" data-spotlight>
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
/*
 * 「中国最美铁路」排行榜。
 *
 * 布局约定：本模块作为 .rv-card 放进页面的侧栏（.rv-col--side），
 * 因此不再自行声明 max-width / margin —— 宽度与左基线完全由 .rv-shell + .rv-grid 决定。
 * 所有色值 / 圆角 / 字号 / 间距 / 时长一律引用 tokens.css 的语义令牌。
 */

.rankings {
  display: grid;
  gap: var(--space-3);
}

/* ── 模块头 ── */
.rankings__head {
  display: grid;
  gap: var(--space-1);
}

.rankings__eyebrow {
  margin: 0;
  font-size: var(--fs-eyebrow);
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
}

.rankings__title {
  margin: 0;
  font-size: var(--fs-h2);
  font-weight: 700;
  line-height: var(--lh-tight);
  color: var(--text-1);
}

.rankings__sub {
  margin: 0;
  font-size: var(--fs-cap);
  line-height: var(--lh-snug);
  color: var(--text-3);
}

/* ── 胶囊 Tab ──
 * 单行横向滚动，不再折行：横屏窄侧栏里 4 个 Tab 折成 3–4 行是
 * 之前观感凌乱的主因；一行胶囊 + 隐藏滚动条更接近 HarmonyOS 分段控件。 */
.rankings__tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: var(--space-2);
  overflow-x: auto;
  scrollbar-width: none;
  /* 微调滚动边界，让胶囊的悬停描边不被裁剪 */
  padding: 2px;
  margin: -2px;
}

.rankings__tabs::-webkit-scrollbar {
  display: none;
}

.rankings__tab {
  position: relative;
  flex-shrink: 0; /* 单行滚动排列：胶囊不被压缩变形 */
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-full);
  border: 1px solid var(--line-default);
  background: var(--fill-subtle);
  color: var(--text-3);
  font-family: inherit;
  font-size: var(--fs-cap);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard);
}

/* 触控热区补齐到 44px：视觉尺寸保持紧凑，用伪元素扩大可点区域 */
.rankings__tab::after {
  content: '';
  position: absolute;
  inset: calc((44px - 100%) / -2) calc(-1 * var(--space-1));
}

.rankings__tab:hover {
  color: var(--text-2);
  border-color: var(--line-strong);
}

.rankings__tab.is-active {
  border-color: var(--line-accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-weight: 600;
}

/* 切换动画：200ms 淡入 + 位移 */
.rank-swap-enter-active,
.rank-swap-leave-active {
  transition: opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
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
  gap: var(--space-3);
}

.rankings__source {
  margin: 0;
  font-size: var(--fs-micro);
  line-height: var(--lh-normal);
  color: var(--text-3);
}

.rankings__source-nature {
  display: inline-block;
  margin-right: var(--space-1);
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-size: var(--fs-micro);
}

/* ── 前三名大卡 ── */
.rankings__podium {
  display: grid;
  gap: var(--space-2);
}

.rank-card {
  position: relative;
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-hairline);
  background: var(--surface-sunken);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-spring),
    border-color var(--dur-fast) var(--ease-standard),
    background-color var(--dur-fast) var(--ease-standard);
}

.rank-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: var(--radius-full);
}

.rank-card--gold::before {
  background: linear-gradient(180deg, #f0c976, #c9a24d);
}

.rank-card--silver::before {
  background: linear-gradient(180deg, #cdd5e0, #8d97a6);
}

.rank-card--bronze::before {
  background: linear-gradient(180deg, #d79a6a, #a9703f);
}

.rank-card.is-muted {
  opacity: 0.72;
}

.rank-card__badge {
  position: absolute;
  right: var(--space-2);
  top: var(--space-2);
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--text-on-accent);
  font-size: var(--fs-cap);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rank-card--gold .rank-card__badge {
  background: linear-gradient(135deg, #f0c976, #c9a24d);
}

.rank-card--silver .rank-card__badge {
  background: linear-gradient(135deg, #e2e7ee, #9aa4b2);
}

.rank-card--bronze .rank-card__badge {
  background: linear-gradient(135deg, #d79a6a, #a9703f);
}

.rank-card__name {
  margin: 0;
  padding-right: 30px;
  font-size: var(--fs-h3);
  font-weight: 700;
  color: var(--text-1);
}

.rank-od {
  justify-self: start;
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  border: 1px solid var(--line-default);
  background: var(--fill-subtle);
  color: var(--text-2);
  font-size: var(--fs-micro);
}

.rank-card__tagline {
  margin: 0;
  font-size: var(--fs-cap);
  line-height: var(--lh-normal);
  color: var(--text-2);
}

.rank-card__meta {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--fs-micro);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.rank-card__focus {
  color: var(--accent-hover);
}

.rank-card__go {
  font-size: var(--fs-cap);
  font-weight: 600;
  color: var(--accent);
}

.rank-card__none {
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.rank-card__note {
  margin: 0;
  font-size: var(--fs-micro);
  line-height: var(--lh-normal);
  color: var(--text-3);
}

@media (hover: hover) and (pointer: fine) {
  .rank-card:hover {
    transform: translateY(-2px);
    border-color: var(--line-strong);
    background: var(--surface-2);
  }
}

/* 渐变分隔线 */
.rankings__divider {
  height: 1px;
  background: linear-gradient(90deg, var(--accent-soft), var(--line-hairline));
}

/* ── 第 4 名起：紧凑列表行 ── */
.rankings__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
}

.rank-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    transform var(--dur-micro) var(--ease-standard),
    background-color var(--dur-micro) var(--ease-standard),
    border-color var(--dur-micro) var(--ease-standard);
}

.rank-row.is-muted {
  opacity: 0.68;
}

.rank-row.is-open {
  background: var(--fill-subtle);
  border-color: var(--line-default);
  opacity: 1;
}

@media (hover: hover) and (pointer: fine) {
  .rank-row:hover {
    transform: translateY(-1px);
    background: var(--fill-subtle);
    border-color: var(--line-default);
  }
}

.rank-row__no {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-xs);
  background: var(--fill-subtle);
  color: var(--text-2);
  font-size: var(--fs-micro);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rank-row__main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: var(--space-1);
}

.rank-row__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.rank-row__name {
  font-size: var(--fs-meta);
  font-weight: 600;
  color: var(--text-2);
}

.rank-row__tagline {
  font-size: var(--fs-micro);
  line-height: var(--lh-snug);
  color: var(--text-3);
}

.rank-row__note {
  margin-top: var(--space-1);
  font-size: var(--fs-micro);
  line-height: var(--lh-snug);
  color: var(--text-2);
}

.rank-row__src {
  flex-shrink: 0;
  align-self: center;
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--fill-subtle);
  color: var(--text-3);
  font-size: var(--fs-micro);
}

.rank-row__go {
  flex-shrink: 0;
  align-self: center;
  color: var(--accent);
  font-size: var(--fs-body);
  line-height: 1;
}

/* ── 我的关注 ── */
.rankings__focus {
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px dashed var(--line-accent);
  background: var(--accent-soft);
}

.rankings__focus-title {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-cap);
  font-weight: 700;
  color: var(--accent-hover);
}

.rankings__focus-hint {
  margin-left: var(--space-1);
  font-size: var(--fs-micro);
  font-weight: 400;
  color: var(--text-3);
}

.rankings__focus-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
}

.rankings__focus-btn {
  position: relative;
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font-family: inherit;
  font-size: var(--fs-cap);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-standard);
}

/* 触控热区补齐到 44px */
.rankings__focus-btn::after {
  content: '';
  position: absolute;
  inset: calc((44px - 100%) / -2) 0;
}

@media (hover: hover) and (pointer: fine) {
  .rankings__focus-btn:hover:not(:disabled) {
    background: var(--fill-accent);
  }
}

.rankings__focus-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.rankings__focus-no {
  width: 16px;
  text-align: center;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.rankings__focus-name {
  font-weight: 600;
  color: var(--text-1);
}

.rankings__focus-count {
  color: var(--accent-hover);
  font-variant-numeric: tabular-nums;
}

.rankings__focus-src {
  margin-left: auto;
  font-size: var(--fs-micro);
  color: var(--text-3);
}

/* ── 全国铁路景点地图入口 ──
 * 侧栏的"次级主行动点"：用宇宙蓝渐变玻璃 + 同心圆轨迹装饰，
 * 与榜单条目拉开层级；悬停时光晕点亮 + 箭头位移。 */
.atlas-entry {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--line-accent);
  background: linear-gradient(
    135deg,
    rgba(77, 159, 255, 0.22),
    rgba(77, 159, 255, 0.07) 52%,
    rgba(157, 140, 240, 0.14)
  );
  color: var(--accent-hover);
  font-family: inherit;
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-spring),
    border-color var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-base) var(--ease-standard);
}

/* 装饰：右上角同心圆"航线"纹理（纯 CSS，随容器裁剪） */
.atlas-entry::before {
  content: '';
  position: absolute;
  right: -26px;
  top: -30px;
  width: 104px;
  height: 104px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(77, 159, 255, 0.28);
  box-shadow:
    0 0 0 18px rgba(77, 159, 255, 0.07),
    0 0 0 36px rgba(77, 159, 255, 0.04);
  pointer-events: none;
}

/* 指针光晕（与其他二/三级条目同规格，坐标由 usePointerSpotlight 写入） */
.atlas-entry::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(
    calc(var(--glow-radius) * 0.55) circle at var(--mx, 50%) var(--my, 0%),
    rgba(255, 255, 255, var(--glow-alpha-tile)),
    transparent 65%
  );
  transition: opacity var(--dur-base) var(--ease-standard);
}

@media (hover: hover) and (pointer: fine) {
  .atlas-entry:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
    box-shadow: 0 12px 32px -12px rgba(77, 159, 255, 0.35);
  }

  .atlas-entry:hover::after {
    opacity: 1;
  }

  .atlas-entry:hover .atlas-entry__go {
    transform: translateX(3px);
  }
}

.atlas-entry__main {
  display: grid;
  gap: var(--space-1);
  text-align: left;
}

.atlas-entry__title {
  font-size: var(--fs-h3);
  font-weight: 700;
  color: var(--text-1);
}

.atlas-entry__desc {
  font-size: var(--fs-cap);
  color: var(--text-2);
}

.atlas-entry__go {
  flex-shrink: 0;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  border: 1px solid var(--line-accent);
  background: rgba(77, 159, 255, 0.16);
  font-size: var(--fs-cap);
  font-weight: 600;
  color: var(--accent-hover);
  transition: transform var(--dur-fast) var(--ease-spring);
}

/* ── 来源脚注 ── */
.rankings__sources {
  display: grid;
  gap: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px solid var(--line-hairline);
}

.rankings__sources-title {
  margin: 0;
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.rankings__sources ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
}

.rankings__sources a {
  font-size: var(--fs-micro);
  line-height: var(--lh-normal);
  color: var(--accent-hover);
  text-decoration: none;
}

.rankings__sources a:hover {
  text-decoration: underline;
}

.rankings__sources-note {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-micro);
  line-height: var(--lh-normal);
  color: var(--text-3);
}

/* ── 窄屏：列表行允许换行，来源标签下移 ── */
@media (max-width: 480px) {
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
  .atlas-entry__go,
  .rankings__tab {
    transition: none;
  }
}
</style>
