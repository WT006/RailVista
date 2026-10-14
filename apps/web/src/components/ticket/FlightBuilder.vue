<script setup lang="ts">
/**
 * 飞行纪念票构建器（鸿蒙风格）：
 * 两种模式：
 *  1. 航班号 + 日期查询：在线服务可用时自动带出起降机场/时刻；否则本地兜底补选。
 *  2. 航线搜索：出发地+目的地+日期 → FlyClaw（飞猪源）返回航班列表，选择后自动成票。
 * 用户只需：舱位（滚轮选择）、座位号、舷窗侧（选）。
 */
import { computed, reactive, ref, watch } from 'vue';
import { CABIN_CLASSES, getAirport, getAirline, haversineKm, cruiseAltitudeM, parseFlightIata, type FlightLookup, type FlightSearchResult } from '@railvista/shared';
import { api } from '../../api/client';
import { useTicketStore } from '../../stores/ticketStore';
import { AIRLINES } from '../../data/ticket';
import HmField from './hm/HmField.vue';
import HmSelect from './hm/HmSelect.vue';
import HmDatePicker from './hm/HmDatePicker.vue';
import AirportField from './AirportField.vue';
import type { WheelOption } from './hm/HmWheel.vue';

const store = useTicketStore();

const mode = ref<'flightNo' | 'route'>('flightNo');
const flightNo = ref('');
const date = ref(new Date().toISOString().slice(0, 10));
const loading = ref(false);
const error = ref('');
const lookup = ref<FlightLookup | null>(null);
const showTimes = ref(false);
const routeSearching = ref(false);
const localSearchError = ref('');

// 航线搜索
const routeFrom = ref('');
const routeTo = ref('');
const searchResults = ref<FlightSearchResult[]>([]);

const cabinOptions: WheelOption[] = CABIN_CLASSES.map((c) => ({ label: c.value, value: c.value }));
const sideOptions: WheelOption[] = [
  { label: '不选', value: '' },
  { label: '左', value: '左' },
  { label: '右', value: '右' },
];

const form = reactive({
  depIata: '',
  arrIata: '',
  cabin: '经济舱',
  seat: '',
  windowSide: '',
  depTime: '',
  arrTime: '',
  gate: '',
});

const isLocal = computed(() => lookup.value?.source === 'local');
const depIata = computed(() => lookup.value?.dep?.iata ?? form.depIata);
const arrIata = computed(() => lookup.value?.arr?.iata ?? form.arrIata);
const ready = computed(
  () => !!lookup.value && !!depIata.value && !!arrIata.value && depIata.value !== arrIata.value,
);

async function query() {
  error.value = '';
  lookup.value = null;
  if (!flightNo.value.trim()) {
    error.value = '请输入航班号，如 CZ3467';
    return;
  }
  loading.value = true;
  try {
    const res = await api.lookupFlight(flightNo.value.trim(), date.value);
    lookup.value = res;
    if (res.source !== 'local') {
      form.depIata = '';
      form.arrIata = '';
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '查询失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

async function searchRoute() {
  error.value = '';
  searchResults.value = [];
  if (!routeFrom.value || !routeTo.value) {
    error.value = '请选择出发和到达机场';
    return;
  }
  loading.value = true;
  try {
    const results = await api.searchFlights(routeFrom.value, routeTo.value, date.value);
    searchResults.value = results;
    if (!results.length) error.value = '未找到航班，请尝试其他日期或航线';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '搜索失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

function selectFlight(r: FlightSearchResult) {
  flightNo.value = r.flightNumber;
  const ap = getAirport(r.depIata);
  const bp = getAirport(r.arrIata);
  const distanceKm = ap && bp ? Math.round(haversineKm(ap, bp)) : undefined;
  lookup.value = {
    source: 'fr24',
    flightNumber: r.flightNumber,
    airlineIata: resultCode(r),
    date: date.value,
    dep: { iata: r.depIata, scheduled: r.scheduledDeparture },
    arr: { iata: r.arrIata, scheduled: r.scheduledArrival },
    durationMin: r.durationMin,
    distanceKm,
    cruiseAltitudeM: distanceKm ? cruiseAltitudeM(distanceKm) : undefined,
  };
  form.depIata = '';
  form.arrIata = '';
  searchResults.value = [];
}

function airlineMeta(iata?: string) {
  if (!iata) return null;
  return AIRLINES[iata.toLowerCase()] ?? null;
}

/** 二字码优先取接口值，缺失时从航班号自解析（3U/8L/9C 等数字开头码易被旧接口截空） */
function resultCode(r: FlightSearchResult) {
  return r.airlineIata || parseFlightIata(r.flightNumber)?.airlineIata;
}

/** 航司展示名一律以航司表为准，表内没有才回落到数据源叫法 */
function resultAirlineName(r: FlightSearchResult) {
  return airlineMeta(resultCode(r))?.name || r.airlineName;
}

/** 本地模式下用户选了起降机场后，自动用飞猪源搜索该航班号 */
async function autoSearchByFlightNo() {
  localSearchError.value = '';
  if (!isLocal.value || !flightNo.value.trim() || !form.depIata || !form.arrIata) return;
  if (form.depIata === form.arrIata) return;
  routeSearching.value = true;
  try {
    const res = await api.lookupFlight(flightNo.value.trim(), date.value, form.depIata, form.arrIata);
    if (res.source !== 'local') {
      lookup.value = res;
      form.depIata = '';
      form.arrIata = '';
    } else {
      localSearchError.value = `未找到 ${flightNo.value.trim()} 航班，请确认起降机场是否正确，或尝试切换日期。`;
    }
  } catch {
    localSearchError.value = '搜索失败，请检查网络后重试。';
  } finally {
    routeSearching.value = false;
  }
}

watch([() => form.depIata, () => form.arrIata], autoSearchByFlightNo);

let t: ReturnType<typeof setTimeout> | undefined;
watch(
  [ready, () => form.cabin, () => form.seat, () => form.windowSide, depIata, arrIata,
   () => form.depTime, () => form.arrTime, () => form.gate],
  () => {
    if (!ready.value || !lookup.value) return;
    clearTimeout(t);
    t = setTimeout(() => {
      store.applyFlight(lookup.value!, {
        depIata: form.depIata,
        arrIata: form.arrIata,
        cabin: form.cabin,
        seat: form.seat,
        windowSide: form.windowSide,
        depTime: form.depTime || undefined,
        arrTime: form.arrTime || undefined,
        gate: form.gate || undefined,
      });
    }, 180);
  },
);
</script>

<template>
  <div class="fb">
    <!-- 模式切换 -->
    <div class="fb__mode">
      <button type="button" :class="['fb__mode-btn', { active: mode === 'flightNo' }]" @click="mode = 'flightNo'">按航班号</button>
      <button type="button" :class="['fb__mode-btn', { active: mode === 'route' }]" @click="mode = 'route'">按航线搜索</button>
    </div>

    <!-- 航班号查询模式 -->
    <form v-if="mode === 'flightNo'" class="fb__top" @submit.prevent="query">
      <div class="fb__no">
        <HmField v-model="flightNo" label="航班号" placeholder="如 CZ3467" hint="两位航司代码 + 数字，如 CA4401、3U8633" />
      </div>
      <div class="fb__date">
        <HmDatePicker v-model="date" label="出发日期" />
      </div>
      <button class="fb__submit" type="submit" :disabled="loading">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M21 15.4v-2l-8-5V3.5a1.5 1.5 0 00-3 0V8.4l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-6.1z"/></svg>
        {{ loading ? '查询中…' : '查询航班' }}
      </button>
    </form>

    <!-- 航线搜索模式 -->
    <form v-else class="fb__top" @submit.prevent="searchRoute">
      <AirportField v-model="routeFrom" label="出发机场" placeholder="如 北京、上海" />
      <AirportField v-model="routeTo" label="到达机场" placeholder="如 广州、成都" />
      <div class="fb__date">
        <HmDatePicker v-model="date" label="出发日期" />
      </div>
      <button class="fb__submit" type="submit" :disabled="loading">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M21 15.4v-2l-8-5V3.5a1.5 1.5 0 00-3 0V8.4l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-6.1z"/></svg>
        {{ loading ? '搜索中…' : '搜索航班' }}
      </button>
    </form>

    <p v-if="error" class="fb__error">{{ error }}</p>

    <!-- 航线搜索结果 -->
    <div v-if="searchResults.length" class="fb__results">
      <div class="fb__results-header">
        <span>找到 {{ searchResults.length }} 个航班</span>
        <span class="fb__results-hint">点击选择航班</span>
      </div>
      <button v-for="r in searchResults" :key="r.flightNumber + r.scheduledDeparture" type="button" class="fb__result" @click="selectFlight(r)">
        <div class="fb__result-left">
          <img v-if="airlineMeta(resultCode(r))?.logo" :src="airlineMeta(resultCode(r))!.logo" class="fb__result-logo" :alt="resultAirlineName(r)" />
          <span v-else class="fb__result-logo fb__result-logo--fallback">{{ r.flightNumber?.charAt(0) || '✈' }}</span>
          <div class="fb__result-info">
            <div class="fb__result-top">
              <span class="fb__result-no">{{ r.flightNumber }}</span>
              <span v-if="resultAirlineName(r)" class="fb__result-airline">{{ resultAirlineName(r) }}</span>
            </div>
            <div class="fb__result-bottom">
              <span class="fb__result-route">{{ r.depIata }} → {{ r.arrIata }}</span>
              <span v-if="r.stops === 0" class="fb__result-tag">直飞</span>
              <span v-else-if="r.stops" class="fb__result-tag fb__result-tag--warn">{{ r.stops }}经停</span>
            </div>
          </div>
        </div>
        <div class="fb__result-right">
          <span class="fb__result-time">{{ r.scheduledDeparture || '--:--' }}–{{ r.scheduledArrival || '--:--' }}</span>
          <span v-if="r.price" class="fb__result-price">¥{{ Math.round(r.price) }}</span>
        </div>
      </button>
    </div>

    <!-- 本地模式：补选机场 -->
    <div v-if="isLocal" class="fb__local">
      <div class="fb__notice-box">
        <svg class="fb__notice-icon" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <p class="fb__notice">{{ lookup?.note }}</p>
      </div>
      <div class="fb__airports">
        <AirportField v-model="form.depIata" label="出发机场" placeholder="如 广州白云" />
        <AirportField v-model="form.arrIata" label="到达机场" placeholder="如 拉萨贡嘎" />
      </div>
      <p v-if="routeSearching" class="fb__searching">
        <svg class="fb__spin" viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M12 2a10 10 0 0110 10" opacity="0.3"/><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M12 2a10 10 0 0110 10"/></svg>
        正在通过飞猪源搜索 {{ flightNo }}…
      </p>
      <p v-else-if="localSearchError" class="fb__local-error">{{ localSearchError }}</p>
      <button type="button" class="fb__times-toggle" @click="showTimes = !showTimes">
        <span>{{ showTimes ? '收起' : '补填时刻 / 登机口（选填）' }}</span>
        <svg v-if="!showTimes" viewBox="0 0 24 24" width="15" height="15"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
        <svg v-else viewBox="0 0 24 24" width="15" height="15"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 15l6-6 6 6"/></svg>
      </button>
      <div v-if="showTimes" class="fb__times">
        <div class="fb__time">
          <label class="fb__label">起飞时间</label>
          <div class="fb__datebox"><input v-model="form.depTime" type="time" /></div>
        </div>
        <div class="fb__time">
          <label class="fb__label">到达时间</label>
          <div class="fb__datebox"><input v-model="form.arrTime" type="time" /></div>
        </div>
        <HmField v-model="form.gate" label="登机口" placeholder="如 B12" />
      </div>
    </div>

    <!-- 在线模式提示 -->
    <p v-else-if="lookup" class="fb__online">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2 9 19.2 20 8.2l-1.4-1.4z"/></svg>
      已自动匹配起降机场、时刻、里程与巡航高度，只需补舱位与座位。
    </p>

    <!-- 个性化 -->
    <div v-if="lookup" class="fb__personal">
      <div class="fb__grid">
        <HmSelect v-model="form.cabin" label="舱位" title="选择舱位" :options="cabinOptions" />
        <HmField v-model="form.seat" label="座位号" placeholder="如 32A" />
      </div>
      <HmSelect v-model="form.windowSide" label="舷窗一侧（选填）" title="选择舷窗侧" :options="sideOptions" />
    </div>
  </div>
</template>

<style scoped>
.fb__mode { display: flex; gap: 0; margin-bottom: 12px; border-radius: var(--radius-full); background: var(--surface-2); padding: 3px; }
.fb__mode-btn {
  flex: 1; padding: 8px 0; border: none; border-radius: var(--radius-full);
  font-size: 13px; font-weight: 500; color: var(--text-2);
  background: transparent; cursor: pointer; transition: all var(--dur-micro) var(--ease-standard);
}
.fb__mode-btn.active { color: var(--surface-0); background: var(--accent); }
.fb__top { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: end; }
.fb__top > * { min-width: 0; }
.fb__no,
.fb__date { grid-column: 1 / -1; }
.fb__label { display: block; margin-bottom: 7px; font-size: var(--fs-cap); letter-spacing: 0.04em; color: var(--text-2); }
.fb__datebox {
  display: flex; align-items: center;
  min-height: 48px; padding: 0 14px;
  border-radius: var(--radius-md);
  background: var(--surface-2);
  border: 1px solid var(--line-default);
}
.fb__datebox:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }
.fb__datebox input { flex: 1; height: 46px; font-size: 15px; color: var(--text-1); background: transparent; border: none; outline: none; color-scheme: dark; }
.fb__submit {
  grid-column: 1 / -1;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 50px; border: none; border-radius: var(--radius-full);
  font-size: 15px; font-weight: 600; color: var(--surface-0);
  background: linear-gradient(180deg, var(--accent), var(--accent-press));
  cursor: pointer; transition: transform var(--dur-micro) var(--ease-standard), filter var(--dur-micro) var(--ease-standard);
}
@media (hover: hover) and (pointer: fine) {
  .fb__submit:hover { filter: brightness(1.06); }
}
.fb__submit:active { transform: scale(0.985); }
.fb__submit:disabled { opacity: 0.6; }
.fb__error { color: var(--danger); font-size: 13px; margin: 10px 0 0; }

.fb__local { margin-top: 16px; padding: 14px; border-radius: var(--radius-md); background: var(--surface-2); border: 1px solid var(--line-default); }
.fb__notice-box { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 14px; }
.fb__notice-icon { flex-shrink: 0; color: var(--accent); margin-top: 1px; }
.fb__notice { margin: 0; font-size: var(--fs-cap); line-height: 1.6; color: var(--text-2); }
.fb__airports { display: grid; gap: 12px; }
.fb__times-toggle {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; margin-top: 12px; padding: 10px 4px;
  border: none; background: transparent;
  font-size: 13px; color: var(--accent); cursor: pointer;
}
.fb__times { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-top: 8px; }
.fb__times .fb__time:last-of-type + * { grid-column: 1 / -1; }
.fb__times > :last-child { grid-column: 1 / -1; }

.fb__online {
  display: flex; align-items: center; gap: 8px;
  margin: 14px 0 0; font-size: var(--fs-cap); color: var(--success);
}
.fb__personal { margin-top: 16px; padding: 14px; border-radius: var(--radius-md); background: var(--surface-2); border: 1px solid var(--line-default); }
.fb__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 12px; }

.fb__results { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.fb__results-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 2px 6px; font-size: var(--fs-cap); color: var(--text-2);
}
.fb__results-hint { color: var(--text-3); }
.fb__result {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 12px 14px; border: 1px solid var(--line-default); border-radius: var(--radius-md);
  background: var(--surface-2); cursor: pointer;
  transition: border-color var(--dur-micro) var(--ease-standard), background var(--dur-micro) var(--ease-standard);
  text-align: left; color: var(--text-1);
}
.fb__result:hover { border-color: var(--accent); background: var(--interactive-hover); }
.fb__result:active { transform: scale(0.995); }
.fb__result-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.fb__result-logo {
  width: 32px; height: 32px; border-radius: 8px;
  object-fit: contain; background: #fff; padding: 3px; flex-shrink: 0;
}
.fb__result-logo--fallback {
  display: grid; place-items: center;
  background: linear-gradient(135deg, var(--accent), var(--accent-press));
  font-size: 14px; font-weight: 800; color: #fff;
}
.fb__result-info { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.fb__result-top { display: flex; align-items: center; gap: 8px; }
.fb__result-bottom { display: flex; align-items: center; gap: 6px; }
.fb__result-no { font-size: 14px; font-weight: 700; color: var(--accent); font-family: Arial, monospace; }
.fb__result-airline { font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fb__result-route { font-size: 12px; color: var(--text-3); }
.fb__result-tag {
  font-size: 10px; font-weight: 600; padding: 1px 6px;
  border-radius: 999px; color: var(--success);
  background: rgba(55, 195, 160, 0.12);
}
.fb__result-tag--warn { color: #e8b03a; background: rgba(232, 176, 58, 0.12); }
.fb__result-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
.fb__result-time { font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 500; color: var(--text-1); }
.fb__result-price { font-size: 14px; font-weight: 700; color: var(--success); }
.fb__searching { margin: 10px 0 0; font-size: var(--fs-cap); color: var(--accent); display: flex; align-items: center; gap: 6px; }
.fb__spin { animation: fb-spin 1s linear infinite; }
@keyframes fb-spin { to { transform: rotate(360deg); } }
.fb__local-error { margin: 10px 0 0; font-size: var(--fs-cap); color: var(--danger); line-height: 1.5; }

@media (prefers-reduced-motion: reduce) {
  .fb__submit {
    transition: none;
  }
}
</style>
