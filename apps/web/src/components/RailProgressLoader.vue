<script setup lang="ts">
/**
 * 统一加载动效：复兴号 CR450AF 沿轨道行进。
 * 查询车次 / 加载经停站 / 进入地图 等场景共用，仅文案与阶段不同。
 *
 * 进度策略（行业常见「感知进度」）：
 * 1. 无真实进度时：快→慢指数逼近软顶 97–99%，绝不先到 100%
 * 2. 加载成功：active 关闭后冲到 100%，短暂停留再收起（避免「走不满就打开」）
 * 3. 取消 / 失败：abort() 后立刻收起，不演 100%
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';

export type LoaderPhase = 'search' | 'stops' | 'enter' | 'demo' | 'resume' | null;

const props = withDefaults(
  defineProps<{
    active: boolean;
    phase?: LoaderPhase;
    /** 后端回传真实进度时优先使用（0–100）；仍会钳在软顶之下，直到完成 */
    progress?: number | null;
  }>(),
  { phase: null, progress: null },
);

const emit = defineEmits<{ retry: []; cancel: []; settled: [] }>();

const SLOW_AFTER_MS = 8000;
const HOLD_AFTER_MS = 15000;
/** 假进度软顶：成功前停在这里，不冻结在「假 100%」 */
const SOFT_CAP = 98;
const TICK_MS = 180;
/** 略长于 fill/train 的 --dur-slow(300ms)，确保用户能看见 100% */
const FINISH_HOLD_MS = 380;

const COPY: Record<string, { title: string; detail: string }> = {
  search: { title: '正在查询直达车次', detail: '向 12306 请求车次列表 · 通常 1–3 秒' },
  stops: { title: '正在加载经停站', detail: '获取时刻与车站坐标 · 通常 2–5 秒' },
  enter: { title: '正在进入行程地图', detail: '整理站点与路线数据' },
  demo: { title: '正在加载演示线路', detail: 'Z8991 青藏线预置数据' },
  resume: { title: '正在恢复上次行程', detail: '从本机缓存打开' },
};

const progress = ref(0);
const elapsedMs = ref(0);
const shown = ref(false);
const finishing = ref(false);
let timer: number | undefined;
let finishTimer: number | undefined;
let startedAt = 0;
/** 下一轮 active→false 时跳过 100% 收尾 */
let abortNext = false;
let settledWaiters: Array<() => void> = [];

function notifySettled() {
  const waiters = settledWaiters;
  settledWaiters = [];
  for (const w of waiters) w();
  emit('settled');
}

function clearTick() {
  if (timer != null) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

function clearFinish() {
  if (finishTimer != null) {
    window.clearTimeout(finishTimer);
    finishTimer = undefined;
  }
}

function reset() {
  progress.value = 0;
  elapsedMs.value = 0;
  startedAt = Date.now();
  finishing.value = false;
}

/**
 * 快→慢逼近软顶（类似 NProgress / YouTube）：
 * 前期大步，接近 97–99% 后细步爬行，保持一直在动。
 */
function tick() {
  elapsedMs.value = Date.now() - startedAt;
  if (finishing.value) return;

  if (props.progress != null) {
    progress.value = Math.max(progress.value, Math.min(SOFT_CAP, props.progress));
    return;
  }

  const p = progress.value;
  const remaining = SOFT_CAP - p;
  // 分段速率：前段快冲，后段减速，避免卡死在某一格
  let rate: number;
  if (p < 40) rate = 0.42;
  else if (p < 70) rate = 0.22;
  else if (p < 90) rate = 0.12;
  else rate = 0.06;

  const step = Math.max(remaining * rate, p >= 95 ? 0.12 : 0.35);
  progress.value = Math.min(SOFT_CAP, p + step);
}

function hideNow() {
  clearTick();
  clearFinish();
  shown.value = false;
  finishing.value = false;
  progress.value = 0;
  notifySettled();
}

function finishAndHide() {
  clearTick();
  clearFinish();
  finishing.value = true;
  progress.value = 100;
  finishTimer = window.setTimeout(() => {
    finishTimer = undefined;
    shown.value = false;
    finishing.value = false;
    notifySettled();
  }, FINISH_HOLD_MS);
}

/** 失败 / 取消：下次关闭时立刻收起 */
function abort() {
  abortNext = true;
  clearFinish();
  if (!props.active) hideNow();
}

/** 供父级 await：等到遮罩真正收起（含 100% 短停） */
function whenSettled(): Promise<void> {
  if (!shown.value && !props.active) return Promise.resolve();
  return new Promise((resolve) => {
    settledWaiters.push(resolve);
  });
}

defineExpose({ abort, whenSettled });

watch(
  () => props.active,
  (on) => {
    if (on) {
      clearFinish();
      abortNext = false;
      reset();
      shown.value = true;
      clearTick();
      timer = window.setInterval(tick, TICK_MS);
      tick();
      return;
    }

    // active → false
    clearTick();
    if (!shown.value) {
      if (settledWaiters.length) notifySettled();
      return;
    }
    if (abortNext) {
      abortNext = false;
      hideNow();
      return;
    }
    finishAndHide();
  },
  { immediate: true },
);

watch(
  () => props.progress,
  (v) => {
    if (v == null || finishing.value) return;
    progress.value = Math.max(progress.value, Math.min(SOFT_CAP, v));
  },
);

onBeforeUnmount(() => {
  clearTick();
  clearFinish();
  notifySettled();
});

const isSlow = computed(() => elapsedMs.value > SLOW_AFTER_MS && elapsedMs.value <= HOLD_AFTER_MS);
const isHold = computed(() => elapsedMs.value > HOLD_AFTER_MS && !finishing.value);
const done = computed(() => progress.value >= 100 || finishing.value);

const copy = computed(() => {
  const base = COPY[props.phase ?? ''] ?? { title: '加载中', detail: '请稍候…' };
  if (done.value) return { title: '已到达', detail: '马上为你呈现' };
  if (isHold.value) return { title: '前方临时停车', detail: '网络信号弱，稍等即可继续' };
  if (isSlow.value)
    return {
      title: '正在加速赶来',
      detail: `前方车流较多，已行驶 ${Math.floor(elapsedMs.value / 1000)} 秒`,
    };
  return base;
});

const milestones = [0, 33, 66, 100];
const pct = computed(() => Math.round(progress.value));

function onRetryClick() {
  abort();
  emit('retry');
}

function onCancelClick() {
  abort();
  emit('cancel');
}
</script>

<template>
  <div
    v-if="shown"
    class="rv-loader"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <div class="rv-loader__card" :class="{ 'is-hold': isHold }">
      <p class="rv-loader__eyebrow">万里路书</p>

      <div class="rv-loader__track">
        <div class="rv-loader__groove">
          <div
            class="rv-loader__fill"
            :class="{ 'is-hold': isHold, 'is-done': done }"
            :style="{ transform: `scaleX(${pct / 100})` }"
          />
        </div>
        <span
          v-for="(m, i) in milestones"
          :key="'sl' + i"
          class="rv-loader__sleeper"
          :style="{ left: (m === 100 ? 88 : m) + '%' }"
        />
        <span
          v-for="(m, i) in milestones"
          :key="'ms' + i"
          class="rv-loader__milestone"
          :class="{
            'is-on': pct >= m,
            'is-end': i === milestones.length - 1,
            'is-done': i === milestones.length - 1 && done,
          }"
          :style="{ left: m + '%' }"
        />

        <div class="rv-loader__train" :style="{ left: pct + '%' }">
          <span class="rv-loader__dash rv-loader__dash--1" />
          <span class="rv-loader__dash rv-loader__dash--2" />
          <svg class="rv-loader__cr" viewBox="0 0 62 24" aria-hidden="true">
            <rect x="7" y="17.6" width="15" height="3.6" rx="1.4" fill="var(--text-muted)" />
            <rect x="33" y="17.6" width="13" height="3.6" rx="1.4" fill="var(--text-muted)" />
            <g class="rv-loader__wheel" style="transform-origin: 12px 21.4px">
              <circle cx="12" cy="21.4" r="2" fill="var(--text-muted)" />
              <circle cx="12" cy="21.4" r="0.7" fill="var(--bg-base)" />
            </g>
            <g class="rv-loader__wheel" style="transform-origin: 19px 21.4px">
              <circle cx="19" cy="21.4" r="2" fill="var(--text-muted)" />
              <circle cx="19" cy="21.4" r="0.7" fill="var(--bg-base)" />
            </g>
            <g class="rv-loader__wheel" style="transform-origin: 37px 21.4px">
              <circle cx="37" cy="21.4" r="2" fill="var(--text-muted)" />
              <circle cx="37" cy="21.4" r="0.7" fill="var(--bg-base)" />
            </g>
            <g class="rv-loader__wheel" style="transform-origin: 43px 21.4px">
              <circle cx="43" cy="21.4" r="2" fill="var(--text-muted)" />
              <circle cx="43" cy="21.4" r="0.7" fill="var(--bg-base)" />
            </g>
            <path
              d="M2.6 5H33c11.5 0 19.5 3.3 25 7.7 1.8 1.4 1.8 2.8 0 4.2C52.5 18.1 45 18.6 36 18.6H5Q2.6 18.6 2.6 16V7.6Q2.6 5 2.6 5Z"
              fill="var(--text-secondary)"
            />
            <path d="M2.6 15.8H36c7 .2 13.5 .9 18.6 1.7H5Q2.6 17.5 2.6 15.8Z" fill="var(--text-muted)" />
            <path
              d="M6.5 7.3H37c8 .2 14.5 2.4 18.6 5l-1.7 1.5c-3.9-2.6-9.4-4.4-16.9-4.6H6.5Z"
              fill="var(--bg-elevated)"
            />
            <rect x="4" y="13.6" width="45" height="1.3" rx="0.65" fill="var(--danger)" />
            <ellipse
              cx="56.2"
              cy="13.9"
              rx="1.8"
              ry="1.1"
              :fill="isHold ? 'var(--warning)' : done ? 'var(--info)' : 'var(--warning)'"
            />
          </svg>
          <span v-if="isHold" class="rv-loader__signal" />
        </div>
      </div>

      <div class="rv-loader__row">
        <p class="rv-loader__title">{{ copy.title }}</p>
        <p class="rv-loader__pct" :class="{ 'is-hold': isHold }">{{ pct }}%</p>
      </div>
      <p class="rv-loader__detail">{{ copy.detail }}</p>

      <div v-if="isHold" class="rv-loader__actions">
        <button type="button" class="rv-loader__btn" @click="onRetryClick">重新发车</button>
        <button type="button" class="rv-loader__btn rv-loader__btn--ghost" @click="onCancelClick">
          结束等待
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rv-loader {
  position: fixed;
  inset: 0;
  z-index: 360;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg-raised);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: rv-fade var(--dur-fast) var(--ease-out) both;
}

.rv-loader__card {
  position: relative;
  width: min(92vw, 340px);
  padding: 20px 22px 18px;
  border-radius: 16px;
  background: linear-gradient(165deg, var(--bg-raised) 0%, var(--bg-base) 100%);
  border: 1px solid var(--accent-container);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}

.rv-loader__card.is-hold {
  border-color: rgba(223, 179, 87, 0.45);
}

.rv-loader__eyebrow {
  margin: 0 0 2px;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.rv-loader__track {
  position: relative;
  height: 46px;
  margin: 18px 0 12px;
}

.rv-loader__groove {
  position: absolute;
  left: 0;
  right: 0;
  top: 24px;
  height: 6px;
  border-radius: 999px;
  background: var(--border-default);
  overflow: hidden;
}

.rv-loader__fill {
  height: 100%;
  width: 100%;
  transform-origin: 0 50%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent) 0%, var(--accent-hover) 100%);
  transition: transform var(--dur-slow) var(--ease-out);
}

.rv-loader__fill.is-hold {
  background: var(--text-muted);
}

.rv-loader__fill.is-done {
  background: linear-gradient(90deg, var(--accent) 0%, var(--info) 100%);
}

.rv-loader__sleeper {
  position: absolute;
  top: 22px;
  width: 2px;
  height: 10px;
  border-radius: 1px;
  background: var(--border-default);
  transform: translateX(-50%);
}

.rv-loader__milestone {
  position: absolute;
  top: 23px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translateX(-50%);
  background: var(--text-muted);
  transition: background var(--dur-base) var(--ease-out);
}

.rv-loader__milestone.is-on {
  background: var(--accent);
}

.rv-loader__milestone.is-end.is-done {
  background: var(--info);
}

/* 列车：translateX(-100%) 让车头（SVG 右端鼻尖）对齐进度位置 */
.rv-loader__train {
  position: absolute;
  top: 6px;
  transform: translateX(-86%);
  margin-left: 4px;
  transition: left var(--dur-slow) var(--ease-out);
  display: flex;
  align-items: center;
}

.rv-loader__cr {
  width: 58px;
  height: 24px;
  display: block;
}

.rv-loader__dash {
  position: absolute;
  right: calc(100% - 4px);
  height: 1.5px;
  border-radius: 2px;
  background: var(--accent-border);
}

.rv-loader__dash--1 {
  width: 13px;
  top: 11px;
}

.rv-loader__dash--2 {
  width: 7px;
  top: 17px;
}

.rv-loader__signal {
  position: absolute;
  top: -8px;
  left: 40px;
  width: 2px;
  height: 10px;
  background: var(--text-muted);
}

.rv-loader__signal::before {
  content: '';
  position: absolute;
  top: -6px;
  left: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warning);
}

.rv-loader__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.rv-loader__title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

.rv-loader__pct {
  margin: 0;
  font-size: 12px;
  color: var(--accent-hover);
  font-variant-numeric: tabular-nums;
}

.rv-loader__pct.is-hold {
  color: var(--warning);
}

.rv-loader__detail {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}

.rv-loader__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.rv-loader__btn {
  flex: 1;
  appearance: none;
  border: 1px solid var(--accent-border);
  background: var(--accent-container);
  color: var(--accent-hover);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.rv-loader__btn:hover {
  background: var(--accent-container);
}

.rv-loader__btn--ghost {
  border-color: var(--border-strong);
  background: transparent;
  color: var(--text-muted);
}

@keyframes rv-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes rv-wheel {
  to {
    transform: rotate(360deg);
  }
}

@keyframes rv-dash {
  0%,
  100% {
    opacity: 0.25;
    transform: translateX(0);
  }
  50% {
    opacity: 0.75;
    transform: translateX(-2px);
  }
}

@media (prefers-reduced-motion: no-preference) {
  .rv-loader__wheel {
    animation: rv-wheel var(--dur-slow) linear infinite;
  }
  .rv-loader__train {
    animation: rv-bob var(--dur-slower) var(--ease-in-out) infinite;
  }
  .rv-loader__dash {
    animation: rv-dash var(--dur-slow) var(--ease-in-out) infinite;
  }
  .rv-loader__dash--2 {
    animation-delay: 0.15s;
  }
}

@keyframes rv-bob {
  0%,
  100% {
    transform: translateX(-86%) translateY(0);
  }
  50% {
    transform: translateX(-86%) translateY(-1px);
  }
}
</style>
