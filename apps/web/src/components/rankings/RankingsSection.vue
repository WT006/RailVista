<script setup lang="ts">
/**
 * 主页「中国最美铁路 · 排行榜」模块。
 * 纯展示：数据来自 apps/web/src/data/beautifulRailings.ts（内嵌，来源可核验），
 * 不请求后端、不改动 data/presets/**。
 *
 * 交互要点（见主页改版指令 §2）：
 * - 胶囊 Tab 切换，200ms 淡入 / 位移动画；
 * - 前三名领奖台（①居中通栏，②左③右；金/银/铜低饱和金属色），第 4 名起紧凑列表行；
 * - corridorId === null 条目弱化：无「查看线路」箭头，点击只展开亮点与说明；
 * - 点击有 corridorId 的条目 → /route/:corridorId；
 * - 末尾一句来源说明。
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  RANKINGS,
  type RankItem,
} from '../../data/beautifulRailings';

const router = useRouter();

const activeId = ref(RANKINGS[0]!.id);
const expandedKey = ref<string | null>(null);

const active = computed(() => RANKINGS.find((r) => r.id === activeId.value) || RANKINGS[0]!);
const top3 = computed(() =>
  active.value.items.filter((i) => i.rank <= 3).sort((a, b) => a.rank - b.rank),
);
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

function onItemClick(item: RankItem) {
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
            <span v-if="item.corridorId" class="rank-row__go" aria-hidden="true">›</span>
          </li>
        </ul>
      </div>
    </Transition>

    <p class="rankings__sources-note">
      排名口径与年份以来源为准，不代表官方统一评选。
    </p>
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
 * 折行排列：所有 Tab 直接可见、直接可点，杜绝横向滚动死角
 * （此前单行滚动 + 隐藏滚动条，窄侧栏里后面的榜单胶囊被截断且无滚动提示，
 * 导致后面的榜单选不到）。
 * 触控热区由真实盒子的 padding 保证，不用伪元素扩边：
 * 折行后伪元素热区会覆盖上/下一行 Tab 的边缘，造成点击误触遮挡。 */
.rankings__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.rankings__tab {
  position: relative;
  flex-shrink: 0; /* 胶囊不被压缩变形，文字完整展示 */
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
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

/* ── 前三名领奖台：① 通栏居中置顶；②③ 左右并排略矮 ── */
.rankings__podium {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-areas:
    'gold gold'
    'silver bronze';
  gap: var(--space-2);
  align-items: end;
}

.rank-card {
  position: relative;
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-hairline);
  background: var(--surface-sunken);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-spring),
    border-color var(--dur-fast) var(--ease-standard),
    background-color var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
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

/* 金 / 银 / 铜：低饱和金属色，贴合深色玻璃；三卡同尺寸，仅色相区分 */
.rank-card--gold {
  grid-area: gold;
  justify-self: center;
  /* 与下方单列同宽，居中摆在第一排 */
  width: calc((100% - var(--space-2)) / 2);
  padding: var(--space-3) var(--space-3) var(--space-3) calc(var(--space-3) + 2px);
  border-color: rgba(224, 177, 85, 0.32);
  background:
    linear-gradient(155deg, rgba(224, 177, 85, 0.16), transparent 58%),
    var(--surface-sunken);
  box-shadow: 0 10px 24px -16px rgba(224, 177, 85, 0.35);
}

.rank-card--gold::before {
  background: linear-gradient(180deg, #f0d78a, #c9a24d 55%, #a8842f);
}

.rank-card--silver {
  grid-area: silver;
  padding: var(--space-3) var(--space-3) var(--space-3) calc(var(--space-3) + 2px);
  border-color: rgba(165, 176, 192, 0.28);
  background:
    linear-gradient(155deg, rgba(165, 176, 192, 0.12), transparent 58%),
    var(--surface-sunken);
  box-shadow: 0 10px 24px -16px rgba(140, 152, 168, 0.3);
}

.rank-card--silver::before {
  background: linear-gradient(180deg, #e4e9f0, #9aa5b4 55%, #6f7a8a);
}

.rank-card--bronze {
  grid-area: bronze;
  padding: var(--space-3) var(--space-3) var(--space-3) calc(var(--space-3) + 2px);
  border-color: rgba(196, 132, 88, 0.3);
  background:
    linear-gradient(155deg, rgba(196, 132, 88, 0.13), transparent 58%),
    var(--surface-sunken);
  box-shadow: 0 10px 24px -16px rgba(168, 108, 64, 0.32);
}

.rank-card--bronze::before {
  background: linear-gradient(180deg, #e0a878, #b8794a 55%, #8f5a32);
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
  color: #0b0e14;
  font-size: var(--fs-cap);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.rank-card--gold .rank-card__badge {
  background: linear-gradient(145deg, #f3dfa0, #d4a84a 48%, #b8923a);
}

.rank-card--silver .rank-card__badge {
  background: linear-gradient(145deg, #f0f3f7, #b0b9c6 48%, #8a95a4);
}

.rank-card--bronze .rank-card__badge {
  background: linear-gradient(145deg, #ebc09a, #c48452 48%, #9a6238);
}

.rank-card__name {
  margin: 0;
  padding-right: 30px;
  font-size: var(--fs-meta);
  font-weight: 700;
  line-height: var(--lh-tight);
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

.rank-card--gold .rank-od {
  border-color: rgba(224, 177, 85, 0.28);
  background: rgba(224, 177, 85, 0.1);
  color: #e8d2a0;
}

.rank-card--silver .rank-od {
  border-color: rgba(165, 176, 192, 0.28);
  background: rgba(165, 176, 192, 0.1);
}

.rank-card--bronze .rank-od {
  border-color: rgba(196, 132, 88, 0.28);
  background: rgba(196, 132, 88, 0.1);
}

.rank-card__tagline {
  margin: 0;
  font-size: var(--fs-micro);
  line-height: var(--lh-snug);
  color: var(--text-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rank-card__go {
  font-size: var(--fs-micro);
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

  .rank-card--gold:hover {
    border-color: rgba(224, 177, 85, 0.48);
    background:
      linear-gradient(155deg, rgba(224, 177, 85, 0.2), transparent 58%),
      var(--surface-2);
  }

  .rank-card--silver:hover {
    border-color: rgba(165, 176, 192, 0.42);
    background:
      linear-gradient(155deg, rgba(165, 176, 192, 0.16), transparent 58%),
      var(--surface-2);
  }

  .rank-card--bronze:hover {
    border-color: rgba(196, 132, 88, 0.45);
    background:
      linear-gradient(155deg, rgba(196, 132, 88, 0.17), transparent 58%),
      var(--surface-2);
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

.rank-row__go {
  flex-shrink: 0;
  align-self: center;
  color: var(--accent);
  font-size: var(--fs-body);
  line-height: 1;
}

/* ── 来源脚注 ── */
.rankings__sources-note {
  margin: 0;
  padding-top: var(--space-1);
  font-size: var(--fs-micro);
  line-height: var(--lh-normal);
  color: var(--text-3);
}

/* ── 窄屏 ── */
@media (max-width: 480px) {
  .rank-row {
    flex-wrap: wrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rank-card,
  .rank-row,
  .rankings__tab {
    transition: none;
  }
}
</style>
