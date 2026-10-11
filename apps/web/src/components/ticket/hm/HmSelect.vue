<script setup lang="ts">
/**
 * 鸿蒙风格选择字段（参考 ArkUI Select）v2（2026-10-09 鸿蒙化收敛）：
 * 外观与输入字段一致（--radius-md / --surface-2 / --line-default），点击弹出滚轮选择器；右侧箭头。
 *
 * v2 变更：全量设计令牌；标签与控件关联（for/id）；动效走 --dur-* 并带 reduced-motion 降级。
 */
import { computed, ref, useId } from 'vue';
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

const uid = `hms-${useId()}`;
const open = ref(false);
const selected = computed(() => props.options.find((o) => o.value === props.modelValue));

function onConfirm(value: string | number, opt: WheelOption) {
  emit('update:modelValue', value);
  emit('confirm', value, opt);
}
</script>

<template>
  <div class="hm-select">
    <label v-if="label" class="hm-select__label" :for="uid">{{ label }}</label>
    <button :id="uid" type="button" class="hm-select__box" @click="open = true">
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
  font-size: var(--fs-cap); letter-spacing: 0.04em; color: var(--text-2);
}
.hm-select__box {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 48px; padding: 0 14px;
  border-radius: var(--radius-md);
  background: var(--surface-2);
  border: 1px solid var(--line-default);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard);
}
.hm-select__box:hover { border-color: var(--line-strong); }
.hm-select__box:focus-visible { box-shadow: var(--focus-ring); }
.hm-select__value { flex: 1; text-align: left; font-size: var(--fs-body); color: var(--text-1); }
.hm-select__value.is-placeholder { color: var(--text-3); }
.hm-select__chevron { flex-shrink: 0; color: var(--text-3); }

@media (prefers-reduced-motion: reduce) {
  .hm-select__box {
    transition: none;
  }
}
</style>
