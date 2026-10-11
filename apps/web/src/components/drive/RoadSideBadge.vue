<script setup lang="ts">
/**
 * 公路「景点在行进方向的哪一侧」徽标。
 *
 * 与铁路 SideBadge.vue 同一套设计约束（docs/scenic-supplement-20260928.md §4.6），
 * 主体从列车截面换成**自驾车俯视**：公路上判左右的主体是你自己开的车。
 *
 *  - 不能只靠颜色区分左右（色觉障碍可读性），必须同时给出箭头与文字；
 *  - 左 #5B8DEF(--info) / 右 #F2A33C(--accent) / 在路上 青绿(--success)；
 *  - 「在路上（both）」是**确定结论**（距路中心线 ≤80m，路就从它身上过），
 *    不是「没把握」，所以不用灰色；只有投影落到路线起终点之外才判待定（虚线边框）。
 */
import { computed } from 'vue';
import { roadSideArrow, roadSideLabel, roadSideShort, type RoadSide } from '@railvista/shared';

const props = withDefaults(
  defineProps<{
    side?: RoadSide | null;
    /** 到路中心线的垂距（km），用于 title 里的距离说明 */
    distKm?: number | null;
    /** 置信度 low（远处投影切向可能漂移） */
    low?: boolean;
    compact?: boolean;
    /** 不画车辆图形，只显示箭头 + 文字 */
    textOnly?: boolean;
  }>(),
  { side: undefined, distKm: null, low: false, compact: false, textOnly: false },
);

const effective = computed<RoadSide>(() => {
  const s = props.side;
  return s && s !== 'unknown' ? s : 'unknown';
});

const label = computed(() => (props.compact ? roadSideShort(effective.value) : roadSideLabel(effective.value)));
const arrow = computed(() => roadSideArrow(effective.value));

const fillSide = computed<'left' | 'right' | 'full' | 'none'>(() => {
  if (effective.value === 'left') return 'left';
  if (effective.value === 'right') return 'right';
  if (effective.value === 'both') return 'full';
  return 'none';
});

const title = computed(() => {
  const dist = props.distKm == null ? '' : `（距路中心线 ${props.distKm} km）`;
  if (effective.value === 'unknown') return '投影落在路线起终点之外，方位无法判定';
  if (props.low) return `按行进方向判定：${roadSideLabel(effective.value)}${dist}。距路较远，远处投影切向可能漂移，仅供参考`;
  return `按行进方向判定：${roadSideLabel(effective.value)}${dist}`;
});
</script>

<template>
  <Transition name="road-side-flip" mode="out-in">
    <span
      :key="`${effective}-${low ? 'l' : 'h'}`"
      class="road-side-badge"
      :class="[
        `road-side-badge--${effective}`,
        { 'road-side-badge--low': low, 'road-side-badge--compact': compact, 'road-side-badge--text': textOnly },
      ]"
      :title="title"
      :aria-label="`${label}${low ? '（低置信度）' : ''}`"
    >
      <svg
        v-if="!textOnly"
        class="road-side-badge__car"
        viewBox="0 0 30 16"
        role="img"
        aria-hidden="true"
      >
        <!-- 车身（俯视） -->
        <rect x="1.4" y="2.6" width="27.2" height="10.8" rx="4.4" class="road-side-badge__body" />
        <!-- 驾驶舱 -->
        <rect x="9.2" y="4.3" width="11.6" height="7.4" rx="2.4" class="road-side-badge__cabin" />
        <rect
          v-if="fillSide === 'left'"
          x="3"
          y="4"
          width="10.4"
          height="8"
          rx="3"
          class="road-side-badge__fill"
        />
        <rect
          v-if="fillSide === 'right'"
          x="16.6"
          y="4"
          width="10.4"
          height="8"
          rx="3"
          class="road-side-badge__fill"
        />
        <rect
          v-if="fillSide === 'full'"
          x="3"
          y="4"
          width="24"
          height="8"
          rx="3"
          class="road-side-badge__fill road-side-badge__fill--ghost"
        />
        <line x1="15" y1="1.6" x2="15" y2="14.4" class="road-side-badge__axis" />
      </svg>
      <b class="road-side-badge__arrow" aria-hidden="true">{{ arrow }}</b>
      <span class="road-side-badge__text">{{ label }}</span>
      <span v-if="low && !compact" class="road-side-badge__hint">仅供参考</span>
    </span>
  </Transition>
</template>

<style scoped>
.road-side-badge {
  --side-color: var(--text-3);
  --side-bg: var(--line-hairline);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--side-color);
  background: var(--side-bg);
  color: var(--side-color);
  font-size: var(--fs-micro);
  font-weight: 650;
  line-height: 1.3;
  white-space: nowrap;
  -webkit-font-smoothing: antialiased;
}

.road-side-badge--left {
  --side-color: var(--info);
  --side-bg: var(--accent-soft);
}

.road-side-badge--right {
  --side-color: var(--accent);
  --side-bg: var(--accent-soft);
}

/* 在路上：正向色（青绿），与左/右同等「可信」 */
.road-side-badge--both {
  --side-color: var(--info);
  --side-bg: var(--success-soft);
}

/* 待定：虚线边框，避免与「在路上」的实线混淆 */
.road-side-badge--unknown {
  --side-color: var(--text-3);
  --side-bg: var(--line-hairline);
  border-style: dashed;
}

.road-side-badge--compact {
  padding: 1px 6px;
  font-size: 10px;
  gap: 3px;
}

.road-side-badge--text {
  padding: 2px 7px;
}

.road-side-badge__car {
  width: 26px;
  height: 14px;
  flex: none;
}

.road-side-badge--compact .road-side-badge__car {
  width: 20px;
  height: 11px;
}

.road-side-badge__body {
  fill: var(--surface-sunken);
  stroke: var(--side-color);
  stroke-width: 1.2;
}

.road-side-badge__cabin {
  fill: var(--side-color);
  opacity: 0.22;
}

.road-side-badge__fill {
  fill: var(--side-color);
}

.road-side-badge__fill--ghost {
  fill-opacity: 0.5;
}

.road-side-badge__axis {
  stroke: var(--side-color);
  stroke-width: 1;
  stroke-dasharray: 2 2;
  opacity: 0.75;
}

.road-side-badge__arrow {
  font-size: 13px;
  line-height: 1;
  font-weight: 800;
}

.road-side-badge__hint {
  padding-left: 5px;
  margin-left: 1px;
  border-left: 1px solid currentColor;
  opacity: 0.72;
  font-size: 10px;
  font-weight: 500;
}

.road-side-flip-enter-active,
.road-side-flip-leave-active {
  transition:
    transform var(--dur-fast) var(--ease-overshoot),
    opacity var(--dur-fast) var(--ease-standard);
}

@media (prefers-reduced-motion: reduce) {
  .road-side-flip-enter-active,
  .road-side-flip-leave-active {
    transition: none;
  }
}

.road-side-flip-enter-from {
  transform: rotateY(-80deg) scale(0.92);
  opacity: 0;
}

.road-side-flip-leave-to {
  transform: rotateY(80deg) scale(0.92);
  opacity: 0;
}
</style>
