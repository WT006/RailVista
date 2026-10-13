<script setup lang="ts">
/**
 * 榜单条目卡：DriveBoard 通用平铺布局与 CNG 分板块杂志布局共用。
 *
 * 动作链路：有几何 roadKeys → /drive/trip?road=（C2 整条公路）；有 routeId →
 * /drive/trip?route=；否则 from/to OD 兜底。B3：from === to 的 OD 兜底会规划出
 * 空路线，返回 null 由模板显示「暂无 OD 数据」并禁用跳转。
 */
import { computed } from 'vue';
import type { RankingItem } from '@railvista/shared';

const props = defineProps<{
  item: RankingItem;
  hasGeom: boolean;
  /** 榜单级别：决定禁用态文案（国际榜 = 海外路线仅供灵感） */
  boardLevel: string;
  /** 是否显示名次徽章（极致公路等无名次板块可关掉） */
  showRank?: boolean;
  /** 覆盖名次文案（如 CNG 领奖台用「第 1 名」）；缺省用 item.rank 数字 */
  rankText?: string;
}>();

function alongHref(item: RankingItem, hasGeom: boolean): string | null {
  if (item.inspirationOnly) return null;
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

const along = computed(() => alongHref(props.item, props.hasGeom));
const roadbook = computed(() => roadbookHref(props.item));

const disabledLabel = computed(() => {
  if (props.item.inspirationOnly) return '仅供灵感 · 暂无沿程';
  if (props.boardLevel === 'international') return '海外路线 · 仅供灵感';
  return '暂无 OD 数据';
});

const disabledTitle = computed(() => {
  if (props.item.inspirationOnly) return '该条目在库内暂无对应路网（如中国台湾/在建线路），仅供灵感参考';
  if (props.boardLevel === 'international')
    return '海外路线暂不支持查看沿程景点，本产品路网覆盖中国公路';
  return '该条目尚未关联公路编号，也没有起终点数据，暂时无法查看沿程景点';
});
</script>

<template>
  <article class="drive-board-item rv-card" data-spotlight>
    <div class="drive-board-item__head">
      <span v-if="showRank" class="drive-board-item__rank">{{ rankText ?? item.rank }}</span>
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
      <router-link v-if="along" class="btn primary btn-sm rv-hit" :to="along!">看沿程景点 →</router-link>
      <!-- B3：无可用 OD（from===to 或全空/仅供灵感）时禁用跳转并说明原因 -->
      <span v-else class="btn ghost btn-sm is-disabled" :title="disabledTitle" aria-disabled="true">
        {{ disabledLabel }}
      </span>
      <router-link v-if="roadbook" class="btn ghost btn-sm rv-hit" :to="roadbook!">深度路书</router-link>
      <span
        v-if="item.roadKeys.length && !hasGeom && !item.inspirationOnly"
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
</template>
