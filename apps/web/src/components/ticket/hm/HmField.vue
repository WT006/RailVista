<script setup lang="ts">
/**
 * 鸿蒙风格输入字段（参考 ArkUI TextInput）v2（2026-10-09 鸿蒙化收敛）：
 * 标签置顶、圆角填充容器（--radius-md）、可选单位后缀、一键清空、深色主题适配。
 *
 * v2 变更：全量设计令牌（tokens.css）、焦点环统一 --focus-ring、清空键命中区 ≥44×44、
 * 标签与输入关联（for/id）、动效走 --dur-* 令牌并带 reduced-motion 降级。
 */
import { computed, useId } from 'vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    modelValue: string | number;
    placeholder?: string;
    type?: string;
    suffix?: string;
    hint?: string;
    inputmode?: 'text' | 'numeric' | 'tel' | 'search';
    maxlength?: number;
    disabled?: boolean;
  }>(),
  { type: 'text' },
);
const emit = defineEmits<{
  'update:modelValue': [string];
  enter: [];
}>();

const uid = `hmf-${useId()}`;

const value = computed({
  get: () => String(props.modelValue ?? ''),
  set: (v) => emit('update:modelValue', v),
});

function onInput(e: Event) {
  value.value = (e.target as HTMLInputElement).value;
}
function clear() {
  value.value = '';
}
</script>

<template>
  <div class="hm-field">
    <label v-if="label" class="hm-field__label" :for="uid">{{ label }}</label>
    <div class="hm-field__box" :class="{ 'is-disabled': disabled }">
      <input
        :id="uid"
        class="hm-field__input"
        :type="type"
        :value="value"
        :placeholder="placeholder"
        :inputmode="inputmode"
        :maxlength="maxlength"
        :disabled="disabled"
        spellcheck="false"
        @input="onInput"
        @keyup.enter="emit('enter')"
      />
      <span v-if="suffix" class="hm-field__suffix">{{ suffix }}</span>
      <button
        v-else-if="value && !disabled"
        type="button"
        class="hm-field__clear rv-hit"
        aria-label="清空"
        @click="clear"
      >
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm3.5 13.5L13.4 12l2.1-3.5-1.4-.9L12 11.1 9.9 7.6l-1.4.9L10.6 12l-2.1 3.5 1.4.9L12 12.9l2.1 3.5z"/></svg>
      </button>
    </div>
    <p v-if="hint" class="hm-field__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.hm-field { display: block; min-width: 0; }
.hm-field__label {
  display: block;
  margin-bottom: 7px;
  font-size: var(--fs-cap);
  letter-spacing: 0.04em;
  color: var(--text-2);
}
.hm-field__box {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 0 14px;
  border-radius: var(--radius-md);
  background: var(--surface-2);
  border: 1px solid var(--line-default);
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}
.hm-field__box:focus-within {
  border-color: var(--accent);
  background: var(--surface-3);
  box-shadow: var(--focus-ring);
}
.hm-field__box.is-disabled { opacity: 0.5; }
.hm-field__input {
  flex: 1;
  min-width: 0;
  height: 46px;
  font-size: var(--fs-body);
  color: var(--text-1);
  background: transparent;
  border: none;
  outline: none;
}
.hm-field__input::placeholder { color: var(--text-3); }
.hm-field__input::-webkit-date-and-time-value { text-align: left; }
.hm-field__suffix {
  flex-shrink: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.hm-field__clear {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-full);
  color: var(--text-3);
  background: var(--interactive-pressed);
  cursor: pointer;
}
.hm-field__clear:hover { color: var(--text-1); }
.hm-field__hint { margin: 6px 2px 0; font-size: var(--fs-micro); line-height: 1.5; color: var(--text-3); }

@media (prefers-reduced-motion: reduce) {
  .hm-field__box {
    transition: none;
  }
}
</style>
