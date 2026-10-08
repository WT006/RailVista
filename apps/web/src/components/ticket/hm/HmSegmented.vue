<script setup lang="ts">
/** 鸿蒙风格分段选择（参考 ArkUI 分段按钮）：滑块指示器在分段间平滑移动。 */
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
    <span class="hm-seg__indicator" :style="{ width: 100 / options.length + '%', transform: `translateX(${activeIndex * 100}%)` }" />
    <button
      v-for="(o, i) in options"
      :key="String(o.value)"
      type="button"
      class="hm-seg__item"
      :class="{ 'is-active': i === activeIndex }"
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
  border-radius: 15px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.07);
}
.hm-seg__indicator {
  position: absolute; top: 4px; bottom: 4px; left: 4px;
  width: 33%;
  border-radius: 11px;
  background: linear-gradient(180deg, rgba(212,168,83,0.28), rgba(212,168,83,0.16));
  border: 1px solid rgba(212,168,83,0.35);
  transition: transform 0.24s cubic-bezier(0.3, 0.9, 0.3, 1);
}
.hm-seg__item {
  position: relative; z-index: 1;
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  height: 38px;
  border: none; background: transparent;
  font-size: 13.5px; color: rgba(255,255,255,0.55);
  cursor: pointer;
  transition: color 0.2s;
}
.hm-seg__item.is-active { color: #f0d9a8; font-weight: 600; }
.hm-seg__icon { display: inline-flex; width: 16px; height: 16px; }
.hm-seg__icon :deep(svg) { width: 100%; height: 100%; }
</style>
