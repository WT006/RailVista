<script setup lang="ts">
/**
 * 自驾纪念票构建器（鸿蒙风格）：
 * 1) 起点 / 终点 + 途经点 chips（自由文案）+ 路牌；
 * 2) 路线名 / 天数 / 日期 / 车辆；
 * 3) 点「规划路线」→ 本地公路引擎规划，写入纪念票（途经能定位才绕行，定位不到不报错）。
 */
import { computed, reactive, ref, watch } from 'vue';
import type { RoadRoute } from '@railvista/shared';
import { api } from '../../api/client';
import { useTicketStore } from '../../stores/ticketStore';
import HmField from './hm/HmField.vue';

const store = useTicketStore();

const start = ref('');
const end = ref('');
const loading = ref(false);
const error = ref('');
const planned = ref(false);
let route: RoadRoute | null = null;

const meta = reactive({
  routeName: '',
  days: '',
  dateText: '',
  vehicle: '',
});

/** 途经点本地草稿（规划前也可编辑；规划时写入票面） */
const viaList = ref<string[]>([]);
const waypointDraft = ref('');
const shieldDraft = ref('');

const waypoints = computed(() => store.config.route.waypoints ?? []);
const shields = computed(() => store.config.route.shields ?? []);

/** 展示用途经链：规划后跟 store，规划前用本地草稿 */
const viaDisplay = computed(() => (planned.value ? waypoints.value : viaList.value));

function buildWaypoints(from: string, to: string, via: string[]): string[] {
  const chain = [from, ...via, to].map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of chain) {
    if (out[out.length - 1] !== p) out.push(p);
  }
  return out;
}

async function plan() {
  error.value = '';
  if (!start.value.trim() || !end.value.trim()) {
    error.value = '请先输入起点与终点';
    return;
  }
  loading.value = true;
  try {
    const from = start.value.trim();
    const to = end.value.trim();
    const via = viaList.value.map((s) => s.trim()).filter(Boolean);
    const res = await api.planDriveRoute({
      from,
      to,
      via: via.length ? via : undefined,
      engine: 'local',
    });
    route = res.route;
    store.applyDriveRoute(res.route, {
      routeName: meta.routeName.trim() || undefined,
      days: meta.days.trim() || undefined,
      dateText: meta.dateText.trim() || undefined,
      vehicle: meta.vehicle.trim() || undefined,
      waypoints: buildWaypoints(from, to, via),
    });
    // 同步草稿：起终点也会进途经链
    viaList.value = [...(store.config.route.waypoints ?? [])];
    planned.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '规划失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

watch(
  meta,
  () => {
    if (!planned.value) return;
    store.setDriveMeta({
      routeName: meta.routeName,
      days: meta.days,
      dateText: meta.dateText,
      vehicle: meta.vehicle,
    });
  },
  { deep: true },
);

function addWaypoint() {
  const v = waypointDraft.value.trim();
  if (!v) return;
  if (planned.value) {
    store.setDriveWaypoints([...waypoints.value, v]);
    viaList.value = [...(store.config.route.waypoints ?? [])];
  } else {
    viaList.value = [...viaList.value, v];
  }
  waypointDraft.value = '';
}
function removeWaypoint(i: number) {
  if (planned.value) {
    const next = [...waypoints.value];
    next.splice(i, 1);
    store.setDriveWaypoints(next);
    viaList.value = [...next];
  } else {
    const next = [...viaList.value];
    next.splice(i, 1);
    viaList.value = next;
  }
}
function addShield() {
  const v = shieldDraft.value.trim();
  if (!v) return;
  store.addShield(v);
  shieldDraft.value = '';
}
function removeShield(i: number) {
  store.removeShield(i);
}
</script>

<template>
  <div class="db">
    <form class="db__top" @submit.prevent="plan">
      <div class="db__grid">
        <HmField v-model="start" label="起点" placeholder="如 西宁" />
        <HmField v-model="end" label="终点" placeholder="如 拉萨" />
      </div>

      <!-- 途经点 chips 取代逗号输入；路牌一并放上面 -->
      <div class="db__block">
        <div class="db__section is-first">
          <span class="db__section-label">途经点</span>
          <div class="db__chips">
            <span v-for="(w, i) in viaDisplay" :key="w + i" class="db__chip">
              {{ w }}
              <button type="button" @click="removeWaypoint(i)">×</button>
            </span>
          </div>
          <div class="db__add">
            <input
              v-model="waypointDraft"
              placeholder="填写城市或景点"
              @keydown.enter.prevent="addWaypoint"
            />
            <button type="button" @click="addWaypoint">添加</button>
          </div>
        </div>

        <div class="db__section">
          <span class="db__section-label">路牌（国道 / 高速）</span>
          <div class="db__chips">
            <span v-for="(s, i) in shields" :key="s + i" class="db__chip db__chip--road">
              {{ s }}
              <button type="button" @click="removeShield(i)">×</button>
            </span>
            <span v-if="!shields.length" class="db__hint">如 G109、G318</span>
          </div>
          <div class="db__add">
            <input
              v-model="shieldDraft"
              placeholder="如 G109"
              @keydown.enter.prevent="addShield"
            />
            <button type="button" @click="addShield">添加</button>
          </div>
        </div>
      </div>

      <div class="db__personal">
        <div class="db__grid">
          <HmField v-model="meta.routeName" label="路线名（选填）" placeholder="如 青甘环线" />
          <HmField v-model="meta.days" label="天数（选填）" placeholder="如 7天6晚" />
        </div>
        <div class="db__grid">
          <HmField v-model="meta.dateText" label="日期（选填）" placeholder="如 2026.08.01-08.07" />
          <HmField v-model="meta.vehicle" label="车辆（选填）" placeholder="如 坦克300" />
        </div>
      </div>

      <button class="db__submit" type="submit" :disabled="loading">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zM7 13l4-4 1.5 1.5L11 12h5v2h-5l1.5 1.5L11 17z" opacity="0"/><path fill="currentColor" d="M5 11h11.2l-4.6-4.6L13 5l7 7-7 7-1.4-1.4 4.6-4.6H5z"/></svg>
        {{ loading ? '规划中…' : '规划路线' }}
      </button>
    </form>

    <p v-if="error" class="db__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.db__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 12px; }
.db__submit {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; min-height: 50px;
  border: none; border-radius: var(--radius-full);
  font-size: 15px; font-weight: 600; color: var(--surface-0);
  background: linear-gradient(180deg, var(--accent), var(--accent-press));
  cursor: pointer; transition: transform var(--dur-micro) var(--ease-standard), filter var(--dur-micro) var(--ease-standard);
}
@media (hover: hover) and (pointer: fine) {
  .db__submit:hover { filter: brightness(1.06); }
}
.db__submit:active { transform: scale(0.985); }
.db__submit:disabled { opacity: 0.6; }
.db__error { color: var(--danger); font-size: 13px; margin: 10px 0 0; }

.db__block,
.db__personal {
  margin: 0 0 14px; padding: 14px;
  border-radius: var(--radius-md);
  background: var(--surface-2);
  border: 1px solid var(--line-default);
}
.db__personal .db__grid:last-child { margin-bottom: 0; }

.db__section { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line-default); }
.db__section.is-first { margin-top: 0; padding-top: 0; border-top: none; }
.db__section-label { display: block; font-size: var(--fs-cap); letter-spacing: 0.04em; color: var(--text-2); margin-bottom: 9px; }
.db__chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 9px; min-height: 0; }
.db__chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 8px 5px 11px;
  border-radius: var(--radius-full);
  font-size: var(--fs-cap); color: var(--text-1);
  background: var(--interactive-hover);
}
.db__chip--road { font-weight: 700; color: var(--ticket-gold); }
.db__chip button {
  display: flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; padding: 0;
  border: none; border-radius: 50%;
  font-size: 13px; line-height: 1; color: var(--text-2);
  background: var(--interactive-pressed); cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .db__chip button:hover { background: color-mix(in srgb, var(--danger) 50%, transparent); color: var(--text-1); }
}
.db__hint { font-size: 12px; color: var(--text-3); }
.db__add { display: flex; gap: 8px; }
.db__add input {
  flex: 1; min-width: 0; height: 42px; padding: 0 13px;
  border-radius: var(--radius-md); font-size: 14px; color: var(--text-1);
  background: var(--surface-2);
  border: 1px solid var(--line-default); outline: none;
}
.db__add input:focus { border-color: var(--accent); }
.db__add button {
  height: 42px; padding: 0 18px;
  border: none; border-radius: var(--radius-md);
  font-size: var(--fs-meta); font-weight: 600; color: var(--surface-0);
  background: linear-gradient(180deg, var(--accent), var(--accent-press)); cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  .db__submit {
    transition: none;
  }
}
</style>
