<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    mode?: 'date' | 'datetime';
    /** 始终展开（对话框内） */
    inline?: boolean;
    placeholder?: string;
  }>(),
  {
    mode: 'date',
    inline: false,
    placeholder: '选择日期',
  },
);

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const open = ref(props.inline);
const viewYear = ref(2026);
const viewMonth = ref(0); // 0-11
const rootRef = ref<HTMLElement | null>(null);

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

type Parts = { y: number; m: number; d: number; hh: number; mm: number };

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function parseValue(v: string): Parts | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    hh: m[4] != null ? Number(m[4]) : 0,
    mm: m[5] != null ? Number(m[5]) : 0,
  };
}

function formatParts(p: Parts) {
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  if (props.mode === 'date') return date;
  return `${date}T${pad(p.hh)}:${pad(p.mm)}`;
}

function todayParts(): Parts {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate(), hh: n.getHours(), mm: n.getMinutes() };
}

const parts = computed(() => parseValue(props.modelValue) ?? (props.inline ? todayParts() : null));

const displayText = computed(() => {
  const p = parseValue(props.modelValue);
  if (!p) return props.placeholder;
  if (props.mode === 'date') return `${p.y}/${pad(p.m)}/${pad(p.d)}`;
  return `${p.y}/${pad(p.m)}/${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`;
});

const monthLabel = computed(() => `${viewYear.value}年${pad(viewMonth.value + 1)}月`);

const cells = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  // Monday-first
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate();
  const prevDays = new Date(viewYear.value, viewMonth.value, 0).getDate();
  const out: { day: number; inMonth: boolean; y: number; m: number }[] = [];
  for (let i = 0; i < startPad; i++) {
    const day = prevDays - startPad + 1 + i;
    const dt = new Date(viewYear.value, viewMonth.value - 1, day);
    out.push({ day, inMonth: false, y: dt.getFullYear(), m: dt.getMonth() + 1 });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    out.push({ day, inMonth: true, y: viewYear.value, m: viewMonth.value + 1 });
  }
  while (out.length % 7 !== 0 || out.length < 42) {
    const day = out.length - startPad - daysInMonth + 1;
    const dt = new Date(viewYear.value, viewMonth.value + 1, day);
    out.push({ day: dt.getDate(), inMonth: false, y: dt.getFullYear(), m: dt.getMonth() + 1 });
  }
  return out;
});

function syncViewFromModel() {
  const p = parseValue(props.modelValue) ?? todayParts();
  viewYear.value = p.y;
  viewMonth.value = p.m - 1;
}

function emitParts(next: Parts) {
  emit('update:modelValue', formatParts(next));
}

function shiftMonth(delta: number) {
  const d = new Date(viewYear.value, viewMonth.value + delta, 1);
  viewYear.value = d.getFullYear();
  viewMonth.value = d.getMonth();
}

function pickDay(y: number, m: number, d: number) {
  const cur = parseValue(props.modelValue) ?? todayParts();
  emitParts({ ...cur, y, m, d });
  viewYear.value = y;
  viewMonth.value = m - 1;
  if (props.mode === 'date' && !props.inline) open.value = false;
}

function pickHour(hh: number) {
  const cur = parseValue(props.modelValue) ?? todayParts();
  emitParts({ ...cur, hh });
}

function pickMinute(mm: number) {
  const cur = parseValue(props.modelValue) ?? todayParts();
  emitParts({ ...cur, mm });
}

function clearValue() {
  emit('update:modelValue', '');
  if (!props.inline) open.value = false;
}

function setToday() {
  const t = todayParts();
  if (props.mode === 'date') {
    emitParts({ ...t, hh: 0, mm: 0 });
  } else {
    emitParts(t);
  }
  viewYear.value = t.y;
  viewMonth.value = t.m - 1;
}

function isSelected(y: number, m: number, d: number) {
  const p = parseValue(props.modelValue);
  return !!p && p.y === y && p.m === m && p.d === d;
}

function isToday(y: number, m: number, d: number) {
  const t = todayParts();
  return t.y === y && t.m === m && t.d === d;
}

function toggle() {
  if (props.inline) return;
  open.value = !open.value;
  if (open.value) syncViewFromModel();
}

function onDocPointer(e: PointerEvent) {
  if (props.inline || !open.value) return;
  const el = rootRef.value;
  if (el && e.target instanceof Node && !el.contains(e.target)) {
    open.value = false;
  }
}

watch(
  () => props.modelValue,
  () => {
    if (open.value || props.inline) syncViewFromModel();
  },
);

onMounted(() => {
  syncViewFromModel();
  document.addEventListener('pointerdown', onDocPointer, true);
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointer, true);
});

async function scrollTimeIntoView() {
  await nextTick();
  rootRef.value?.querySelectorAll('.dtf-time-scroll .is-active').forEach((el) => {
    el.scrollIntoView({ block: 'center' });
  });
}

watch(open, (v) => {
  if (v && props.mode === 'datetime') void scrollTimeIntoView();
});

watch(
  () => props.inline,
  (v) => {
    if (v) {
      open.value = true;
      void scrollTimeIntoView();
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    ref="rootRef"
    class="dtf"
    :class="{ 'dtf--inline': inline, 'dtf--open': open, 'dtf--date': mode === 'date' }"
  >
    <button
      v-if="!inline"
      type="button"
      class="dtf-trigger"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="dtf-trigger__text" :class="{ 'is-placeholder': !modelValue }">{{ displayText }}</span>
      <span class="dtf-trigger__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
        </svg>
      </span>
    </button>

    <div v-show="open" class="dtf-panel" role="dialog" :aria-label="mode === 'date' ? '选择日期' : '选择日期时间'">
      <div v-if="mode === 'datetime' || (mode === 'date' && open && !inline)" class="dtf-selected">
        <span class="dtf-selected__label">当前选择</span>
        <strong class="dtf-selected__value">{{ modelValue ? displayText : '未选择' }}</strong>
      </div>
      <div class="dtf-panel__body" :class="{ 'has-time': mode === 'datetime' }">
        <div class="dtf-cal">
          <div class="dtf-cal__head">
            <button type="button" class="dtf-nav" aria-label="上一月" @click="shiftMonth(-1)">‹</button>
            <span class="dtf-cal__label">{{ monthLabel }}</span>
            <button type="button" class="dtf-nav" aria-label="下一月" @click="shiftMonth(1)">›</button>
          </div>
          <div class="dtf-week">
            <span v-for="w in WEEKDAYS" :key="w">{{ w }}</span>
          </div>
          <div class="dtf-grid">
            <button
              v-for="(c, i) in cells"
              :key="i"
              type="button"
              class="dtf-day"
              :class="{
                'is-muted': !c.inMonth,
                'is-selected': isSelected(c.y, c.m, c.day),
                'is-today': isToday(c.y, c.m, c.day),
              }"
              @click="pickDay(c.y, c.m, c.day)"
            >
              {{ c.day }}
            </button>
          </div>
          <div class="dtf-cal__foot">
            <button type="button" class="dtf-link" @click="clearValue">清除</button>
            <button type="button" class="dtf-link" @click="setToday">今天</button>
          </div>
        </div>

        <div v-if="mode === 'datetime'" class="dtf-time" role="group" aria-label="时间">
          <div class="dtf-time-col">
            <div class="dtf-time-head">时</div>
            <div class="dtf-time-scroll" aria-label="小时">
              <button
                v-for="h in HOURS"
                :key="'h' + h"
                type="button"
                class="dtf-time-item"
                :class="{ 'is-active': (parts?.hh ?? 0) === h }"
                @click="pickHour(h)"
              >
                {{ pad(h) }}
              </button>
            </div>
          </div>
          <div class="dtf-time-col">
            <div class="dtf-time-head">分</div>
            <div class="dtf-time-scroll" aria-label="分钟">
              <button
                v-for="m in MINUTES"
                :key="'m' + m"
                type="button"
                class="dtf-time-item"
                :class="{ 'is-active': (parts?.mm ?? 0) === m }"
                @click="pickMinute(m)"
              >
                {{ pad(m) }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dtf {
  position: relative;
  width: 100%;
}

.dtf--open {
  z-index: 60;
}

.dtf-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-default);
  background: var(--bg-raised);
  color: var(--text-primary);
  font-size: 16px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color var(--dur-micro) var(--ease-out), box-shadow var(--dur-micro) var(--ease-out);
}

.dtf-trigger:hover,
.dtf--open .dtf-trigger {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 1px var(--accent-container);
}

.dtf-trigger__text.is-placeholder {
  color: var(--text-muted);
}

.dtf-trigger__icon {
  color: var(--accent-hover);
  display: inline-flex;
  opacity: 0.9;
}

.dtf-panel {
  z-index: 50;
  margin-top: 8px;
  border-radius: 12px;
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.5),
    0 0 0 1px var(--accent-container) inset;
  overflow: hidden;
}

.dtf:not(.dtf--inline) .dtf-panel {
  position: absolute;
  left: 0;
  right: 0;
  width: min(100%, 280px);
  z-index: 70;
}

.dtf--inline .dtf-panel {
  margin-top: 0;
  box-shadow: none;
  background: var(--bg-scrim);
  border: 1px solid var(--border-default);
}

/* 短视口横屏：面板高度 ~280px，向下弹必然超出视口下缘（390px 高的横屏
 * 里日期字段已在中部），改为向上弹出；同时紧凑化日历（当前值已在触发器
 * 里展示，"当前选择"条冗余），保证整个面板在 390px 高的视口内完整可见。 */
@media (orientation: landscape) and (max-height: 560px) {
  .dtf:not(.dtf--inline) .dtf-panel {
    top: auto;
    bottom: calc(100% + 8px);
    margin-top: 0;
  }

  .dtf:not(.dtf--inline) .dtf-selected {
    display: none;
  }

  .dtf:not(.dtf--inline) .dtf-cal {
    padding: 4px 6px;
  }

  .dtf:not(.dtf--inline) .dtf-cal__head {
    margin-bottom: 2px;
  }

  .dtf:not(.dtf--inline) .dtf-day {
    height: 20px;
    font-size: 10px;
  }

  .dtf:not(.dtf--inline) .dtf-week span {
    font-size: 9px;
    padding: 0;
  }
}

.dtf-selected {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-hairline);
  background: var(--accent-container);
}

.dtf-selected__label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.dtf-selected__value {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent-hover);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.dtf-panel__body {
  display: flex;
  gap: 0;
}

.dtf-panel__body.has-time {
  flex-wrap: nowrap;
}

.dtf-cal {
  flex: 1 1 auto;
  padding: 8px 8px 6px;
  min-width: 0;
}

.dtf:not(.dtf--inline) .dtf-cal {
  padding: 6px 6px 4px;
}

.dtf:not(.dtf--inline) .dtf-day {
  height: 26px;
  font-size: 11px;
  border-radius: 5px;
}

.dtf:not(.dtf--inline) .dtf-nav {
  width: 24px;
  height: 24px;
  font-size: 14px;
}

.dtf:not(.dtf--inline) .dtf-cal__label {
  font-size: 12px;
}

.dtf:not(.dtf--inline) .dtf-week span {
  font-size: 10px;
  padding: 1px 0;
}

.dtf-cal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.dtf-cal__label {
  font-size: 12px;
  font-weight: 650;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
}

.dtf-nav {
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.dtf-nav:hover {
  border-color: rgba(56, 189, 248, 0.4);
  color: var(--accent-hover);
}

.dtf-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  margin-bottom: 2px;
}

.dtf-week span {
  text-align: center;
  font-size: 10px;
  color: var(--text-muted);
  padding: 2px 0;
}

.dtf-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
}

.dtf-day {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-family: inherit;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
}

.dtf-day:hover {
  background: var(--accent-container);
}

.dtf-day.is-muted {
  color: var(--text-muted);
}

.dtf-day.is-today:not(.is-selected) {
  border-color: var(--accent-border);
  color: var(--accent-hover);
}

.dtf-day.is-selected {
  background: var(--accent-container);
  border-color: var(--accent-border);
  color: var(--accent-hover);
  font-weight: 650;
}

.dtf-cal__foot {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 2px;
}

.dtf-link {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  padding: 2px;
}

.dtf-link:hover {
  color: var(--accent-hover);
}

.dtf-time {
  display: flex;
  flex: 0 0 96px;
  width: 96px;
  border-left: 1px solid var(--border-hairline);
  background: var(--bg-scrim);
}

.dtf-time-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dtf-time-head {
  flex-shrink: 0;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-hover);
  padding: 6px 0 4px;
  border-bottom: 1px solid var(--border-hairline);
  letter-spacing: 0.06em;
}

.dtf-time-scroll {
  flex: 1;
  max-height: 196px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 3px;
  scrollbar-width: thin;
  scrollbar-color: var(--text-muted) transparent;
}

.dtf-time-item {
  display: block;
  width: 100%;
  padding: 4px 0;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
  cursor: pointer;
  line-height: 1.2;
}

.dtf-time-item:hover {
  background: var(--accent-container);
  color: var(--text-secondary);
}

.dtf-time-item.is-active {
  background: var(--accent-container);
  border-color: var(--accent-border);
  color: var(--accent-hover);
  font-weight: 650;
}

@media (max-width: 420px) {
  .dtf-panel__body.has-time {
    flex-direction: column;
  }

  .dtf-time {
    width: 100%;
    flex-basis: auto;
    border-left: none;
    border-top: 1px solid var(--border-hairline);
  }

  .dtf-time-scroll {
    max-height: 108px;
  }
}
</style>
