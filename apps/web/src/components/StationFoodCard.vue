<script setup lang="ts">
/**
 * 过站美食通告：列车经过（或抵达）某个车站时，推荐该站所在地方的特色美食。
 * 顶部通告位三卡共用（景点 > 美食 > 路书库玩法），见 TripMap 的让位链。
 * 每个站只主动弹一次，约 14s 自动收起，可手动关闭；关闭后同站不再弹。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { StationFood } from '../data/stationFoods';

const props = withDefaults(
  defineProps<{
    /** 站名，作为「一站一弹」的去重键；为空表示当前没有可展示的过站 */
    station: string;
    food: StationFood | null;
    kicker?: string;
    compact?: boolean;
    /** 第几站 / 共几站，0 表示未知 */
    seq?: number;
    total?: number;
  }>(),
  { kicker: '正在经过', compact: false, seq: 0, total: 0 },
);

const open = ref(false);
const silenced = ref<string | null>(null);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

const AUTO_HIDE_MS = 14_000;
/** 卡片里最多列几道：再多手机竖屏就要滚了 */
const MAX_DISHES = 4;

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
}

function dismiss() {
  silenced.value = props.station;
  open.value = false;
  clearHideTimer();
}

watch(
  () => props.station,
  (name, prev) => {
    clearHideTimer();
    if (!name || !props.food) {
      open.value = false;
      return;
    }
    if (prev && name !== prev) silenced.value = null;
    if (name === silenced.value) {
      open.value = false;
      return;
    }
    open.value = true;
    hideTimer = setTimeout(() => {
      silenced.value = name;
      open.value = false;
    }, AUTO_HIDE_MS);
  },
  { immediate: true },
);

onBeforeUnmount(clearHideTimer);

const dishes = computed(() => props.food?.dishes.slice(0, MAX_DISHES) ?? []);
const place = computed(() => {
  const f = props.food;
  if (!f) return '';
  const city = f.city && f.city !== f.province ? `${f.province}${f.city}` : f.province;
  return f.tag ? `${city} · ${f.tag}` : city;
});
const seqText = computed(() => (props.seq > 0 && props.total > 0 ? `第 ${props.seq}/${props.total} 站` : ''));
const show = computed(() => open.value && Boolean(props.food) && Boolean(props.station));

/** TripMap 据此让「完成引导条」等浮层避让：只看通告是否真的在屏上 */
defineExpose({ visible: show });
</script>

<template>
  <Teleport to="body">
    <Transition name="food-toast">
      <aside
        v-if="show && food"
        class="food-toast"
        :class="{ 'food-toast--compact': compact }"
        role="status"
        aria-live="polite"
        :aria-label="`${station} 地方特色美食推荐`"
      >
        <header class="food-toast__head">
          <span class="food-toast__kicker">{{ kicker }}</span>
          <span v-if="seqText" class="food-toast__seq">{{ seqText }}</span>
          <button type="button" class="food-toast__close rv-hit" aria-label="关闭美食推荐" @click="dismiss">×</button>
        </header>
        <div class="food-toast__title-row">
          <h3 class="food-toast__title">{{ station }}</h3>
          <p class="food-toast__place">{{ place }}</p>
        </div>
        <ul class="food-toast__list">
          <li v-for="dish in dishes" :key="dish.name" class="food-toast__dish">
            <span class="food-toast__dish-name">{{ dish.name }}</span>
            <span class="food-toast__dish-note">{{ dish.note }}</span>
          </li>
        </ul>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.food-toast {
  position: fixed;
  top: calc(var(--top-overlay, 88px) + 10px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 129;
  width: min(392px, calc(100vw - 28px - var(--sidenav-w, 0px)));
  padding: 12px 14px 13px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-1) 94%, transparent);
  border: 1px solid var(--line-default);
  border-top: 2px solid var(--food);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  box-shadow: var(--elev-3);
  color: var(--text-2);
}

.food-toast--compact {
  padding: 10px 12px 11px;
  width: min(340px, calc(100vw - 20px));
}

.food-toast__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.food-toast__kicker {
  font-size: var(--fs-micro);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--food);
}

.food-toast__seq {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--fs-micro);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.food-toast__close {
  flex: none;
  width: 28px;
  height: 28px;
  margin: -4px 0 -4px auto;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-3);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.food-toast__close:hover {
  color: var(--text-1);
  background: var(--fill-subtle);
}

.food-toast__title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.food-toast__title {
  margin: 0;
  font-size: var(--fs-h2);
  font-weight: 700;
  line-height: var(--lh-tight);
  color: var(--text-1);
}

.food-toast__place {
  margin: 0;
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.food-toast__list {
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.food-toast__dish {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.food-toast__dish-name {
  flex: none;
  max-width: 45%;
  font-size: var(--fs-meta);
  font-weight: 650;
  line-height: 1.35;
  color: var(--text-1);
}

.food-toast__dish-note {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--fs-cap);
  line-height: 1.35;
  color: var(--text-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 手机横屏矮视口：地图可视高度本就紧张，收成两列纯菜名，不写说明 */
@media (orientation: landscape) and (max-height: 560px) {
  .food-toast {
    width: min(340px, calc(100vw - 24px));
    padding: 8px 10px 9px;
  }

  .food-toast__title-row {
    margin-bottom: 6px;
  }

  .food-toast__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px 10px;
  }

  .food-toast__dish {
    display: block;
  }

  .food-toast__dish-name {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .food-toast__dish-note {
    display: none;
  }
}

.food-toast-enter-active,
.food-toast-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}

@media (prefers-reduced-motion: reduce) {
  .food-toast-enter-active,
  .food-toast-leave-active {
    transition: none;
  }
}

.food-toast-enter-from,
.food-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>
