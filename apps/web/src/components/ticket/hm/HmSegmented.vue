<script setup lang="ts">
/**
 * 鸿蒙风格分段选择（参考 ArkUI 分段按钮）v2（2026-10-09 鸿蒙化收敛）：
 * 滑块指示器在分段间平滑移动。
 *
 * v2 变更：全量设计令牌；指示器由品牌色驱动（原金色交互层回退系统令牌）；
 * 分段高度 38 → 44（触控下限）；动效走 --dur-* / --ease-* 并带 reduced-motion 降级。
 */
import { computed } from 'vue';

export interface SegOption {
  label: string;
  value: string | number;
  icon?: string;
}
const props = defineProps<{
  options: SegOption[];
  modelValue: string | number;
}>();
const emit = defineEmits<{ 'update:modelValue': [string | number] }>();

const activeIndex = computed(() => {
  const i = props.options.findIndex((o) => o.value === props.modelValue);
  return i >= 0 ? i : 0;
});
function select(i: number) {
  emit('update:modelValue', props.options[i]!.value);
}
</script>

<template>
  <div class="hm-seg">
    <!-- 宽度扣掉左右 padding(4+4)，避免末段 translateX 后贴出圆角 -->
    <span
      class="hm-seg__indicator"
      :style="{
        width: `calc((100% - 8px) / ${options.length})`,
        transform: `translateX(${activeIndex * 100}%)`,
      }"
    />
    <button
      v-for="(o, i) in options"
      :key="String(o.value)"
      type="button"
      class="hm-seg__item"
      :class="{ 'is-active': i === activeIndex }"
      :aria-pressed="i === activeIndex"
      @click="select(i)"
    >
      <span v-if="o.icon" class="hm-seg__icon" v-html="o.icon" />
      <span>{{ o.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.hm-seg {
  position: relative;
  display: flex;
  padding: 4px;
  border-radius: var(--radius-md);
  background: var(--surface-2);
  border: 1px solid var(--line-default);
  overflow: hidden;
}
.hm-seg__indicator {
  position: absolute; top: 4px; bottom: 4px; left: 4px;
  box-sizing: border-box;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  transition: transform var(--dur-base) var(--ease-standard);
}
.hm-seg__item {
  position: relative; z-index: 1;
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px;
  border: none; background: transparent;
  font-size: var(--fs-meta); color: var(--text-2);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-standard);
}
.hm-seg__item.is-active { color: var(--accent); font-weight: 600; }
.hm-seg__icon { display: inline-flex; width: 16px; height: 16px; }
.hm-seg__icon :deep(svg) { width: 100%; height: 100%; }

@media (prefers-reduced-motion: reduce) {
  .hm-seg__indicator,
  .hm-seg__item {
    transition: none;
  }
}
</style>
