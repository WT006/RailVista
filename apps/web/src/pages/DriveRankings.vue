<script setup lang="ts">
/**
 * 万里路书 · 排行榜聚合页（PRD §7.3，从属内容层）。
 *
 * 视觉权重低于主功能（DriveHome 首屏不含榜单，属验收项）。
 * 官方榜置顶 → 媒体榜 → 分省榜；榜单是路网之上的过滤器，不是平行世界。
 */
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import DriveBackdropMap from '../components/DriveBackdropMap.vue';
import AppTopBar from '../components/AppTopBar.vue';
import DriveSubNav from '../components/DriveSubNav.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';

usePointerSpotlight();
import type { RankingBoardSummary } from '@railvista/shared';

const loading = ref(true);
const error = ref('');
const boards = ref<RankingBoardSummary[]>([]);
const updated = ref('');

const LEVEL_LABEL: Record<string, string> = {
  national: '官方榜',
  provincial: '省级',
  media: '媒体榜',
};

onMounted(async () => {
  try {
    const data = await api.getDriveBoards();
    boards.value = data.boards;
    updated.value = data.updated;
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

      <header class="drive-hero">
        <h1>最美公路榜单</h1>
        <p class="sub">
          榜单是路网之上的过滤器：国家精品自驾旅游公路、中国国家地理「中国最美公路」、
          各地文旅/媒体榜单。点进任何一条，都复用主功能加载沿程景点。
        </p>
      </header>

      <div v-if="loading" class="drive-empty">正在加载榜单…</div>
      <div v-else-if="error" class="drive-empty drive-empty--error">{{ error }}</div>

      <template v-else>
        <section class="drive-board-list">
          <router-link v-for="b in boards" :key="b.id" class="drive-board-card" :to="`/drive/rankings/${b.id}`">
            <span class="drive-board-card__level" :class="`is-${b.level}`">{{ LEVEL_LABEL[b.level] ?? b.level }}</span>
            <span class="drive-board-card__title">{{ b.title }}</span>
            <span v-if="b.subtitle" class="drive-board-card__sub">{{ b.subtitle }}</span>
            <span class="drive-board-card__meta">{{ b.org }}<template v-if="b.publishedAt"> · {{ b.publishedAt }}</template> · {{ b.itemCount }} 条</span>
          </router-link>
          <p v-if="!boards.length" class="drive-empty">
            榜单数据待生成（data/roads/boards/；加一个新榜单 = 加一个 JSON，零代码）
          </p>
        </section>

        <p v-if="updated" class="drive-footnote">榜单更新于 {{ updated }} · 媒体榜均标注来源与年份，不冒充官方</p>
      </template>
    </main>
  </div>
</template>
