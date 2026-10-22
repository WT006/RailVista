<script setup lang="ts">
/**
 * 我的中国足迹（/ticket/footprint —— 纪念票的二级页）
 *
 * 两种点亮模式：
 *  · 按市点亮：勾选具体城市，所属省份按「已点亮城市 / 该省城市总数」的比例渐染，
 *    点得越多铺得越满；
 *  · 按省点亮：整省点亮，整块抬升发光。
 *
 * 数据仅存本机 localStorage，沿用旧 key 以兼容既有记录。
 *
 * 视觉分工：金色只归地图（那是「走过的土地」本身），页面控件一律走系统令牌
 * （宇宙蓝做交互态、雪域灰做表面）。整页到处涂橙是上一版显得吵的原因。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import FootprintMap3D from '../components/ticket/FootprintMap3D.vue';
import HmSegmented, { type SegOption } from '../components/ticket/hm/HmSegmented.vue';
import { FOOTPRINT_CITIES, FOOTPRINT_PROVINCES } from '../data/chinaFootprintGeom';
import {
  buildActs,
  exportFootprintPng,
  exportFootprintVideo,
  type VideoAspect,
} from '../lib/footprintExport';

const router = useRouter();

const KEY_CITIES = 'rv-footprint-cities';
const KEY_PROVINCES = 'rv-footprint-provinces';

type Mode = 'city' | 'province';

const mode = ref<Mode>('city');
const litCities = ref<string[]>([]);
const litProvinces = ref<string[]>([]);
const query = ref('');
const suggestOpen = ref(false);
/** 点击地图省份后展开的城市选择面板 */
const activeProvince = ref<string | null>(null);

const cityByName = new Map(FOOTPRINT_CITIES.map((c) => [c.name, c]));
const cityByAdcode = new Map(FOOTPRINT_CITIES.map((c) => [c.adcode, c]));
const citiesOfProvince = new Map<string, typeof FOOTPRINT_CITIES>();
for (const c of FOOTPRINT_CITIES) {
  const arr = citiesOfProvince.get(c.province);
  if (arr) arr.push(c);
  else citiesOfProvince.set(c.province, [c]);
}

function load<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}
function persist() {
  localStorage.setItem(KEY_CITIES, JSON.stringify(litCities.value));
  localStorage.setItem(KEY_PROVINCES, JSON.stringify(litProvinces.value));
}

litCities.value = load<string>(KEY_CITIES, []);
litProvinces.value = load<string>(KEY_PROVINCES, []);
// 只有省份记录的人打开却停在「按市点亮」，会看到一张全黑的空图——按已有数据决定初始档
if (!litCities.value.length && litProvinces.value.length) mode.value = 'province';
watch([litCities, litProvinces], persist, { deep: true });

// ── 统计 ──────────────────────────────────────────────────────────────────
const TOTAL_CITIES = FOOTPRINT_CITIES.length;
const TOTAL_PROVINCES = FOOTPRINT_PROVINCES.length;

const litCitySet = computed(() => new Set(litCities.value));
const litProvinceSet = computed(() => new Set(litProvinces.value));

const litCountByProvince = computed(() => {
  const m = new Map<string, number>();
  for (const name of litCities.value) {
    const c = cityByName.get(name);
    if (c) m.set(c.province, (m.get(c.province) ?? 0) + 1);
  }
  return m;
});
/** 城市模式下由城市推导出的涉足省份 */
const touchedProvinces = computed(() => litCountByProvince.value.size);
const provinceCount = computed(() =>
  mode.value === 'province' ? litProvinceSet.value.size : touchedProvinces.value,
);
const cityPercent = computed(() => Math.round((litCities.value.length / TOTAL_CITIES) * 100));
const provincePercent = computed(() =>
  Math.round((provinceCount.value / TOTAL_PROVINCES) * 100),
);

/** 数字滚动：目标值变化时用 rAF 插值，仅驱动这一个 ref */
function useCountUp(source: () => number) {
  const display = ref(source());
  let raf = 0;
  let from = source();
  watch(source, (to) => {
    cancelAnimationFrame(raf);
    const start = performance.now();
    const a = from;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 620);
      display.value = Math.round(a + (to - a) * (1 - (1 - t) ** 3));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from = to;
    };
    raf = requestAnimationFrame(tick);
  });
  return display;
}
const cityShown = useCountUp(() => litCities.value.length);
const provinceShown = useCountUp(() => provinceCount.value);

// ── 搜索 ──────────────────────────────────────────────────────────────────
interface Suggest {
  name: string;
  province: string;
  adcode: number;
  before: string;
  match: string;
  after: string;
  lit: boolean;
}

const suggestions = computed<Suggest[]>(() => {
  const q = query.value.trim();
  if (!q) return [];
  const out: Suggest[] = [];
  const push = (c: (typeof FOOTPRINT_CITIES)[number], exact: boolean) => {
    const idx = exact ? 0 : c.name.indexOf(q);
    out.push({
      name: c.name,
      province: c.province,
      adcode: c.adcode,
      before: exact ? '' : c.name.slice(0, idx),
      match: exact ? c.name : q,
      after: exact ? '' : c.name.slice(idx + q.length),
      lit: litCitySet.value.has(c.name),
    });
  };
  for (const c of FOOTPRINT_CITIES) {
    if (c.name.includes(q)) push(c, false);
    if (out.length >= 30) return out;
  }
  // 无城市命中时退化为按省份匹配，列出该省全部城市
  for (const c of FOOTPRINT_CITIES) {
    if (!c.province.includes(q)) continue;
    push(c, true);
    if (out.length >= 30) break;
  }
  return out;
});

function onInput() {
  suggestOpen.value = query.value.trim().length > 0;
}
function onBlur() {
  // 延迟收起，确保 click 先于 blur 生效
  window.setTimeout(() => {
    suggestOpen.value = false;
  }, 180);
}
function pickSuggest(item: Suggest) {
  if (mode.value !== 'city') mode.value = 'city';
  toggleCity(item.name);
  query.value = '';
  suggestOpen.value = false;
}

// ── 点亮操作 ──────────────────────────────────────────────────────────────
function toggleCity(name: string) {
  if (!cityByName.has(name)) return;
  const i = litCities.value.indexOf(name);
  if (i >= 0) litCities.value.splice(i, 1);
  else litCities.value.push(name);
}
function toggleProvince(name: string) {
  const i = litProvinces.value.indexOf(name);
  if (i >= 0) litProvinces.value.splice(i, 1);
  else litProvinces.value.push(name);
}
function onProvinceClick(name: string) {
  if (mode.value === 'province') toggleProvince(name);
  else activeProvince.value = name;
}
function removeCity(name: string) {
  const i = litCities.value.indexOf(name);
  if (i >= 0) litCities.value.splice(i, 1);
}
function clearAll() {
  if (mode.value === 'province') litProvinces.value = [];
  else litCities.value = [];
}
function toggleMode(m: Mode) {
  mode.value = m;
  query.value = '';
  suggestOpen.value = false;
}

// ── 省份城市清单 ──────────────────────────────────────────────────────────
const activeCities = computed(
  () => (activeProvince.value ? citiesOfProvince.get(activeProvince.value) : []) ?? [],
);
const activeLitCount = computed(
  () => (activeProvince.value && litCountByProvince.value.get(activeProvince.value)) || 0,
);
function toggleAllInProvince() {
  const cities = activeCities.value;
  const allLit = cities.length > 0 && cities.every((c) => litCitySet.value.has(c.name));
  for (const c of cities) {
    const has = litCitySet.value.has(c.name);
    if (allLit && has) removeCity(c.name);
    else if (!allLit && !has) litCities.value.push(c.name);
  }
}

// ── 省份进度（替代上一版 34 个橙色药丸）──────────────────────────────────
function shortName(name: string) {
  return name
    .replace('维吾尔自治区', '')
    .replace('壮族自治区', '')
    .replace('回族自治区', '')
    .replace('特别行政区', '')
    .replace('自治区', '')
    .replace('省', '')
    .replace('市', '');
}
/** 按 adcode 前缀归入地理大区，让列表自上而下有空间顺序而不是字典序 */
function regionOf(adcode: number) {
  const p = Math.floor(adcode / 10000);
  if (p >= 21 && p <= 23) return '东北';
  if ([11, 12, 13, 14, 15].includes(p)) return '华北';
  if (p >= 31 && p <= 37) return '华东';
  if (p >= 41 && p <= 43) return '华中';
  if (p >= 44 && p <= 46) return '华南';
  if (p >= 50 && p <= 54) return '西南';
  if (p >= 61 && p <= 66) return '西北';
  return '港澳台';
}
const REGION_ORDER = ['华北', '东北', '华东', '华中', '华南', '西南', '西北', '港澳台'];
/** 大区内按 adcode 排，整体按大区表排 */
const sortedProvinces = [...FOOTPRINT_PROVINCES].sort((a, b) => {
  const ra = REGION_ORDER.indexOf(regionOf(a.adcode));
  const rb = REGION_ORDER.indexOf(regionOf(b.adcode));
  return ra !== rb ? ra - rb : a.adcode - b.adcode;
});
const provinceRows = computed(() =>
  sortedProvinces.map((p) => {
    const total = citiesOfProvince.get(p.name)?.length ?? 0;
    const lit = litCountByProvince.value.get(p.name) ?? 0;
    const isProvMode = mode.value === 'province';
    const on = isProvMode ? litProvinceSet.value.has(p.name) : lit > 0;
    return {
      name: p.name,
      short: shortName(p.name),
      region: regionOf(p.adcode),
      total,
      lit,
      on,
      full: isProvMode ? on : total > 0 && lit === total,
      pct: isProvMode ? (on ? 100 : 0) : total ? Math.round((lit / total) * 100) : 0,
    };
  }),
);
/** 大区标题只在换区时出现一次 */
const provinceGroups = computed(() => {
  const out: { region: string; rows: typeof provinceRows.value }[] = [];
  for (const row of provinceRows.value) {
    const last = out[out.length - 1];
    if (last && last.region === row.region) last.rows.push(row);
    else out.push({ region: row.region, rows: [row] });
  }
  return out;
});

// ── 现场回放 ──────────────────────────────────────────────────────────────
const mapRef = ref<InstanceType<typeof FootprintMap3D> | null>(null);
/** 回放中：null 表示正常显示全量；数字表示已放出前 N 幕 */
const replayAct = ref<number | null>(null);
const replaying = computed(() => replayAct.value !== null);
const acts = computed(() => buildActs(litCities.value, litProvinces.value, mode.value));

/** 回放时地图只画前 N 幕，金色自然从西往东铺过去 */
const shownCities = computed(() => {
  if (replayAct.value === null) return litCities.value;
  const out: string[] = [];
  for (const act of acts.value.slice(0, replayAct.value)) {
    for (const ad of act.cities) {
      const c = cityByAdcode.get(ad);
      if (c) out.push(c.name);
    }
  }
  return out;
});
const shownProvinces = computed(() =>
  replayAct.value === null
    ? litProvinces.value
    : acts.value.slice(0, replayAct.value).map((a) => a.name),
);

let replayTimers: number[] = [];
function stopReplay() {
  replayTimers.forEach(window.clearTimeout);
  replayTimers = [];
  replayAct.value = null;
}
function playReplay() {
  if (replaying.value) {
    stopReplay();
    return;
  }
  const n = acts.value.length;
  if (!n) return;
  activeProvince.value = null;
  replayAct.value = 0;
  for (let i = 1; i <= n; i++) {
    replayTimers.push(
      window.setTimeout(() => {
        if (replayAct.value !== null) replayAct.value = i;
      }, 420 + i * 210),
    );
  }
  replayTimers.push(
    window.setTimeout(() => {
      replayAct.value = null;
    }, 420 + n * 210 + 1500),
  );
}
onBeforeUnmount(stopReplay);

// ── 导出 ──────────────────────────────────────────────────────────────────
const busy = ref<'' | 'png' | 'video'>('');
const hint = ref('');
const videoAspect = ref<VideoAspect>('16:9');
const progress = ref(0);
const progressLabel = ref('');
const videoUrl = ref('');
const videoExt = ref('webm');
const cancelled = ref({ aborted: false });

const aspectOptions: SegOption[] = [
  { label: '横屏 16:9', value: '16:9' },
  { label: '竖屏 9:16', value: '9:16' },
];

function flash(msg: string) {
  hint.value = msg;
  window.setTimeout(() => {
    if (hint.value === msg) hint.value = '';
  }, 3200);
}

async function onSavePng() {
  const map = mapRef.value;
  if (!map || busy.value) return;
  busy.value = 'png';
  try {
    await exportFootprintPng({
      map,
      litCities: litCities.value,
      litProvinces: litProvinces.value,
      mode: mode.value,
      view: map.getView(),
    });
    flash('已保存纪念图片');
  } catch (err) {
    flash(err instanceof Error ? err.message : '图片导出失败');
  } finally {
    busy.value = '';
  }
}

async function onMakeVideo() {
  const map = mapRef.value;
  if (!map || busy.value) return;
  if (!acts.value.length) {
    flash('先点亮几座城市，再生成动画');
    return;
  }
  busy.value = 'video';
  progress.value = 0;
  progressLabel.value = '准备中';
  cancelled.value = { aborted: false };
  videoUrl.value = '';
  try {
    const res = await exportFootprintVideo({
      map,
      cityOrder: litCities.value,
      litProvinces: litProvinces.value,
      mode: mode.value,
      view: map.getView(),
      aspect: videoAspect.value,
      signal: cancelled.value,
      onProgress: (p, label) => {
        progress.value = p;
        progressLabel.value = label;
      },
    });
    videoUrl.value = res.url;
    videoExt.value = res.ext;
  } catch (err) {
    if (!cancelled.value.aborted) flash(err instanceof Error ? err.message : '视频生成失败');
  } finally {
    busy.value = '';
    progress.value = 0;
  }
}

function cancelVideo() {
  cancelled.value.aborted = true;
}
function closeVideo() {
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value);
  videoUrl.value = '';
}
function downloadVideo() {
  if (!videoUrl.value) return;
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  const a = document.createElement('a');
  a.href = videoUrl.value;
  a.download = `我的中国足迹_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${videoExt.value}`;
  a.click();
}
onBeforeUnmount(() => {
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value);
});

function goBack() {
  void router.push('/ticket');
}
</script>

<template>
  <div class="fp-page rv-page">
    <div class="rv-shell">
      <header class="fp-head">
        <button type="button" class="fp-back" @click="goBack">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M15 5l-7 7 7 7"
            />
          </svg>
          纪念票
        </button>
        <p class="fp-eyebrow">RAILVISTA · 万里路书</p>
        <h1 class="fp-title">我的中国足迹</h1>

        <div class="fp-metrics">
          <div class="fp-metric">
            <b>{{ cityShown }}</b>
            <span>座城市已点亮</span>
          </div>
          <i class="fp-metric__sep" aria-hidden="true" />
          <div class="fp-metric">
            <b>{{ provinceShown }}</b>
            <span>/ {{ TOTAL_PROVINCES }} 个省级行政区</span>
          </div>
          <i class="fp-metric__sep" aria-hidden="true" />
          <div class="fp-metric">
            <b>{{ cityPercent }}%</b>
            <span>全国 {{ TOTAL_CITIES }} 城覆盖率</span>
          </div>
        </div>
        <div class="fp-track" role="img" :aria-label="`已走过 ${provincePercent}% 的省级行政区`">
          <i :style="{ width: provincePercent + '%' }" />
        </div>
      </header>

      <div class="fp-main">
        <section class="rv-card fp-map" data-spotlight>
          <FootprintMap3D
            ref="mapRef"
            :lit-cities="shownCities"
            :lit-provinces="shownProvinces"
            :mode="mode"
            @province-click="onProvinceClick"
          />
          <transition name="fp-fade">
            <button v-if="replaying" type="button" class="fp-skip" @click="stopReplay">
              跳过回放
            </button>
          </transition>
        </section>

        <aside class="fp-side">
          <section class="rv-card fp-card" data-spotlight>
            <HmSegmented
              :options="[
                { label: '按市点亮', value: 'city' },
                { label: '按省点亮', value: 'province' },
              ]"
              :model-value="mode"
              @update:model-value="toggleMode($event as Mode)"
            />

            <div class="fp-search">
              <svg class="fp-search__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  d="M11 4a7 7 0 105.2 11.7l3.5 3.5 1.4-1.4-3.5-3.5A7 7 0 0011 4zm0 2a5 5 0 110 10 5 5 0 010-10z"
                />
              </svg>
              <input
                v-model="query"
                type="text"
                class="fp-search__input"
                :placeholder="mode === 'city' ? '搜索城市，如：广州' : '搜索城市或省份'"
                @input="onInput"
                @focus="onInput"
                @blur="onBlur"
                @keydown.enter.prevent="suggestions[0] && pickSuggest(suggestions[0])"
              />
              <transition name="fp-pop">
                <ul v-if="suggestOpen && query.trim()" class="fp-suggest">
                  <li
                    v-for="(s, i) in suggestions"
                    :key="s.adcode"
                    class="fp-suggest__item"
                    :class="{ 'is-lit': s.lit }"
                    :style="{ animationDelay: `${Math.min(i, 12) * 22}ms` }"
                    @mousedown.prevent="pickSuggest(s)"
                  >
                    <span class="fp-suggest__name">
                      {{ s.before }}<b>{{ s.match }}</b>{{ s.after }}
                    </span>
                    <span class="fp-suggest__prov">{{ s.province }}</span>
                    <svg v-if="s.lit" class="fp-suggest__ok" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </li>
                  <li v-if="!suggestions.length" class="fp-suggest__empty">
                    没有找到匹配的城市
                  </li>
                </ul>
              </transition>
            </div>

            <div class="fp-picked">
              <div class="fp-rowhead">
                <span class="fp-rowhead__t">
                  {{
                    mode === 'city'
                      ? `已点亮 ${litCities.length} 座城市`
                      : `已点亮 ${litProvinces.length} 个省份`
                  }}
                </span>
                <button
                  v-if="(mode === 'city' && litCities.length) || (mode === 'province' && litProvinces.length)"
                  type="button"
                  class="fp-link"
                  @click="clearAll"
                >
                  清空
                </button>
              </div>
              <div v-if="mode === 'city'" v-auto-animate class="fp-tags">
                <span v-for="name in litCities" :key="name" class="fp-tag">
                  {{ shortName(name) }}
                  <button
                    type="button"
                    class="fp-tag__x"
                    :aria-label="`取消点亮 ${name}`"
                    @click="removeCity(name)"
                  >
                    ×
                  </button>
                </span>
                <p v-if="!litCities.length" class="fp-empty">搜索城市，或直接在地图上点省份</p>
              </div>
              <div v-else v-auto-animate class="fp-tags">
                <span v-for="name in litProvinces" :key="name" class="fp-tag">
                  {{ shortName(name) }}
                  <button
                    type="button"
                    class="fp-tag__x"
                    :aria-label="`取消点亮 ${name}`"
                    @click="toggleProvince(name)"
                  >
                    ×
                  </button>
                </span>
                <p v-if="!litProvinces.length" class="fp-empty">
                  在地图上点省份，或用下方省份进度
                </p>
              </div>
            </div>
          </section>

          <section class="rv-card fp-card" data-spotlight>
            <div class="fp-rowhead">
              <span class="fp-rowhead__t">导出纪念物</span>
              <span v-if="hint" class="fp-hint">{{ hint }}</span>
            </div>
            <div class="fp-actions">
              <button type="button" class="btn ghost btn-sm" @click="playReplay">
                {{ replaying ? '停止回放' : '回放点亮' }}
              </button>
              <button
                type="button"
                class="btn ghost btn-sm"
                :disabled="busy !== ''"
                @click="onSavePng"
              >
                {{ busy === 'png' ? '正在生成…' : '保存图片' }}
              </button>
            </div>
            <HmSegmented
              class="fp-aspect"
              :options="aspectOptions"
              :model-value="videoAspect"
              @update:model-value="videoAspect = $event as VideoAspect"
            />
            <button
              type="button"
              class="btn primary fp-video-btn"
              :disabled="busy !== ''"
              @click="onMakeVideo"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M4 7h11v10H4zM15 10l5-3v10l-5-3z"
                />
              </svg>
              {{ busy === 'video' ? `${progressLabel} ${Math.round(progress * 100)}%` : '生成动画视频' }}
            </button>
            <div v-if="busy === 'video'" class="fp-prog">
              <i :style="{ width: progress * 100 + '%' }" />
              <button type="button" class="fp-prog__x" @click="cancelVideo">取消</button>
            </div>
            <p v-else-if="!hint" class="fp-note">
              由西向东按省份铺开，约 8 秒；数据仅存本机
            </p>
          </section>
        </aside>
      </div>

      <!-- 省份进度：横跨整幅的数据带，与上方两栏等高线对齐 -->
      <section class="rv-card fp-band" data-spotlight>
        <div class="fp-rowhead">
          <span class="fp-rowhead__t">省份进度</span>
          <span class="fp-rowhead__n">
            {{ provinceCount }} / {{ TOTAL_PROVINCES }} 个省级行政区
          </span>
        </div>
        <div class="fp-regions">
          <section v-for="grp in provinceGroups" :key="grp.region" class="fp-region">
            <h3 class="fp-region__h">{{ grp.region }}</h3>
            <div class="fp-region__grid">
              <button
                v-for="row in grp.rows"
                :key="row.name"
                type="button"
                class="fp-prov"
                :class="{ 'is-on': row.on, 'is-full': row.full }"
                :title="`${row.name} · ${row.lit}/${row.total}`"
                @click="onProvinceClick(row.name)"
              >
                <span class="fp-prov__top">
                  <span class="fp-prov__n">{{ row.short }}</span>
                  <!-- 按省点亮时「n/总城市数」没有意义，整省点亮就是整省 -->
                  <span v-if="mode === 'city'" class="fp-prov__c">{{ row.lit }}/{{ row.total }}</span>
                </span>
                <span class="fp-prov__bar"><i :style="{ width: row.pct + '%' }" /></span>
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>

    <!-- 省份城市清单 -->
    <transition name="fp-fade">
      <div v-if="activeProvince" class="fp-sheet" role="dialog" aria-modal="true">
        <button
          type="button"
          class="fp-sheet__backdrop"
          aria-label="关闭"
          @click="activeProvince = null"
        />
        <div class="fp-sheet__panel">
          <header class="fp-sheet__head">
            <div>
              <h2>{{ activeProvince }}</h2>
              <p>已点亮 {{ activeLitCount }} / {{ activeCities.length }} 座城市</p>
            </div>
            <button
              type="button"
              class="fp-sheet__x"
              aria-label="关闭"
              @click="activeProvince = null"
            >
              ×
            </button>
          </header>
          <div class="fp-sheet__grid">
            <button
              v-for="c in activeCities"
              :key="c.adcode"
              type="button"
              class="fp-city"
              :class="{ 'is-on': litCitySet.has(c.name) }"
              @click="toggleCity(c.name)"
            >
              {{ c.name }}
            </button>
          </div>
          <footer class="fp-sheet__foot">
            <button type="button" class="btn ghost btn-sm" @click="toggleAllInProvince">
              {{
                activeLitCount === activeCities.length && activeCities.length
                  ? '全部取消'
                  : '全选本省'
              }}
            </button>
            <button type="button" class="btn primary btn-sm" @click="activeProvince = null">
              完成
            </button>
          </footer>
        </div>
      </div>
    </transition>

    <!-- 视频成片预览 -->
    <transition name="fp-fade">
      <div v-if="videoUrl" class="fp-sheet" role="dialog" aria-modal="true">
        <button type="button" class="fp-sheet__backdrop" aria-label="关闭" @click="closeVideo" />
        <div class="fp-sheet__panel">
          <header class="fp-sheet__head">
            <div>
              <h2>点亮动画已生成</h2>
              <p>
                {{ videoAspect === '16:9' ? '横屏 1920×1080' : '竖屏 1080×1920' }} ·
                {{ videoExt.toUpperCase() }}
              </p>
            </div>
            <button type="button" class="fp-sheet__x" aria-label="关闭" @click="closeVideo">
              ×
            </button>
          </header>
          <video :src="videoUrl" controls autoplay loop class="fp-video" />
          <footer class="fp-sheet__foot">
            <button type="button" class="btn ghost btn-sm" @click="closeVideo">关闭</button>
            <button type="button" class="btn primary btn-sm" @click="downloadVideo">
              下载视频
            </button>
          </footer>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.fp-page {
  min-height: 100vh;
}

/* ── 页头 ──────────────────────────────────────────────────────────────── */
.fp-head {
  padding-top: var(--space-4);
}

.fp-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 40px;
  padding: 0 var(--space-3) 0 var(--space-2);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-full);
  background: var(--surface-2);
  color: var(--text-2);
  font-family: inherit;
  font-size: var(--fs-meta);
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard);
}
.fp-back:hover {
  color: var(--text-1);
  border-color: var(--line-strong);
}

.fp-eyebrow {
  margin: var(--space-5) 0 0;
  font-size: var(--fs-eyebrow);
  letter-spacing: 0.22em;
  color: var(--text-3);
}
.fp-title {
  margin: var(--space-2) 0 0;
  font-family: var(--font-display);
  font-size: var(--fs-display);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: var(--lh-tight);
  color: var(--text-1);
}

.fp-metrics {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-4);
}
.fp-metric {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.fp-metric b {
  font-family: var(--font-display);
  font-size: var(--fs-display);
  font-weight: 700;
  line-height: 1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.fp-metric span {
  font-size: var(--fs-cap);
  color: var(--text-3);
}
.fp-metric__sep {
  width: 1px;
  height: 18px;
  background: var(--line-default);
}

/* 覆盖率细线：整页唯一一处金色进度表达，其余交给地图 */
.fp-track {
  display: block;
  height: 2px;
  margin-top: var(--space-3);
  border-radius: var(--radius-full);
  background: var(--fill-subtle);
  overflow: hidden;
}
.fp-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--ticket-gold-deep), var(--ticket-gold-bright));
  transition: width var(--dur-slower) var(--ease-emphasized);
}

/* ── 主区 ──────────────────────────────────────────────────────────────── */
.fp-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--space-3);
  align-items: start;
  margin-top: var(--space-4);
}
.fp-band {
  margin-top: var(--space-3);
}

.fp-map {
  position: relative;
  padding: var(--space-3);
}
.fp-skip {
  position: absolute;
  left: 50%;
  bottom: var(--space-5);
  transform: translateX(-50%);
  min-height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-full);
  background: var(--surface-scrim);
  color: var(--text-2);
  font-family: inherit;
  font-size: var(--fs-cap);
  cursor: pointer;
  backdrop-filter: blur(var(--glass-blur-tile));
  -webkit-backdrop-filter: blur(var(--glass-blur-tile));
}
.fp-skip:hover {
  color: var(--text-1);
  border-color: var(--line-strong);
}

.fp-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.fp-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.fp-rowhead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.fp-rowhead__t {
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
}
.fp-rowhead__n {
  font-size: var(--fs-cap);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

/* ── 搜索 ──────────────────────────────────────────────────────────────── */
.fp-search {
  position: relative;
}
.fp-search__icon {
  position: absolute;
  left: var(--space-3);
  top: 50%;
  width: 16px;
  height: 16px;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
  transition: color var(--dur-fast) var(--ease-standard);
}
.fp-search__input {
  width: 100%;
  min-height: var(--hit-min);
  padding: 0 var(--space-3) 0 var(--space-6);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-1);
  font-family: inherit;
  font-size: var(--fs-input);
  outline: none;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}
.fp-search__input::placeholder {
  color: var(--text-3);
}
.fp-search__input:focus {
  border-color: var(--accent-border);
  box-shadow: var(--focus-ring);
}
.fp-search:focus-within .fp-search__icon {
  color: var(--accent);
}

.fp-suggest {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 0;
  right: 0;
  z-index: 40;
  max-height: 288px;
  overflow: auto;
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  border-radius: var(--radius-md);
  background: var(--surface-3);
  border: 1px solid var(--line-default);
  box-shadow: var(--elev-3);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.fp-suggest__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  /* 逐条错峰进场；animationDelay 由模板写入 */
  animation: fp-item-in var(--dur-base) var(--ease-standard) backwards;
  transition: background-color var(--dur-micro) var(--ease-standard);
}
.fp-suggest__item:hover {
  background: var(--interactive-hover);
}
@keyframes fp-item-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.fp-suggest__name {
  font-size: var(--fs-body);
  color: var(--text-1);
}
.fp-suggest__name b {
  color: var(--accent-hover);
  font-weight: 700;
}
.fp-suggest__prov {
  margin-left: auto;
  font-size: var(--fs-micro);
  color: var(--text-3);
}
.fp-suggest__ok {
  width: 14px;
  height: 14px;
  color: var(--ticket-gold-bright);
}
.fp-suggest__empty {
  padding: var(--space-4);
  text-align: center;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.fp-pop-enter-active,
.fp-pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard);
}
.fp-pop-enter-from,
.fp-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ── 已选 ──────────────────────────────────────────────────────────────── */
.fp-link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-family: inherit;
  font-size: var(--fs-cap);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-standard);
}
.fp-link:hover {
  color: var(--danger);
}
.fp-tags {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: var(--space-2);
  max-height: 152px;
  overflow: auto;
}
.fp-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  border: 1px solid var(--line-default);
  background: var(--surface-2);
  font-size: var(--fs-cap);
  color: var(--text-1);
}
.fp-tag__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-3);
  font-size: var(--fs-meta);
  line-height: 1;
  cursor: pointer;
  transition:
    background-color var(--dur-micro) var(--ease-standard),
    color var(--dur-micro) var(--ease-standard);
}
.fp-tag__x:hover {
  background: var(--interactive-pressed);
  color: var(--text-1);
}
.fp-empty {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}

/* ── 省份进度 ──────────────────────────────────────────────────────────── */
.fp-regions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4) var(--space-5);
}
.fp-region__h {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-micro);
  font-weight: 500;
  letter-spacing: 0.16em;
  color: var(--text-3);
}
.fp-region__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: var(--space-2);
}
.fp-prov {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line-hairline);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-micro) var(--ease-standard),
    border-color var(--dur-micro) var(--ease-standard),
    transform var(--dur-micro) var(--ease-standard);
}
.fp-prov:hover {
  background: var(--surface-2);
  border-color: var(--line-strong);
  transform: translateY(-1px);
}
.fp-prov__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1);
}
.fp-prov__n {
  font-size: var(--fs-meta);
  color: var(--text-2);
  transition: color var(--dur-fast) var(--ease-standard);
}
.fp-prov.is-on .fp-prov__n {
  color: var(--text-1);
}
.fp-prov__bar {
  display: block;
  height: 2px;
  border-radius: var(--radius-full);
  background: var(--fill-subtle);
  overflow: hidden;
}
.fp-prov__bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ticket-gold);
  transition: width var(--dur-slower) var(--ease-emphasized);
}
.fp-prov.is-full {
  border-color: var(--line-hairline);
  background: var(--surface-2);
}
.fp-prov.is-full .fp-prov__bar i {
  background: var(--ticket-gold-bright);
}
.fp-prov__c {
  font-size: var(--fs-micro);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

/* ── 导出 ──────────────────────────────────────────────────────────────── */
.fp-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.fp-aspect :deep(.hm-seg__item) {
  height: 36px;
  font-size: var(--fs-cap);
}
.fp-video-btn {
  width: 100%;
}
.fp-prog {
  position: relative;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--fill-subtle);
  overflow: hidden;
}
.fp-prog i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width var(--dur-fast) linear;
}
.fp-prog__x {
  position: absolute;
  right: 0;
  top: -22px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-family: inherit;
  font-size: var(--fs-micro);
  cursor: pointer;
}
.fp-prog__x:hover {
  color: var(--text-1);
}
.fp-note,
.fp-hint {
  margin: 0;
  font-size: var(--fs-cap);
  color: var(--text-3);
}
.fp-hint {
  color: var(--ticket-gold-bright);
  animation: fp-item-in var(--dur-fast) var(--ease-standard);
}

/* ── 弹层 ──────────────────────────────────────────────────────────────── */
.fp-sheet {
  position: fixed;
  inset: 0;
  z-index: 10060;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
}
.fp-sheet__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: var(--surface-scrim);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  cursor: pointer;
}
.fp-sheet__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: min(600px, 100%);
  max-height: 86vh;
  padding: var(--pad-card-lg);
  border-radius: var(--radius-xl);
  background: var(--surface-1);
  border: 1px solid var(--line-default);
  box-shadow: var(--elev-4);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  animation: fp-panel-in var(--dur-slow) var(--ease-spring);
}
.fp-sheet__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}
.fp-sheet__head h2 {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: 700;
  color: var(--text-1);
}
.fp-sheet__head p {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-cap);
  color: var(--text-3);
}
.fp-sheet__x {
  width: 32px;
  height: 32px;
  flex: none;
  border: 1px solid var(--line-default);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-2);
  font-size: var(--fs-h2);
  line-height: 1;
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard);
}
.fp-sheet__x:hover {
  color: var(--text-1);
  border-color: var(--line-strong);
}
.fp-sheet__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: var(--space-2);
  overflow: auto;
}
.fp-sheet__foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.fp-city {
  padding: var(--space-2) var(--space-1);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-2);
  font-family: inherit;
  font-size: var(--fs-meta);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard),
    transform var(--dur-micro) var(--ease-standard);
}
.fp-city:hover {
  transform: translateY(-1px);
  border-color: var(--line-strong);
  color: var(--text-1);
}
.fp-city.is-on {
  background: var(--fill-accent);
  border-color: var(--accent-border);
  color: var(--text-1);
  font-weight: 600;
}
.fp-video {
  width: 100%;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-default);
  background: var(--surface-0);
}
@keyframes fp-panel-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
.fp-fade-enter-active,
.fp-fade-leave-active {
  transition: opacity var(--dur-base) var(--ease-standard);
}
.fp-fade-enter-from,
.fp-fade-leave-to {
  opacity: 0;
}

/* ── 响应式：主栏 / 侧栏在 <1200 收成一列 ───────────────────────────────── */
@media (max-width: 1199px) {
  .fp-main {
    grid-template-columns: minmax(0, 1fr);
  }
  .fp-side {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    align-items: start;
  }
}
@media (max-width: 839px) {
  .fp-metrics {
    gap: var(--space-3);
  }
  .fp-metric b {
    font-size: var(--fs-h1);
  }
  .fp-metric__sep {
    display: none;
  }
  .fp-regions {
    gap: var(--space-4);
  }
}

@media (prefers-reduced-motion: reduce) {
  .fp-suggest__item,
  .fp-sheet__panel {
    animation: none;
  }
  .fp-track i,
  .fp-prov__bar i {
    transition-duration: 0.01ms;
  }
}
</style>
