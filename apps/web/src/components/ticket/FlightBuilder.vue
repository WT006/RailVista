<script setup lang="ts">
/**
 * 飞行纪念票构建器（鸿蒙风格）：
 * 航班号 + 日期查询：
 *  - 在线服务可用：起降机场（含英文名）、时刻、登机口、时长/里程/巡航高度全自动；
 *  - 未配置：补选起降机场（机场英文名/里程/巡航高度仍自动匹配），时刻选填。
 * 用户只需：舱位（滚轮选择）、座位号、舷窗侧（选）。
 */
import { computed, reactive, ref, watch } from 'vue';
import { CABIN_CLASSES, type FlightLookup } from '@railvista/shared';
import { api } from '../../api/client';
import { useTicketStore } from '../../stores/ticketStore';
import HmField from './hm/HmField.vue';
import HmSelect from './hm/HmSelect.vue';
import AirportField from './AirportField.vue';
import type { WheelOption } from './hm/HmWheel.vue';

const store = useTicketStore();

const flightNo = ref('');
const date = ref(new Date().toISOString().slice(0, 10));
const loading = ref(false);
const error = ref('');
const lookup = ref<FlightLookup | null>(null);
const showTimes = ref(false);

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
    if (res.source === 'airlabs') {
      form.depIata = '';
      form.arrIata = '';
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '查询失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

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
    <form class="fb__top" @submit.prevent="query">
      <div class="fb__no">
        <HmField v-model="flightNo" label="航班号" placeholder="如 CZ3467" hint="两位航司代码 + 数字，如 CA4401、3U8633" />
      </div>
      <div class="fb__date">
        <label class="fb__label">出发日期</label>
        <div class="fb__datebox"><input v-model="date" type="date" /></div>
      </div>
      <button class="fb__submit" type="submit" :disabled="loading">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M21 15.4v-2l-8-5V3.5a1.5 1.5 0 00-3 0V8.4l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-6.1z"/></svg>
        {{ loading ? '查询中…' : '查询航班' }}
      </button>
    </form>

    <p v-if="error" class="fb__error">{{ error }}</p>

    <!-- 本地模式：补选机场 -->
    <div v-if="isLocal" class="fb__local">
      <p class="fb__notice">{{ lookup?.note }}</p>
      <div class="fb__airports">
        <AirportField v-model="form.depIata" label="出发机场" placeholder="如 广州白云" />
        <AirportField v-model="form.arrIata" label="到达机场" placeholder="如 拉萨贡嘎" />
      </div>
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
.fb__top { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: end; }
.fb__no { grid-column: 1 / -1; }
.fb__label { display: block; margin-bottom: 7px; font-size: 12.5px; letter-spacing: 0.04em; color: rgba(255,255,255,0.55); }
.fb__datebox {
  display: flex; align-items: center;
  min-height: 48px; padding: 0 14px;
  border-radius: 15px;
  background: rgba(255,255,255,0.055);
  border: 1px solid rgba(255,255,255,0.08);
}
.fb__datebox:focus-within { border-color: rgba(212,168,83,0.55); box-shadow: 0 0 0 3px rgba(212,168,83,0.12); }
.fb__datebox input { flex: 1; height: 46px; font-size: 15px; color: #fff; background: transparent; border: none; outline: none; color-scheme: dark; }
.fb__submit {
  grid-column: 1 / -1;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 50px; border: none; border-radius: 25px;
  font-size: 15px; font-weight: 600; color: #1c1810;
  background: linear-gradient(180deg, #e8cd92, #cba85c);
  cursor: pointer; transition: transform 0.15s, filter 0.15s;
}
.fb__submit:hover { filter: brightness(1.06); }
.fb__submit:active { transform: scale(0.985); }
.fb__submit:disabled { opacity: 0.6; }
.fb__error { color: #e06b6b; font-size: 13px; margin: 10px 0 0; }

.fb__local { margin-top: 16px; padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.07); }
.fb__notice { margin: 0 0 12px; font-size: 12.5px; line-height: 1.6; color: rgba(255,255,255,0.6); }
.fb__airports { display: grid; gap: 12px; }
.fb__times-toggle {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; margin-top: 12px; padding: 10px 4px;
  border: none; background: transparent;
  font-size: 13px; color: rgba(212,168,83,0.85); cursor: pointer;
}
.fb__times { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-top: 8px; }
.fb__times .fb__time:last-of-type + * { grid-column: 1 / -1; }
.fb__times > :last-child { grid-column: 1 / -1; }

.fb__online {
  display: flex; align-items: center; gap: 8px;
  margin: 14px 0 0; font-size: 12.5px; color: rgba(120,200,150,0.9);
}
.fb__personal { margin-top: 16px; padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.07); }
.fb__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 12px; }
</style>
