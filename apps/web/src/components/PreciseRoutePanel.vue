<script setup lang="ts">
/**
 * 「精准路线」单按钮：未加载可点加载；加载中 / 已完成仅展示、不可点。
 * 状态机仍跟 tripStore.preciseJob（queued → running → bridging → done/partial/failed）。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useTripStore } from '../stores/tripStore';

withDefaults(
  defineProps<{
    /** 当前折线里程（km），保留 props 以免 TripMap 调用方改动 */
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
  if (trip.railwaySource === 'precise') return 'done';
  if (trip.canUpgradePrecise) return 'idle';
  if (trip.railwaySource === 'station') return 'offline';
  return 'idle';
});

const ratio = computed(() => {
  const j = job.value;
  if (!j || !j.segmentsTotal) return '';
  return `${Math.min(j.segmentsDone, j.segmentsTotal)}/${j.segmentsTotal}`;
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

/** 已加载（含部分精确）：只展示，不可点 */
const isLoaded = computed(() => state.value === 'done' || state.value === 'partial');

/** 进行中：展示进度，不可点 */
const isBusy = computed(
  () => state.value === 'queued' || state.value === 'running' || state.value === 'bridging',
);

/** 仅未加载 / 失败时可点触发加载或重试 */
const clickable = computed(() => state.value === 'idle' || state.value === 'failed');

const label = computed(() => {
  const j = job.value;
  switch (state.value) {
    case 'queued':
      return j?.message || '排队中…';
    case 'running':
      return `匹配轨道中${ratio.value ? ` · ${ratio.value}` : ''}`;
    case 'bridging':
      return `补全缺口中${ratio.value ? ` · ${ratio.value}` : ''}`;
    case 'done':
      return `精准路线已生成 · ${tierLabel.value}`;
    case 'partial': {
      const ok = j?.segmentsOk ?? 0;
      const total = j?.segmentsTotal ?? 0;
      const gap = total ? `${ok}/${total}` : '';
      return gap ? `部分精确 ${gap} · ${tierLabel.value}` : `部分精确 · ${tierLabel.value}`;
    }
    case 'failed':
      return '重试精准路线';
    case 'offline':
      return '本地未覆盖，暂不可用';
    default:
      return '获取精准路线';
  }
});

const titleHint = computed(() => {
  if (state.value === 'failed') return trip.preciseError || job.value?.message || '生成未成功';
  if (isBusy.value && elapsedSec.value >= 8) return `已等待 ${elapsedSec.value}s`;
  if (trip.spotsStale) return '景点列表可能未随新折线更新';
  return undefined;
});

async function onClick() {
  if (!clickable.value) return;
  const force = state.value === 'failed';
  await trip.upgradePrecise(force ? { force: true } : undefined);
  emit('refresh');
}
</script>

<template>
  <button
    type="button"
    class="precise-btn"
    :class="[
      `precise-btn--${state}`,
      {
        'precise-btn--compact': compact,
        'precise-btn--static': !clickable,
        'precise-btn--busy': isBusy,
        'precise-btn--loaded': isLoaded,
      },
    ]"
    :disabled="!clickable"
    :title="titleHint"
    :aria-busy="isBusy"
    :aria-live="isBusy ? 'polite' : undefined"
    @click="onClick"
  >
    <span class="precise-btn__dot" aria-hidden="true" />
    <span class="precise-btn__label">{{ label }}</span>
  </button>
</template>
