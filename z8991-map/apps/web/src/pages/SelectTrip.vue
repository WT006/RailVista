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
import { useTripStore } from '../stores/tripStore';

const router = useRouter();
const trip = useTripStore();

const from = ref('');
const to = ref('');
const date = ref('');
const fromSuggest = ref<{ name: string; telecode: string }[]>([]);
const toSuggest = ref<{ name: string; telecode: string }[]>([]);
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

const loadingCopy = computed(() => {
  switch (loadingPhase.value) {
    case 'search':
      return { title: '正在查询直达车次', detail: '向 12306 拉取车次列表，通常几秒内完成' };
    case 'stops':
      return { title: '正在加载经停站', detail: '拉取时刻与车站坐标，请稍候' };
    case 'enter':
      return { title: '正在进入行程地图', detail: '整理站点与路线数据' };
    case 'demo':
      return { title: '正在加载演示线路', detail: 'Z8991 青藏线预置数据' };
    case 'resume':
      return { title: '正在恢复上次行程', detail: '从本机缓存打开' };
    default:
      return { title: '加载中', detail: '请稍候…' };
  }
});

function beginLoading(phase: 'search' | 'stops' | 'enter' | 'demo' | 'resume') {
  loadingPhase.value = phase;
  loading.value = true;
}

function endLoading() {
  loading.value = false;
  loadingPhase.value = null;
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
      if (which === 'from') fromSuggest.value = [];
      else toSuggest.value = [];
      return;
    }
    try {
      const res = await api.suggestStations(q);
      if (which === 'from') fromSuggest.value = res.stations;
      else toSuggest.value = res.stations;
    } catch {
      /* ignore suggest errors */
    }
  }, 250);
}

watch(from, (q) => onSuggest('from', q));
watch(to, (q) => onSuggest('to', q));

async function search() {
  error.value = '';
  if (!from.value.trim() || !to.value.trim() || !date.value) {
    error.value = '请填写出发站、到达站和出发日期后再查询。';
    return;
  }
  beginLoading('search');
  trains.value = [];
  step.value = 'search';
  selected.value = null;
  try {
    const res = await api.searchTrains(from.value, to.value, date.value);
    trains.value = res.trains;
    if (!trains.value.length) error.value = '未找到直达车次，可换日期或试试演示线路。';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '查询失败';
  } finally {
    endLoading();
  }
}

async function pickTrain(t: TrainSummary) {
  selected.value = t;
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
    error.value = e instanceof Error ? e.message : '经停加载失败';
  } finally {
    endLoading();
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
        spots = (preset.scenicSpots || []).map((s) => ({
          id: String(s.id),
          name: s.name,
          lng: s.lng,
          lat: s.lat,
          intro: s.intro,
          timeLabel: s.timeLabel,
          at: s.at,
          nightOnly: s.nightOnly,
          side: s.side,
          source: 'preset' as const,
          trainCode: 'Z8991',
        }));
        const byName = new Map(preset.stations.map((s) => [s.name, s]));
        stops.value = stops.value.map((st) => {
          const p = byName.get(st.name);
          return p ? { ...st, lng: p.lng, lat: p.lat, intro: p.intro || st.intro } : st;
        });
      } catch {
        /* scenic optional */
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
      if (geo.fromPreset && geo.coords?.length >= 2 && geo.source !== 'station') {
        preciseRailway = geo.coords;
        canUpgradePrecise = false;
        railHint = geo.corridorName
          ? `真实轨道线（${geo.corridorName}）`
          : '真实轨道线（精品预置）';
      } else {
        canUpgradePrecise = geo.canUpgrade !== false;
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
    const spots = (preset.scenicSpots || []).map((s) => ({
      id: String(s.id),
      name: s.name,
      lng: s.lng,
      lat: s.lat,
      intro: s.intro,
      timeLabel: s.timeLabel,
      at: s.at,
      nightOnly: s.nightOnly,
      side: s.side,
      source: 'preset' as const,
      trainCode: 'Z8991',
    }));
    trip.setTrip({
      trainCode: preset.meta.train,
      trainNo: preset.meta.trainNo || '5500000Z8991',
      date: preset.meta.date || '2026-08-11',
      fromName: preset.meta.from,
      toName: preset.meta.to,
      stops: demoStops,
      spots,
      preciseRailway: (preset.railway as [number, number][] | undefined) || null,
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
</script>

<template>
  <div class="select-page">
    <header class="select-hero">
      <p class="brand">RailVista</p>
      <h1>车上风景与行程定位</h1>
      <p class="sub">选择出发站、到达站与日期，进入行程地图</p>
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

    <form class="select-form" @submit.prevent="search">
      <label>
        <span>出发站</span>
        <input v-model="from" list="from-list" autocomplete="off" placeholder="例如 西宁" />
        <datalist id="from-list">
          <option v-for="s in fromSuggest" :key="s.telecode" :value="s.name" />
        </datalist>
      </label>
      <label>
        <span>到达站</span>
        <input v-model="to" list="to-list" autocomplete="off" placeholder="例如 拉萨" />
        <datalist id="to-list">
          <option v-for="s in toSuggest" :key="s.telecode" :value="s.name" />
        </datalist>
      </label>
      <label>
        <span>乘车日期</span>
        <input v-model="date" type="date" required />
      </label>
      <div class="actions">
        <button type="submit" class="btn primary" :disabled="loading">查询直达车次</button>
        <button type="button" class="btn ghost" :disabled="loading" @click="loadDemo">
          演示：Z8991 青藏线
        </button>
      </div>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

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
      <h2>直达车次</h2>
      <button
        v-for="t in trains"
        :key="t.trainNo + t.departTime"
        type="button"
        class="train-card"
        :disabled="loading"
        @click="pickTrain(t)"
      >
        <strong>{{ t.trainCode }}</strong>
        <span>{{ t.departTime }} → {{ t.arriveTime }}</span>
        <span class="muted">{{ t.from.name }} → {{ t.to.name }} · 历时 {{ t.duration }}</span>
      </button>
    </section>

    <section v-if="step === 'od' && selected" class="od-panel">
      <h2>确认上下车站</h2>
      <p class="muted">{{ selected.trainCode }} · {{ selected.date }}</p>
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
      <button type="button" class="btn primary" :disabled="loading" @click="enterTrip">
        进入行程地图
      </button>
      <button type="button" class="btn ghost" :disabled="loading" @click="step = 'search'">
        返回列表
      </button>
    </section>

    <p class="footnote">时刻数据来自公开查询，仅供参考。行程缓存在本机浏览器。</p>

    <div v-if="loading" class="select-loading" role="status" aria-live="polite" aria-busy="true">
      <div class="select-loading__card">
        <div class="select-loading__spinner" aria-hidden="true" />
        <p class="select-loading__title">{{ loadingCopy.title }}</p>
        <p class="select-loading__detail">{{ loadingCopy.detail }}</p>
      </div>
    </div>
  </div>
</template>
