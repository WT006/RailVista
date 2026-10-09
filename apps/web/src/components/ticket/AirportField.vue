<script setup lang="ts">
/**
 * 可搜索机场选择字段（鸿蒙风格）：
 * 输入城市/机场名/IATA → 从本地机场库检索（含英文名），下拉选择，值为 IATA。
 */
import { computed, ref } from 'vue';
import { searchAirports, type Airport } from '@railvista/shared';

const props = defineProps<{
  label: string;
  modelValue: string;
  placeholder?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const text = ref('');
const open = ref(false);

const selected = computed(() => (props.modelValue ? text.value : ''));
const results = computed<Airport[]>(() => searchAirports(text.value, 20));

function labelOf(a: Airport): string {
  return `${a.city} ${a.short} · ${a.iata}`;
}

function onFocus() {
  if (props.modelValue && !text.value) {
    // keep showing what is selected
  }
  open.value = true;
}
function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value;
  open.value = true;
  if (text.value === '') emit('update:modelValue', '');
}
function pick(a: Airport) {
  text.value = labelOf(a);
  emit('update:modelValue', a.iata);
  open.value = false;
}
</script>

<template>
  <div class="af">
    <label class="af__label">{{ label }}</label>
    <div class="af__box">
      <svg class="af__icon" viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M21 15.4v-2l-8-5V3.5a1.5 1.5 0 00-3 0V8.4l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-6.1z"/>
      </svg>
      <input
        :value="text"
        autocomplete="off"
        :placeholder="placeholder ?? '城市 / 机场 / 三字码'"
        @focus="onFocus"
        @blur="open = false"
        @input="onInput"
      />
      <span v-if="modelValue" class="af__code">{{ modelValue }}</span>
    </div>
    <ul v-show="open && results.length" class="af__list">
      <li v-for="a in results" :key="a.iata" @mousedown.prevent="pick(a)">
        <span class="af__city">{{ a.city }} {{ a.short }}</span>
        <span class="af__en">{{ a.nameEn }}</span>
        <span class="af__iata">{{ a.iata }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.af__label { display: block; margin-bottom: 7px; font-size: var(--fs-cap); letter-spacing: 0.04em; color: var(--text-2); }
.af__box {
  display: flex; align-items: center; gap: 9px;
  min-height: 48px; padding: 0 13px;
  border-radius: var(--radius-md);
  background: var(--surface-2);
  border: 1px solid var(--line-default);
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}
.af__box:focus-within {
  border-color: var(--accent);
  background: var(--interactive-hover);
  box-shadow: var(--focus-ring);
}
.af__icon { flex-shrink: 0; color: var(--text-3); }
.af__box input { flex: 1; min-width: 0; height: 46px; font-size: var(--fs-body); color: var(--text-1); background: transparent; border: none; outline: none; }
.af__box input::placeholder { color: var(--text-3); }
.af__code { flex-shrink: 0; font-size: 12px; font-weight: 700; color: var(--ticket-gold); }
.af__list {
  position: relative; z-index: 20;
  max-height: 260px; overflow-y: auto;
  margin: 6px 0 0; padding: 6px;
  border-radius: var(--radius-md); list-style: none;
  background: var(--surface-1); border: 1px solid var(--line-strong);
  box-shadow: var(--elev-3);
}
.af__list li {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px;
  padding: 9px 11px; border-radius: var(--radius-sm); cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .af__list li:hover { background: var(--interactive-hover); }
}
.af__city { font-size: var(--fs-meta); color: var(--text-1); }
.af__en { font-size: var(--fs-micro); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 8px; }
.af__iata { font-size: 12px; font-weight: 700; color: var(--ticket-gold); }

@media (prefers-reduced-motion: reduce) {
  .af__box,
  .af__list li {
    transition: none;
  }
}
</style>
