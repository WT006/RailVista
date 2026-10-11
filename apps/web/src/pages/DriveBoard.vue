<script setup lang="ts">
/**
 * 万里路书 · 单个榜单页（PRD §7.3）。
 *
 * 两种渲染：
 *   - 通用平铺（其余榜单）：名次 · 名称 · 途经省 · 里程 · 标签。
 *   - 分板块杂志式（board.groups 存在时，目前仅 CNG 最美公路触发）：
 *     CNG 徽标横幅 + 地貌板块「第一名/第二名/第三名」领奖台 + 长线致敬 + 极致公路网格。
 *
 * 「看沿程景点」→ /drive/trip（C2 整条公路入口；无几何时 C1 OD 兜底），
 * 复用主功能代码——榜单没有自己的渲染逻辑（条目卡见 BoardItemCard）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client';
import DriveSubNav from '../components/DriveSubNav.vue';
import BoardItemCard from '../components/rankings/BoardItemCard.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';

usePointerSpotlight();
import type { RankingBoard, RankingBoardGroup } from '@railvista/shared';

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
  international: '国际榜',
};

interface BoardRow {
  item: RankingBoard['items'][number];
  hasGeom: boolean;
}

interface BoardSection {
  key: string;
  index: string;
  title: string;
  description?: string;
  kind: NonNullable<RankingBoardGroup['kind']> | 'flat';
  rows: BoardRow[];
}

const rows = computed<BoardRow[]>(() =>
  (board.value?.items ?? []).map((item, i) => ({ item, hasGeom: geomAvailable.value[i] ?? false })),
);

/**
 * 分板块：items 平铺数据不动（alsoIn / geomAvailable 按下标配对），
 * 只按 item.group 归拢进 board.groups 的展示顺序；无法归类的条目兜底进
 * 「其他条目」，避免静默丢条目。
 */
const groupedSections = computed<BoardSection[]>(() => {
  const b = board.value;
  if (!b?.groups?.length) return [];
  const byGroup = new Map<string, BoardRow[]>();
  for (const row of rows.value) {
    const key = row.item.group && b.groups.some((g) => g.key === row.item.group) ? row.item.group : '';
    const list = byGroup.get(key) ?? [];
    list.push(row);
    byGroup.set(key, list);
  }
  const sections: BoardSection[] = b.groups.map((g, i) => ({
    key: g.key,
    index: String(i + 1).padStart(2, '0'),
    title: g.title,
    description: g.description,
    kind: g.kind ?? 'terrain',
    rows: byGroup.get(g.key) ?? [],
  }));
  const orphans = byGroup.get('');
  if (orphans?.length) {
    sections.push({ key: 'flat-rest', index: '', title: '其他条目', kind: 'flat', rows: orphans });
  }
  return sections;
});

const terrainGroups = computed(() => groupedSections.value.filter((s) => s.kind === 'terrain'));

function shortTerrain(title: string): string {
  return title.replace('区域最美公路', '');
}

const CN_RANK = ['第一名', '第二名', '第三名', '第四名', '第五名'];

function cnRank(rank: number): string {
  return CN_RANK[rank - 1] ?? `第${rank}名`;
}

function rankClass(rank: number): string | undefined {
  return rank >= 1 && rank <= 3 ? `is-rank-${rank}` : undefined;
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

    <main class="rv-shell">
      <div v-if="loading" class="drive-skeleton">
        <DriveSubNav />
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
        <div class="drive-skeleton__line drive-skeleton__line--mid" />
        <div class="drive-skeleton__line drive-skeleton__line--narrow" />
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
      </div>
      <div v-else-if="error || !board" class="drive-empty drive-empty--error">
        <DriveSubNav />
        {{ error || '榜单不存在' }}
      </div>

      <template v-else>
        <header class="drive-hero">
          <p class="drive-stat__label">
            <span class="drive-board-card__level" :class="`is-${board.level}`">{{ LEVEL_LABEL[board.level] ?? board.level }}</span>
            {{ board.source.org }}<template v-if="board.source.publishedAt"> · {{ board.source.publishedAt }}</template>
          </p>
          <DriveSubNav>
            <h1>{{ board.title }}</h1>
          </DriveSubNav>
          <p v-if="board.subtitle" class="sub">{{ board.subtitle }}</p>

          <!-- CNG 杂志横幅：复刻《中国最美公路》增刊「G TOP 3」扉页版式 -->
          <div v-if="groupedSections.length" class="cng-banner rv-card" data-spotlight>
            <div class="cng-banner__brand">
              <span class="cng-banner__mark" aria-hidden="true">C</span>
              <span class="cng-banner__brandname">中国国家地理<i>CHINESE NATIONAL GEOGRAPHY</i></span>
            </div>
            <div class="cng-banner__title">
              <span class="cng-banner__top">TOP 3</span>
              <span class="cng-banner__en">THE MOST BEAUTIFUL HIGHWAYS IN CHINA</span>
              <span class="cng-banner__cn">中国最美公路 · 榜单</span>
            </div>
            <ul class="cng-banner__terrains" aria-label="十大地貌区域">
              <li v-for="g in terrainGroups" :key="g.key">{{ shortTerrain(g.title) }}</li>
            </ul>
          </div>
        </header>

        <!-- 分板块杂志式布局（CNG 最美公路：10 类地貌 × TOP3 + 致敬长线 + 极致公路） -->
        <template v-if="groupedSections.length">
          <section
            v-for="sec in groupedSections"
            :key="sec.key"
            class="cng-section"
            :class="`is-${sec.kind}`"
          >
            <header class="cng-section__head">
              <span v-if="sec.index" class="cng-section__index" aria-hidden="true">{{ sec.index }}</span>
              <div class="cng-section__titles">
                <h2>{{ sec.title }}</h2>
                <p v-if="sec.description">{{ sec.description }}</p>
              </div>
            </header>
            <!-- 极致公路：无名次，双列卡片网格 -->
            <div v-if="sec.kind === 'extreme'" class="cng-grid">
              <BoardItemCard
                v-for="row in sec.rows"
                :key="`${row.item.rank}-${row.item.name}`"
                class="cng-tile"
                :item="row.item"
                :has-geom="row.hasGeom"
                :board-level="board.level"
                :show-rank="false"
              />
            </div>
            <!-- 地貌板块 / 长线致敬：领奖台行 -->
            <div v-else class="cng-list">
              <BoardItemCard
                v-for="row in sec.rows"
                :key="`${row.item.rank}-${row.item.name}`"
                class="cng-row"
                :class="sec.kind === 'terrain' ? rankClass(row.item.rank) : undefined"
                :item="row.item"
                :has-geom="row.hasGeom"
                :board-level="board.level"
                :show-rank="sec.kind === 'terrain'"
                :rank-text="sec.kind === 'terrain' ? cnRank(row.item.rank) : undefined"
              />
            </div>
          </section>
        </template>

        <!-- 通用平铺布局（其余榜单，保持原有渲染） -->
        <section v-else class="drive-board-items">
          <BoardItemCard
            v-for="row in rows"
            :key="`${row.item.rank}-${row.item.name}`"
            :item="row.item"
            :has-geom="row.hasGeom"
            :board-level="board.level"
          />
        </section>

        <footer class="drive-footnote">
          <template v-if="board.level === 'media'">
            来源：{{ board.source.org }}<template v-if="board.source.publishedAt"> · {{ board.source.publishedAt }}</template>，媒体榜单不冒充官方。
          </template>
          <template v-else-if="board.level === 'international'">
            来源：{{ board.source.org }}<template v-if="board.source.publishedAt"> · {{ board.source.publishedAt }}</template>，国际媒体榜单按原书/专题聚合、无统一名次；海外路线暂无沿程数据，G314 等中国段可查看。
          </template>
          <template v-if="board.level === 'national'">
            政策 12 条精品线官方尚未发布逐桩走向表，本产品中的走向为 OSM 编号还原的近似线位。
          </template>
        </footer>
      </template>
    </main>
  </div>
</template>
