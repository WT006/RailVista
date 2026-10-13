<script setup lang="ts">
/**
 * 鸿蒙风格日期选择器（参考 ArkUI DatePicker）：
 * 点击输入框弹出日历面板，支持月份切换、今日高亮、日期选择。
 * 设计令牌全量走 tokens.css。
 */
import { computed, ref, watch, useId } from 'vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    modelValue: string;
    placeholder?: string;
    min?: string;
    max?: string;
  }>(),
  { placeholder: '请选择日期' },
);
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const uid = `hmdp-${useId()}`;
const open = ref(false);

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const selectedDate = computed(() => (props.modelValue ? parseDate(props.modelValue) : null));
const displayText = computed(() => {
  if (!props.modelValue) return '';
  const d = parseDate(props.modelValue);
  const wd = WEEKDAYS[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${wd}`;
});

const viewYear = ref(selectedDate.value?.getFullYear() ?? new Date().getFullYear());
const viewMonth = ref(selectedDate.value?.getMonth() ?? new Date().getMonth());

watch(open, (v) => {
  if (v && selectedDate.value) {
    viewYear.value = selectedDate.value.getFullYear();
    viewMonth.value = selectedDate.value.getMonth();
  }
});

const todayStr = computed(() => formatDate(new Date()));

const daysInMonth = computed(() => new Date(viewYear.value, viewMonth.value + 1, 0).getDate());
const firstDayOfWeek = computed(() => new Date(viewYear.value, viewMonth.value, 1).getDay());

const gridDays = computed(() => {
  const cells: Array<{ day: number; date: string; isCurrentMonth: boolean } | null> = [];
  for (let i = 0; i < firstDayOfWeek.value; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth.value; d++) {
    const date = new Date(viewYear.value, viewMonth.value, d);
    cells.push({ day: d, date: formatDate(date), isCurrentMonth: true });
  }
  return cells;
});

const monthLabel = computed(() => `${viewYear.value}年${viewMonth.value + 1}月`);

function prevMonth() {
  if (viewMonth.value === 0) { viewYear.value--; viewMonth.value = 11; }
  else viewMonth.value--;
}
function nextMonth() {
  if (viewMonth.value === 11) { viewYear.value++; viewMonth.value = 0; }
  else viewMonth.value++;
}

function pick(dateStr: string) {
  if (props.min && dateStr < props.min) return;
  if (props.max && dateStr > props.max) return;
  emit('update:modelValue', dateStr);
  open.value = false;
}

function isDisabled(dateStr: string): boolean {
  return (props.min != null && dateStr < props.min) || (props.max != null && dateStr > props.max);
}

function isToday(dateStr: string): boolean { return dateStr === todayStr.value; }
function isSelected(dateStr: string): boolean { return dateStr === props.modelValue; }
</script>

<template>
  <div class="hm-dp">
    <label v-if="label" class="hm-dp__label" :for="uid">{{ label }}</label>
    <button :id="uid" type="button" class="hm-dp__box" :class="{ 'is-open': open }" @click="open = !open">
      <svg class="hm-dp__icon" viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"/>
      </svg>
      <span class="hm-dp__value" :class="{ 'is-placeholder': !modelValue }">{{ displayText || placeholder }}</span>
      <span v-if="modelValue" class="hm-dp__raw">{{ modelValue }}</span>
    </button>

    <Teleport to="body">
      <div v-if="open" class="hm-dp__overlay" @click.self="open = false">
        <div class="hm-dp__panel">
          <div class="hm-dp__header">
            <button type="button" class="hm-dp__nav" @click="prevMonth">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6"/></svg>
            </button>
            <span class="hm-dp__title">{{ monthLabel }}</span>
            <button type="button" class="hm-dp__nav" @click="nextMonth">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
          <div class="hm-dp__weekdays">
            <span v-for="w in WEEKDAYS" :key="w" class="hm-dp__wd">{{ w }}</span>
          </div>
          <div class="hm-dp__grid">
            <span v-for="(cell, i) in gridDays" :key="i" class="hm-dp__cell">
              <button
                v-if="cell"
                type="button"
                class="hm-dp__day"
                :class="{
                  'is-today': isToday(cell.date),
                  'is-selected': isSelected(cell.date),
                  'is-disabled': isDisabled(cell.date),
                }"
                :disabled="isDisabled(cell.date)"
                @click="pick(cell.date)"
              >{{ cell.day }}</button>
            </span>
          </div>
          <div class="hm-dp__footer">
            <button type="button" class="hm-dp__today-btn" @click="pick(todayStr)">今天</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.hm-dp { display: block; min-width: 0; }
.hm-dp__label {
  display: block; margin-bottom: 7px;
  font-size: var(--fs-cap); letter-spacing: 0.04em; color: var(--text-2);
}
.hm-dp__box {
  display: flex; align-items: center; gap: 9px;
  width: 100%; min-height: 48px; padding: 0 14px;
  border-radius: var(--radius-md);
  background: var(--surface-2);
  border: 1px solid var(--line-default);
  cursor: pointer; text-align: left;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}
.hm-dp__box:hover { border-color: var(--line-strong); }
.hm-dp__box.is-open,
.hm-dp__box:focus-visible {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
.hm-dp__icon { flex-shrink: 0; color: var(--text-3); }
.hm-dp__value { flex: 1; font-size: var(--fs-body); color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hm-dp__value.is-placeholder { color: var(--text-3); }
.hm-dp__raw { flex-shrink: 0; font-size: 11px; font-weight: 600; color: var(--accent); font-family: Arial, monospace; }
</style>

<style>
/* 非 scoped：Teleport 到 body 的面板 */
.hm-dp__overlay {
  position: fixed; inset: 0; z-index: 9000;
  display: grid; place-items: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  animation: hm-dp-fadein 0.2s ease;
}
@keyframes hm-dp-fadein { from { opacity: 0; } to { opacity: 1; } }

.hm-dp__panel {
  width: 320px; max-width: calc(100vw - 32px);
  border-radius: 20px;
  background: rgba(22, 28, 38, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  animation: hm-dp-slideup 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  color: #e7ecf3;
}
@keyframes hm-dp-slideup { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.hm-dp__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 16px 12px;
}
.hm-dp__title { font-size: 16px; font-weight: 700; letter-spacing: 0.02em; }
.hm-dp__nav {
  display: grid; place-items: center;
  width: 36px; height: 36px;
  border: none; border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: #a3aebd; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.hm-dp__nav:hover { background: rgba(255, 255, 255, 0.12); color: #e7ecf3; }

.hm-dp__weekdays {
  display: grid; grid-template-columns: repeat(7, 1fr);
  padding: 0 12px 4px;
}
.hm-dp__wd {
  text-align: center; font-size: 12px; font-weight: 600;
  color: #6d7889; padding: 4px 0; letter-spacing: 0.04em;
}

.hm-dp__grid {
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 2px; padding: 0 12px 12px;
}
.hm-dp__cell { aspect-ratio: 1; display: grid; place-items: center; }
.hm-dp__day {
  width: 100%; height: 100%;
  display: grid; place-items: center;
  border: none; border-radius: 50%;
  font-size: 14px; font-weight: 500;
  color: #e7ecf3; background: transparent;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.hm-dp__day:hover:not(.is-selected):not(.is-disabled) { background: rgba(255, 255, 255, 0.08); }
.hm-dp__day.is-today { color: #4d9fff; font-weight: 700; box-shadow: inset 0 0 0 1px rgba(77, 159, 255, 0.4); }
.hm-dp__day.is-selected {
  background: #4d9fff; color: #05121f; font-weight: 700;
  box-shadow: 0 2px 8px rgba(77, 159, 255, 0.35);
}
.hm-dp__day.is-disabled { color: #3a4250; cursor: default; }

.hm-dp__footer {
  padding: 8px 16px 14px;
  display: flex; justify-content: center;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.hm-dp__today-btn {
  padding: 8px 24px;
  border: none; border-radius: 999px;
  font-size: 13px; font-weight: 600;
  color: #4d9fff; background: rgba(77, 159, 255, 0.1);
  cursor: pointer;
  transition: background 0.15s;
}
.hm-dp__today-btn:hover { background: rgba(77, 159, 255, 0.18); }
</style>
