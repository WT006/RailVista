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
.af__label { display: block; margin-bottom: 7px; font-size: 12.5px; letter-spacing: 0.04em; color: rgba(255,255,255,0.55); }
.af__box {
  display: flex; align-items: center; gap: 9px;
  min-height: 48px; padding: 0 13px;
  border-radius: 15px;
  background: rgba(255,255,255,0.055);
  border: 1px solid rgba(255,255,255,0.08);
  transition: border-color 0.18s, background 0.18s, box-shadow 0.18s;
}
.af__box:focus-within {
  border-color: rgba(212,168,83,0.55);
  background: rgba(255,255,255,0.08);
  box-shadow: 0 0 0 3px rgba(212,168,83,0.12);
}
.af__icon { flex-shrink: 0; color: rgba(255,255,255,0.4); }
.af__box input { flex: 1; min-width: 0; height: 46px; font-size: 14.5px; color: #fff; background: transparent; border: none; outline: none; }
.af__box input::placeholder { color: rgba(255,255,255,0.3); }
.af__code { flex-shrink: 0; font-size: 12px; font-weight: 700; color: #d4a853; }
.af__list {
  position: relative; z-index: 20;
  max-height: 260px; overflow-y: auto;
  margin: 6px 0 0; padding: 6px;
  border-radius: 14px; list-style: none;
  background: #232634; border: 1px solid rgba(255,255,255,0.1);
  box-shadow: 0 16px 40px rgba(0,0,0,0.45);
}
.af__list li {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px;
  padding: 9px 11px; border-radius: 9px; cursor: pointer;
}
.af__list li:hover { background: rgba(255,255,255,0.08); }
.af__city { font-size: 13.5px; color: rgba(255,255,255,0.9); }
.af__en { font-size: 10.5px; color: rgba(255,255,255,0.4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 8px; }
.af__iata { font-size: 12px; font-weight: 700; color: #d4a853; }
</style>
