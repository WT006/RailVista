<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
import RailProgressLoader from '../components/RailProgressLoader.vue';
import RankingsSection from '../components/rankings/RankingsSection.vue';
import AtlasEntryCard from '../components/AtlasEntryCard.vue';
import AppTopBar from '../components/AppTopBar.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import { useTripStore } from '../stores/tripStore';

/** 卡片悬停光影（指针位置写入 --mx/--my，由 CSS 绘制光晕与高光流转） */
usePointerSpotlight();

const router = useRouter();
const route = useRoute();
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
const loaderRef = ref<{ abort: () => void; whenSettled: () => Promise<void> } | null>(null);
const error = ref('');
const resumeHint = ref('');
const selected = ref<TrainSummary | null>(null);
const stops = ref<Stop[]>([]);
const boardFrom = ref('');
const boardTo = ref('');
const step = ref<'search' | 'od'>('search');
const recent = ref<TripIndexEntry[]>([]);
const currentEntry = ref<TripIndexEntry | null>(null);
/** 「最近访问」折叠态：默认收起，点击标题展开 */
const recentOpen = ref(false);
/** 查询面板朝向：od = 按站查询（正面），code = 车次号查询（背面） */
const searchFace = ref<'od' | 'code'>('od');
/** 按车次号直达的输入 */
const codeQuery = ref('');

const queryFlipCard = ref<HTMLElement | null>(null);
const queryFlipFront = ref<HTMLElement | null>(null);
const queryFlipBack = ref<HTMLElement | null>(null);
/** 首帧量高完成前保持正面文档流，避免 absolute 叠放把容器压成 0 */
const queryFlipMeasured = ref(false);
let queryFlipRo: ResizeObserver | null = null;

/** 把容器高度钉到当前可见面板，供 CSS height 过渡使用 */
function syncQueryFlipHeight() {
  const card = queryFlipCard.value;
  const face = searchFace.value === 'od' ? queryFlipFront.value : queryFlipBack.value;
  if (!card || !face) return;
  const next = `${face.offsetHeight}px`;
  if (!queryFlipMeasured.value) {
    card.style.transition = 'none';
    card.style.setProperty('--query-flip-h', next);
    void card.offsetHeight;
    card.style.transition = '';
    queryFlipMeasured.value = true;
    return;
  }
  card.style.setProperty('--query-flip-h', next);
}

/** 切换查询面板；离开按站面时收起站名建议 */
function flipSearchFace() {
  searchFace.value = searchFace.value === 'od' ? 'code' : 'od';
  fromOpen.value = false;
  toOpen.value = false;
}

watch(searchFace, async () => {
  await nextTick();
  syncQueryFlipHeight();
});

onMounted(() => {
  syncQueryFlipHeight();
  queryFlipRo = new ResizeObserver(() => syncQueryFlipHeight());
  if (queryFlipFront.value) queryFlipRo.observe(queryFlipFront.value);
  if (queryFlipBack.value) queryFlipRo.observe(queryFlipBack.value);
});

onBeforeUnmount(() => {
  queryFlipRo?.disconnect();
  queryFlipRo = null;
});

/** 车次类型前缀 → 专属颜色（前缀键盘 + 车次列表共用同一色板，保证"对得上"）。
 * 每类一个可区分色，落在深色玻璃底上均 ≥ 3:1 对比；纯数字普速用中性灰。 */
const TRAIN_COLORS: Record<string, string> = {
  G: '#4d9fff', // 高铁 · 蓝
  D: '#35c2a5', // 动车 · 青绿
  C: '#7fb4d8', // 城际 · 青蓝
  Z: '#9d8cf0', // 直达 · 紫
  T: '#e0915a', // 特快 · 橙
  K: '#74bd89', // 快速 · 黄绿
  L: '#8a97a8', // 临客 · 灰蓝
  S: '#6aa9f0', // 市郊 · 天蓝
  Y: '#e5769f', // 旅游 · 品红
  '': '#a3aebd', // 普速(纯数字) · 灰
};

/** 车次号前缀键盘：字母 / 中文名 / 英文名 / 色别。
 * 覆盖国铁常见车次类型；「纯数字」对应无字母开头的普通旅客列车。 */
interface TrainPrefix {
  key: string;
  zh: string;
  en: string;
  kind: 'hsr' | 'intercity' | 'conventional' | 'other';
  color: string;
}
const codePrefixes: TrainPrefix[] = [
  { key: 'G', zh: '高铁', en: 'HSR', kind: 'hsr', color: TRAIN_COLORS['G']! },
  { key: 'D', zh: '动车', en: 'EMU', kind: 'hsr', color: TRAIN_COLORS['D']! },
  { key: 'C', zh: '城际', en: 'Intercity', kind: 'intercity', color: TRAIN_COLORS['C']! },
  { key: 'Z', zh: '直达', en: 'Direct', kind: 'conventional', color: TRAIN_COLORS['Z']! },
  { key: 'T', zh: '特快', en: 'Express', kind: 'conventional', color: TRAIN_COLORS['T']! },
  { key: 'K', zh: '快速', en: 'Fast', kind: 'conventional', color: TRAIN_COLORS['K']! },
  { key: 'L', zh: '临客', en: 'Temp', kind: 'conventional', color: TRAIN_COLORS['L']! },
  { key: 'S', zh: '市郊', en: 'Suburban', kind: 'other', color: TRAIN_COLORS['S']! },
  { key: 'Y', zh: '旅游', en: 'Tourist', kind: 'other', color: TRAIN_COLORS['Y']! },
  { key: '', zh: '普速', en: 'Regular', kind: 'conventional', color: TRAIN_COLORS['']! },
];

/** 点击前缀：替换车次号首字母（或纯数字时补一个字母前缀）。
 * 保留用户已输入的后续数字，只改开头的"类型"部分，避免清空重打。 */
function applyPrefix(p: TrainPrefix) {
  const digits = codeQuery.value.replace(/^[A-Za-z]/, '').trim();
  codeQuery.value = (p.key + digits).toUpperCase();
}

/** 当前输入对应的前缀键：仅当输入非空时才算命中（空输入不高亮任何键） */
const activePrefixKey = computed<string | null>(() => {
  const v = codeQuery.value.trim().toUpperCase();
  if (!v) return null;
  return /^[A-Z]/.test(v) ? v[0]! : '';
});

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

/**
 * complete：冲到 100% 再收起（默认）
 * abort：立刻收起（失败 / 取消 / 过期请求）
 */
async function endLoading(mode: 'complete' | 'abort' = 'complete') {
  if (!loading.value) return;
  if (mode === 'abort') loaderRef.value?.abort();
  const settled = loaderRef.value?.whenSettled() ?? Promise.resolve();
  loading.value = false;
  loadingPhase.value = null;
  await settled;
}

function onRetry() {
  const fn = retryFn.value;
  void endLoading('abort').then(() => {
    if (fn) fn();
  });
}

function onCancel() {
  requestSeq += 1;
  void endLoading('abort');
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
      await endLoading('abort');
      return;
    }
    hydrateFromSnapshot(snap);
    await endLoading('complete');
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
    await endLoading('abort');
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
  // 线路详情页「进入实时地图」带 from/to 回来：预填 OD 输入框（零回归：仅赋值，不触发查询）
  const qFrom = route.query.from;
  const qTo = route.query.to;
  if (typeof qFrom === 'string' && qFrom.trim()) from.value = qFrom.trim();
  if (typeof qTo === 'string' && qTo.trim()) to.value = qTo.trim();
  try {
    const hint = sessionStorage.getItem('railvista:resumeHint');
    if (hint) {
      resumeHint.value = hint;
      sessionStorage.removeItem('railvista:resumeHint');
    }
  } catch {
    /* */
  }
  try {
    await pruneRecentTrips();
    refreshRecentUi();
    const stayOnSelect = consumeStayOnSelect();
    const resumeKey = getAutoResumeTripKey();
    // 仅在真正要自动跳回行程时才播加载动画；从全国地图等返回主页不应闪「已到达」
    if (stayOnSelect || !resumeKey) return;

    beginLoading('resume');
    const snap = await getSnapshot(resumeKey);
    if (snap) {
      hydrateFromSnapshot(snap);
      await endLoading('complete');
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
    await endLoading('abort');
  } catch {
    if (loading.value) await endLoading('abort');
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

/** 程序化回填 OD（车次直达）时静音联想：watch 是微任务异步触发，
 * 置位期间到达的联想请求一律丢弃，否则回填后下拉框会意外弹出 */
let muteSuggest = false;

watch(from, (q) => {
  if (muteSuggest) return;
  onSuggest('from', q);
});
watch(to, (q) => {
  if (muteSuggest) return;
  onSuggest('to', q);
});

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
    if (isStale(seq)) {
      await endLoading('abort');
      return;
    }
    trains.value = res.trains;
    if (!trains.value.length) error.value = '这个区间暂时没有查到直达车次。';
    await endLoading('complete');
  } catch (e) {
    if (isStale(seq)) {
      await endLoading('abort');
      return;
    }
    error.value = e instanceof Error ? e.message : '查询失败';
    await endLoading('abort');
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

/** 按公开车次号直达：跳过 OD 查询，直接拉全程时刻表进入「确认上下车站」 */
async function searchByCode() {
  error.value = '';
  const code = codeQuery.value.trim().toUpperCase();
  if (!code) {
    error.value = '请输入车次号，例如 Z8991。';
    return;
  }
  if (!date.value) {
    error.value = '请先选择乘车日期。';
    return;
  }
  const seq = nextSeq();
  retryFn.value = () => void searchByCode();
  beginLoading('stops');
  trains.value = [];
  selected.value = null;
  try {
    const res = await api.searchTrainByCode(code, date.value);
    if (isStale(seq)) {
      await endLoading('abort');
      return;
    }
    const list = res.stops;
    if (!list.length) {
      error.value = '未查到该车次，请核对车次号与日期。';
      await endLoading('abort');
      return;
    }
    stops.value = list;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    // 车次查询返回的是"全程"时刻表：默认上下车站为始发/终到，用户可在下方改选任意区间
    selected.value = {
      trainCode: code,
      trainNo: res.trainNo || code,
      from: { name: first.name, telecode: first.telecode || first.name },
      to: { name: last.name, telecode: last.telecode || last.name },
      departTime: hm(first.departTime || first.arriveTime),
      arriveTime: hm(last.arriveTime || last.departTime),
      duration: '',
      date: date.value,
    };
    boardFrom.value = first.name;
    boardTo.value = last.name;
    // 同步 OD 输入框：保持与后续「重新发车」/预设轨道匹配所用的 OD 一致。
    // 注意静音联想，避免回填触发站名下拉弹出。
    muteSuggest = true;
    from.value = first.name;
    to.value = last.name;
    fromSuggest.value = [];
    toSuggest.value = [];
    fromOpen.value = false;
    toOpen.value = false;
    window.setTimeout(() => {
      muteSuggest = false;
    }, 0);
    step.value = 'od';
    await endLoading('complete');
  } catch (e) {
    if (isStale(seq)) {
      await endLoading('abort');
      return;
    }
    error.value = e instanceof Error ? e.message : '车次查询失败';
    await endLoading('abort');
  }
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
    if (isStale(seq)) {
      await endLoading('abort');
      return;
    }
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
    await endLoading('complete');
  } catch (e) {
    if (isStale(seq)) {
      await endLoading('abort');
      return;
    }
    error.value = e instanceof Error ? e.message : '经停加载失败';
    await endLoading('abort');
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
      await endLoading('abort');
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
      await endLoading('abort');
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
    await endLoading('complete');
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
    await endLoading('abort');
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

/** 取车次号首字母对应的颜色（无字母 → 普速灰）。前缀键盘与车次卡都调它。 */
function trainColor(code: string): string {
  const c = String(code || '').trim().toUpperCase();
  const k = /^[A-Z]/.test(c) ? c[0]! : '';
  return TRAIN_COLORS[k] ?? TRAIN_COLORS['']!;
}

/** 车次类型（仅用于保留向后兼容的色条分组：hsr/intercity/conventional/other） */
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
  <div class="select-page rv-page" :class="{ 'is-solo-main': !showHomeLists }">
    <!-- 背景层：极淡的中国地图 + 全国铁路景点热力光点。
         轮廓与点位均为构建期生成的离线静态资源（内联进包），运行时零网络请求，
         不依赖任何在线地图服务；整层 pointer-events:none，不影响前景交互。 -->

    <!-- 顶部导航栏：品牌标识 + 版本徽标。sticky 吸顶，与正文共用同一 .rv-shell 栅格。 -->
    <AppTopBar />

    <div class="rv-shell">
      <div v-if="showBackBtn" class="select-top">
        <button type="button" class="select-back-btn" :disabled="loading" @click="goBack">
          <span class="select-back-btn__icon" aria-hidden="true">‹</span>
          返回
        </button>
      </div>

      <header class="select-hero">
        <h1>车上风景与行程定位</h1>
        <p class="sub">按站查询或按车次号直达，进入行程地图</p>
      </header>

      <p v-if="resumeHint" class="error">{{ resumeHint }}</p>

      <!-- 12 列栅格：sm 竖屏单列纵向堆叠；≥600px 起主栏 7 列 + 侧栏 5 列 -->
      <div class="rv-grid" :class="{ 'is-solo-main': !showHomeLists }">
        <!-- 主栏：查询与当前行程相关的一切 -->
        <div class="rv-col rv-col--main">
          <section v-if="currentEntry && showHomeLists" class="current-trip rv-card" data-spotlight>
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

          <!-- 查询面板：按站 / 车次号同级；高度过渡 + 交叉淡入 + 微位移 -->
          <div
            class="query-flip"
            :class="{
              'is-flipped': searchFace === 'code',
              'has-suggest-open': fromOpen || toOpen,
            }"
          >
            <div
              ref="queryFlipCard"
              class="query-flip__card"
              :class="{ 'is-measured': queryFlipMeasured }"
            >
              <!-- 正面：出发站 / 到达站 -->
              <form
                ref="queryFlipFront"
                class="query-flip__face query-flip__face--front select-form select-form--panel rv-card"
                data-spotlight
                :aria-hidden="searchFace === 'code'"
                :inert="searchFace === 'code'"
                @submit.prevent="search"
              >
                  <div class="rv-head select-form__head query-flip__head">
                    <div class="query-flip__head-text">
                      <h2 class="rv-head__title">按站查询</h2>
                      <p class="rv-head__sub">填写 OD 与乘车日，查找直达车次</p>
                    </div>
                    <button
                      type="button"
                      class="btn ghost btn-sm query-flip__toggle"
                      :disabled="loading"
                      aria-label="切换到车次查询"
                      @click="flipSearchFace"
                    >
                      按车次号
                      <span class="query-flip__toggle-icon" aria-hidden="true">↻</span>
                    </button>
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

                  <label class="date-field">
                    <span>乘车日期</span>
                    <DarkDateTimeField v-model="date" mode="date" placeholder="选择乘车日期" />
                  </label>

                  <div class="actions">
                    <button type="submit" class="btn primary" :disabled="loading">查询直达车次</button>
                  </div>
                </form>

              <!-- 背面：按车次号查询 -->
              <form
                ref="queryFlipBack"
                class="query-flip__face query-flip__face--back select-form select-form--panel rv-card"
                data-spotlight
                :aria-hidden="searchFace === 'od'"
                :inert="searchFace === 'od'"
                @submit.prevent="searchByCode"
              >
                  <div class="rv-head select-form__head query-flip__head">
                    <div class="query-flip__head-text">
                      <h2 class="rv-head__title">车次查询</h2>
                      <p class="rv-head__sub">输入车次号与乘车日，直达时刻表</p>
                    </div>
                    <button
                      type="button"
                      class="btn ghost btn-sm query-flip__toggle"
                      :disabled="loading"
                      aria-label="切换到按站查询"
                      @click="flipSearchFace"
                    >
                      按站查询
                      <span class="query-flip__toggle-icon" aria-hidden="true">↻</span>
                    </button>
                  </div>

                  <label class="date-field">
                    <span>乘车日期</span>
                    <DarkDateTimeField v-model="date" mode="date" placeholder="选择乘车日期" />
                  </label>

                  <div class="code-search">
                    <label class="code-search__field">
                      <span>车次号</span>
                      <div class="code-search__row">
                        <input
                          v-model="codeQuery"
                          class="code-search__input"
                          autocomplete="off"
                          placeholder="输入车次号，例如 Z8991"
                        />
                      </div>
                    </label>

                    <div class="code-prefix" role="group" aria-label="车次类型前缀">
                      <button
                        v-for="p in codePrefixes"
                        :key="p.key || 'num'"
                        type="button"
                        class="code-prefix__key"
                        :class="`code-prefix__key--${p.kind}`"
                        :style="{ '--prefix-color': p.color }"
                        :aria-pressed="activePrefixKey !== null && activePrefixKey === p.key"
                        :title="p.key ? `${p.key} 字头 · ${p.zh}（${p.en}）` : `纯数字车次 · ${p.zh}（${p.en}），无字母开头`"
                        @click="applyPrefix(p)"
                      >
                        <span class="code-prefix__letter">{{ p.key || '#' }}</span>
                        <span class="code-prefix__name">
                          <strong>{{ p.zh }}</strong>
                          <em>{{ p.en }}</em>
                        </span>
                      </button>
                    </div>
                  </div>

                  <div class="actions">
                    <button type="submit" class="btn primary" :disabled="loading">查时刻</button>
                  </div>
              </form>
            </div>
          </div>

          <p v-if="error && !showEmptyState" class="error">{{ error }}</p>

          <section v-if="showEmptyState" class="empty-state rv-card">
            <p class="empty-state__title">这个区间暂时没有查到直达车次</p>
            <p class="empty-state__desc">可以换一天看看。</p>
            <div class="empty-state__actions">
              <button type="button" class="btn ghost btn-sm" @click="retryWithDateShift(-1)">
                前一天
              </button>
              <button type="button" class="btn ghost btn-sm" @click="retryWithDateShift(1)">
                后一天
              </button>
            </div>
          </section>

          <!-- 最近访问：默认折叠在查询表单之下，点击标题展开；
               高频操作区（查询）保持首屏完整可见，历史行程按需展开 -->
          <section
            v-if="recent.length && showHomeLists"
            class="recent-list rv-card"
            data-spotlight
          >
            <button
              type="button"
              class="recent-list__toggle"
              :aria-expanded="recentOpen"
              @click="recentOpen = !recentOpen"
            >
              <h2 class="rv-head__title">最近访问</h2>
              <span class="recent-list__count">{{ recent.length }}</span>
              <span
                class="recent-list__chevron"
                :class="{ 'is-open': recentOpen }"
                aria-hidden="true"
                >›</span
              >
            </button>
            <div v-show="recentOpen" class="recent-list__body">
              <div v-for="item in recent" :key="item.key" class="recent-row">
                <button
                  type="button"
                  class="recent-card"
                  :disabled="loading"
                  @click="openCachedTrip(item.key)"
                >
                  <span class="recent-card__main">
                    <strong>{{ item.trainCode }}</strong>
                    <span>{{ item.fromName }} → {{ item.toName }}</span>
                  </span>
                  <span class="recent-card__meta">
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
            </div>
          </section>

          <!-- 全国铁路景点地图：紧跟查询区，首屏可见 -->
          <AtlasEntryCard v-if="showHomeLists" />

          <section
            v-if="trains.length && step === 'search'"
            class="train-list rv-card"
            data-spotlight
          >
            <h2 class="train-list__title">
              直达车次
              <span class="train-list__count">{{ trains.length }} 趟</span>
            </h2>
            <div class="train-grid" v-auto-animate>
              <button
                v-for="(t, i) in trains"
                :key="t.trainNo + t.departTime"
                type="button"
                class="train-card"
                :class="`train-card--${trainKind(t.trainCode)}`"
                :style="{ '--i': Math.min(i, 8), '--train-color': trainColor(t.trainCode) }"
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

          <section v-if="step === 'od' && selected" class="od-panel rv-card" data-spotlight>
            <h2 class="rv-head__title">确认上下车站</h2>
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

            <div class="od-panel__actions">
              <button type="button" class="btn primary" :disabled="loading" @click="enterTrip">
                进入行程地图
              </button>
              <button type="button" class="btn ghost" :disabled="loading" @click="step = 'search'">
                返回列表
              </button>
            </div>

            <ol class="tl" v-auto-animate>
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
          </section>
        </div>

        <!-- 侧栏：中国最美铁路排行榜（首页态；竖屏单列时落在下一屏） -->
        <div v-if="showHomeLists" class="rv-col rv-col--side select-rankings-below-fold">
          <div class="select-rankings-spacer" aria-hidden="true" />
          <RankingsSection />
        </div>
      </div>

      <p class="footnote">时刻数据来自公开查询，仅供参考。行程缓存在本机浏览器。</p>
    </div>

    <RailProgressLoader
      ref="loaderRef"
      :active="loading"
      :phase="loadingPhase"
      @retry="onRetry"
      @cancel="onCancel"
    />
  </div>
</template>

<style scoped>
/*
 * 首页的模块样式全部位于设计系统层（`src/styles/base.css` 的 .rv-shell / .rv-grid /
 * .rv-card / .tl / .train-card 等），本页只保留真正属于"页面"的排版微调，
 * 避免同一套样式在两处重复维护。
 */
.select-page .rv-grid {
  margin-top: var(--space-1);
}

/* 无侧栏（查车次 / 选区间）：主栏居中，避免只占 7/12 列贴左 */
@media (min-width: 600px) {
  .select-page.is-solo-main .select-top,
  .select-page.is-solo-main .select-hero {
    max-width: min(720px, 100%);
    margin-inline: auto;
  }

  .select-page .rv-grid.is-solo-main .rv-col--main {
    grid-column: 1 / -1;
    width: 100%;
    max-width: min(720px, 100%);
    justify-self: center;
  }
}

/* 竖屏单列：首屏留给查询 + 景点地图，榜单从下一屏起 */
@media (max-width: 599px) {
  .select-rankings-below-fold {
    display: grid;
    grid-template-rows: 1fr auto;
    min-height: calc(100svh - var(--appbar-h) - var(--space-4));
    scroll-margin-top: calc(var(--appbar-h) + var(--space-3));
  }

  .select-rankings-spacer {
    min-height: 0;
  }
}

@media (min-width: 600px) {
  .select-rankings-spacer {
    display: none;
  }
}

.select-page .footnote {
  margin-inline: 0;
}
</style>

