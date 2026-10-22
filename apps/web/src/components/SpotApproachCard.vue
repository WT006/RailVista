<script setup lang="ts">
/**
 * 临近景点通告：只提示「到了哪个景点 + 一句介绍」。
 * 方位 / 天气 / 距轨 / 进度 由右下角下一站面板承担，避免重复。
 * 进入点前 ~5 km 弹一次（须已发车，由 TripMap 在 progress>0 时才传入 spot）；
 * 可关，约 10s 自动收起。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ScenicSpot, SpotWeatherParts } from '@railvista/shared';

const props = withDefaults(
  defineProps<{
    spot: ScenicSpot | null;
    currentKm?: number;
    compact?: boolean;
    /** 保留 props 兼容 TripMap 传入，通告本身不再展示天气 */
    weather?: SpotWeatherParts | null;
  }>(),
  { currentKm: 0, compact: false, weather: null },
);

const open = ref(false);
const silencedId = ref<string | null>(null);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

const AUTO_HIDE_MS = 10_000;

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
}

function scheduleHide() {
  clearHideTimer();
  hideTimer = setTimeout(() => {
    silencedId.value = props.spot ? String(props.spot.id) : silencedId.value;
    open.value = false;
  }, AUTO_HIDE_MS);
}

function dismiss() {
  silencedId.value = props.spot ? String(props.spot.id) : null;
  open.value = false;
  clearHideTimer();
}

watch(
  () => (props.spot ? String(props.spot.id) : ''),
  (id, prev) => {
    if (!id) {
      open.value = false;
      clearHideTimer();
      return;
    }
    if (prev && id !== prev) silencedId.value = null;
    if (id === silencedId.value) {
      open.value = false;
      return;
    }
    open.value = true;
    scheduleHide();
  },
  { immediate: true },
);

onBeforeUnmount(clearHideTimer);

const arrived = computed(() => {
  const s = props.spot;
  if (!s) return false;
  return (s.progressKm ?? 0) - props.currentKm <= 0;
});

const kicker = computed(() => (arrived.value ? '正在经过' : '即将到达'));

const intro = computed(() => {
  const t = props.spot?.intro?.trim();
  return t || '';
});

const show = computed(() => Boolean(props.spot && open.value));

/** TripMap 据此决定过站美食卡是否让位：只看通告是否真的可见，而不是景点窗口是否还在 */
defineExpose({ visible: show });
</script>

<template>
  <Teleport to="body">
    <Transition name="approach-toast">
      <aside
        v-if="show && spot"
        class="approach-toast"
        :class="{ 'approach-toast--compact': compact }"
        role="status"
        aria-live="polite"
        aria-label="临近景点提示"
      >
        <header class="approach-toast__head">
          <span class="approach-toast__kicker">{{ kicker }}</span>
          <button type="button" class="approach-toast__close rv-hit" aria-label="关闭提示" @click="dismiss">
            ×
          </button>
        </header>
        <h3 class="approach-toast__title">{{ spot.name }}</h3>
        <p v-if="intro" class="approach-toast__intro">{{ intro }}</p>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.approach-toast {
  position: fixed;
  top: calc(var(--top-overlay, 88px) + 10px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 130;
  width: min(360px, calc(100vw - 28px - var(--sidenav-w, 0px)));
  padding: 12px 14px 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-1) 92%, transparent);
  border: 1px solid var(--line-default);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  box-shadow: var(--elev-3);
  color: var(--text-2);
}

.approach-toast--compact {
  padding: 10px 12px 12px;
}

.approach-toast__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.approach-toast__kicker {
  font-size: var(--fs-micro);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--accent-hover);
}

.approach-toast__close {
  width: 28px;
  height: 28px;
  margin: -6px -8px -6px 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-3);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.approach-toast__close:hover {
  color: var(--text-1);
  background: var(--fill-subtle);
}

.approach-toast__title {
  margin: 0;
  font-size: var(--fs-h2);
  font-weight: 700;
  line-height: var(--lh-tight);
  color: var(--text-1);
}

.approach-toast__intro {
  margin: 8px 0 0;
  font-size: var(--fs-meta);
  line-height: var(--lh-normal);
  color: var(--text-3);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.approach-toast-enter-active,
.approach-toast-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}

@media (prefers-reduced-motion: reduce) {
  .approach-toast-enter-active,
  .approach-toast-leave-active {
    transition: none;
  }
}

.approach-toast-enter-from,
.approach-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>
