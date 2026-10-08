<script setup lang="ts">
/**
 * 铁路个性化（选完车次后展示）：
 * 席别滚轮选择；车厢号、座位号；硬卧/软卧选铺位；里程选填；风景侧开关；一句感言。
 * 任意修改实时联动票面。
 */
import { reactive, watch } from 'vue';
import { useTicketStore } from '../../stores/ticketStore';
import HmField from './hm/HmField.vue';
import HmSelect from './hm/HmSelect.vue';
import HmSwitch from './hm/HmSwitch.vue';
import type { WheelOption } from './hm/HmWheel.vue';

const store = useTicketStore();

interface SeatClassDef { value: string; berths?: string[]; noSeat?: boolean }
const SEAT_CLASSES: SeatClassDef[] = [
  { value: '二等座' },
  { value: '一等座' },
  { value: '商务座' },
  { value: '特等座' },
  { value: '硬座' },
  { value: '软座' },
  { value: '无座', noSeat: true },
  { value: '硬卧', berths: ['上铺', '中铺', '下铺'] },
  { value: '软卧', berths: ['上铺', '下铺'] },
];

const classOptions: WheelOption[] = SEAT_CLASSES.map((c) => ({ label: c.value, value: c.value }));
const berthOptions = (b: string[]): WheelOption[] =>
  [({ label: '不选', value: '' })].concat(b.map((x) => ({ label: x, value: x })));

const form = reactive({
  seatClass: '二等座',
  carNo: '',
  seatNo: '',
  berth: '',
  mileage: '' as string | number,
  scenicSide: false,
  quote: '',
});

const currentDef = () => SEAT_CLASSES.find((c) => c.value === form.seatClass);
const isBerth = () => (currentDef()?.berths?.length ?? 0) > 0;
const noSeat = () => currentDef()?.noSeat ?? false;

let t: ReturnType<typeof setTimeout> | undefined;
watch(
  form,
  () => {
    clearTimeout(t);
    t = setTimeout(() => {
      store.setRailPersonalize({
        seatClass: form.seatClass,
        carNo: form.carNo,
        seatNo: noSeat() ? '' : form.seatNo,
        berth: isBerth() ? form.berth : undefined,
        mileage: form.mileage === '' ? null : Number(form.mileage),
        quote: form.quote,
        scenicSide: form.scenicSide,
      });
    }, 180);
  },
  { deep: true },
);

// 切换席别时重置不适用的字段
watch(
  () => form.seatClass,
  () => {
    if (!isBerth()) form.berth = '';
    if (noSeat()) form.seatNo = '';
  },
);
</script>

<template>
  <div class="rp-card">
    <div class="rp-card__head">
      <span class="rp-card__dot" />
      <span>个性化你的车票</span>
      <span class="rp-card__tip">仅这几项需要你补</span>
    </div>

    <div class="rp-card__grid">
      <HmSelect v-model="form.seatClass" label="席别" title="选择席别" :options="classOptions" />
      <HmField v-model="form.carNo" label="车厢号" placeholder="如 07" inputmode="numeric" suffix="车" />
      <HmField
        v-if="!noSeat()"
        v-model="form.seatNo"
        label="座位号"
        :placeholder="isBerth() ? '如 15' : '如 12A'"
        :inputmode="isBerth() ? 'numeric' : 'text'"
        suffix="号"
      />
      <HmSelect
        v-if="isBerth()"
        v-model="form.berth"
        label="铺位"
        title="选择铺位"
        :options="berthOptions(currentDef()!.berths!)"
      />
    </div>

    <HmField
      v-model="form.mileage"
      label="里程（选填，系统已按直线预填，可改实际）"
      placeholder="如 1972"
      inputmode="numeric"
      suffix="km"
    />

    <div class="rp-card__switch">
      <HmSwitch v-model="form.scenicSide" label="风景侧座位" desc="靠风景一侧，如青藏线看雪山" />
    </div>

    <HmField v-model="form.quote" label="一句感言（选填）" placeholder="如 在可可西里看到了藏羚羊" />
  </div>
</template>

<style scoped>
.rp-card {
  margin-top: 16px;
  padding: 16px;
  border-radius: 20px;
  background: rgba(255,255,255,0.035);
  border: 1px solid rgba(255,255,255,0.07);
}
.rp-card__head {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.9);
  margin-bottom: 14px;
}
.rp-card__dot { width: 8px; height: 8px; border-radius: 50%; background: #d4a853; box-shadow: 0 0 8px rgba(212,168,83,0.7); }
.rp-card__tip { margin-left: auto; font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.35); }
.rp-card__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 12px; }
.rp-card__switch { padding: 10px 0 14px; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 14px; }
</style>
