<script setup lang="ts">
/**
 * 车次选择器：站点联想 + 日期 + 12306 直达车次列表。
 * 交互模式复用首页 SelectTrip（station-field / station-suggest / train-card），
 * 选中车次后 emit pick，由页面联动票面配置（ticketStore.applyTrain）。
 */
import { ref, watch } from 'vue';
import type { TrainSummary } from '@railvista/shared';
import { api } from '../../api/client';
import { trainChipColor } from '../../data/ticket';
import DarkDateTimeField from '../DarkDateTimeField.vue';

defineEmits<{ pick: [train: TrainSummary] }>();

const from = ref('');
const to = ref('');
const date = ref(new Date().toISOString().slice(0, 10));

interface SuggestItem {
  name: string;
  telecode: string;
}
const fromSuggest = ref<SuggestItem[]>([]);
const toSuggest = ref<SuggestItem[]>([]);
const fromOpen = ref(false);
const toOpen = ref(false);
const fromActive = ref(-1);
const toActive = ref(-1);

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
      const list = res.stations.slice(0, 8);
      if (side === 'from') fromSuggest.value = list;
      else toSuggest.value = list;
    } catch {
      /* 联想失败不阻塞输入 */
    }
  }, 250);
}

watch(from, () => {
  fromOpen.value = true;
  fromActive.value = -1;
  fetchSuggest('from');
});
watch(to, () => {
  toOpen.value = true;
  toActive.value = -1;
  fetchSuggest('to');
});

function pickStation(side: 'from' | 'to', name: string) {
  if (side === 'from') {
    from.value = name;
    fromOpen.value = false;
  } else {
    to.value = name;
    toOpen.value = false;
  }
}

function onSuggestKey(side: 'from' | 'to', ev: KeyboardEvent) {
  const list = side === 'from' ? fromSuggest.value : toSuggest.value;
  const active = side === 'from' ? fromActive.value : toActive.value;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const next = ev.key === 'ArrowDown' ? active + 1 : active - 1;
    const clamped = Math.max(0, Math.min(list.length - 1, next));
    if (side === 'from') fromActive.value = clamped;
    else toActive.value = clamped;
  } else if (ev.key === 'Enter' && active >= 0 && list[active]) {
    ev.preventDefault();
    pickStation(side, list[active]!.name);
  } else if (ev.key === 'Escape') {
    if (side === 'from') fromOpen.value = false;
    else toOpen.value = false;
  }
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
      <label class="station-field">
        <span>出发站</span>
        <div class="station-field__control">
          <input
            v-model="from"
            autocomplete="off"
            placeholder="例如 西宁"
            @focus="fromOpen = fromSuggest.length > 0"
            @blur="fromOpen = false"
            @keydown="onSuggestKey('from', $event)"
          />
          <ul v-show="fromOpen && fromSuggest.length" class="station-suggest" role="listbox">
            <li
              v-for="(s, i) in fromSuggest"
              :key="s.telecode"
              role="option"
              :aria-selected="i === fromActive"
              :class="{ 'is-active': i === fromActive }"
              @mousedown.prevent="pickStation('from', s.name)"
            >
              {{ s.name }}
            </li>
          </ul>
        </div>
      </label>

      <label class="station-field">
        <span>到达站</span>
        <div class="station-field__control">
          <input
            v-model="to"
            autocomplete="off"
            placeholder="例如 拉萨"
            @focus="toOpen = toSuggest.length > 0"
            @blur="toOpen = false"
            @keydown="onSuggestKey('to', $event)"
          />
          <ul v-show="toOpen && toSuggest.length" class="station-suggest" role="listbox">
            <li
              v-for="(s, i) in toSuggest"
              :key="s.telecode"
              role="option"
              :aria-selected="i === toActive"
              :class="{ 'is-active': i === toActive }"
              @mousedown.prevent="pickStation('to', s.name)"
            >
              {{ s.name }}
            </li>
          </ul>
        </div>
      </label>

      <label class="tp__date">
        <span>出发日期</span>
        <DarkDateTimeField v-model="date" mode="date" />
      </label>

      <button class="btn primary" type="submit" :disabled="loading">
        {{ loading ? '查询中…' : '查询车次' }}
      </button>
    </form>

    <p v-if="error" class="tp__error">{{ error }}</p>

    <div v-if="trains.length" class="train-grid tp__grid" v-auto-animate>
      <button
        v-for="(t, i) in trains"
        :key="t.trainNo + t.departTime"
        type="button"
        class="train-card"
        :class="`train-card--${trainKind(t.trainCode)}`"
        :style="{ '--i': Math.min(i, 8), '--train-color': trainChipColor(t.trainCode) }"
        :disabled="loading"
        @click="$emit('pick', t)"
      >
        <span class="train-card__code">{{ t.trainCode }}</span>
        <span class="train-card__time">
          <span>{{ t.departTime }}</span>
          <span class="train-card__arrow" aria-hidden="true">→</span>
          <span>{{ t.arriveTime }}</span>
        </span>
        <span class="train-card__meta">
          {{ t.from.name }} → {{ t.to.name }}
          <template v-if="t.duration"> · 历时 {{ t.duration }}</template>
        </span>
      </button>
    </div>
    <p v-else-if="searched && !loading" class="tp__empty muted">
      该日期暂无直达车次，换个日期或站点试试。
    </p>
  </div>
</template>

<style scoped>
.tp__form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
  align-items: end;
}
.tp__date { display: flex; flex-direction: column; gap: 6px; }
.tp__date > span { font-size: var(--fs-meta); color: var(--text-2); }
.tp__form .btn { grid-column: 1 / -1; }
@media (min-width: 840px) {
  .tp__form { grid-template-columns: 1fr 1fr auto auto; }
  .tp__form .btn { grid-column: auto; }
}
.tp__error { color: var(--danger); font-size: var(--fs-meta); margin: var(--space-1) 0 0; }
.tp__grid { margin-top: var(--space-2); }
.tp__empty { margin: var(--space-2) 0 0; font-size: var(--fs-meta); }
</style>
