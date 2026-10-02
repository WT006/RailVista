<script setup lang="ts">
/**
 * 万里路书 · 全国公路旅游网首页（PRD §2.3 DriveHome，主功能）。
 *
 * 强制约束（v1 被否的直接原因，属验收项）：首屏不得以榜单为主视觉——
 * 搜索框视觉权重 > 榜单入口，榜单放在第二屏。
 *
 * 结构：
 *   1. 全幅公路网 SVG 底图（离线中国轮廓 + /drive/network/overview 抽稀折线，
 *      ROAD_COLORS 按等级着色，点击路线进 /drive/road/:key）
 *   2. 起终点 OD 搜索（suggest 四类索引 + geocode 兜底）+ ⇄ 交换
 *   3. 公路编号键盘（对标车次号前缀键盘：G/S/X/Y/C + 数字；S 需先选省）
 *   4. 路网统计 + 覆盖诚实说明（PRD §3.1）
 *   5. 第二屏：榜单入口卡（从属）
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import AppTopBar from '../components/AppTopBar.vue';
import DriveSubNav from '../components/DriveSubNav.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';

usePointerSpotlight();
import outlineRaw from '../assets/china-outline.svg?raw';
import { CHINA_OUTLINE_VIEWBOX, lngLatToViewBox } from '../data/chinaBackdrop';
import { ROAD_COLORS, roadColor, roadClassLabel, classOfRef } from '../data/roadColors';
import type { PlaceHit, RoadClass } from '@railvista/shared';

const router = useRouter();

// ── 公路网底图 ───────────────────────────────────────────────────────────────
const VIEW_W = CHINA_OUTLINE_VIEWBOX.width;
const VIEW_H = CHINA_OUTLINE_VIEWBOX.height;
const outlinePaths = (() => {
  const m = /<g[^>]*>([\s\S]*?)<\/g>/.exec(outlineRaw);
  return m ? m[1].trim() : '';
})();

interface RoadLine {
  key: string;
  ref: string;
  name?: string;
  class: RoadClass;
  lengthKm: number;
  d: string;
}

const roadLines = ref<RoadLine[]>([]);
const netError = ref('');

function polylineToPath(pts: [number, number][]): string {
  let d = '';
  for (let i = 0; i < pts.length; i += 1) {
    const [x, y] = lngLatToViewBox(pts[i]![0], pts[i]![1]);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

async function loadNetwork() {
  try {
    const data = await api.getDriveNetworkOverview();
    roadLines.value = data.roads
      .filter((r) => r.polyline.length >= 2)
      .map((r) => ({ ...r, d: polylineToPath(r.polyline) }));
  } catch (e) {
    netError.value = e instanceof Error ? e.message : '路网图层加载失败';
  }
}

function openRoad(key: string) {
  void router.push(`/drive/road/${encodeURIComponent(key)}`);
}

// ── OD 搜索 ──────────────────────────────────────────────────────────────────
const from = ref('');
const to = ref('');
const fromSuggest = ref<PlaceHit[]>([]);
const toSuggest = ref<PlaceHit[]>([]);
const fromOpen = ref(false);
const toOpen = ref(false);
const odError = ref('');
const odBusy = ref(false);
let suggestSeq = 0;

async function refreshSuggest(field: 'from' | 'to') {
  const q = (field === 'from' ? from : to).value.trim();
  const seq = ++suggestSeq;
  if (!q) {
    if (field === 'from') fromSuggest.value = [];
    else toSuggest.value = [];
    return;
  }
  try {
    const data = await api.suggestDrivePlaces(q, undefined, 8);
    if (seq !== suggestSeq) return; // 迟到响应丢弃
    if (field === 'from') {
      fromSuggest.value = data.hits;
      fromOpen.value = data.hits.length > 0;
    } else {
      toSuggest.value = data.hits;
      toOpen.value = data.hits.length > 0;
    }
  } catch {
    /* 联想失败不打断输入 */
  }
}

function pickHit(field: 'from' | 'to', hit: PlaceHit) {
  if (field === 'from') {
    from.value = hit.name;
    fromOpen.value = false;
  } else {
    to.value = hit.name;
    toOpen.value = false;
  }
}

function swapOd() {
  const f = from.value;
  from.value = to.value;
  to.value = f;
}

function goTrip() {
  if (!from.value.trim() || !to.value.trim()) {
    odError.value = '请先填写起点和终点（支持地名 / 公路编号 / 景点）';
    return;
  }
  odError.value = '';
  void router.push({ path: '/drive/trip', query: { from: from.value.trim(), to: to.value.trim() } });
}

// ── 公路编号键盘（PRD §4.2，对标车次号前缀键盘） ────────────────────────────
const codeQuery = ref('');
const selectedProvince = ref('');
const roadCandidates = ref<PlaceHit[]>([]);
const roadBusy = ref(false);

const PREFIXES = [
  { key: 'G', zh: '国道', en: 'National', color: ROAD_COLORS.national },
  { key: 'S', zh: '省道', en: 'Provincial', color: ROAD_COLORS.provincial },
  { key: 'X', zh: '县道', en: 'County', color: ROAD_COLORS.county },
  { key: 'Y', zh: '乡道', en: 'Township', color: ROAD_COLORS.township },
  { key: 'C', zh: '村道', en: 'Village', color: ROAD_COLORS.village },
];

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const activePrefix = computed(() => {
  const v = codeQuery.value.trim().toUpperCase();
  if (!v) return null;
  return /^[GSXYC]/.test(v) ? v[0]! : null;
});

/** 省道等省内编号跨省重复：先选省（PRD §4.2） */
const needsProvince = computed(() => ['S', 'X', 'Y', 'C'].includes(activePrefix.value ?? ''));

const provinceOptions = computed(() => {
  const set = new Set<string>();
  for (const hit of roadCandidates.value) {
    // 省份信息在 sub 字段（「沪聂线 · 上海 → 聂拉木」不含省份），用 id 前缀提省内编号主键
    if (hit.id.includes(':')) set.add(hit.id.split(':')[0]!);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
});

async function refreshRoadCandidates() {
  const q = codeQuery.value.trim();
  if (!q) {
    roadCandidates.value = [];
    return;
  }
  roadBusy.value = true;
  try {
    const data = await api.suggestDrivePlaces(q, 'road', 60);
    let hits = data.hits;
    if (needsProvince.value && selectedProvince.value) {
      hits = hits.filter((h) => h.id.startsWith(`${selectedProvince.value}:`));
    }
    // PRD §4.2：候选按编号数字升序（G3 → G30 → G318）
    hits.sort((a, b) => {
      const na = Number(a.name.replace(/\D/g, '')) || 0;
      const nb = Number(b.name.replace(/\D/g, '')) || 0;
      return na - nb || a.name.localeCompare(b.name);
    });
    roadCandidates.value = hits;
  } catch {
    roadCandidates.value = [];
  } finally {
    roadBusy.value = false;
  }
}

watch(codeQuery, () => void refreshRoadCandidates());

function applyPrefix(p: { key: string }) {
  const digits = codeQuery.value.replace(/^[GSXYC]/, '').trim();
  codeQuery.value = p.key + digits; // 保留已选省与后续数字，只换等级前缀
}

function appendDigit(d: string) {
  codeQuery.value = (codeQuery.value || 'G') + d;
}

function backspace() {
  codeQuery.value = codeQuery.value.slice(0, -1);
}

function openRoadHit(hit: PlaceHit) {
  if (hit.kind === 'road') {
    void router.push(`/drive/road/${encodeURIComponent(hit.id)}`);
  }
}

function setRoadAsConstraint(field: 'from' | 'to') {
  const hit = roadCandidates.value[0];
  if (!hit) return;
  if (field === 'from') from.value = hit.name;
  else to.value = hit.name;
}

// ── 路网统计 + 榜单入口（第二屏） ────────────────────────────────────────────
const stats = ref<Awaited<ReturnType<typeof api.getDriveNetworkStats>> | null>(null);
const boards = ref<Awaited<ReturnType<typeof api.getDriveBoards>>['boards']>([]);

onMounted(async () => {
  void loadNetwork();
  try {
    stats.value = await api.getDriveNetworkStats();
  } catch {
    /* 统计失败不阻塞页面 */
  }
  try {
    boards.value = (await api.getDriveBoards()).boards;
  } catch {
    /* 榜单入口失败不阻塞 */
  }
});

const levelLabel: Record<string, string> = {
  national: '官方',
  provincial: '省级',
  media: '媒体',
};
</script>

<template>
  <div class="drive-page">
    <AppTopBar />

    <main class="rv-shell">
      <DriveSubNav />

      <header class="drive-hero">
        <h1>万里路书 · 全国公路旅游网</h1>
        <p class="sub">
          和铁路版同构：全国公路网 + 路线搜索 + 任意起终点的沿程景点。
          无论走在哪条国道上，或者从哪个位置到哪个位置，走过就能把它的景点加载出来。
        </p>
      </header>

      <!-- 首屏主体：地图 + OD 搜索 + 编号键盘（搜索框视觉权重 > 榜单，验收项） -->
      <section class="drive-home-main">
        <div class="drive-netmap rv-card" data-spotlight>
          <svg :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" class="drive-netmap__svg" role="img" aria-label="全国公路网示意图">
            <g class="drive-netmap__outline" v-html="outlinePaths" />
            <path
              v-for="r in roadLines"
              :key="r.key"
              class="drive-netmap__road"
              :class="`drive-netmap__road--${r.class}`"
              :d="r.d"
              :stroke="roadColor(r.class)"
            >
              <title>{{ r.ref }} {{ r.name ?? '' }} · 约 {{ Math.round(r.lengthKm) }} km（估算）</title>
            </path>
          </svg>
          <p v-if="netError" class="drive-netmap__note">{{ netError }}</p>
          <p v-else-if="!roadLines.length" class="drive-netmap__note">
            路网几何加载中…（无几何时仅显示索引统计）
          </p>
          <p class="drive-netmap__hint">点击路线进入单条公路详情</p>
        </div>

        <div class="drive-home-panel">
          <!-- OD 搜索 -->
          <form class="drive-od rv-card" data-spotlight @submit.prevent="goTrip">
            <div class="drive-od__row">
              <label class="station-field">
                <span>起点</span>
                <div class="station-field__control">
                  <input
                    v-model="from"
                    autocomplete="off"
                    placeholder="例如 上海 或 G318"
                    @input="refreshSuggest('from')"
                    @focus="fromOpen = fromSuggest.length > 0"
                    @blur="fromOpen = false"
                  />
                  <ul v-show="fromOpen && fromSuggest.length" class="station-suggest" role="listbox">
                    <li
                      v-for="(s, i) in fromSuggest"
                      :key="`${s.kind}-${s.id}-${i}`"
                      role="option"
                      :class="{ 'is-active': i === 0 }"
                      @mousedown.prevent="pickHit('from', s)"
                    >
                      <span class="drive-suggest__kind">{{ s.kind === 'place' ? '地名' : s.kind === 'road' ? '公路' : s.kind === 'spot' ? '景点' : '设施' }}</span>
                      {{ s.name }}
                      <span class="drive-suggest__sub">{{ s.sub }}</span>
                    </li>
                  </ul>
                </div>
              </label>
              <button type="button" class="drive-od__swap" aria-label="交换起终点" @click="swapOd">⇄</button>
              <label class="station-field">
                <span>终点</span>
                <div class="station-field__control">
                  <input
                    v-model="to"
                    autocomplete="off"
                    placeholder="例如 拉萨"
                    @input="refreshSuggest('to')"
                    @focus="toOpen = toSuggest.length > 0"
                    @blur="toOpen = false"
                  />
                  <ul v-show="toOpen && toSuggest.length" class="station-suggest" role="listbox">
                    <li
                      v-for="(s, i) in toSuggest"
                      :key="`${s.kind}-${s.id}-${i}`"
                      role="option"
                      :class="{ 'is-active': i === 0 }"
                      @mousedown.prevent="pickHit('to', s)"
                    >
                      <span class="drive-suggest__kind">{{ s.kind === 'place' ? '地名' : s.kind === 'road' ? '公路' : s.kind === 'spot' ? '景点' : '设施' }}</span>
                      {{ s.name }}
                      <span class="drive-suggest__sub">{{ s.sub }}</span>
                    </li>
                  </ul>
                </div>
              </label>
            </div>
            <p v-if="odError" class="drive-od__error">{{ odError }}</p>
            <div class="drive-actions">
              <button type="submit" class="btn primary" :disabled="odBusy">出发</button>
              <span class="drive-od__hint">在线高德规划 + 本地干线 A* 兜底，离线也能出沿程景点</span>
            </div>
          </form>

          <!-- 公路编号键盘 -->
          <div class="road-kbd rv-card" data-spotlight>
            <span class="road-kbd__label">或按公路编号直达</span>
            <div class="road-kbd__row">
              <input
                v-model="codeQuery"
                class="road-kbd__input"
                autocomplete="off"
                placeholder="输入编号，例如 G318"
                @keydown.enter.prevent="roadCandidates[0] && openRoadHit(roadCandidates[0])"
              />
              <button type="button" class="btn ghost btn-sm" @click="backspace">⌫</button>
            </div>

            <div v-if="needsProvince && provinceOptions.length" class="road-kbd__provinces">
              <button
                v-for="p in provinceOptions"
                :key="p"
                type="button"
                class="road-kbd__chip"
                :class="{ 'is-on': selectedProvince === p }"
                @click="selectedProvince = selectedProvince === p ? '' : p"
              >
                {{ p }}
              </button>
            </div>

            <div class="road-kbd__prefixes" role="group" aria-label="公路等级前缀">
              <button
                v-for="p in PREFIXES"
                :key="p.key"
                type="button"
                class="road-kbd__prefix"
                :style="{ '--prefix-color': p.color }"
                :aria-pressed="activePrefix === p.key"
                :title="`${p.key} 字头 · ${p.zh}（${p.en}）`"
                @click="applyPrefix(p)"
              >
                <span class="road-kbd__letter">{{ p.key }}</span>
                <span class="road-kbd__name"><strong>{{ p.zh }}</strong><em>{{ p.en }}</em></span>
              </button>
            </div>
            <div class="road-kbd__digits" role="group" aria-label="数字键">
              <button v-for="d in DIGITS" :key="d" type="button" class="road-kbd__digit" @click="appendDigit(d)">
                {{ d }}
              </button>
            </div>

            <ul v-if="roadCandidates.length" class="road-kbd__candidates">
              <li v-for="hit in roadCandidates.slice(0, 8)" :key="hit.id">
                <button type="button" class="road-kbd__candidate" @click="openRoadHit(hit)">
                  <span class="road-kbd__badge" :style="{ '--prefix-color': roadColor(classOfRef(hit.name)) }">{{ hit.name }}</span>
                  <span class="road-kbd__candidate-sub">{{ hit.sub }}</span>
                </button>
              </li>
            </ul>
            <p v-else-if="codeQuery.trim() && !roadBusy" class="road-kbd__none">
              没有匹配的编号（省道需先选省）
            </p>
            <div v-if="roadCandidates.length" class="drive-actions">
              <button type="button" class="btn ghost btn-sm" @click="setRoadAsConstraint('from')">设为起点</button>
              <button type="button" class="btn ghost btn-sm" @click="setRoadAsConstraint('to')">设为终点</button>
            </div>
          </div>
        </div>
      </section>

      <!-- 路网统计 + 诚实边界 -->
      <section v-if="stats" class="drive-stats">
        <div class="drive-stat">
          <div class="drive-stat__value">{{ stats.national }}<span class="drive-stat__target">/301</span></div>
          <div class="drive-stat__label">普通国道在册</div>
        </div>
        <div class="drive-stat">
          <div class="drive-stat__value">{{ stats.expressway }}<span class="drive-stat__target">/278</span></div>
          <div class="drive-stat__label">国家高速在册</div>
        </div>
        <div class="drive-stat">
          <div class="drive-stat__value">{{ stats.hasGeom }}</div>
          <div class="drive-stat__label">已挂几何（{{ Math.round(stats.hasGeomRatio * 100) }}%）</div>
        </div>
        <div class="drive-stat">
          <div class="drive-stat__value">{{ stats.spotCount }}</div>
          <div class="drive-stat__label">公路侧景点</div>
        </div>
      </section>
      <p v-if="stats" class="drive-coverage-note">
        {{ stats.coverage.notes[0] }}。高速/国道几何可查率 85~95%，省道 50~70%，县道 20~40%；
        精品线走向为 OSM 编号还原的近似线位。
      </p>

      <!-- 第二屏：榜单入口（从属，视觉权重低于搜索） -->
      <section class="drive-boards">
        <h2 class="drive-boards__title">热门榜单<span>（入口，点击看完整榜单）</span></h2>
        <div class="drive-boards__grid">
          <router-link
            v-for="b in boards.slice(0, 3)"
            :key="b.id"
            class="drive-board-card"
            :to="`/drive/rankings/${b.id}`"
          >
            <span class="drive-board-card__level" :class="`is-${b.level}`">{{ levelLabel[b.level] ?? b.level }}</span>
            <span class="drive-board-card__title">{{ b.title }}</span>
            <span class="drive-board-card__meta">{{ b.org }}<template v-if="b.publishedAt"> · {{ b.publishedAt }}</template> · {{ b.itemCount }} 条</span>
          </router-link>
          <p v-if="!boards.length" class="drive-empty">榜单数据待生成（data/roads/boards/）</p>
        </div>
        <router-link class="drive-boards__more" to="/drive/rankings">查看全部榜单 →</router-link>
      </section>

      <footer class="drive-footnote">
        路网数据来自 OpenStreetMap 众包数据，里程与走向为估算，不作为导航依据。
      </footer>
    </main>
  </div>
</template>
