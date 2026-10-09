<script setup lang="ts">
/**
 * 鸿蒙风格滚轮选择器（参考 ArkUI TextPicker）：
 * 底部弹出，中央高亮带 + 滚轮吸附，5 项可见，支持点击/滚动，取消/确认。
 */
import { computed, nextTick, ref, watch } from 'vue';

export interface WheelOption {
  label: string;
  value: string | number;
  sub?: string;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    options: WheelOption[];
    modelValue?: string | number;
    confirmText?: string;
  }>(),
  { confirmText: '确定' },
);
const emit = defineEmits<{
  'update:open': [boolean];
  confirm: [string | number, WheelOption];
  cancel: [];
}>();

const ITEM_H = 44;
const VISIBLE = 5;

const scroller = ref<HTMLDivElement | null>(null);
const tempIndex = ref(0);
let snapTimer: ReturnType<typeof setTimeout> | undefined;

const currentIndex = computed(() => {
  const i = props.options.findIndex((o) => o.value === props.modelValue);
  return i >= 0 ? i : 0;
});

function scrollToIndex(i: number, smooth = false) {
  const el = scroller.value;
  if (!el) return;
  const idx = Math.max(0, Math.min(props.options.length - 1, i));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollTo({ top: idx * ITEM_H, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  tempIndex.value = idx;
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick();
      tempIndex.value = currentIndex.value;
      requestAnimationFrame(() => scrollToIndex(currentIndex.value));
    }
  },
);

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  tempIndex.value = Math.max(0, Math.min(props.options.length - 1, Math.round(el.scrollTop / ITEM_H)));
  if (snapTimer) clearTimeout(snapTimer);
  snapTimer = setTimeout(() => scrollToIndex(tempIndex.value, true), 110);
}

function tapOption(i: number) {
  scrollToIndex(i, true);
}

function confirm() {
  const opt = props.options[tempIndex.value];
  if (opt) emit('confirm', opt.value, opt);
  emit('update:open', false);
}
function cancel() {
  emit('update:open', false);
  emit('cancel');
}
</script>

<template>
  <Teleport to="body">
    <Transition name="hm-sheet">
      <div v-if="open" class="hm-wheel">
        <div class="hm-wheel__mask" @click="cancel" />
        <div class="hm-wheel__sheet">
          <div class="hm-wheel__grip" />
          <div class="hm-wheel__header">
            <button type="button" class="hm-wheel__btn" @click="cancel">取消</button>
            <span class="hm-wheel__title">{{ title }}</span>
            <button type="button" class="hm-wheel__btn is-primary" @click="confirm">{{ confirmText }}</button>
          </div>

          <div class="hm-wheel__body" :style="{ height: ITEM_H * VISIBLE + 'px' }">
            <div class="hm-wheel__band" :style="{ top: (ITEM_H * VISIBLE) / 2 - ITEM_H / 2 + 'px', height: ITEM_H + 'px' }" />
            <div
              ref="scroller"
              class="hm-wheel__scroller"
              :style="{ padding: (ITEM_H * (VISIBLE - 1)) / 2 + 'px 0' }"
              @scroll="onScroll"
            >
              <div
                v-for="(o, i) in options"
                :key="String(o.value)"
                class="hm-wheel__item"
                :class="{ 'is-active': i === tempIndex }"
                :style="{ height: ITEM_H + 'px' }"
                @click="tapOption(i)"
              >
                <span class="hm-wheel__label">{{ o.label }}</span>
                <span v-if="o.sub" class="hm-wheel__sub">{{ o.sub }}</span>
              </div>
            </div>
            <div class="hm-wheel__fade is-top" />
            <div class="hm-wheel__fade is-bottom" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.hm-wheel { position: fixed; inset: 0; z-index: 120; }
.hm-wheel__mask { position: absolute; inset: 0; background: var(--surface-scrim); backdrop-filter: blur(2px); }
.hm-wheel__sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 8px 16px calc(20px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, var(--surface-lift), var(--surface-0));
  border-top-left-radius: var(--radius-xl);
  border-top-right-radius: var(--radius-xl);
  border: 1px solid var(--line-default);
  border-bottom: none;
}
.hm-wheel__grip { width: 40px; height: 4px; margin: 4px auto 6px; border-radius: var(--radius-xs); background: var(--line-strong); }
.hm-wheel__header { display: flex; align-items: center; justify-content: space-between; height: 46px; }
.hm-wheel__title { font-size: var(--fs-h3); font-weight: 600; color: var(--text-1); }
.hm-wheel__btn {
  border: none; background: transparent;
  font-size: var(--fs-body); color: var(--text-2); cursor: pointer; padding: 6px 4px;
}
.hm-wheel__btn.is-primary { color: var(--accent); font-weight: 600; }
.hm-wheel__body { position: relative; overflow: hidden; margin: 4px 0 8px; }
.hm-wheel__band {
  position: absolute; left: 4px; right: 4px; z-index: 1;
  border-radius: var(--radius-md);
  background: var(--fill-subtle);
  border: 1px solid var(--accent-border);
}
.hm-wheel__scroller {
  position: relative;
  z-index: 2;
  overflow-y: scroll;
  scroll-snap-type: y mandatory;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.hm-wheel__scroller::-webkit-scrollbar { display: none; }
.hm-wheel__item {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  scroll-snap-align: center;
  color: var(--text-3);
  transition: color var(--dur-micro) var(--ease-standard), transform var(--dur-micro) var(--ease-standard);
  cursor: pointer;
}
.hm-wheel__label { font-size: var(--fs-h2); }
.hm-wheel__sub { font-size: var(--fs-micro); color: var(--text-3); }
.hm-wheel__item.is-active { color: var(--text-1); transform: scale(1.06); font-weight: 700; }
.hm-wheel__item.is-active .hm-wheel__sub { color: var(--accent); }
.hm-wheel__fade { position: absolute; left: 0; right: 0; z-index: 3; height: 88px; pointer-events: none; }
.hm-wheel__fade.is-top { top: 0; background: linear-gradient(180deg, var(--surface-lift), transparent); }
.hm-wheel__fade.is-bottom { bottom: 0; background: linear-gradient(0deg, var(--surface-0), transparent); }

.hm-sheet-enter-active, .hm-sheet-leave-active { transition: opacity var(--dur-base) var(--ease-standard); }
.hm-sheet-enter-active .hm-wheel__sheet, .hm-sheet-leave-active .hm-wheel__sheet { transition: transform var(--dur-slow) var(--ease-emphasized); }
.hm-sheet-enter-from, .hm-sheet-leave-to { opacity: 0; }
.hm-sheet-enter-from .hm-wheel__sheet, .hm-sheet-leave-to .hm-wheel__sheet { transform: translateY(100%); }

@media (prefers-reduced-motion: reduce) {
  .hm-wheel__item,
  .hm-sheet-enter-active,
  .hm-sheet-leave-active,
  .hm-sheet-enter-active .hm-wheel__sheet,
  .hm-sheet-leave-active .hm-wheel__sheet {
    transition: none;
  }
}
</style>
