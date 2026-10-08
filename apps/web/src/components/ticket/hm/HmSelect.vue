<script setup lang="ts">
/**
 * 鸿蒙风格选择字段（参考 ArkUI Select）：
 * 外观与输入字段一致，点击弹出滚轮选择器；右侧为箭头。
 */
import { computed, ref } from 'vue';
import HmWheel, { type WheelOption } from './HmWheel.vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    modelValue: string | number;
    options: WheelOption[];
    placeholder?: string;
    title?: string;
  }>(),
  {},
);
const emit = defineEmits<{
  'update:modelValue': [string | number];
  confirm: [string | number, WheelOption];
}>();

const open = ref(false);
const selected = computed(() => props.options.find((o) => o.value === props.modelValue));

function onConfirm(value: string | number, opt: WheelOption) {
  emit('update:modelValue', value);
  emit('confirm', value, opt);
}
</script>

<template>
  <div class="hm-select">
    <label v-if="label" class="hm-select__label">{{ label }}</label>
    <button type="button" class="hm-select__box" @click="open = true">
      <span class="hm-select__value" :class="{ 'is-placeholder': !selected }">
        {{ selected ? selected.label : placeholder ?? '请选择' }}
      </span>
      <svg class="hm-select__chevron" viewBox="0 0 24 24" width="17" height="17">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/>
      </svg>
    </button>
    <HmWheel
      :open="open"
      :title="title ?? label"
      :options="options"
      :model-value="modelValue"
      @update:open="open = $event"
      @confirm="onConfirm"
    />
  </div>
</template>

<style scoped>
.hm-select { min-width: 0; }
.hm-select__label {
  display: block; margin-bottom: 7px;
  font-size: 12.5px; letter-spacing: 0.04em; color: rgba(255,255,255,0.55);
}
.hm-select__box {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 48px; padding: 0 14px;
  border-radius: 15px;
  background: rgba(255,255,255,0.055);
  border: 1px solid rgba(255,255,255,0.08);
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s;
}
.hm-select__box:hover { border-color: rgba(255,255,255,0.18); }
.hm-select__value { flex: 1; text-align: left; font-size: 15px; color: #fff; }
.hm-select__value.is-placeholder { color: rgba(255,255,255,0.3); }
.hm-select__chevron { flex-shrink: 0; color: rgba(255,255,255,0.45); }
</style>
