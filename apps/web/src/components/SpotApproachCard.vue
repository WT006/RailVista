<script setup lang="ts">
/**
 * 临近景点提示卡，对应 docs/scenic-supplement-20260928.md §4.3
 *
 * 触发窗口：进入点前 5 km 开始提示，离开点后 2 km 淡出。
 * 夜间通过 / 声屏障等阻挡情形给出「本次错过」提示，避免用户白等。
 */
import { computed } from 'vue';
import { honorLabels, type ScenicSpot } from '@railvista/shared';
import { AlertTriangle } from 'lucide-vue-next';
import SideBadge from './SideBadge.vue';

const props = withDefaults(
  defineProps<{
    spot: ScenicSpot | null;
    /** 列车当前里程（沿本次行程折线） */
    currentKm?: number;
    compact?: boolean;
  }>(),
  { currentKm: 0, compact: false },
);

const TIME_OF_DAY: Record<string, string> = {
  day: '白天最佳',
  dawn: '清晨最佳',
  dusk: '黄昏最佳',
  night: '夜间最佳',
  any: '全天可看',
};

const blockReason: Record<string, string> = {
  night_pass: '本次夜间通过，可能看不到',
  tunnel: '前方隧道遮挡',
  sound_barrier: '有声屏障遮挡',
  urban: '城区遮挡较多',
};

/** 进入前剩余公里；已进入为负 */
const kmToEnter = computed(() => {
  const s = props.spot;
  if (!s) return 0;
  return Math.round(((s.progressKm ?? 0) - props.currentKm) * 10) / 10;
});

const arrived = computed(() => kmToEnter.value <= 0);

const timeLabel = computed(() => {
  const t = props.spot?.bestView?.timeOfDay;
  return t ? TIME_OF_DAY[t] ?? '' : '';
});

const monthsText = computed(() => {
  const m = props.spot?.bestView?.months;
  if (!m?.length) return '';
  return `${Math.min(...m)}–${Math.max(...m)} 月`;
});

const honorList = computed(() => honorLabels(props.spot?.honors));
const visibleHonors = computed(() => honorList.value.slice(0, 3));
const honorRest = computed(() => Math.max(0, honorList.value.length - visibleHonors.value.length));

const blocks = computed(() =>
  (props.spot?.bestView?.blocked ?? []).map((b) => blockReason[b] ?? b).filter(Boolean),
);

const distText = computed(() => {
  const d = props.spot?.distKm;
  return d == null ? '' : `距轨 ${d < 10 ? d.toFixed(1) : Math.round(d)} km`;
});

const countdownText = computed(() => {
  if (arrived.value) return '正在经过';
  return `${kmToEnter.value} km 后到达`;
});
</script>

<template>
  <Transition name="approach">
    <section v-if="spot" class="approach-card" :class="{ 'approach-card--compact': compact }">
      <div class="approach-card__lead">
        <span class="approach-card__kicker">{{ arrived ? '正在经过' : '即将到达' }}</span>
        <span class="approach-card__countdown">{{ countdownText }}</span>
      </div>

      <div class="approach-card__body">
        <h3 class="approach-card__title">{{ spot.name }}</h3>
        <SideBadge
          :side="spot.sideRuntime ?? spot.side"
          :dist-km="spot.distKm"
          :needs-review="spot.sideNeedsReview"
          :low="spot.sideConfidence === 'low'"
          :compact="compact"
        />
      </div>

      <div class="approach-card__meta">
        <span v-if="timeLabel" class="approach-card__chip">{{ timeLabel }}</span>
        <span v-if="monthsText" class="approach-card__chip">{{ monthsText }}</span>
        <span v-if="distText" class="approach-card__chip approach-card__chip--muted">{{ distText }}</span>
        <span v-if="spot.nightOnly" class="approach-card__chip approach-card__chip--night">夜间</span>
      </div>

      <p v-if="spot.intro" class="approach-card__intro">{{ spot.intro }}</p>

      <div v-if="visibleHonors.length" class="approach-card__honors">
        <span v-for="h in visibleHonors" :key="h" class="approach-card__honor">{{ h }}</span>
        <span v-if="honorRest" class="approach-card__honor approach-card__honor--more">
          +{{ honorRest }}
        </span>
      </div>

      <p v-if="blocks.length" class="approach-card__blocked"><AlertTriangle :size="14" /> {{ blocks.join(' · ') }}</p>
    </section>
  </Transition>
</template>

<style scoped>
.approach-card {
  /* fixed：与 .bottom-panel 同一坐标系，避免 absolute 相对 .trip-page 时宽屏叠压错位 */
  position: fixed;
  left: calc(12px + var(--safe-left, 0px));
  right: calc(12px + var(--safe-right, 0px));
  /* 叠在底栏上方；高度仅取底栏占位，避免与 --bottom-overlay 互相抬升 */
  bottom: calc(var(--bottom-panel-clearance, var(--bottom-overlay, 168px)) + 8px);
  z-index: 99;
  max-width: 100%;
  max-height: min(42vh, 260px);
  overflow: auto;
  padding: 10px 12px 11px;
  border-radius: 14px;
  background: linear-gradient(165deg, rgba(30, 41, 59, 0.96), var(--bg-base));
  border: 1px solid var(--border-default);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* 宽屏：左下浮卡，与右下 .bottom-panel 成对，不再拉满全宽压住右侧 */
@media (min-width: 960px) {
  .approach-card {
    left: var(--space-4);
    right: auto;
    bottom: var(--space-4);
    width: min(380px, calc(50vw - 2.5 * var(--space-4)));
    max-height: min(48vh, 320px);
  }
}

.approach-card--compact {
  padding: 8px 10px 9px;
  font-size: 12px;
}

.approach-card__lead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
}

.approach-card__kicker {
  color: var(--accent-hover);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.approach-card__countdown {
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.approach-card__body {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.approach-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.approach-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

.approach-card__chip {
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: var(--border-hairline);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.approach-card__chip--muted {
  opacity: 0.8;
}

.approach-card__chip--night {
  color: var(--warning);
  border-color: rgba(223, 179, 87, 0.4);
  background: rgba(223, 179, 87, 0.14);
}

.approach-card__intro {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.approach-card__honors {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 7px;
}

.approach-card__honor {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--accent-container);
  border: 1px solid var(--accent-container);
  color: var(--accent-hover);
  font-size: 10.5px;
  font-weight: 600;
}

.approach-card__honor--more {
  background: var(--border-hairline);
  border-color: var(--border-default);
  color: var(--text-secondary);
}

.approach-card__blocked {
  margin: 7px 0 0;
  color: var(--danger);
  font-size: 11.5px;
  font-weight: 600;
}

.approach-enter-active,
.approach-leave-active {
  transition:
    transform var(--dur-base) var(--ease-out),
    opacity var(--dur-base) var(--ease-out);
}

.approach-enter-from {
  transform: translateY(16px);
  opacity: 0;
}

.approach-leave-to {
  transform: translateY(10px);
  opacity: 0;
}
</style>
