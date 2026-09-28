<script setup lang="ts">
/**
 * 车窗观赏方位徽标，对应 docs/scenic-supplement-20260928.md §4.6
 *
 * 设计约束：
 *  - 不能只靠颜色区分左右（色觉障碍可读性），必须同时给出箭头与文字；
 *  - 主色对比度 ≥ 4.5:1：左 #5B8DEF / 右 #F2A33C / 两侧 #8A8F98；
 *  - 「两侧均可」且垂距 > 8km 时视为不确定，改用虚线边框 + 「方位待确认」；
 *  - 方向变化时用翻转动画提示（不要静默替换）。
 */
import { computed } from 'vue';
import { sideArrow, sideLabel, type SpotSide } from '@railvista/shared';

const props = withDefaults(
  defineProps<{
    side?: SpotSide | null;
    /** 点到轨道垂距（km），用于识别「看似两侧、实则看不清」的情形 */
    distKm?: number | null;
    /** 投影落到走廊端点外等，需人工复核 */
    needsReview?: boolean;
    /** 置信度 low（贴线 / 延展型景观 / 推断翻转） */
    low?: boolean;
    compact?: boolean;
    /** 不显示列车截面图形，只显示箭头 + 文字 */
    textOnly?: boolean;
  }>(),
  {
    side: undefined,
    distKm: null,
    needsReview: false,
    low: false,
    compact: false,
    textOnly: false,
  },
);

const resolved = computed<SpotSide>(() => {
  const s = props.side;
  return s && s !== 'unknown' ? s : 'unknown';
});

/**
 * 只有「方位确实判断不出来」才显示为待确认。
 * 注意：不要用垂距把 `both` 降级成待确认 —— 看得清看不清是**可见性**问题，
 * 已由 visibility / distKm 表达，与**方位**的可信度是两件事，不能混为一谈。
 */
const effective = computed<SpotSide>(() => (props.needsReview ? 'unknown' : resolved.value));

const label = computed(() => sideLabel(effective.value));
const arrow = computed(() => sideArrow(effective.value));

const fillSide = computed<'left' | 'right' | 'full' | 'none'>(() => {
  if (effective.value === 'left') return 'left';
  if (effective.value === 'right') return 'right';
  if (effective.value === 'both') return 'full';
  return 'none';
});

const title = computed(() => {
  if (props.needsReview) return '方位无法可靠判定，已标记待人工复核';
  if (props.low) return '方位为低置信度：几何判定与数据记录不一致，建议人工复核';
  const dist = props.distKm == null ? '' : `（距轨约 ${props.distKm} km）`;
  return `按本次车次行进方向判定：${label.value}${dist}`;
});
</script>

<template>
  <Transition name="side-flip" mode="out-in">
    <span
      :key="`${effective}-${low ? 'l' : 'h'}`"
      class="side-badge"
      :class="[
        `side-badge--${effective}`,
        { 'side-badge--low': low, 'side-badge--compact': compact, 'side-badge--text': textOnly },
      ]"
      :title="title"
      :aria-label="`${label}${low ? '（低置信度）' : ''}`"
    >
      <svg
        v-if="!textOnly"
        class="side-badge__train"
        viewBox="0 0 30 16"
        role="img"
        aria-hidden="true"
      >
        <rect x="0.9" y="0.9" width="28.2" height="14.2" rx="6" class="side-badge__body" />
        <rect
          v-if="fillSide === 'left'"
          x="3.2"
          y="3"
          width="11.2"
          height="10"
          rx="4"
          class="side-badge__fill"
        />
        <rect
          v-if="fillSide === 'right'"
          x="15.6"
          y="3"
          width="11.2"
          height="10"
          rx="4"
          class="side-badge__fill"
        />
        <rect
          v-if="fillSide === 'full'"
          x="3.2"
          y="3"
          width="23.6"
          height="10"
          rx="4"
          class="side-badge__fill side-badge__fill--ghost"
        />
        <line x1="15" y1="1.4" x2="15" y2="14.6" class="side-badge__axis" />
      </svg>
      <b class="side-badge__arrow" aria-hidden="true">{{ arrow }}</b>
      <span class="side-badge__text">{{ label }}</span>
      <span v-if="low && !compact" class="side-badge__hint">低置信度</span>
    </span>
  </Transition>
</template>

<style scoped>
.side-badge {
  --side-color: var(--text-muted);
  --side-bg: var(--border-hairline);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--side-color);
  background: var(--side-bg);
  color: var(--side-color);
  font-size: 11.5px;
  font-weight: 650;
  line-height: 1.3;
  white-space: nowrap;
  -webkit-font-smoothing: antialiased;
}

.side-badge--left {
  --side-color: var(--info);
  --side-bg: var(--accent-container);
}

.side-badge--right {
  --side-color: var(--accent);
  --side-bg: var(--accent-container);
}

/* 两侧均可：正向色（青绿），与左/右同等「可信」，不再用灰色暗示不可靠 */
.side-badge--both {
  --side-color: var(--info);
  --side-bg: var(--success-container);
}

/* 待确认：虚线边框，避免与「两侧均可」的实线灰混淆 */
.side-badge--unknown {
  --side-color: var(--text-muted);
  --side-bg: var(--border-hairline);
  border-style: dashed;
}

.side-badge--compact {
  padding: 1px 6px;
  font-size: 10px;
  gap: 3px;
}

.side-badge--text {
  padding: 2px 7px;
}

.side-badge__train {
  width: 26px;
  height: 14px;
  flex: none;
}

.side-badge--compact .side-badge__train {
  width: 20px;
  height: 11px;
}

.side-badge__body {
  fill: var(--bg-inset);
  stroke: var(--side-color);
  stroke-width: 1.2;
}

.side-badge__fill {
  fill: var(--side-color);
}

.side-badge__fill--ghost {
  fill-opacity: 0.55;
}

.side-badge__axis {
  stroke: var(--side-color);
  stroke-width: 1;
  stroke-dasharray: 2 2;
  opacity: 0.75;
}

.side-badge__arrow {
  font-size: 13px;
  line-height: 1;
  font-weight: 800;
}

.side-badge__hint {
  padding-left: 5px;
  margin-left: 1px;
  border-left: 1px solid currentColor;
  opacity: 0.72;
  font-size: 10px;
  font-weight: 500;
}

/* 方向变化时的翻转提示 */
.side-flip-enter-active,
.side-flip-leave-active {
  transition:
    transform var(--dur-fast) var(--ease-overshoot),
    opacity var(--dur-fast) var(--ease-out);
}

.side-flip-enter-from {
  transform: rotateY(-80deg) scale(0.92);
  opacity: 0;
}

.side-flip-leave-to {
  transform: rotateY(80deg) scale(0.92);
  opacity: 0;
}
</style>
