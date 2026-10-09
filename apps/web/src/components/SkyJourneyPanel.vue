<script setup lang="ts">
/**
 * 天象观景面板：选定铁路线后按发车时间重算整条线的
 * 日出日落 / 朝晚霞 / 蓝金时刻 / 月相月出落 / 光污染 / 观景指数时间轴。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  buildMileageAxis,
  buildScheduleCurve,
  buildSkyTripTimeline,
  computeSeaOfCloudsIndex,
  computeRimeIndex,
  computeRainbowIndex,
  computeViewScore,
  estimateLightPollution,
  findMeteorShowers,
  formatTime,
  moonPhase,
  profileForTrain,
  type RailwayPoint,
  type ScenicSpot,
  type SkyEpisode,
  type SkyIndex,
  type SkyMetSample,
  type SkyMoment,
  type SkyMapResult,
  type SkyPhaseKind,
  type SkyTripResult,
  type Stop,
} from '@railvista/shared';
import { api } from '../api/client';
import { toDatetimeLocalValue, fromDatetimeLocalValue } from '@railvista/shared';

const props = defineProps<{
  open: boolean;
  trainCode: string;
  fromName: string;
  toName: string;
  path: RailwayPoint[];
  lengthKm: number;
  stops: Stop[];
  spots: ScenicSpot[];
  /** 当前生效发车/到达（绝对 ms） */
  departureMs: number;
  arrivalMs: number;
  /** 图定基准发车 → 实际发车的整体偏移 */
  offsetMs: number;
  compact: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 地图定位到事件点 */
  (e: 'focus', payload: { lng: number; lat: number }): void;
  /** 时间轴算完（父级画地图标注/路段，含各片段指数） */
  (e: 'result', payload: SkyMapResult | null): void;
  /** 用户改发车时间（先落 prefs，再由父级回传新 departureMs 触发重算） */
  (e: 'depart-change', iso: string): void;
}>();

const computing = ref(false);
const errorMsg = ref('');
const timeline = ref<SkyTripResult | null>(null);
const scores = ref<Record<string, SkyIndex>>({});
const metByPoint = ref<Record<string, SkyMetSample | undefined>>({});
const departInput = ref('');
let computeSeq = 0;

/** 片段 → 指数类型 */
function scoreKind(kind: SkyPhaseKind): 'glow' | 'star' | 'moon' | 'day' {
  if (kind === 'night' || kind === 'astroTwilight' || kind === 'nautical') return 'star';
  if (kind === 'day') return 'day';
  return 'glow';
}

const KIND_CLASS: Record<SkyPhaseKind, string> = {
  dawnGlow: 'k-glow',
  duskGlow: 'k-glow',
  sunrise: 'k-sun',
  sunset: 'k-sun',
  goldenMorning: 'k-golden',
  goldenEvening: 'k-golden',
  blueMorning: 'k-blue',
  blueEvening: 'k-blue',
  day: 'k-day',
  night: 'k-night',
  nautical: 'k-night',
  astroTwilight: 'k-night',
};

const KIND_GLYPH: Record<SkyPhaseKind, string> = {
  dawnGlow: '霞',
  duskGlow: '霞',
  sunrise: '日',
  sunset: '日',
  goldenMorning: '金',
  goldenEvening: '金',
  blueMorning: '蓝',
  blueEvening: '蓝',
  day: '昼',
  night: '夜',
  nautical: '夜',
  astroTwilight: '夜',
};

/** 夜间长片段压缩展示，只保留看点 */
const displayEpisodes = computed<SkyEpisode[]>(() => {
  const list = timeline.value?.episodes ?? [];
  return list.filter(
    (e) =>
      e.kind !== 'day' &&
      !(e.kind === 'nautical' || e.kind === 'astroTwilight') &&
      !(e.kind === 'night' && e.endMs - e.startMs < 90 * 60_000),
  );
});

const moments = computed<SkyMoment[]>(() => timeline.value?.moments ?? []);
const moonInfo = computed(() => timeline.value?.moon ?? null);
const lightInfo = computed(() => timeline.value?.light ?? null);

/** 时段文案：17:32~18:05（跨天补「次日」） */
function rangeLabel(startMs: number, endMs: number): string {
  const d0 = new Date(startMs);
  const depDay = new Date(props.departureMs).getDate();
  const mk = (d: Date) => {
    const next = d.getDate() !== depDay ? '次日 ' : '';
    return next + formatTime(d);
  };
  return `${mk(d0)}~${mk(new Date(endMs))}`;
}

function dayTag(ms: number): string {
  const dep = new Date(props.departureMs);
  const d = new Date(ms);
  const diff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(dep.getFullYear(), dep.getMonth(), dep.getDate()).getTime()) /
      86_400_000,
  );
  return diff === 0 ? '当天' : diff === 1 ? '次日' : `第${diff + 1}天`;
}

function bandText(idx: SkyIndex | undefined): string {
  if (!idx) return '';
  return idx.score >= 75 ? '极佳' : idx.score >= 55 ? '不错' : idx.score >= 35 ? '一般' : '较差';
}

function sideGlyph(side: string): string {
  return side === 'right' ? '→' : '←';
}

/** 精选 3 个最佳看点 */
const topPicks = computed(() => {
  return displayEpisodes.value
    .map((e) => ({ e, score: scores.value[e.id]?.score ?? 0 }))
    .filter((x) => ['dawnGlow', 'duskGlow', 'goldenMorning', 'goldenEvening', 'sunrise', 'sunset'].includes(x.e.kind))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
});

const skyExtras = computed(() => {
  const keys = Object.keys(metByPoint.value);
  if (!keys.length) return { sea: null as SkyIndex | null, rime: null as SkyIndex | null };
  // 取全程最有代表性的采样（中位）估云海/雾凇可能性
  const samples = keys.map((k) => metByPoint.value[k]).filter(Boolean) as SkyMetSample[];
  const mid = samples[Math.floor(samples.length / 2)];
  return { sea: computeSeaOfCloudsIndex(mid), rime: computeRimeIndex(mid) };
});

/** 光污染逐段变化：取全程最暗段（如青藏高原的可可西里），而非单一中点值 */
const darkestChip = computed(() => {
  const eps = timeline.value?.episodes ?? [];
  if (!eps.length) return null;
  let best = eps[0]!;
  for (const e of eps) if (e.light.bortle < best.light.bortle) best = e;
  return { name: best.nearName || '沿途', bortle: best.light.bortle, label: best.light.label };
});

/** 银河窗口：新月窗 + 最暗段光污染（青藏高原段典型成立） */
const milkyWayChip = computed(() => {
  const moon = moonInfo.value;
  const dark = darkestChip.value;
  if (!moon || !dark) return null;
  if (moon.illumination < 0.25 && dark.bortle <= 4) {
    return { text: `${dark.name}一带银河条件佳`, hot: true };
  }
  if (moon.illumination < 0.25) return { text: '新月窗，但沿途光污染偏强', hot: false };
  return { text: `月光较亮（${Math.round(moon.illumination * 100)}%），银河受抑制`, hot: false };
});

/** 流星雨：行程期间撞上极大期（±2 天窗）的主要流星雨，取预期强度最高的 */
const meteorChip = computed(() => {
  if (!props.departureMs || !props.arrivalMs) return null;
  const hits = findMeteorShowers(props.departureMs, props.arrivalMs, (ms) => moonPhase(ms).illumination);
  if (!hits.length) return null;
  const hit = hits[0]!;
  if (hit.score < 25) return null; // 月光干扰太强或 ZHR 太低不值得提示
  return { note: hit.note, hot: hit.moonIllum < 0.35 };
});

async function compute() {
  if (!props.path.length || props.departureMs <= 0) return;
  const seq = ++computeSeq;
  computing.value = true;
  errorMsg.value = '';
  try {
    const mileage = buildMileageAxis({
      stops: props.stops,
      path: props.path,
      lengthKm: props.lengthKm,
    });
    const prof = profileForTrain(props.trainCode);
    const curve = buildScheduleCurve({ stops: props.stops, stationKm: mileage.stationKm, prof });
    const offsetMs = props.offsetMs;
    const result = buildSkyTripTimeline({
      path: props.path,
      lengthKm: props.lengthKm,
      // 注意：curve.kmAtTime 返回米（里程轴 stationKm 为米制），天象算法期望公里
      kmAtTime: (ms) => curve.kmAtTime(ms - offsetMs) / 1000,
      departureMs: props.departureMs,
      arrivalMs: props.arrivalMs,
      stops: props.stops,
      spots: props.spots,
      stepMs: 5 * 60_000,
    });
    if (seq !== computeSeq) return;
    timeline.value = result;

    // 取看点片段与时刻的气象采样 → 指数
    const points: Array<{ pointId: string; lng: number; lat: number; atIso: string }> = [];
    for (const e of result.episodes) {
      if (e.kind === 'day') continue;
      points.push({ pointId: e.id, lng: e.lng, lat: e.lat, atIso: new Date((e.startMs + e.endMs) / 2).toISOString() });
    }
    result.moments.forEach((m, i) => {
      points.push({ pointId: `moment-${i}`, lng: m.lng, lat: m.lat, atIso: m.atIso });
    });
    const metById: Record<string, SkyMetSample | undefined> = {};
    try {
      for (let i = 0; i < points.length; i += 60) {
        const data = await api.getSkyMet(points.slice(i, i + 60));
        if (seq !== computeSeq) return;
        for (const item of data.items || []) metById[item.pointId] = item.met;
      }
    } catch {
      /* 气象缺失时指数降级为天文条件估计 */
    }
    if (seq !== computeSeq) return;
    metByPoint.value = metById;

    const nextScores: Record<string, SkyIndex> = {};
    for (const e of result.episodes) {
      const met = metById[e.id];
      const idx = computeViewScore(scoreKind(e.kind), met, {
        sunAltDeg: e.sunAltDeg,
        moonIllum: result.moon.illumination,
        moonAltDeg: e.moonAltDeg,
        bortle: e.light.bortle,
      });
      // 白天/霞光时段顺带算彩虹可能性（阵雨+低太阳时提示）
      if (e.sunAltDeg > 1) {
        const rainbow = computeRainbowIndex(met, e.sunAltDeg);
        if (rainbow.score >= 55) idx.note = `${idx.note}，${rainbow.note}`;
      }
      nextScores[e.id] = idx;
    }
    scores.value = nextScores;
    emit('result', { result, scores: nextScores });
  } catch (e) {
    if (seq === computeSeq) errorMsg.value = (e as Error)?.message || '天象计算失败';
  } finally {
    if (seq === computeSeq) computing.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      departInput.value = toDatetimeLocalValue(new Date(props.departureMs));
      if (!timeline.value) void compute();
    }
  },
);

watch(
  () => [props.departureMs, props.arrivalMs, props.lengthKm],
  () => {
    departInput.value = toDatetimeLocalValue(new Date(props.departureMs));
    if (props.open) void compute();
  },
);

function onRecompute() {
  const iso = fromDatetimeLocalValue(departInput.value);
  if (iso) {
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms) && ms !== props.departureMs) emit('depart-change', iso);
  }
  void compute();
}

function focusEvent(payload: { lng: number; lat: number }) {
  emit('focus', payload);
}

/** 浮层惯例：Esc 关闭 */
function onGlobalKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close');
}

onMounted(() => window.addEventListener('keydown', onGlobalKey));
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey));

defineExpose({ compute });
</script>

<template>
  <aside v-if="open" class="sky-panel" :class="{ 'is-compact': compact }" aria-label="天象观景">
    <header class="sky-head">
      <div>
        <p class="sky-eyebrow">SKY JOURNEY</p>
        <h2 class="sky-title">天象观景</h2>
        <p class="sky-route">{{ trainCode }} · {{ fromName }} → {{ toName }}</p>
      </div>
      <button type="button" class="sky-close" aria-label="关闭天象观景" @click="emit('close')">×</button>
    </header>

    <div class="sky-controls">
      <label class="sky-depart">
        <span>发车</span>
        <input v-model="departInput" type="datetime-local" />
      </label>
      <button type="button" class="sky-recompute" :disabled="computing" @click="onRecompute">
        {{ computing ? '计算中…' : '重新计算' }}
      </button>
    </div>

    <p v-if="errorMsg" class="sky-error" role="alert" aria-live="polite">{{ errorMsg }}</p>

    <template v-if="timeline">
      <div class="sky-chips">
        <div class="sky-chip">
          <span class="sky-chip__k">月相</span>
          <span class="sky-chip__v">{{ moonInfo?.phaseName }} · 亮{{ Math.round((moonInfo?.illumination ?? 0) * 100) }}%</span>
        </div>
        <div class="sky-chip">
          <span class="sky-chip__k">光污染</span>
          <span class="sky-chip__v">最暗 {{ darkestChip?.name || '—' }} · Bortle {{ darkestChip?.bortle ?? '—' }}</span>
        </div>
        <div v-if="milkyWayChip" class="sky-chip" :class="{ 'is-hot': milkyWayChip.hot }">
          <span class="sky-chip__k">银河窗口</span>
          <span class="sky-chip__v">{{ milkyWayChip.text }}</span>
        </div>
        <div v-if="meteorChip" class="sky-chip" :class="{ 'is-hot': meteorChip.hot }">
          <span class="sky-chip__k">流星雨</span>
          <span class="sky-chip__v">{{ meteorChip.note }}</span>
        </div>
        <div v-if="skyExtras.sea" class="sky-chip">
          <span class="sky-chip__k">云海可能</span>
          <span class="sky-chip__v">{{ skyExtras.sea.score }}</span>
        </div>
        <div v-if="skyExtras.rime" class="sky-chip">
          <span class="sky-chip__k">雾凇可能</span>
          <span class="sky-chip__v">{{ skyExtras.rime.score }}</span>
        </div>
      </div>

      <div class="sky-moments" aria-label="日月时刻">
        <button
          v-for="(m, i) in moments"
          :key="i"
          type="button"
          class="sky-moment"
          @click="focusEvent(m)"
        >
          <span class="sky-moment__t">{{ formatTime(new Date(m.atMs)) }}</span>
          <span class="sky-moment__n">{{ m.title }}</span>
          <span class="sky-moment__s">{{ sideGlyph(m.sideInfo.side) }}{{ m.sideInfo.label }}</span>
        </button>
        <p v-if="!moments.length" class="sky-empty">本次行程区间内没有日出/日落/月出/月落</p>
      </div>

      <section v-if="topPicks.length" class="sky-picks" aria-label="最佳看点">
        <h3 class="sky-h3">最佳看点</h3>
        <button
          v-for="p in topPicks"
          :key="p.e.id"
          type="button"
          class="sky-pick"
          @click="focusEvent(p.e)"
        >
          <span class="sky-pick__badge" :class="KIND_CLASS[p.e.kind]">{{ KIND_GLYPH[p.e.kind] }}</span>
          <span class="sky-pick__main">
            <strong>{{ p.e.title }}</strong>
            <em>{{ rangeLabel(p.e.startMs, p.e.endMs) }} · {{ p.e.nearName || '沿途' }}</em>
          </span>
          <span class="sky-pick__side">{{ sideGlyph(p.e.sunSide.side) }} {{ p.e.sunSide.label }}</span>
          <span class="sky-pick__score" :class="`b-${scores[p.e.id]?.band ?? 'fair'}`">{{ p.score }}</span>
        </button>
      </section>

      <section class="sky-timeline" aria-label="天象时间轴">
        <h3 class="sky-h3">时间轴</h3>
        <p v-if="!displayEpisodes.length" class="sky-empty">本次行程以白天行驶为主，没有突出的天象看点</p>
        <ol class="sky-list">
          <li v-for="e in displayEpisodes" :key="e.id">
            <button type="button" class="sky-item" @click="focusEvent(e)">
              <span class="sky-gutter" :class="KIND_CLASS[e.kind]" aria-hidden="true"></span>
              <span class="sky-item__glyph" :class="KIND_CLASS[e.kind]" aria-hidden="true">{{ KIND_GLYPH[e.kind] }}</span>
              <span class="sky-item__main">
                <span class="sky-item__row">
                  <strong>{{ e.title }}</strong>
                  <em class="sky-item__day">{{ dayTag(e.startMs) }}</em>
                </span>
                <span class="sky-item__time">{{ rangeLabel(e.startMs, e.endMs) }}</span>
                <span class="sky-item__meta">
                  {{ e.nearName || '沿途' }} · 太阳{{ e.sunSide.label }}
                  <template v-if="scoreKind(e.kind) === 'star'"> · 月亮{{ e.moonSide.side === 'right' ? '右' : '左' }}</template>
                  <template v-if="e.galCenter && e.galCenter.altDeg > -5">
                    · 银心{{ e.galCenter.side.side === 'right' ? '右' : '左' }}侧{{ e.galCenter.altDeg > 5 ? ` ${Math.round(e.galCenter.altDeg)}°` : '（低空）' }}
                  </template>
                </span>
              </span>
              <span class="sky-item__right">
                <span class="sky-side" :class="e.sunSide.side === 'right' ? 'is-right' : 'is-left'">
                  {{ sideGlyph(e.sunSide.side) }}{{ e.sunSide.side === 'right' ? '右' : '左' }}
                </span>
                <span v-if="scores[e.id]" class="sky-score" :class="`b-${scores[e.id]!.band}`">
                  {{ scores[e.id]!.score }} · {{ bandText(scores[e.id]) }}
                </span>
                <span v-if="scores[e.id]" class="sky-note">{{ scores[e.id]!.note }}</span>
              </span>
            </button>
          </li>
        </ol>
      </section>

      <footer class="sky-foot">
        <p>指数由沿途逐时气象（云量分层/能见度/湿度）与天文条件合成；光污染为城市灯光影响场估算。</p>
      </footer>
    </template>
  </aside>
</template>

<style scoped>
.sky-panel {
  position: absolute;
  top: calc(var(--top-overlay, 88px) + var(--safe-top, 0px));
  right: calc(var(--gutter) + var(--safe-right, 0px));
  bottom: calc(var(--bottom-overlay, 130px) + var(--safe-bottom, 0px));
  width: min(430px, calc(100vw - 2 * var(--gutter)));
  z-index: 110;
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
  padding: var(--pad-card);
  background: var(--surface-1);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  box-shadow: var(--elev-3);
  overflow: hidden;
}

.sky-panel.is-compact {
  left: var(--gutter);
  width: auto;
}

.sky-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gap-inline);
}

.sky-eyebrow {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-eyebrow);
  letter-spacing: 0.18em;
  color: var(--text-3);
}

.sky-title {
  margin: 2px 0 0;
  font-size: var(--fs-h1);
  color: var(--text-1);
}

.sky-route {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-meta);
  color: var(--text-2);
}

.sky-close {
  width: 36px;
  height: 36px;
  border: 1px solid var(--line-default);
  border-radius: var(--radius-full);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}

.sky-close:hover {
  background: var(--surface-3);
  color: var(--text-1);
}

.sky-close:focus-visible,
.sky-recompute:focus-visible,
.sky-moment:focus-visible,
.sky-pick:focus-visible,
.sky-item:focus-visible,
.sky-depart input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.sky-controls {
  display: flex;
  align-items: flex-end;
  gap: var(--gap-inline);
}

.sky-depart {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.sky-depart input {
  width: 100%;
  min-height: 40px;
  padding: 0 var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-size: var(--fs-input);
  color-scheme: dark;
}

.sky-recompute {
  min-height: 40px;
  padding: 0 var(--space-4);
  background: var(--accent);
  border: none;
  border-radius: var(--radius-lg);
  color: var(--text-on-accent);
  font-size: var(--fs-meta);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.sky-recompute:hover:not(:disabled) {
  background: var(--accent-hover);
}

.sky-recompute:disabled {
  opacity: 0.6;
  cursor: default;
}

.sky-error {
  margin: 0;
  font-size: var(--fs-cap);
  color: var(--danger);
}

.sky-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.sky-chip {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--line-hairline);
  border-radius: var(--radius-full);
  font-size: var(--fs-cap);
}

.sky-chip__k {
  color: var(--text-3);
}

.sky-chip__v {
  color: var(--text-1);
}

.sky-chip.is-hot {
  border-color: var(--accent-container);
  background: var(--accent-soft);
}

.sky-chip.is-hot .sky-chip__k {
  color: var(--accent-hover);
}

.sky-moments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.sky-moment {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-sunken);
  border: 1px solid var(--line-hairline);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: var(--fs-cap);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard);
}

.sky-moment:hover {
  border-color: var(--line-accent);
}

.sky-moment__t {
  font-family: var(--font-display);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}

.sky-moment__s {
  color: var(--text-3);
}

.sky-h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-h3);
  color: var(--text-1);
}

.sky-picks {
  padding: var(--space-3);
  background: var(--surface-sunken);
  border-radius: var(--radius-md);
}

.sky-pick {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) 0;
  background: none;
  border: none;
  border-top: 1px solid var(--line-hairline);
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.sky-pick:hover {
  background: var(--fill-subtle);
}

.sky-pick:first-of-type {
  border-top: none;
}

.sky-pick__badge,
.sky-item__glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-full);
  font-size: var(--fs-cap);
  font-weight: 600;
  flex: none;
}

.sky-pick__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sky-pick__main strong {
  color: var(--text-1);
  font-size: var(--fs-meta);
}

.sky-pick__main em {
  font-style: normal;
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.sky-pick__side {
  font-size: var(--fs-cap);
  color: var(--text-2);
}

.sky-pick__score,
.sky-score {
  font-family: var(--font-display);
  font-size: var(--fs-meta);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.sky-timeline {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sky-list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  overscroll-behavior: contain;
  min-height: 0;
}

.sky-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-2);
  background: none;
  border: none;
  border-bottom: 1px solid var(--line-hairline);
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.sky-item:hover {
  background: var(--fill-subtle);
}

.sky-gutter {
  width: 4px;
  align-self: stretch;
  border-radius: var(--radius-full);
  flex: none;
}

.sky-item__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sky-item__row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.sky-item__row strong {
  color: var(--text-1);
  font-size: var(--fs-body);
}

.sky-item__day {
  font-style: normal;
  font-size: var(--fs-micro);
  color: var(--text-3);
  padding: 1px var(--space-2);
  border: 1px solid var(--line-hairline);
  border-radius: var(--radius-full);
}

.sky-item__time {
  font-family: var(--font-display);
  font-size: var(--fs-meta);
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}

.sky-item__meta {
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.sky-item__right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  max-width: 45%;
}

.sky-side {
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--fs-cap);
  font-weight: 600;
}

.sky-side.is-right {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.sky-side.is-left {
  background: var(--purple-soft);
  color: var(--purple);
}

.sky-note {
  font-size: var(--fs-micro);
  color: var(--text-3);
  text-align: right;
}

.b-excellent {
  color: var(--success);
}

.b-good {
  color: var(--info);
}

.b-fair {
  color: var(--warning);
}

.b-poor {
  color: var(--danger);
}

/* 片段配色语义：霞=暖橙 / 金=琥珀 / 蓝=冰蓝 / 日=朱红 / 夜=靛紫 / 昼=灰 */
.k-glow {
  background: var(--spot-soft);
  color: var(--spot);
}

.k-golden {
  background: var(--warning-soft);
  color: var(--warning);
}

.k-blue {
  background: var(--info-soft);
  color: var(--info);
}

.k-sun {
  background: var(--danger-soft);
  color: var(--danger);
}

.k-night {
  background: var(--purple-soft);
  color: var(--purple);
}

.k-day {
  background: var(--fill-subtle);
  color: var(--text-3);
}

.sky-empty {
  margin: 0;
  font-size: var(--fs-cap);
  color: var(--text-3);
}

.sky-foot {
  border-top: 1px solid var(--line-hairline);
  padding-top: var(--space-2);
}

.sky-foot p {
  margin: 0;
  font-size: var(--fs-micro);
  color: var(--text-3);
  line-height: var(--lh-snug);
}

@media (min-width: 641px) {
  /* 桌面：让开右侧固定按钮列（定位/卫星/图例/天象），互不遮挡 */
  .sky-panel {
    right: calc(var(--gutter) + 98px + var(--safe-right, 0px));
  }
}

@media (max-width: 640px) {
  /* 竖屏手机：面板贴底部成卡片（顶部留给车次徽章区），限高不遮地图 */
  .sky-panel {
    left: var(--gutter);
    right: var(--gutter);
    top: auto;
    bottom: calc(var(--bottom-overlay, 130px) + var(--safe-bottom, 0px));
    width: auto;
    max-height: min(62vh, 560px);
    padding: var(--space-3);
    border-radius: var(--radius-md);
  }

  /* chips 横向轻扫，不占纵向空间 */
  .sky-chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    padding-bottom: 2px;
  }

  .sky-chips::-webkit-scrollbar {
    display: none;
  }

  .sky-chip {
    flex: none;
  }

  /* 手机聚焦"接下来有什么"，最佳看点折叠进时间轴（分数已在列表中） */
  .sky-picks {
    display: none;
  }

  .sky-item__right {
    max-width: 44%;
  }

  .sky-note {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }
}
</style>
