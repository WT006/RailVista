<script setup lang="ts">
/**
 * 中国旅行足迹地图
 * - 市级/省级两种点亮模式
 * - 城市选择后自动归属省份
 * - 金色暗色纪念主题 + 涟漪动画
 * - 支持 PNG 截图与 WebM 视频录制
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import * as echarts from 'echarts/core';
import {
  EffectScatterChart,
  MapChart,
  ScatterChart,
} from 'echarts/charts';
import {
  GeoComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { toPng } from 'html-to-image';
import type { ECharts, EChartsCoreOption } from 'echarts/core';

echarts.use([
  MapChart,
  EffectScatterChart,
  ScatterChart,
  GeoComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface CityCoord {
  name: string;
  adcode: number;
  lng: number;
  lat: number;
  province: string;
}

interface GeoJsonFeature {
  properties: {
    name: string;
    adcode: number | string;
    center?: number[];
  };
}

const STORAGE_KEY = 'rv-footprint-cities';

const chartRef = ref<HTMLDivElement | null>(null);
const wrapRef = ref<HTMLDivElement | null>(null);
let chart: ECharts | null = null;

const allCities = ref<CityCoord[]>([]);
const provinceNames = ref<string[]>([]);
const selected = ref<string[]>([]);
const mode = ref<'city' | 'province'>('city');
const query = ref('');
const suggestOpen = ref(false);
const recording = ref(false);
const recordedUrl = ref<string | null>(null);

const uniqueProvinces = computed(() => {
  const set = new Set(allCities.value.map((c) => c.province).filter(Boolean));
  return Array.from(set).sort();
});

const litProvinces = computed(() => {
  const set = new Set<string>();
  for (const city of selected.value) {
    const info = cityMap.value.get(city);
    if (info?.province) set.add(info.province);
  }
  return Array.from(set);
});

const cityMap = computed(() => {
  const map = new Map<string, CityCoord>();
  for (const c of allCities.value) map.set(c.name, c);
  return map;
});

const filteredSuggest = computed(() => {
  const q = query.value.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const picked = new Set(selected.value);
  return allCities.value
    .filter(
      (c) =>
        !picked.has(c.name) &&
        (c.name.includes(q) ||
          c.name.toLowerCase().includes(lower) ||
          c.province.includes(q)),
    )
    .slice(0, 24);
});

const totalCities = computed(() => allCities.value.length);
const totalProvinces = computed(() => uniqueProvinces.value.length);
const cityPercent = computed(() =>
  totalCities.value
    ? Math.round((selected.value.length / totalCities.value) * 100)
    : 0,
);
const provincePercent = computed(() =>
  totalProvinces.value
    ? Math.round((litProvinces.value.length / totalProvinces.value) * 100)
    : 0,
);

const orderedCities = computed(() => {
  const map = cityMap.value;
  return selected.value
    .map((name) => map.get(name))
    .filter((c): c is CityCoord => !!c)
    .sort((a, b) => a.province.localeCompare(b.province) || a.name.localeCompare(b.name));
});

const goldBase = '#f59e0b';
const goldGlow = '#fbbf24';
const bgBase = '#070a10';
const landBase = '#131b2a';
const landDim = '#0e1420';
const borderColor = '#1f2d44';

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) selected.value = JSON.parse(raw);
  } catch {
    selected.value = [];
  }
}

function saveStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selected.value));
}

function addCity(name: string) {
  if (!cityMap.value.has(name)) return;
  if (selected.value.includes(name)) return;
  selected.value.push(name);
  query.value = '';
  suggestOpen.value = false;
  saveStorage();
  refreshChart();
}

function removeCity(name: string) {
  selected.value = selected.value.filter((n) => n !== name);
  saveStorage();
  refreshChart();
}

function clearAll() {
  selected.value = [];
  saveStorage();
  refreshChart();
}

function toggleMode(m: 'city' | 'province') {
  if (mode.value === m) return;
  mode.value = m;
  refreshChart();
}

function provinceMapData(): { name: string; value: number; selected?: boolean }[] {
  return provinceNames.value.map((name) => {
    const lit = litProvinces.value.includes(name);
    return { name, value: lit ? 1 : 0, selected: lit };
  });
}

function cityScatterData(): { name: string; value: [number, number, number] }[] {
  const data: { name: string; value: [number, number, number] }[] = [];
  for (const name of selected.value) {
    const c = cityMap.value.get(name);
    if (!c) continue;
    data.push({ name, value: [c.lng, c.lat, 1] });
  }
  return data;
}

function buildOption(): EChartsCoreOption {
  const isProv = mode.value === 'province';
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(11,16,26,0.92)',
      borderColor: borderColor,
      textStyle: { color: '#e5e7eb' },
      formatter: (params: any) => {
        if (params.seriesType === 'map') {
          const lit = litProvinces.value.includes(params.name);
          return `<div style="font-weight:600">${params.name}</div>` +
            `<div style="font-size:12px;color:#9ca3af">${lit ? '已点亮' : '未到访'}</div>`;
        }
        return `<div style="font-weight:600;color:${goldGlow}">${params.name}</div>`;
      },
    },
    geo: {
      map: 'china',
      roam: true,
      zoom: 1.15,
      center: [105, 36],
      itemStyle: {
        areaColor: landDim,
        borderColor: borderColor,
        borderWidth: 1,
        shadowColor: 'rgba(0,0,0,0.45)',
        shadowBlur: 18,
        shadowOffsetY: 8,
      },
      emphasis: {
        disabled: isProv,
        itemStyle: {
          areaColor: '#1c2840',
          borderColor: '#3b5173',
        },
        label: { show: false },
      },
      select: {
        disabled: true,
      },
      silent: isProv,
    },
    series: [
      {
        name: '省份',
        type: 'map',
        map: 'china',
        geoIndex: 0,
        data: provinceMapData(),
        emphasis: {
          disabled: true,
        },
        select: {
          disabled: true,
        },
        itemStyle: isProv
          ? {
              areaColor: landDim,
              borderColor,
              borderWidth: 1,
            }
          : {
              areaColor: landDim,
              borderColor,
              borderWidth: 1,
            },
      },
      {
        name: '点亮城市',
        type: 'effectScatter',
        coordinateSystem: 'geo',
        data: cityScatterData(),
        symbolSize: isProv ? 8 : 14,
        showEffectOn: 'render',
        rippleEffect: {
          brushType: 'stroke',
          scale: isProv ? 2 : 3.5,
          period: 3.5,
        },
        itemStyle: {
          color: goldBase,
          shadowBlur: 12,
          shadowColor: goldGlow,
        },
        emphasis: {
          scale: 1.6,
          itemStyle: { color: '#fff' },
        },
        label: {
          show: !isProv && selected.value.length <= 35,
          formatter: '{b}',
          position: 'right',
          color: '#fde68a',
          fontSize: 10,
          textBorderColor: '#000',
          textBorderWidth: 2,
        },
        zlevel: 2,
      },
    ],
  };
}

function refreshChart() {
  if (!chart) return;
  const opt = buildOption();
  chart.setOption(opt, true);
  // 省级模式下高亮已点亮省份
  if (mode.value === 'province') {
    chart.dispatchAction({ type: 'downplay' });
    for (const name of litProvinces.value) {
      chart.dispatchAction({ type: 'highlight', name });
    }
  } else {
    chart.dispatchAction({ type: 'downplay' });
  }
}

async function initChart() {
  if (!chartRef.value) return;
  const [geoRes, cityRes] = await Promise.all([
    fetch('/geo/china-provinces.json'),
    fetch('/geo/city-coords.json'),
  ]);
  const geoJson = await geoRes.json();
  const cities = await cityRes.json();
  echarts.registerMap('china', geoJson);
  allCities.value = cities;
  provinceNames.value = (geoJson.features as GeoJsonFeature[])
    .map((f) => f.properties.name)
    .filter(Boolean)
    .sort();
  loadStorage();

  chart = echarts.init(chartRef.value, undefined, { renderer: 'canvas' });
  chart.setOption(buildOption());
  chart.on('click', (params: any) => {
    if (params.componentType === 'series' && params.seriesType === 'map') {
      // 点击省份：在省级模式下无额外操作；城市模式下可提示
    }
  });
  window.addEventListener('resize', handleResize);
}

function handleResize() {
  chart?.resize();
}

async function exportPng() {
  if (!wrapRef.value) return;
  const dataUrl = await toPng(wrapRef.value, {
    pixelRatio: 2,
    backgroundColor: bgBase,
  });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `我的中国足迹_${new Date().toLocaleDateString()}.png`;
  a.click();
}

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordTimer: number | undefined;
let replayTimer: number | undefined;
const recordReplaySaved = ref<string[]>([]);

async function startRecord() {
  if (!chart || recording.value) return;
  const canvas = chart.getDom().querySelector('canvas');
  if (!canvas) return;
  recordedChunks = [];
  const stream = (canvas as HTMLCanvasElement).captureStream(30);
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 6_000_000,
  });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    recordedUrl.value = URL.createObjectURL(blob);
  };

  recording.value = true;
  recordedUrl.value = null;
  recordReplaySaved.value = [...selected.value];
  mediaRecorder.start();

  // 录制时播放一段「逐个点亮」动画：先把已选清空再逐步恢复
  selected.value = [];
  refreshChart();
  let i = 0;
  replayTimer = window.setInterval(() => {
    if (i >= recordReplaySaved.value.length) {
      window.clearInterval(replayTimer);
      return;
    }
    selected.value = recordReplaySaved.value.slice(0, i + 1);
    refreshChart();
    i++;
  }, 260);

  recordTimer = window.setTimeout(() => {
    stopRecord();
  }, 9000);
}

function stopRecord() {
  window.clearTimeout(recordTimer);
  window.clearInterval(replayTimer);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  // 确保录制中断时也能恢复到完整选择
  if (recordReplaySaved.value.length) {
    selected.value = recordReplaySaved.value;
    recordReplaySaved.value = [];
  }
  recording.value = false;
}

function downloadVideo() {
  if (!recordedUrl.value) return;
  const a = document.createElement('a');
  a.href = recordedUrl.value;
  a.download = `我的中国足迹_${new Date().toLocaleDateString()}.webm`;
  a.click();
}

function onInputBlur() {
  // 延迟收起，方便点击建议项
  window.setTimeout(() => {
    suggestOpen.value = false;
  }, 180);
}

watch(mode, refreshChart);
watch(selected, refreshChart, { deep: true });

onMounted(() => {
  void initChart();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  window.clearTimeout(recordTimer);
  window.clearInterval(replayTimer);
  stopRecord();
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div ref="wrapRef" class="footprint-wrap">
    <div class="footprint-header">
      <div class="footprint-title">
        <h2>我的中国足迹</h2>
        <p>点亮去过的城市，看看中国被点亮了多少</p>
      </div>
      <div class="footprint-mode">
        <button
          type="button"
          class="mode-btn"
          :class="{ active: mode === 'city' }"
          @click="toggleMode('city')"
        >
          按市点亮
        </button>
        <button
          type="button"
          class="mode-btn"
          :class="{ active: mode === 'province' }"
          @click="toggleMode('province')"
        >
          按省点亮
        </button>
      </div>
    </div>

    <div class="footprint-stats">
      <div class="stat-card">
        <span class="stat-num">{{ selected.length }}</span>
        <span class="stat-label">点亮城市</span>
        <div class="stat-bar"><div class="stat-fill" :style="{ width: cityPercent + '%' }" /></div>
        <span class="stat-cap">/{{ totalCities }} · {{ cityPercent }}%</span>
      </div>
      <div class="stat-card">
        <span class="stat-num">{{ litProvinces.length }}</span>
        <span class="stat-label">点亮省份</span>
        <div class="stat-bar"><div class="stat-fill" :style="{ width: provincePercent + '%' }" /></div>
        <span class="stat-cap">/{{ totalProvinces }} · {{ provincePercent }}%</span>
      </div>
    </div>

    <div class="footprint-body">
      <div class="footprint-map" :class="{ recording }">
        <div ref="chartRef" class="footprint-chart" />
        <div v-if="recording" class="record-badge">● 录制中</div>
      </div>

      <div class="footprint-side">
        <div class="city-search" :class="{ 'is-suggest-open': suggestOpen }">
          <input
            v-model="query"
            type="text"
            placeholder="搜索城市 / 省份"
            class="city-input"
            @focus="suggestOpen = query.trim().length > 0"
            @blur="onInputBlur"
            @input="suggestOpen = query.trim().length > 0"
            @keydown.enter.prevent="filteredSuggest[0] && addCity(filteredSuggest[0].name)"
          />
          <ul v-if="suggestOpen && filteredSuggest.length" class="city-suggest">
            <li
              v-for="c in filteredSuggest"
              :key="c.adcode"
              @click="addCity(c.name)"
            >
              <span class="suggest-name">{{ c.name }}</span>
              <span class="suggest-province">{{ c.province }}</span>
            </li>
          </ul>
          <p v-else-if="suggestOpen && query.trim()" class="city-empty">未找到匹配城市</p>
        </div>

        <div class="city-list">
          <div class="city-list__head">
            <span>已选 {{ selected.length }}</span>
            <button type="button" class="link-btn" @click="clearAll">清空</button>
          </div>
          <div v-if="orderedCities.length" class="city-tags">
            <span
              v-for="c in orderedCities"
              :key="c.adcode"
              class="city-tag"
              :title="c.province"
            >
              {{ c.name }}
              <button type="button" class="city-tag__x" @click="removeCity(c.name)">×</button>
            </span>
          </div>
          <p v-else class="city-empty">还没有点亮城市，搜索添加吧</p>
        </div>

        <div class="footprint-actions">
          <button type="button" class="btn primary" @click="exportPng">保存图片</button>
          <button
            type="button"
            class="btn primary"
            :disabled="recording"
            @click="startRecord"
          >
            {{ recording ? '录制中…' : '生成动画视频' }}
          </button>
        </div>

        <div v-if="recordedUrl" class="record-preview">
          <video :src="recordedUrl" controls class="record-video" />
          <button type="button" class="btn primary" @click="downloadVideo">下载视频</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.footprint-wrap {
  --footprint-bg: #070a10;
  --footprint-card: #0f1520;
  --footprint-gold: #f59e0b;
  --footprint-gold-light: #fbbf24;
  background: var(--footprint-bg);
  color: #e5e7eb;
  border-radius: var(--radius-lg, 16px);
  padding: var(--space-3, 16px);
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 16px);
}

.footprint-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-2, 12px);
  flex-wrap: wrap;
}

.footprint-title h2 {
  margin: 0;
  font-size: var(--fs-h2, 22px);
  font-weight: 700;
  color: #fff;
}
.footprint-title p {
  margin: 4px 0 0;
  font-size: var(--fs-meta, 13px);
  color: #9ca3af;
}

.footprint-mode {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  background: #161f2e;
  border-radius: var(--radius-full, 999px);
}

.mode-btn {
  padding: 7px 14px;
  border: none;
  border-radius: var(--radius-full, 999px);
  background: transparent;
  color: #9ca3af;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s ease;
}
.mode-btn.active {
  background: linear-gradient(135deg, var(--footprint-gold), #d97706);
  color: #0f0f0f;
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.28);
}

.footprint-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-2, 12px);
}

.stat-card {
  background: var(--footprint-card);
  border: 1px solid #1f2d44;
  border-radius: var(--radius-md, 12px);
  padding: var(--space-2, 12px);
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: var(--space-2, 12px);
  row-gap: 4px;
  align-items: center;
}

.stat-num {
  grid-row: 1 / 3;
  font-size: 38px;
  font-weight: 800;
  background: linear-gradient(180deg, var(--footprint-gold-light), var(--footprint-gold));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  line-height: 1;
}

.stat-label {
  font-size: 13px;
  color: #9ca3af;
  font-weight: 600;
}

.stat-bar {
  grid-column: 2;
  height: 4px;
  background: #1f2d44;
  border-radius: 2px;
  overflow: hidden;
}

.stat-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--footprint-gold), var(--footprint-gold-light));
  border-radius: 2px;
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

.stat-cap {
  grid-column: 2;
  font-size: 11px;
  color: #6b7280;
}

.footprint-body {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: var(--space-3, 16px);
  min-height: 520px;
}

.footprint-map {
  position: relative;
  background: radial-gradient(circle at 50% 40%, #111b2d 0%, #070a10 70%);
  border: 1px solid #1f2d44;
  border-radius: var(--radius-md, 12px);
  overflow: hidden;
}

.footprint-chart {
  width: 100%;
  height: 100%;
  min-height: 520px;
}

.record-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(185, 28, 28, 0.9);
  color: #fff;
  border-radius: var(--radius-full, 999px);
  font-size: 12px;
  font-weight: 700;
  animation: pulse 1.2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.footprint-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 12px);
}

.city-search {
  position: relative;
}

.city-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #1f2d44;
  border-radius: var(--radius-md, 12px);
  background: #111827;
  color: #e5e7eb;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.city-input:focus {
  border-color: var(--footprint-gold);
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
}

.city-suggest {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 60;
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 6px;
  list-style: none;
  background: #111827;
  border: 1px solid #1f2d44;
  border-radius: var(--radius-md, 12px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
}

.city-suggest li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm, 8px);
  cursor: pointer;
  transition: background 0.15s;
}
.city-suggest li:hover {
  background: #1f2937;
}

.suggest-name {
  font-size: 14px;
  color: #f3f4f6;
}
.suggest-province {
  font-size: 11px;
  color: #9ca3af;
}

.city-empty {
  margin: 8px 0 0;
  font-size: 13px;
  color: #6b7280;
  text-align: center;
}

.city-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--footprint-card);
  border: 1px solid #1f2d44;
  border-radius: var(--radius-md, 12px);
  padding: var(--space-2, 12px);
}

.city-list__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-size: 13px;
  color: #9ca3af;
}

.link-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--footprint-gold-light);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.link-btn:hover {
  text-decoration: underline;
}

.city-tags {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 8px;
}

.city-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(217, 119, 6, 0.1));
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--radius-full, 999px);
  font-size: 12px;
  color: #fde68a;
}

.city-tag__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  margin-left: 2px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #fde68a;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.city-tag__x:hover {
  background: rgba(255, 255, 255, 0.2);
}

.footprint-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.footprint-actions .btn {
  justify-content: center;
}

.record-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.record-video {
  width: 100%;
  border-radius: var(--radius-sm, 8px);
  border: 1px solid #1f2d44;
}

@media (max-width: 920px) {
  .footprint-body {
    grid-template-columns: 1fr;
  }
  .footprint-chart {
    min-height: 360px;
  }
  .footprint-side {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .city-search,
  .city-list,
  .footprint-actions,
  .record-preview {
    flex: 1 1 260px;
    min-width: 260px;
  }
  .city-list {
    min-height: 140px;
  }
}

@media (max-width: 520px) {
  .footprint-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .footprint-actions {
    grid-template-columns: 1fr;
  }
}
</style>
