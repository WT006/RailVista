<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Stop, TrainSummary } from '@railvista/shared';
import { api } from '../api/client';
import { hydrateFromSnapshot } from '../lib/persistTrip';
import {
  clearAutoResume,
  consumeStayOnSelect,
  deleteSnapshot,
  getAutoResumeTripKey,
  getSnapshot,
  isTripInProgress,
  listRecentTrips,
  pruneRecentTrips,
  type TripIndexEntry,
} from '../lib/tripCache';
import DarkDateTimeField from '../components/DarkDateTimeField.vue';
import ApiVersionBadge from '../components/ApiVersionBadge.vue';
import RailProgressLoader from '../components/RailProgressLoader.vue';
import { useTripStore } from '../stores/tripStore';

const router = useRouter();
const trip = useTripStore();

const from = ref('');
const to = ref('');
const date = ref('');
const fromSuggest = ref<{ name: string; telecode: string }[]>([]);
const toSuggest = ref<{ name: string; telecode: string }[]>([]);
const fromOpen = ref(false);
const toOpen = ref(false);
const fromActive = ref(-1);
const toActive = ref(-1);
const trains = ref<TrainSummary[]>([]);
const loading = ref(false);
const loadingPhase = ref<'search' | 'stops' | 'enter' | 'demo' | 'resume' | null>(null);
const error = ref('');
const resumeHint = ref('');
const selected = ref<TrainSummary | null>(null);
const stops = ref<Stop[]>([]);
const boardFrom = ref('');
const boardTo = ref('');
const step = ref<'search' | 'od'>('search');
const recent = ref<TripIndexEntry[]>([]);
const currentEntry = ref<TripIndexEntry | null>(null);

/** 请求序号：新请求发出后，旧请求的迟到响应一律丢弃（取消 / 重新发车用） */
let requestSeq = 0;
function nextSeq(): number {
  return ++requestSeq;
}
function isStale(seq: number): boolean {
  return seq !== requestSeq;
}

/** 「重新发车」要重跑的动作 */
const retryFn = ref<(() => void) | null>(null);

function beginLoading(phase: 'search' | 'stops' | 'enter' | 'demo' | 'resume') {
  loadingPhase.value = phase;
  loading.value = true;
}

function endLoading() {
  loading.value = false;
  loadingPhase.value = null;
}

function onRetry() {
  const fn = retryFn.value;
  endLoading();
  if (fn) fn();
}

function onCancel() {
  requestSeq += 1;
  endLoading();
}

function defaultDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function refreshRecentUi() {
  const entries = listRecentTrips();
  recent.value = entries;
  const resumeKey = getAutoResumeTripKey();
  const hit = resumeKey ? entries.find((e) => e.key === resumeKey) : null;
  currentEntry.value = hit && isTripInProgress(hit) ? hit : null;
}

async function openCachedTrip(key: string) {
  beginLoading('resume');
  error.value = '';
  resumeHint.value = '';
  try {
    const snap = await getSnapshot(key);
    if (!snap) {
      resumeHint.value = '无法恢复该行程，请重新查询。';
      await deleteSnapshot(key);
      refreshRecentUi();
      return;
    }
    hydrateFromSnapshot(snap);
    await router.replace({
      path: '/trip',
      query: {
        trainCode: snap.segment.trainCode,
        date: snap.segment.date,
        from: snap.segment.fromName,
        to: snap.segment.toName,
      },
    });
  } catch (e) {
    resumeHint.value = '无法恢复上次行程';
    error.value = e instanceof Error ? e.message : '恢复失败';
    clearAutoResume();
    refreshRecentUi();
  } finally {
    endLoading();
  }
}

function startNewTrip() {
  clearAutoResume();
  trip.clear();
  currentEntry.value = null;
  refreshRecentUi();
}

async function removeRecent(key: string) {
  await deleteSnapshot(key);
  refreshRecentUi();
}

onMounted(async () => {
  date.value = defaultDate();
  try {
    const hint = sessionStorage.getItem('railvista:resumeHint');
    if (hint) {
      resumeHint.value = hint;
      sessionStorage.removeItem('railvista:resumeHint');
    }
  } catch {
    /* */
  }
  beginLoading('resume');
  try {
    await pruneRecentTrips();
    refreshRecentUi();
    const stayOnSelect = consumeStayOnSelect();
    const resumeKey = getAutoResumeTripKey();
    if (!stayOnSelect && resumeKey) {
      const snap = await getSnapshot(resumeKey);
      if (snap) {
        hydrateFromSnapshot(snap);
        await router.replace({
          path: '/trip',
          query: {
            trainCode: snap.segment.trainCode,
            date: snap.segment.date,
            from: snap.segment.fromName,
            to: snap.segment.toName,
          },
        });
        return;
      }
      clearAutoResume();
      resumeHint.value = '无法恢复上次行程';
      refreshRecentUi();
    }
  } finally {
    endLoading();
  }
});

let suggestTimer: number | undefined;
function onSuggest(which: 'from' | 'to', q: string) {
  clearTimeout(suggestTimer);
  suggestTimer = window.setTimeout(async () => {
    if (!q.trim()) {
      if (which === 'from') {
        fromSuggest.value = [];
        fromActive.value = -1;
      } else {
        toSuggest.value = [];
        toActive.value = -1;
      }
      return;
    }
    try {
      const res = await api.suggestStations(q);
      if (which === 'from') {
        fromSuggest.value = res.stations;
        fromActive.value = res.stations.length ? 0 : -1;
        fromOpen.value = res.stations.length > 0;
      } else {
        toSuggest.value = res.stations;
        toActive.value = res.stations.length ? 0 : -1;
        toOpen.value = res.stations.length > 0;
      }
    } catch {
      /* ignore suggest errors */
    }
  }, 250);
}

watch(from, (q) => onSuggest('from', q));
watch(to, (q) => onSuggest('to', q));

function pickStation(which: 'from' | 'to', name: string) {
  if (which === 'from') {
    from.value = name;
    fromSuggest.value = [];
    fromOpen.value = false;
    fromActive.value = -1;
  } else {
    to.value = name;
    toSuggest.value = [];
    toOpen.value = false;
    toActive.value = -1;
  }
}

function onSuggestKey(which: 'from' | 'to', e: KeyboardEvent) {
  const list = which === 'from' ? fromSuggest.value : toSuggest.value;
  const active = which === 'from' ? fromActive : toActive;
  const open = which === 'from' ? fromOpen : toOpen;
  if (!open.value || !list.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    active.value = (active.value + 1) % list.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = (active.value - 1 + list.length) % list.length;
  } else if (e.key === 'Enter' && active.value >= 0) {
    e.preventDefault();
    pickStation(which, list[active.value]!.name);
  } else if (e.key === 'Escape') {
    open.value = false;
  }
}

async function search() {
  error.value = '';
  if (!from.value.trim() || !to.value.trim() || !date.value) {
    error.value = '请填写出发站、到达站和出发日期后再查询。';
    return;
  }
  const seq = nextSeq();
  retryFn.value = () => void search();
  beginLoading('search');
  trains.value = [];
  step.value = 'search';
  selected.value = null;
  try {
    const res = await api.searchTrains(from.value, to.value, date.value);
    if (isStale(seq)) return;
    trains.value = res.trains;
    if (!trains.value.length) error.value = '这个区间暂时没有查到直达车次。';
  } catch (e) {
    if (isStale(seq)) return;
    error.value = e instanceof Error ? e.message : '查询失败';
  } finally {
    if (!isStale(seq)) endLoading();
  }
}

/** 空态：换一天重新查 */
function retryWithDateShift(days: number) {
  const base = date.value || defaultDate();
  const d = new Date(`${base}T00:00:00+08:00`);
  d.setDate(d.getDate() + days);
  date.value = d.toISOString().slice(0, 10);
  void search();
}

async function pickTrain(t: TrainSummary) {
  selected.value = t;
  const seq = nextSeq();
  retryFn.value = () => void pickTrain(t);
  beginLoading('stops');
  error.value = '';
  try {
    const res = await api.getStops({
      trainNo: t.trainNo,
      trainCode: t.trainCode,
      from: t.from.telecode,
      to: t.to.telecode,
      date: t.date,
    });
    if (isStale(seq)) return;
    stops.value = res.stops;
    boardFrom.value = from.value;
    boardTo.value = to.value;
    const names = stops.value.map((s) => s.name);
    if (!names.includes(boardFrom.value)) {
      const hit = names.find((n) => n.includes(from.value) || from.value.includes(n));
      if (hit) boardFrom.value = hit;
      else boardFrom.value = names[0];
    }
    if (!names.includes(boardTo.value)) {
      const hit = names.find((n) => n.includes(to.value) || to.value.includes(n));
      if (hit) boardTo.value = hit;
      else boardTo.value = names[names.length - 1];
    }
    step.value = 'od';
  } catch (e) {
    if (isStale(seq)) return;
    error.value = e instanceof Error ? e.message : '经停加载失败';
  } finally {
    if (!isStale(seq)) endLoading();
  }
}

async function enterTrip() {
  if (!selected.value || !stops.value.length) return;
  beginLoading('enter');
  error.value = '';
  let spots: import('@railvista/shared').ScenicSpot[] = [];

  try {
    if (/^Z8991$/i.test(selected.value.trainCode)) {
      try {
        const preset = await api.getPreset('z8991');
        const byName = new Map(preset.stations.map((s) => [s.name, s]));
        stops.value = stops.value.map((st) => {
          const p = byName.get(st.name);
          return p ? { ...st, lng: p.lng, lat: p.lat, intro: p.intro || st.intro } : st;
        });
      } catch {
        /* station enrich optional */
      }
    }

    const names = stops.value.map((s) => s.name);
    let iFrom = names.indexOf(boardFrom.value);
    let iTo = names.indexOf(boardTo.value);
    if (iFrom < 0) iFrom = 0;
    if (iTo < 0) iTo = names.length - 1;
    if (iFrom > iTo) [iFrom, iTo] = [iTo, iFrom];
    let odStops = stops.value.slice(iFrom, iTo + 1);
    const knownCoords = odStops.filter((s) => s.lng != null && s.lat != null).length;
    if (knownCoords < 2 && odStops.length < 2) {
      error.value = '车站坐标获取失败，无法绘制地图。请稍后重试。';
      return;
    }

    let preciseRailway: [number, number][] | null = null;
    let railHint = '示意线（站点连线）';
    let canUpgradePrecise = true;
    try {
      const geo = await api.getRailGeometry({
        trainCode: selected.value.trainCode,
        mode: 'preset',
        stops: odStops.map((s) => ({ name: s.name, lng: s.lng, lat: s.lat })),
      });
      if (geo.stops?.length) {
        const byName = new Map(geo.stops.map((s) => [s.name, s]));
        odStops = odStops.map((s) => {
          const g = byName.get(s.name);
          if (g?.lng != null && g?.lat != null) {
            return { ...s, lng: g.lng, lat: g.lat };
          }
          return s;
        });
      }
      if (geo.scenicSpots?.length) {
        spots = geo.scenicSpots;
      }
      if (geo.fromPreset && geo.coords?.length >= 2 && geo.source !== 'station') {
        preciseRailway = geo.coords;
        canUpgradePrecise = false;
        railHint = geo.corridorName
          ? `真实轨道线（${geo.corridorName}）`
          : '真实轨道线（精品预置）';
      } else {
        canUpgradePrecise = geo.canUpgrade !== false;
        // 示意折线也可能命中附近风景点
        if (!spots.length && geo.scenicSpots) spots = geo.scenicSpots;
        console.warn('[enter] no preset corridor', {
          fromPreset: geo.fromPreset,
          source: geo.source,
          pts: geo.coords?.length,
          message: geo.message,
        });
      }
    } catch (e) {
      console.warn('[enter] preset rail failed', e);
    }

    const coordStops = odStops.filter((s) => s.lng != null && s.lat != null);
    if (coordStops.length < 2) {
      error.value = '车站坐标获取失败，无法绘制地图。请稍后重试。';
      return;
    }

    trip.setTrip({
      trainCode: selected.value.trainCode,
      trainNo: selected.value.trainNo,
      date: selected.value.date,
      fromName: boardFrom.value,
      toName: boardTo.value,
      fromTelecode: selected.value.from.telecode,
      toTelecode: selected.value.to.telecode,
      stops: odStops,
      spots,
      preciseRailway,
      railHint,
      canUpgradePrecise,
    });
    router.push({
      path: '/trip',
      query: {
        trainCode: selected.value.trainCode,
        date: selected.value.date,
        from: boardFrom.value,
        to: boardTo.value,
      },
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '进入行程失败';
  } finally {
    endLoading();
  }
}

async function loadDemo() {
  beginLoading('demo');
  error.value = '';
  try {
    const preset = await api.getPreset('z8991');
    const demoStops: Stop[] = preset.stations.map((s, i) => ({
      seq: i + 1,
      name: s.name,
      type: s.type,
      at: s.at,
      arrive: s.arrive,
      depart: s.depart,
      arriveTime: s.arrive || (s.type === 'arrive' ? s.at : null) || null,
      departTime: s.depart || (s.type === 'depart' ? s.at : null) || null,
      lng: s.lng,
      lat: s.lat,
      intro: s.intro,
      telecode: s.telecode,
    }));
    let spots: import('@railvista/shared').ScenicSpot[] = [];
    let preciseRailway = (preset.railway as [number, number][] | undefined) || null;
    try {
      const geo = await api.getRailGeometry({
        trainCode: preset.meta.train,
        mode: 'preset',
        stops: demoStops.map((s) => ({ name: s.name, lng: s.lng, lat: s.lat })),
      });
      if (geo.coords?.length >= 2) preciseRailway = geo.coords;
      if (geo.scenicSpots?.length) spots = geo.scenicSpots;
    } catch {
      /* fallback below */
    }
    if (!spots.length && preset.scenicSpots?.length) {
      spots = preset.scenicSpots.map((s) => ({
        id: String(s.id),
        name: s.name,
        lng: s.lng,
        lat: s.lat,
        intro: s.intro,
        nightOnly: s.nightOnly,
        side: s.side,
        visibility: 'window' as const,
        source: 'preset' as const,
      }));
    }
    trip.setTrip({
      trainCode: preset.meta.train,
      trainNo: preset.meta.trainNo || '5500000Z8991',
      date: preset.meta.date || '2026-08-11',
      fromName: preset.meta.from,
      toName: preset.meta.to,
      stops: demoStops,
      spots,
      preciseRailway,
      isDemo: true,
    });
    router.push({
      path: '/trip',
      query: {
        trainCode: 'Z8991',
        date: preset.meta.date || '2026-08-11',
        from: preset.meta.from,
        to: preset.meta.to,
        demo: '1',
      },
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '演示加载失败';
  } finally {
    endLoading();
  }
}

const odOptions = computed(() => stops.value.map((s) => s.name));

/** 仅首页展示当前行程 / 最近访问；有查询结果或确认 OD 时隐藏 */
const showHomeLists = computed(() => step.value === 'search' && trains.value.length === 0);

const showBackBtn = computed(() => step.value === 'od' || trains.value.length > 0);

/** 空态：查过但没有结果 */
const showEmptyState = computed(
  () => !loading.value && step.value === 'search' && trains.value.length === 0 && !!error.value,
);

/** 车次类型色条：G/D 蓝、C 青、Z/T/K 灰绿 */
function trainKind(code: string): 'hsr' | 'intercity' | 'conventional' | 'other' {
  const c = String(code || '').trim().toUpperCase();
  if (/^[GD]/.test(c)) return 'hsr';
  if (/^C/.test(c)) return 'intercity';
  if (/^[ZTK]/.test(c)) return 'conventional';
  return 'other';
}

/** ISO 或 HH:mm 统一取 HH:mm */
function hm(v: string | null | undefined): string {
  if (!v) return '';
  const m = /T(\d{2}:\d{2})/.exec(v);
  if (m) return m[1] as string;
  return v.length >= 5 ? v.slice(0, 5) : v;
}

function stopoverText(s: Stop): string {
  if (!s.arriveTime || !s.departTime) return '';
  const ta = Date.parse(s.arriveTime);
  const td = Date.parse(s.departTime);
  if (!Number.isFinite(ta) || !Number.isFinite(td)) return '';
  const min = Math.round((td - ta) / 60000);
  return min > 0 ? `停 ${min} 分` : '';
}

/** 上下车区间在经停序列中的位置 */
const odRange = computed(() => {
  const names = stops.value.map((s) => s.name);
  let iFrom = names.indexOf(boardFrom.value);
  let iTo = names.indexOf(boardTo.value);
  if (iFrom < 0) iFrom = 0;
  if (iTo < 0) iTo = Math.max(0, names.length - 1);
  if (iFrom > iTo) [iFrom, iTo] = [iTo, iFrom];
  return { iFrom, iTo };
});

const timeline = computed(() =>
  stops.value.map((s, i) => ({
    name: s.name,
    seq: s.seq,
    arrive: hm(s.arriveTime),
    depart: hm(s.departTime),
    stopover: stopoverText(s),
    dayOffset: s.dayOffset ?? 0,
    inRange: i >= odRange.value.iFrom && i <= odRange.value.iTo,
    isBoard: i === odRange.value.iFrom,
    isAlight: i === odRange.value.iTo,
  })),
);

const tripDurationHint = computed(() => {
  const t = selected.value;
  return t?.duration ? `历时 ${t.duration}` : '';
});

function goBack() {
  if (loading.value) return;
  if (step.value === 'od') {
    step.value = 'search';
    return;
  }
  if (trains.value.length > 0) {
    trains.value = [];
    selected.value = null;
    stops.value = [];
    error.value = '';
  }
}
</script>

<template>
  <div class="select-page">
    <div class="select-ambiance" aria-hidden="true">
      <svg class="select-ambiance__rail" viewBox="0 0 720 280" preserveAspectRatio="xMidYMid slice">
        <path
          class="select-ambiance__track"
          d="M-20 210 C 80 190, 140 120, 220 110 S 360 150, 420 90 S 560 40, 640 70 S 720 130, 760 100"
        />
        <path
          class="select-ambiance__track select-ambiance__track--soft"
          d="M-40 240 C 60 220, 160 170, 250 165 S 390 200, 470 140 S 610 80, 780 120"
        />
        <circle class="select-ambiance__dot select-ambiance__dot--station" cx="220" cy="110" r="4.5" />
        <circle class="select-ambiance__dot select-ambiance__dot--spot" cx="420" cy="90" r="4" />
        <circle class="select-ambiance__dot select-ambiance__dot--train" cx="560" cy="55" r="5" />
      </svg>
    </div>

    <div v-if="showBackBtn" class="select-top">
      <button type="button" class="select-back-btn" :disabled="loading" @click="goBack">
        <span class="select-back-btn__icon" aria-hidden="true">‹</span>
        返回
      </button>
    </div>

    <header class="select-hero">
      <p class="brand">RailVista</p>
      <h1>车上风景与行程定位</h1>
      <p class="sub">选择出发站、到达站与日期，进入行程地图</p>
      <ApiVersionBadge class="select-hero__version" />
    </header>

    <section v-if="currentEntry && showHomeLists" class="current-trip">
      <div class="current-trip__row">
        <div class="current-trip__body">
          <p class="current-trip__label">当前行程</p>
          <p class="current-trip__title">
            <strong>{{ currentEntry.trainCode }}</strong>
            <span>{{ currentEntry.fromName }} → {{ currentEntry.toName }}</span>
          </p>
          <p class="current-trip__meta">{{ currentEntry.date }} · 未到站前可继续</p>
        </div>
        <div class="current-trip__actions">
          <button
            type="button"
            class="btn primary btn-sm"
            :disabled="loading"
            @click="openCachedTrip(currentEntry.key)"
          >
            继续行程
          </button>
          <button type="button" class="btn ghost btn-sm" :disabled="loading" @click="startNewTrip">
            开始新行程
          </button>
        </div>
      </div>
    </section>

    <p v-if="resumeHint" class="error">{{ resumeHint }}</p>

    <form class="select-form select-form--panel" @submit.prevent="search">
      <div class="select-form__head">
        <h2>开始查询</h2>
        <p>填写 OD 与乘车日，查找直达车次</p>
      </div>
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
      <label>
        <span>乘车日期</span>
        <DarkDateTimeField v-model="date" mode="date" placeholder="选择乘车日期" />
      </label>
      <div class="actions">
        <button type="submit" class="btn primary" :disabled="loading">查询直达车次</button>
        <button type="button" class="btn ghost" :disabled="loading" @click="loadDemo">
          演示：Z8991 青藏线
        </button>
      </div>
    </form>

    <p v-if="error && !showEmptyState" class="error">{{ error }}</p>

    <section v-if="showEmptyState" class="empty-state">
      <p class="empty-state__title">这个区间暂时没有查到直达车次</p>
      <p class="empty-state__desc">可以换一天看看，或者先体验青藏线 demo。</p>
      <div class="empty-state__actions">
        <button type="button" class="btn ghost btn-sm" @click="retryWithDateShift(-1)">
          前一天
        </button>
        <button type="button" class="btn ghost btn-sm" @click="retryWithDateShift(1)">后一天</button>
        <button type="button" class="btn primary btn-sm" @click="loadDemo">试试演示线路</button>
      </div>
    </section>

    <section v-if="recent.length && showHomeLists" class="recent-list">
      <h2>最近访问</h2>
      <div v-for="item in recent" :key="item.key" class="recent-row">
        <button type="button" class="recent-card" :disabled="loading" @click="openCachedTrip(item.key)">
          <span class="recent-card__main">
            <strong>{{ item.trainCode }}</strong>
            <span>{{ item.fromName }} → {{ item.toName }}</span>
          </span>
          <span class="recent-card__meta muted">
            {{ item.date }}
            <template v-if="item.hasPrecise"> · 已缓存精确线</template>
          </span>
        </button>
        <button
          type="button"
          class="recent-delete"
          title="从最近访问删除"
          :disabled="loading"
          @click="removeRecent(item.key)"
        >
          删除
        </button>
      </div>
    </section>

    <section v-if="trains.length && step === 'search'" class="train-list">
      <h2 class="train-list__title">
        直达车次
        <span class="train-list__count">{{ trains.length }} 趟</span>
      </h2>
      <div class="train-grid">
        <button
          v-for="(t, i) in trains"
          :key="t.trainNo + t.departTime"
          type="button"
          class="train-card"
          :class="`train-card--${trainKind(t.trainCode)}`"
          :style="{ '--i': Math.min(i, 8) }"
          :disabled="loading"
          @click="pickTrain(t)"
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
    </section>

    <section v-if="step === 'od' && selected" class="od-panel">
      <h2>确认上下车站</h2>
      <p class="muted">
        {{ selected.trainCode }} · {{ selected.date }}
        <template v-if="tripDurationHint"> · {{ tripDurationHint }}</template>
      </p>
      <div class="od-panel__pick">
        <label>
          <span>上车站</span>
          <select v-model="boardFrom">
            <option v-for="n in odOptions" :key="'f' + n" :value="n">{{ n }}</option>
          </select>
        </label>
        <label>
          <span>下车站</span>
          <select v-model="boardTo">
            <option v-for="n in odOptions" :key="'t' + n" :value="n">{{ n }}</option>
          </select>
        </label>
      </div>

      <ol class="tl">
        <li
          v-for="s in timeline"
          :key="s.seq + s.name"
          class="tl__item"
          :class="{
            'is-range': s.inRange,
            'is-board': s.isBoard,
            'is-alight': s.isAlight,
          }"
        >
          <span class="tl__dot" aria-hidden="true" />
          <span class="tl__name">{{ s.name }}</span>
          <span class="tl__time">
            <template v-if="s.arrive && s.depart">{{ s.arrive }} / {{ s.depart }}</template>
            <template v-else-if="s.depart">{{ s.depart }} 发</template>
            <template v-else-if="s.arrive">{{ s.arrive }} 到</template>
          </span>
          <span v-if="s.stopover" class="tl__stop">{{ s.stopover }}</span>
          <span v-if="s.dayOffset > 0" class="tl__day">+{{ s.dayOffset }}天</span>
        </li>
      </ol>

      <div class="od-panel__actions">
        <button type="button" class="btn primary" :disabled="loading" @click="enterTrip">
          进入行程地图
        </button>
        <button type="button" class="btn ghost" :disabled="loading" @click="step = 'search'">
          返回列表
        </button>
      </div>
    </section>

    <p class="footnote">时刻数据来自公开查询，仅供参考。行程缓存在本机浏览器。</p>

    <RailProgressLoader
      :active="loading"
      :phase="loadingPhase"
      @retry="onRetry"
      @cancel="onCancel"
    />
  </div>
</template>

<style scoped>
/* ── 车次列表：自适应网格 + 类型色条 + 入场错峰 ── */
.train-list__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 16px;
  margin-bottom: 4px;
}

.train-list__count {
  font-size: 12px;
  color: #94a3b8;
  font-weight: 400;
}

.train-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
}

.train-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: left;
  padding: 13px 14px 13px 16px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.72);
  color: inherit;
  cursor: pointer;
  font-family: inherit;
  overflow: hidden;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.train-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #94a3b8;
}

.train-card--hsr::before {
  background: #38bdf8;
}

.train-card--intercity::before {
  background: #22d3ee;
}

.train-card--conventional::before {
  background: #94a3b8;
}

.train-card--other::before {
  background: #64748b;
}

.train-card:hover:not(:disabled) {
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(30, 41, 59, 0.78);
}

.train-card:active:not(:disabled) {
  transform: translateY(1px);
}

.train-card:disabled {
  opacity: 0.55;
  cursor: wait;
}

.train-card__code {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #f1f5f9;
}

.train-card__time {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: #e2e8f0;
  font-variant-numeric: tabular-nums;
}

.train-card__arrow {
  color: #64748b;
  font-weight: 400;
}

.train-card__meta {
  font-size: 12px;
  color: #94a3b8;
}

@media (prefers-reduced-motion: no-preference) {
  .train-card {
    animation: tc-in 0.34s cubic-bezier(0.22, 0.61, 0.36, 1) both;
    animation-delay: calc(var(--i, 0) * 40ms);
  }
}

@keyframes tc-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── 空态 ── */
.empty-state {
  max-width: 560px;
  margin: 0 auto 14px;
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px dashed rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.5);
  text-align: center;
}

.empty-state__title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: #e2e8f0;
}

.empty-state__desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: #94a3b8;
}

.empty-state__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

/* ── 经停时间轴 ── */
.od-panel__pick {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin: 10px 0 4px;
}

.tl {
  list-style: none;
  margin: 14px 0 4px;
  padding: 4px 0 4px 18px;
  position: relative;
  max-height: 46vh;
  overflow-y: auto;
}

.tl::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 10px;
  bottom: 10px;
  width: 2px;
  border-radius: 2px;
  background: rgba(148, 163, 184, 0.25);
}

.tl__item {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  color: #94a3b8;
  transition: color 0.18s ease;
}

.tl__dot {
  position: absolute;
  left: -18px;
  top: 11px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #334155;
  border: 2px solid #0f172a;
  transition: background 0.18s ease, box-shadow 0.18s ease;
}

.tl__item.is-range {
  color: #e2e8f0;
}

.tl__item.is-range .tl__dot {
  background: #38bdf8;
}

.tl__item.is-board .tl__dot,
.tl__item.is-alight .tl__dot {
  background: #38bdf8;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.22);
}

.tl__name {
  font-size: 14px;
  font-weight: 600;
}

.tl__time {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: #7dd3fc;
}

.tl__item:not(.is-range) .tl__time {
  color: #64748b;
}

.tl__stop,
.tl__day {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.16);
  color: #94a3b8;
}

.tl__day {
  background: rgba(251, 191, 36, 0.16);
  color: #fbbf24;
}

.od-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

@media (max-width: 560px) {
  .train-grid {
    grid-template-columns: 1fr;
  }

  .tl {
    max-height: 40vh;
  }
}
</style>
