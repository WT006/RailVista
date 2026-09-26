<script setup lang="ts">
/**
 * 统一加载动效：复兴号 CR450AF 沿轨道行进。
 * 查询车次 / 加载经停站 / 进入地图 等场景共用，仅文案与阶段锚点不同。
 *
 * 进度推进采用「阶段锚点 + 指数逼近」：未收到真实阶段事件时按剩余距离 8% 逼近下一锚点，
 * 上限 92%，避免"假进度到 100% 后卡住"。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';

export type LoaderPhase = 'search' | 'stops' | 'enter' | 'demo' | 'resume' | null;

const props = withDefaults(
  defineProps<{
    active: boolean;
    phase?: LoaderPhase;
    /** 后端回传真实进度时优先使用（0–100） */
    progress?: number | null;
  }>(),
  { phase: null, progress: null },
);

const emit = defineEmits<{ retry: []; cancel: [] }>();

const SLOW_AFTER_MS = 8000;
const HOLD_AFTER_MS = 15000;
const CAP = 92;

const ANCHORS: Record<string, number[]> = {
  search: [15, 55, 85],
  stops: [10, 45, 80],
  enter: [25, 60, 88],
  demo: [25, 65, 88],
  resume: [35, 75],
};

const COPY: Record<string, { title: string; detail: string }> = {
  search: { title: '正在查询直达车次', detail: '向 12306 请求车次列表 · 通常 1–3 秒' },
  stops: { title: '正在加载经停站', detail: '获取时刻与车站坐标 · 通常 2–5 秒' },
  enter: { title: '正在进入行程地图', detail: '整理站点与路线数据' },
  demo: { title: '正在加载演示线路', detail: 'Z8991 青藏线预置数据' },
  resume: { title: '正在恢复上次行程', detail: '从本机缓存打开' },
};

const progress = ref(0);
const elapsedMs = ref(0);
const anchorIdx = ref(0);
let timer: number | undefined;
let startedAt = 0;

function reset() {
  progress.value = 0;
  elapsedMs.value = 0;
  anchorIdx.value = 0;
  startedAt = Date.now();
}

function tick() {
  elapsedMs.value = Date.now() - startedAt;
  if (props.progress != null) {
    progress.value = Math.max(progress.value, Math.min(100, props.progress));
    return;
  }
  const anchors = ANCHORS[props.phase ?? ''] ?? [30, 70];
  const target = anchorIdx.value < anchors.length ? (anchors[anchorIdx.value] as number) : CAP;
  const next = progress.value + (target - progress.value) * 0.08;
  progress.value = Math.min(CAP, next);
  if (progress.value >= target - 0.6 && anchorIdx.value < anchors.length) anchorIdx.value += 1;
}

watch(
  () => props.active,
  (on) => {
    if (on) {
      reset();
      if (timer) window.clearInterval(timer);
      timer = window.setInterval(tick, 300);
      tick();
    } else if (timer) {
      window.clearInterval(timer);
      timer = undefined;
    }
  },
  { immediate: true },
);

watch(
  () => props.progress,
  (v) => {
    if (v != null) progress.value = Math.min(100, v);
  },
);

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});

const isSlow = computed(() => elapsedMs.value > SLOW_AFTER_MS && elapsedMs.value <= HOLD_AFTER_MS);
const isHold = computed(() => elapsedMs.value > HOLD_AFTER_MS);
const done = computed(() => progress.value >= 100);

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

const elapsedSec = computed(() => Math.floor(elapsedMs.value / 1000));
const milestones = [0, 33, 66, 100];
const pct = computed(() => Math.round(progress.value));
</script>

<template>
  <div
    v-if="active"
    class="rv-loader"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <div class="rv-loader__card" :class="{ 'is-hold': isHold }">
      <p class="rv-loader__eyebrow">RailVista</p>

      <div class="rv-loader__track">
        <div class="rv-loader__groove">
          <div
            class="rv-loader__fill"
            :class="{ 'is-hold': isHold, 'is-done': done }"
            :style="{ width: pct + '%' }"
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
            <rect x="7" y="17.6" width="15" height="3.6" rx="1.4" fill="#475569" />
            <rect x="33" y="17.6" width="13" height="3.6" rx="1.4" fill="#475569" />
            <g class="rv-loader__wheel" style="transform-origin: 12px 21.4px">
              <circle cx="12" cy="21.4" r="2" fill="#94a3b8" />
              <circle cx="12" cy="21.4" r="0.7" fill="#0f172a" />
            </g>
            <g class="rv-loader__wheel" style="transform-origin: 19px 21.4px">
              <circle cx="19" cy="21.4" r="2" fill="#94a3b8" />
              <circle cx="19" cy="21.4" r="0.7" fill="#0f172a" />
            </g>
            <g class="rv-loader__wheel" style="transform-origin: 37px 21.4px">
              <circle cx="37" cy="21.4" r="2" fill="#94a3b8" />
              <circle cx="37" cy="21.4" r="0.7" fill="#0f172a" />
            </g>
            <g class="rv-loader__wheel" style="transform-origin: 43px 21.4px">
              <circle cx="43" cy="21.4" r="2" fill="#94a3b8" />
              <circle cx="43" cy="21.4" r="0.7" fill="#0f172a" />
            </g>
            <path
              d="M2.6 5H33c11.5 0 19.5 3.3 25 7.7 1.8 1.4 1.8 2.8 0 4.2C52.5 18.1 45 18.6 36 18.6H5Q2.6 18.6 2.6 16V7.6Q2.6 5 2.6 5Z"
              fill="#dfe6ee"
            />
            <path d="M2.6 15.8H36c7 .2 13.5 .9 18.6 1.7H5Q2.6 17.5 2.6 15.8Z" fill="#c3ccd8" />
            <path
              d="M6.5 7.3H37c8 .2 14.5 2.4 18.6 5l-1.7 1.5c-3.9-2.6-9.4-4.4-16.9-4.6H6.5Z"
              fill="#16213a"
            />
            <rect x="4" y="13.6" width="45" height="1.3" rx="0.65" fill="#e03131" />
            <ellipse
              cx="56.2"
              cy="13.9"
              rx="1.8"
              ry="1.1"
              :fill="isHold ? '#fbbf24' : done ? '#5eead4' : '#fde68a'"
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
        <button type="button" class="rv-loader__btn" @click="emit('retry')">重新发车</button>
        <button type="button" class="rv-loader__btn rv-loader__btn--ghost" @click="emit('cancel')">
          结束等待
        </button>
      </div>
      <p v-else-if="isSlow" class="rv-loader__hint">已等待 {{ elapsedSec }} 秒</p>
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
  background: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: rv-fade 0.18s ease-out both;
}

.rv-loader__card {
  position: relative;
  width: min(92vw, 340px);
  padding: 20px 22px 18px;
  border-radius: 16px;
  background: linear-gradient(165deg, #152033 0%, #0f172a 100%);
  border: 1px solid rgba(56, 189, 248, 0.35);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}

.rv-loader__card.is-hold {
  border-color: rgba(251, 191, 36, 0.45);
}

.rv-loader__eyebrow {
  margin: 0 0 2px;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #64748b;
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
  background: rgba(148, 163, 184, 0.22);
  overflow: hidden;
}

.rv-loader__fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #38bdf8 0%, #7dd3fc 100%);
  transition: width 0.45s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.rv-loader__fill.is-hold {
  background: #475569;
}

.rv-loader__fill.is-done {
  background: linear-gradient(90deg, #38bdf8 0%, #5eead4 100%);
}

.rv-loader__sleeper {
  position: absolute;
  top: 22px;
  width: 2px;
  height: 10px;
  border-radius: 1px;
  background: rgba(148, 163, 184, 0.28);
  transform: translateX(-50%);
}

.rv-loader__milestone {
  position: absolute;
  top: 23px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translateX(-50%);
  background: #475569;
  transition: background 0.3s ease;
}

.rv-loader__milestone.is-on {
  background: #38bdf8;
}

.rv-loader__milestone.is-end.is-done {
  background: #5eead4;
}

/* 列车：translateX(-100%) 让车头（SVG 右端鼻尖）对齐进度位置 */
.rv-loader__train {
  position: absolute;
  top: 6px;
  transform: translateX(-86%);
  margin-left: 4px;
  transition: left 0.45s cubic-bezier(0.22, 0.61, 0.36, 1);
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
  background: rgba(125, 211, 252, 0.5);
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
  background: #475569;
}

.rv-loader__signal::before {
  content: '';
  position: absolute;
  top: -6px;
  left: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fbbf24;
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
  color: #f1f5f9;
  letter-spacing: 0.02em;
}

.rv-loader__pct {
  margin: 0;
  font-size: 12px;
  color: #7dd3fc;
  font-variant-numeric: tabular-nums;
}

.rv-loader__pct.is-hold {
  color: #fbbf24;
}

.rv-loader__detail {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: #94a3b8;
}

.rv-loader__hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #64748b;
}

.rv-loader__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.rv-loader__btn {
  flex: 1;
  appearance: none;
  border: 1px solid rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.14);
  color: #7dd3fc;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.rv-loader__btn:hover {
  background: rgba(56, 189, 248, 0.22);
}

.rv-loader__btn--ghost {
  border-color: rgba(148, 163, 184, 0.35);
  background: transparent;
  color: #94a3b8;
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
    animation: rv-wheel 0.6s linear infinite;
  }
  .rv-loader__train {
    animation: rv-bob 1.2s ease-in-out infinite;
  }
  .rv-loader__dash {
    animation: rv-dash 0.9s ease-in-out infinite;
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
