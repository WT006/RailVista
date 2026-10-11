<script setup lang="ts">
/**
 * 车次选择器（鸿蒙风格）：站点联想 + 日期 + 12306 直达车次列表。
 * 选中车次后 emit pick，由页面联动票面（ticketStore.applyTrain）。
 */
import { ref, watch } from 'vue';
import type { TrainSummary } from '@railvista/shared';
import { api } from '../../api/client';
import { trainChipColor } from '../../data/ticket';

defineEmits<{ pick: [train: TrainSummary] }>();

const from = ref('');
const to = ref('');
const date = ref(new Date().toISOString().slice(0, 10));

interface SuggestItem { name: string; telecode: string }
const fromSuggest = ref<SuggestItem[]>([]);
const toSuggest = ref<SuggestItem[]>([]);
const fromOpen = ref(false);
const toOpen = ref(false);

const trains = ref<TrainSummary[]>([]);
const loading = ref(false);
const searched = ref(false);
const error = ref('');

let suggestSeq = 0;

function fetchSuggest(side: 'from' | 'to') {
  const q = (side === 'from' ? from.value : to.value).trim();
  if (!q) {
    if (side === 'from') fromSuggest.value = [];
    else toSuggest.value = [];
    return;
  }
  const seq = ++suggestSeq;
  window.setTimeout(async () => {
    if (seq !== suggestSeq) return;
    try {
      const res = await api.suggestStations(q);
      if (seq !== suggestSeq) return;
      const list = res.stations.slice(0, 7);
      if (side === 'from') fromSuggest.value = list;
      else toSuggest.value = list;
    } catch {
      /* 联想失败不阻塞 */
    }
  }, 220);
}

watch(from, () => { fromOpen.value = true; fetchSuggest('from'); });
watch(to, () => { toOpen.value = true; fetchSuggest('to'); });

function pickStation(side: 'from' | 'to', name: string) {
  if (side === 'from') { from.value = name; fromOpen.value = false; }
  else { to.value = name; toOpen.value = false; }
}

async function search() {
  error.value = '';
  if (!from.value.trim() || !to.value.trim()) {
    error.value = '请先选择出发站与到达站';
    return;
  }
  loading.value = true;
  searched.value = true;
  try {
    const res = await api.searchTrains(from.value.trim(), to.value.trim(), date.value);
    trains.value = res.trains;
  } catch (e) {
    trains.value = [];
    error.value = e instanceof Error ? e.message : '查询失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

function trainKind(code: string): 'hsr' | 'intercity' | 'conventional' | 'other' {
  const c = String(code || '').trim().toUpperCase();
  if (/^[GD]/.test(c)) return 'hsr';
  if (/^C/.test(c)) return 'intercity';
  if (/^[ZTK]/.test(c)) return 'conventional';
  return 'other';
}
</script>

<template>
  <div class="tp">
    <form class="tp__form" @submit.prevent="search">
      <div class="tp__station">
        <label class="tp__label">出发站</label>
        <div class="tp__control">
          <input
            v-model="from"
            autocomplete="off"
            placeholder="例如 西宁"
            @focus="fromOpen = fromSuggest.length > 0"
            @blur="fromOpen = false"
          />
          <ul v-show="fromOpen && fromSuggest.length" class="tp__suggest" role="listbox">
            <li
              v-for="s in fromSuggest"
              :key="s.telecode"
              role="option"
              @mousedown.prevent="pickStation('from', s.name)"
            >
              {{ s.name }}
            </li>
          </ul>
        </div>
      </div>

      <div class="tp__station">
        <label class="tp__label">到达站</label>
        <div class="tp__control">
          <input
            v-model="to"
            autocomplete="off"
            placeholder="例如 拉萨"
            @focus="toOpen = toSuggest.length > 0"
            @blur="toOpen = false"
          />
          <ul v-show="toOpen && toSuggest.length" class="tp__suggest" role="listbox">
            <li
              v-for="s in toSuggest"
              :key="s.telecode"
              role="option"
              @mousedown.prevent="pickStation('to', s.name)"
            >
              {{ s.name }}
            </li>
          </ul>
        </div>
      </div>

      <div class="tp__station">
        <label class="tp__label">出发日期</label>
        <div class="tp__datebox">
          <input v-model="date" type="date" />
        </div>
      </div>

      <button class="tp__submit" type="submit" :disabled="loading">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm.8 5v4.2l3.6 2.1-1 1.7L11 12.4V7z"/></svg>
        {{ loading ? '查询中…' : '查询车次' }}
      </button>
    </form>

    <p v-if="error" class="tp__error">{{ error }}</p>

    <div v-if="trains.length" class="tp__grid">
      <button
        v-for="(t, i) in trains"
        :key="t.trainNo + t.departTime"
        type="button"
        class="tp__train"
        :class="`tp__train--${trainKind(t.trainCode)}`"
        :style="{ '--i': Math.min(i, 8), '--train-color': trainChipColor(t.trainCode) }"
        :disabled="loading"
        @click="$emit('pick', t)"
      >
        <span class="tp__code">{{ t.trainCode }}</span>
        <span class="tp__time">
          <span>{{ t.departTime }}</span>
          <span class="tp__arrow">→</span>
          <span>{{ t.arriveTime }}</span>
        </span>
        <span class="tp__meta">
          {{ t.from.name }} → {{ t.to.name }}
          <template v-if="t.duration"> · 历时 {{ t.duration }}</template>
        </span>
      </button>
    </div>
    <p v-else-if="searched && !loading" class="tp__empty">
      该日期暂无直达车次，换个日期或站点试试。
    </p>
  </div>
</template>

<style scoped>
.tp__form {
  display: grid;
  /* minmax(0,1fr)：轨道最小宽为 0，避免原生 date 输入的固有 min-content
     把双列栅格撑出卡片（手机竖屏曾横向溢出 86px，到达站/查询钮顶出基础组件） */
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.tp__station { min-width: 0; }

/* 手机竖屏（≤560px）：出发站 / 到达站 / 日期纵向单列，查询钮整宽 */
@media (max-width: 560px) {
  .tp__form {
    grid-template-columns: minmax(0, 1fr);
  }
}
.tp__label { display: block; margin-bottom: 7px; font-size: var(--fs-cap); letter-spacing: 0.04em; color: var(--text-2); }
.tp__control, .tp__datebox {
  position: relative;
  display: flex; align-items: center;
  min-height: 48px; padding: 0 14px;
  border-radius: var(--radius-md);
  background: var(--surface-2);
  border: 1px solid var(--line-default);
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}
.tp__control:focus-within, .tp__datebox:focus-within {
  border-color: var(--accent);
  background: var(--interactive-hover);
  box-shadow: var(--focus-ring);
}
.tp__control input, .tp__datebox input {
  flex: 1; min-width: 0; height: 46px;
  font-size: 15px; color: var(--text-1);
  background: transparent; border: none; outline: none;
}
.tp__control input::placeholder { color: var(--text-3); }
.tp__datebox input::-webkit-date-and-time-value { text-align: left; }
.tp__datebox { color-scheme: dark; }

.tp__suggest {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 20;
  max-height: 240px; overflow-y: auto;
  padding: 6px;
  border-radius: var(--radius-md);
  background: var(--surface-1);
  border: 1px solid var(--line-strong);
  box-shadow: var(--elev-3);
  list-style: none; margin: 0;
}
.tp__suggest li {
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 14px; color: var(--text-1);
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .tp__suggest li:hover { background: var(--interactive-hover); }
}

.tp__submit {
  grid-column: 1 / -1;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 50px;
  border: none; border-radius: var(--radius-full);
  font-size: 15px; font-weight: 600; color: var(--surface-0);
  background: linear-gradient(180deg, var(--accent), var(--accent-press));
  cursor: pointer;
  transition: transform var(--dur-micro) var(--ease-standard), filter var(--dur-micro) var(--ease-standard);
}
.tp__submit:hover { filter: brightness(1.06); }
.tp__submit:active { transform: scale(0.985); }
.tp__submit:disabled { opacity: 0.6; cursor: default; }

.tp__error { color: var(--danger); font-size: 13px; margin: 10px 0 0; }
.tp__grid { display: grid; gap: 10px; margin-top: 16px; }
.tp__train {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 4px 14px;
  padding: 12px 16px;
  text-align: left;
  border-radius: 16px;
  background: var(--surface-2);
  border: 1px solid var(--line-default);
  cursor: pointer;
  transition:
    transform var(--dur-micro) var(--ease-standard),
    border-color var(--dur-micro) var(--ease-standard),
    background var(--dur-micro) var(--ease-standard);
  animation: tp-in 0.3s both; animation-delay: calc(var(--i) * 35ms);
}
@media (hover: hover) and (pointer: fine) {
  .tp__train:hover { border-color: var(--train-color); background: var(--line-default); transform: translateY(-1px); }
}
.tp__code {
  grid-row: 1 / 3;
  font-size: 19px; font-weight: 800; color: var(--train-color);
  font-family: 'Arial', sans-serif; letter-spacing: 0.5px;
}
.tp__time { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-1); }
.tp__arrow { color: var(--text-3); font-size: 13px; }
.tp__meta { font-size: 12px; color: var(--text-3); }
.tp__empty { margin-top: 16px; font-size: 13px; color: var(--text-3); }

@keyframes tp-in { from { opacity: 0; transform: translateY(8px); } }

@media (prefers-reduced-motion: reduce) {
  .tp__control,
  .tp__suggest,
  .tp__submit,
  .tp__train {
    transition: none;
  }
}
</style>
