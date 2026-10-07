<script setup lang="ts">
/**
 * 鸿蒙风格输入字段（参考 ArkUI TextInput）：
 * 标签置顶、圆角填充容器、可选单位后缀、一键清空；深色主题适配。
 */
import { computed } from 'vue';

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
    <label v-if="label" class="hm-field__label">{{ label }}</label>
    <div class="hm-field__box" :class="{ 'is-disabled': disabled }">
      <input
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
        class="hm-field__clear"
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
  font-size: 12.5px;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.55);
}
.hm-field__box {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 0 14px;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: border-color 0.18s, background 0.18s, box-shadow 0.18s;
}
.hm-field__box:focus-within {
  border-color: rgba(212, 168, 83, 0.55);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 0 3px rgba(212, 168, 83, 0.12);
}
.hm-field__box.is-disabled { opacity: 0.5; }
.hm-field__input {
  flex: 1;
  min-width: 0;
  height: 46px;
  font-size: 15px;
  color: #fff;
  background: transparent;
  border: none;
  outline: none;
}
.hm-field__input::placeholder { color: rgba(255, 255, 255, 0.3); }
.hm-field__input::-webkit-date-and-time-value { text-align: left; }
.hm-field__suffix {
  flex-shrink: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
}
.hm-field__clear {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.12);
  cursor: pointer;
}
.hm-field__clear:hover { color: #fff; }
.hm-field__hint { margin: 6px 2px 0; font-size: 11.5px; line-height: 1.5; color: rgba(255, 255, 255, 0.35); }
</style>
