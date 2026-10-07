<script setup lang="ts">
/**
 * 自驾纪念票构建器（鸿蒙风格）：
 * 1) 输入起点 / 终点（可加途经点）→ 本地公路引擎规划，自动给出路牌编号、里程、驾驶时长；
 * 2) 个性化：路线名、天数、日期、车辆；
 * 3) 途经点 chips 可增删；路牌（国道/高速）可自由增删，自动识别制式；
 *    命中 318/109/217 等经典编号时票面自动出现黑金「此生必驾」盾牌。
 */
import { computed, reactive, ref, watch } from 'vue';
import type { RoadRoute } from '@railvista/shared';
import { api } from '../../api/client';
import { useTicketStore } from '../../stores/ticketStore';
import HmField from './hm/HmField.vue';

const store = useTicketStore();

const start = ref('');
const end = ref('');
const viaText = ref('');
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

const waypointDraft = ref('');
const shieldDraft = ref('');

const waypoints = computed(() => store.config.route.waypoints ?? []);
const shields = computed(() => store.config.route.shields ?? []);

async function plan() {
  error.value = '';
  if (!start.value.trim() || !end.value.trim()) {
    error.value = '请先输入起点与终点';
    return;
  }
  loading.value = true;
  try {
    const via = viaText.value
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await api.planDriveRoute({
      from: start.value.trim(),
      to: end.value.trim(),
      via: via.length ? via : undefined,
      engine: 'local',
    });
    route = res.route;
    store.applyDriveRoute(res.route, {
      routeName: meta.routeName,
      days: meta.days,
      dateText: meta.dateText,
      vehicle: meta.vehicle,
    });
    planned.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '规划失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

// meta 变化实时同步（规划后）
watch(
  meta,
  () => {
    if (!planned.value) return;
    store.setDriveMeta({
      days: meta.days,
      dateText: meta.dateText,
      vehicle: meta.vehicle,
    });
    store.patch({ subtitle: meta.routeName });
  },
  { deep: true },
);

function addWaypoint() {
  const v = waypointDraft.value.trim();
  if (!v) return;
  store.setDriveWaypoints([...waypoints.value, v]);
  waypointDraft.value = '';
}
function removeWaypoint(i: number) {
  const next = [...waypoints.value];
  next.splice(i, 1);
  store.setDriveWaypoints(next);
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
      <HmField v-model="viaText" label="途经点（选填）" placeholder="多个用逗号隔开，如 青海湖,茶卡,敦煌" />
      <button class="db__submit" type="submit" :disabled="loading">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zM7 13l4-4 1.5 1.5L11 12h5v2h-5l1.5 1.5L11 17z" opacity="0"/><path fill="currentColor" d="M5 11h11.2l-4.6-4.6L13 5l7 7-7 7-1.4-1.4 4.6-4.6H5z"/></svg>
        {{ loading ? '规划中…' : '规划路线' }}
      </button>
    </form>

    <p v-if="error" class="db__error">{{ error }}</p>

    <div v-if="planned" class="db__personal">
      <div class="db__grid">
        <HmField v-model="meta.routeName" label="路线名（选填）" placeholder="如 青甘环线" />
        <HmField v-model="meta.days" label="天数（选填）" placeholder="如 7天6晚" />
      </div>
      <div class="db__grid">
        <HmField v-model="meta.dateText" label="日期（选填）" placeholder="如 2026.08.01-08.07" />
        <HmField v-model="meta.vehicle" label="车辆（选填）" placeholder="如 坦克300" />
      </div>

      <!-- 途经点 -->
      <div class="db__section">
        <span class="db__section-label">途经点</span>
        <div class="db__chips">
          <span v-for="(w, i) in waypoints" :key="w + i" class="db__chip">
            {{ w }}
            <button type="button" @click="removeWaypoint(i)">×</button>
          </span>
        </div>
        <div class="db__add">
          <input v-model="waypointDraft" placeholder="加一个途经点" @keydown.enter.prevent="addWaypoint" />
          <button type="button" @click="addWaypoint">添加</button>
        </div>
      </div>

      <!-- 路牌 -->
      <div class="db__section">
        <span class="db__section-label">路牌（国道 / 高速）</span>
        <div class="db__chips">
          <span v-for="(s, i) in shields" :key="s + i" class="db__chip db__chip--road">
            {{ s }}
            <button type="button" @click="removeShield(i)">×</button>
          </span>
          <span v-if="!shields.length" class="db__hint">还没有路牌，手动加一个，如 G109、G318、G6</span>
        </div>
        <div class="db__add">
          <input v-model="shieldDraft" placeholder="如 G109 / G318 / G6" @keydown.enter.prevent="addShield" />
          <button type="button" @click="addShield">添加</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.db__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 12px; }
.db__submit {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; min-height: 50px;
  border: none; border-radius: 25px;
  font-size: 15px; font-weight: 600; color: #1c1810;
  background: linear-gradient(180deg, #e8cd92, #cba85c);
  cursor: pointer; transition: transform 0.15s, filter 0.15s;
}
.db__submit:hover { filter: brightness(1.06); }
.db__submit:active { transform: scale(0.985); }
.db__submit:disabled { opacity: 0.6; }
.db__error { color: #e06b6b; font-size: 13px; margin: 10px 0 0; }

.db__personal { margin-top: 16px; padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.07); }
.db__section { margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.06); }
.db__section-label { display: block; font-size: 12.5px; letter-spacing: 0.04em; color: rgba(255,255,255,0.55); margin-bottom: 9px; }
.db__chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 9px; }
.db__chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 8px 5px 11px;
  border-radius: 999px;
  font-size: 12.5px; color: rgba(255,255,255,0.85);
  background: rgba(255,255,255,0.08);
}
.db__chip--road { font-weight: 700; color: #d4a853; }
.db__chip button {
  display: flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; padding: 0;
  border: none; border-radius: 50%;
  font-size: 13px; line-height: 1; color: rgba(255,255,255,0.7);
  background: rgba(255,255,255,0.12); cursor: pointer;
}
.db__chip button:hover { background: rgba(224,107,107,0.5); color: #fff; }
.db__hint { font-size: 12px; color: rgba(255,255,255,0.35); }
.db__add { display: flex; gap: 8px; }
.db__add input {
  flex: 1; min-width: 0; height: 42px; padding: 0 13px;
  border-radius: 12px; font-size: 14px; color: #fff;
  background: rgba(255,255,255,0.055);
  border: 1px solid rgba(255,255,255,0.08); outline: none;
}
.db__add input:focus { border-color: rgba(212,168,83,0.55); }
.db__add button {
  height: 42px; padding: 0 18px;
  border: none; border-radius: 12px;
  font-size: 13.5px; font-weight: 600; color: #1c1810;
  background: linear-gradient(180deg, #e8cd92, #cba85c); cursor: pointer;
}
</style>
