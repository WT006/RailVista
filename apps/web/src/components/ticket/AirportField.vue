<script setup lang="ts">
/**
 * 可搜索机场选择字段（鸿蒙风格 ArkUI SearchField）：
 * 输入城市/机场名/IATA → 从本地机场库检索，下拉选择，值为 IATA。
 * 边输入边出联想；空输入不展开整库列表（避免一点击就铺开十几条）。
 */
import { computed, ref, nextTick } from 'vue';
import { searchAirports, type Airport } from '@railvista/shared';

const props = defineProps<{
  label: string;
  modelValue: string;
  placeholder?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const text = ref('');
const open = ref(false);
const boxRef = ref<HTMLElement | null>(null);

const query = computed(() => text.value.trim());
const results = computed<Airport[]>(() => {
  if (!open.value || !query.value) return [];
  return searchAirports(query.value, 8);
});
/** 有输入且应展示下拉（有命中或空态提示） */
const listVisible = computed(() => open.value && query.value.length > 0);

function labelOf(a: Airport): string {
  return `${a.city} ${a.short}`;
}

function onFocus() {
  /* 仅已有关键字时重开联想；空白聚焦不铺整表 */
  if (query.value) open.value = true;
}

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value;
  open.value = query.value.length > 0;
  if (!text.value) emit('update:modelValue', '');
}

function onClear() {
  text.value = '';
  emit('update:modelValue', '');
  open.value = false;
  nextTick(() => {
    (boxRef.value?.querySelector('input') as HTMLInputElement | null)?.focus();
  });
}

function pick(a: Airport) {
  text.value = labelOf(a);
  emit('update:modelValue', a.iata);
  open.value = false;
}

function onBlur() {
  setTimeout(() => {
    if (!props.modelValue && text.value) {
      const match = results.value.find((a) => labelOf(a) === text.value);
      if (match) {
        emit('update:modelValue', match.iata);
      }
    }
    open.value = false;
  }, 200);
}
</script>

<template>
  <div class="af" :class="{ 'is-suggest-open': listVisible }">
    <label class="af__label">{{ label }}</label>
    <div ref="boxRef" class="af__box" :class="{ 'is-open': listVisible && results.length > 0 }">
      <svg class="af__icon" viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M21 15.4v-2l-8-5V3.5a1.5 1.5 0 00-3 0V8.4l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-6.1z"/>
      </svg>
      <input
        :value="text"
        autocomplete="off"
        :placeholder="placeholder ?? '城市 / 机场 / 三字码'"
        @focus="onFocus"
        @blur="onBlur"
        @input="onInput"
      />
      <button v-if="modelValue" type="button" class="af__clear" @mousedown.prevent="onClear" aria-label="清空">
        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm3.5 13.5L13.4 12l2.1-3.5-1.4-.9L12 11.1 9.9 7.6l-1.4.9L10.6 12l-2.1 3.5 1.4.9L12 12.9l2.1 3.5z"/></svg>
      </button>
      <span v-if="modelValue" class="af__code">{{ modelValue }}</span>
    </div>
    <ul v-show="listVisible" class="af__list">
      <li v-if="results.length === 0" class="af__empty">
        <span>未找到匹配机场</span>
      </li>
      <li
        v-for="a in results"
        :key="a.iata"
        :class="{ 'is-active': a.iata === modelValue }"
        @mousedown.prevent="pick(a)"
      >
        <span class="af__city">{{ a.city }} <em>{{ a.short }}</em></span>
        <span class="af__en">{{ a.nameEn }}</span>
        <span class="af__iata">{{ a.iata }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.af { display: block; min-width: 0; position: relative; }
.af__label {
  display: block; margin-bottom: 7px;
  font-size: var(--fs-cap); letter-spacing: 0.04em; color: var(--text-2);
}
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
.af__box:focus-within,
.af__box.is-open {
  border-color: var(--accent);
  background: var(--surface-3);
  box-shadow: var(--focus-ring);
}
.af__icon { flex-shrink: 0; color: var(--text-3); }
.af__box input {
  flex: 1; min-width: 0; height: 46px;
  font-size: var(--fs-body); color: var(--text-1);
  background: transparent; border: none; outline: none;
}
.af__box input::placeholder { color: var(--text-3); }
.af__clear {
  flex-shrink: 0; display: grid; place-items: center;
  width: 20px; height: 20px;
  border: none; border-radius: var(--radius-full);
  color: var(--text-3); background: var(--interactive-pressed);
  cursor: pointer; transition: color 0.15s;
}
.af__clear:hover { color: var(--text-1); }
.af__code {
  flex-shrink: 0; font-size: 12px; font-weight: 700;
  color: var(--accent); padding: 2px 8px;
  background: rgba(77, 159, 255, 0.1);
  border-radius: var(--radius-sm);
}
.af__list {
  /* 卡内层级；跨卡压不住兄弟 .rv-card（isolation），由 TicketHome :has(.is-suggest-open) 抬整卡 */
  position: absolute; left: 0; right: 0; z-index: 40;
  top: calc(100% + 4px);
  max-height: 280px; overflow-y: auto;
  margin: 0; padding: 6px;
  border-radius: var(--radius-md); list-style: none;
  background: rgba(22, 28, 38, 0.96);
  border: 1px solid var(--line-strong);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(16px);
}
.af__list li {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: var(--radius-sm); cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.af__list li:hover { background: var(--interactive-hover); }
.af__list li.is-active { background: rgba(77, 159, 255, 0.08); }
.af__list li.is-active .af__iata { color: var(--accent); }
.af__empty {
  display: block !important; padding: 16px 12px !important;
  text-align: center; font-size: var(--fs-meta); color: var(--text-3);
  cursor: default !important;
}
.af__empty:hover { background: transparent !important; }
.af__city { font-size: var(--fs-meta); color: var(--text-1); white-space: nowrap; }
.af__city em { font-style: normal; color: var(--text-2); margin-left: 2px; }
.af__en {
  font-size: var(--fs-micro); color: var(--text-3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding: 0 4px;
}
.af__iata {
  font-size: 12px; font-weight: 700; color: var(--accent);
  font-family: Arial, monospace;
}

@media (prefers-reduced-motion: reduce) {
  .af__box,
  .af__list li { transition: none; }
}
</style>
