<script setup lang="ts">
/**
 * 万里路书 · 单个榜单页（PRD §7.3）。
 *
 * 榜单头（来源徽标 + 发布单位 + 年份）+ 条目列表（名次 · 名称 · 途经省 · 里程 · 标签）。
 * 「看沿程景点」→ /drive/trip（C2 整条公路入口；无几何时 C1 OD 兜底），
 * 复用主功能代码——榜单没有自己的渲染逻辑。
 */
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client';
import DriveBackdropMap from '../components/DriveBackdropMap.vue';
import AppTopBar from '../components/AppTopBar.vue';
import DriveSubNav from '../components/DriveSubNav.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';

usePointerSpotlight();
import type { RankingBoard, RankingItem } from '@railvista/shared';

const route = useRoute();
const boardId = String(route.params.boardId ?? '');

const loading = ref(true);
const error = ref('');
const board = ref<RankingBoard | null>(null);
const geomAvailable = ref<boolean[]>([]);

const LEVEL_LABEL: Record<string, string> = {
  national: '官方榜',
  provincial: '省级榜',
  media: '媒体榜',
};

/**
 * B3：原兜底对「无 roadKeys / 无 routeId」的条目用 province 首尾兜底，
 * 22/33 个条目 roadKeys 为空且无 fromPlace/toPlace，同省条目会得到 from === to，
 * 规划出 lengthKm≈0 的空路线，点进去必然「加载失败」或空结果。
 * 现在校验 from !== to，相同则返回 null，由模板显示「暂无 OD 数据」并禁用跳转。
 */
function alongHref(item: RankingItem, hasGeom: boolean): string | null {
  if (hasGeom && item.roadKeys.length) {
    return `/drive/trip?road=${encodeURIComponent(item.roadKeys[0]!)}`;
  }
  if (item.routeId) {
    return `/drive/trip?route=${encodeURIComponent(item.routeId)}`;
  }
  const from = item.fromPlace ?? item.province[0] ?? '';
  const to = item.toPlace ?? item.province[item.province.length - 1] ?? '';
  if (!from || !to || from === to) return null;
  return `/drive/trip?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

function roadbookHref(item: RankingItem): string | null {
  return item.routeId ? `/drive/roadbook/${encodeURIComponent(item.routeId)}` : null;
}

onMounted(async () => {
  try {
    const data = await api.getDriveBoard(boardId);
    board.value = data.board;
    geomAvailable.value = data.geomAvailable;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
});
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
        <div class="drive-skeleton__line drive-skeleton__line--narrow" />
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
      </div>
      <div v-else-if="error || !board" class="drive-empty drive-empty--error">{{ error || '榜单不存在' }}</div>

      <template v-else>
        <header class="drive-hero">
          <p class="drive-stat__label">
            <span class="drive-board-card__level" :class="`is-${board.level}`">{{ LEVEL_LABEL[board.level] ?? board.level }}</span>
            {{ board.source.org }}<template v-if="board.source.publishedAt"> · {{ board.source.publishedAt }}</template>
          </p>
          <h1>{{ board.title }}</h1>
          <p v-if="board.subtitle" class="sub">{{ board.subtitle }}</p>
          <p v-if="board.source.doc" class="drive-board-source">依据：{{ board.source.doc }}</p>
        </header>

        <section class="drive-board-items">
          <article v-for="(item, i) in board.items" :key="`${item.rank}-${item.name}`" class="drive-board-item rv-card" data-spotlight>
            <div class="drive-board-item__head">
              <span class="drive-board-item__rank">{{ item.rank }}</span>
              <span class="drive-board-item__name">{{ item.name }}</span>
              <span v-if="item.lengthKm" class="drive-board-item__km">约 {{ item.lengthKm }} km</span>
            </div>
            <div class="drive-board-item__meta">
              <span v-if="item.province.length">{{ item.province.join(' · ') }}</span>
              <span v-if="item.highlight" class="drive-board-item__highlight">{{ item.highlight }}</span>
            </div>
            <div v-if="item.tags?.length" class="drive-board-item__tags">
              <span v-for="t in item.tags" :key="t" class="drive-tag">{{ t }}</span>
            </div>
            <div class="drive-board-item__actions">
              <router-link
                v-if="alongHref(item, geomAvailable[i] ?? false)"
                class="btn primary btn-sm"
                :to="alongHref(item, geomAvailable[i] ?? false)!"
              >
                看沿程景点 →
              </router-link>
              <!-- B3：无可用 OD（from===to 或全空）时禁用跳转并说明原因 -->
              <span
                v-else
                class="btn ghost btn-sm is-disabled"
                title="该条目尚未关联公路编号，也没有起终点数据，暂时无法查看沿程景点"
              >
                暂无 OD 数据
              </span>
              <router-link
                v-if="roadbookHref(item)"
                class="btn ghost btn-sm"
                :to="roadbookHref(item)!"
              >
                深度路书
              </router-link>
              <span
                v-if="item.roadKeys.length && !geomAvailable[i]"
                class="drive-board-item__hint"
                :title="`${item.roadKeys.join(' / ')} 几何待抓取，按起终点规划示意`"
              >
                {{ item.roadKeys.join(' / ') }} 几何待补 · OD 示意
              </span>
              <span
                v-if="item.alsoIn?.length"
                class="drive-board-item__hint"
                title="同一条路出现在多个榜单（交叉推荐）"
              >
                同路上榜：{{ item.alsoIn.length + 1 }} 个榜
              </span>
            </div>
          </article>
        </section>

        <footer class="drive-footnote">
          <template v-if="board.level === 'media'">
            来源：{{ board.source.org }}<template v-if="board.source.publishedAt"> · {{ board.source.publishedAt }}</template>，媒体榜单不冒充官方。
          </template>
          政策 12 条精品线官方尚未发布逐桩走向表，本产品中的走向为 OSM 编号还原的近似线位。
        </footer>
      </template>
    </main>
  </div>
</template>
