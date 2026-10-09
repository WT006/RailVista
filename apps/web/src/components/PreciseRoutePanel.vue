<script setup lang="ts">
/**
 * U1 [P2] 「精度状态面板」：把原来挤在一个按钮文案里的排队/进度/补缝/结果/错误，
 * 收敛为状态驱动的一小块面板——可信（示意线还是真实线、来源、精度）、
 * 可感知（阶段、进度、已等待时长、可取消）、完成后折叠为一行摘要。
 *
 * 状态机见 docs/精准路线生成-性能加速与景点刷新修复及UI改版报告-20260927.md §4.3。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useTripStore } from '../stores/tripStore';

const props = withDefaults(
  defineProps<{
    /** 当前折线里程（km），用于完成后展示 */
    lengthKm?: number;
    /** 沿线景点数 */
    spotCount?: number;
    /** 紧凑模式（移动端） */
    compact?: boolean;
  }>(),
  { lengthKm: 0, spotCount: 0, compact: false },
);

const emit = defineEmits<{ (e: 'refresh'): void }>();

const trip = useTripStore();

type PanelState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'bridging'
  | 'done'
  | 'partial'
  | 'failed'
  | 'offline';

/** 已完成态默认折叠为一行摘要，减少对地图的遮挡 */
const expanded = ref(false);
const elapsedSec = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

function startElapsed() {
  stopElapsed();
  elapsedSec.value = 0;
  elapsedTimer = setInterval(() => {
    elapsedSec.value += 1;
  }, 1000);
}
function stopElapsed() {
  if (elapsedTimer != null) {
    clearInterval(elapsedTimer);
    elapsedTimer = undefined;
  }
}

watch(
  () => trip.preciseLoading,
  (loading) => {
    if (loading) startElapsed();
    else stopElapsed();
  },
  { immediate: true },
);

onUnmounted(stopElapsed);

const job = computed(() => trip.preciseJob);

const state = computed<PanelState>(() => {
  if (trip.preciseLoading) {
    const st = job.value?.status;
    const msg = job.value?.message || '';
    if (msg.includes('补缝')) return 'bridging';
    if (st === 'queued') return 'queued';
    return 'running';
  }
  const st = job.value?.status;
  if (trip.preciseError && st !== 'done' && st !== 'partial') return 'failed';
  if (st === 'failed') return 'failed';
  if (st === 'done') return 'done';
  if (st === 'partial') return 'partial';
  if (trip.canUpgradePrecise) return 'idle';
  if (trip.railwaySource === 'station') return 'offline';
  return 'idle';
});

/** 慢速阈值：超过 8s 还没完成就明确告知已等待多久，避免「看起来卡死」 */
const SLOW_SEC = 8;
const isSlow = computed(
  () =>
    (state.value === 'running' || state.value === 'bridging' || state.value === 'queued') &&
    elapsedSec.value >= SLOW_SEC,
);

const ratio = computed(() => {
  const j = job.value;
  if (!j || !j.segmentsTotal) return '';
  return `${Math.min(j.segmentsDone, j.segmentsTotal)}/${j.segmentsTotal}`;
});

const pct = computed(() => {
  const j = job.value;
  if (!j || !j.segmentsTotal) return 0;
  const done = Math.min(j.segmentsDone, j.segmentsTotal);
  return Math.round((done / j.segmentsTotal) * 100);
});

const TIER_LABEL: Record<string, string> = {
  corridor: '精品走廊',
  network: '精品路网',
  local: '本地轨网',
  osm: 'OSM 实测',
  soft: '近似轨道',
  mixed: '混合来源',
  station: '站点示意',
};

const tierLabel = computed(() => {
  const tier = job.value?.qualityTier || (trip.railwaySource === 'precise' ? 'mixed' : 'station');
  return TIER_LABEL[tier] || '按需生成';
});

const statusText = computed(() => {
  const j = job.value;
  switch (state.value) {
    case 'queued':
      return j?.message || '排队中…';
    case 'running':
      return `正在匹配轨道 · ${ratio.value || '—'}`;
    case 'bridging':
      return `正在补全缺口 · ${ratio.value || '—'}`;
    case 'done':
      return '精准路线已生成';
    case 'partial': {
      const ok = j?.segmentsOk ?? 0;
      const total = j?.segmentsTotal ?? 0;
      return total ? `已精确 ${ok}/${total}，缺口为示意` : '部分精确，缺口为示意';
    }
    case 'failed':
      return trip.preciseError || j?.message || '生成未成功';
    case 'offline':
      return '本地未覆盖且网络不可用';
    default:
      return trip.railwaySource === 'precise' ? '当前为已缓存精确线' : '当前为站点示意线，非真实轨道';
  }
});

const summary = computed(() => {
  const parts: string[] = [];
  if (props.lengthKm > 0) parts.push(`全程 ${Math.round(props.lengthKm)} km`);
  if (props.spotCount > 0) parts.push(`沿线 ${props.spotCount} 个景点`);
  parts.push(`数据来源：${tierLabel.value}`);
  return parts.join(' · ');
});

const showProgress = computed(
  () => state.value === 'running' || state.value === 'bridging' || state.value === 'queued',
);

async function run(force: boolean) {
  await trip.upgradePrecise(force ? { force: true } : undefined);
  emit('refresh');
}

function onPrimary() {
  const st = state.value;
  if (st === 'partial') {
    // 定向重试缺口：沿用既有 retryFailedOnly 链路
    void run(false);
    return;
  }
  void run(true);
}

function onCancel() {
  trip.cancelPrecise();
  emit('refresh');
}

function toggleExpanded() {
  expanded.value = !expanded.value;
}

/** 完成后自动折叠：从进行中态切到终态时收起 */
watch(state, (next, prev) => {
  const wasBusy = prev === 'running' || prev === 'bridging' || prev === 'queued';
  if (wasBusy && (next === 'done' || next === 'partial')) expanded.value = false;
});
</script>

<template>
  <div class="precise-panel" :class="[`precise-panel--${state}`, { 'precise-panel--compact': props.compact }]">
    <div class="precise-panel__head">
      <span class="precise-dot" aria-hidden="true" />
      <span class="precise-panel__title">{{ statusText }}</span>
      <span v-if="showProgress && ratio" class="precise-panel__ratio">{{ ratio }}</span>
      <span v-if="state === 'done' || state === 'partial'" class="precise-tier">{{ tierLabel }}</span>
      <button
        v-if="state === 'done'"
        type="button"
        class="precise-panel__toggle"
        :aria-expanded="expanded"
        @click="toggleExpanded"
      >
        {{ expanded ? '收起' : '展开' }}
      </button>
      <button
        v-if="showProgress"
        type="button"
        class="precise-panel__cancel"
        aria-label="取消生成精准路线"
        @click="onCancel"
      >
        ✕
      </button>
    </div>

    <div v-if="showProgress" class="precise-progress" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
      <div class="precise-progress__track">
        <div class="precise-progress__bar" :style="{ transform: `scaleX(${pct / 100})` }" />
      </div>
      <span class="precise-progress__pct">{{ pct }}%</span>
    </div>

    <p v-if="showProgress" class="precise-panel__note" aria-live="polite">
      <template v-if="isSlow">已等待 {{ elapsedSec }}s，仍在进行…</template>
      <template v-else>{{ job?.message || '正在按站间逐段匹配轨道' }}</template>
    </p>

    <div v-if="!showProgress && (state !== 'done' || expanded)" class="precise-panel__body">
      <!-- failed：错误已在标题，不再重复小字 -->
      <p v-if="state !== 'failed'" class="precise-panel__desc">
        <template v-if="state === 'done'">{{ summary }}</template>
        <template v-else-if="state === 'partial'">{{ summary }} · 缺口为示意线</template>
        <template v-else>{{ trip.polylineHint }}</template>
      </p>

      <div class="precise-panel__actions">
        <button
          type="button"
          class="precise-btn precise-btn--primary"
          :disabled="trip.preciseLoading"
          @click="onPrimary"
        >
          {{ state === 'partial' ? '重试缺口' : state === 'failed' ? '重试' : state === 'done' ? '重新生成' : '获取精准路线' }}
        </button>
        <button
          v-if="state === 'partial'"
          type="button"
          class="precise-btn precise-btn--ghost"
          :disabled="trip.preciseLoading"
          @click="run(true)"
        >
          全部重算
        </button>
      </div>
    </div>

    <div v-else class="precise-panel__summary">
      <span class="precise-panel__summary-text">精准路线 · {{ tierLabel }}</span>
    </div>

    <p v-if="trip.spotsStale" class="precise-panel__stale">景点列表可能未随新折线更新</p>
  </div>
</template>
