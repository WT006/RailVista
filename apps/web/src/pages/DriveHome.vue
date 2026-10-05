<script setup lang="ts">
/**
 * 万里路书 · 全国公路旅游网首页（PRD §2.3 DriveHome，主功能）。
 *
 * 强制约束（v1 被否的直接原因，属验收项）：首屏不得以榜单为主视觉——
 * 搜索框视觉权重 > 榜单入口，榜单放在第二屏。
 *
 * 结构：
 *   1. App 级背景与铁路选行程页一致（淡轮廓 + 冷蓝景点星点）
 *   2. 起终点 OD 搜索（suggest 四类索引 + geocode 兜底）+ ⇄ 交换
 *   3. 公路编号键盘（对标车次号前缀键盘：G/S/X/Y/C + 数字；S 需先选省）
 *   4. 路网统计 + 覆盖诚实说明（PRD §3.1）
 *   5. 第二屏：榜单入口卡（从属）
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import DriveSubNav from '../components/DriveSubNav.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';

usePointerSpotlight();
import { ROAD_COLORS, roadColor, roadClassLabel, classOfRef } from '../data/roadColors';
import type { PlaceHit, RoadClass } from '@railvista/shared';

const router = useRouter();

/** 路网索引：用于右侧「干线直达」快捷入口与等级图例（背景不再铺路网位图） */
interface RoadBrief {
  key: string;
  ref: string;
  name?: string;
  class: RoadClass;
  lengthKm: number;
}

const roadList = ref<RoadBrief[]>([]);
const netError = ref('');

async function loadNetwork() {
  try {
    const data = await api.getDriveNetworkOverview();
    roadList.value = data.roads
      .filter((r) => r.polyline.length >= 2)
      .map((r) => ({
        key: r.key,
        ref: r.ref,
        name: r.name,
        class: r.class,
        lengthKm: r.lengthKm,
      }));
  } catch (e) {
    netError.value = e instanceof Error ? e.message : '路网图层加载失败';
  }
}

/** 干线直达：按里程取前若干条作快捷入口（背景图上画的就是这些已挂几何的公路） */
const hotRoads = computed(() =>
  [...roadList.value].sort((a, b) => b.lengthKm - a.lengthKm).slice(0, 12),
);

/** 等级图例：与背景路网、编号徽标共用 ROAD_COLORS 单一色板，不硬编码颜色 */
const LEGEND = (['national', 'expressway', 'provincial', 'county'] as RoadClass[]).map((cls) => ({
  cls,
  label: roadClassLabel(cls),
  color: roadColor(cls),
}));

function openRoad(key: string) {
  void router.push({ path: '/drive/trip', query: { road: key } });
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
/**
 * A7：原为单个共享计数器 suggestSeq，导致在「起点」输入后立刻在「终点」输入时，
 * 起点的响应到达后 seq !== suggestSeq 被当作迟到响应丢弃 → 起点下拉永远不弹。
 * 改为每字段独立序号（铁路 SelectTrip.vue 也是 fromActive/toActive 分离设计）。
 */
const suggestSeq = { from: 0, to: 0 };
/** A7：250ms 防抖，避免每次按键都发请求（铁路侧同值） */
let suggestTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSuggest(field: 'from' | 'to') {
  if (suggestTimer) clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => void refreshSuggest(field), 250);
}

async function refreshSuggest(field: 'from' | 'to') {
  const q = (field === 'from' ? from : to).value.trim();
  const seq = ++suggestSeq[field];
  if (!q) {
    if (field === 'from') {
      fromSuggest.value = [];
      fromOpen.value = false;
    } else {
      toSuggest.value = [];
      toOpen.value = false;
    }
    return;
  }
  try {
    // A5：OD 框只接受「地点」，公路编号一律不在此联想 ——
    // 公路编号有独立的「按公路编号直达」区。两个入口混在一个输入框里是自驾最大的 IA 歧义。
    const data = await api.suggestDrivePlaces(q, 'place', 8);
    if (seq !== suggestSeq[field]) return; // 本字段的迟到响应丢弃
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

/**
 * A5：原实现只写 hit.name，丢弃 kind/id/lng/lat —— 公路编号与地名被压成同一个字符串，
 * 「我要走 G318 全程」与「我要从 G318 某点出发」在提交时无法区分。
 * 现在保留结构化对象，提交时按 kind 分流；输入框仍显示 name 以保证可读性。
 */
const fromHit = ref<PlaceHit | null>(null);
const toHit = ref<PlaceHit | null>(null);

function pickHit(field: 'from' | 'to', hit: PlaceHit) {
  if (field === 'from') {
    from.value = hit.name;
    fromHit.value = hit;
    fromOpen.value = false;
  } else {
    to.value = hit.name;
    toHit.value = hit;
    toOpen.value = false;
  }
}

function swapOd() {
  const f = from.value;
  from.value = to.value;
  to.value = f;
  // A5：结构化端点也要一起交换，否则 kind 会与文本错位
  const fh = fromHit.value;
  fromHit.value = toHit.value;
  toHit.value = fh;
}

function goTrip() {
  if (!from.value.trim() || !to.value.trim()) {
    odError.value = '请先填写起点和终点（城市 / 区县级地名）';
    return;
  }
  // A5：任一端选中的是「公路」而非「地点」时，语义是走这条公路的全程，
  // 与点对点规划不同 —— 直接跳单条公路页，不再混在同一个 OD 请求里。
  const roadHit = fromHit.value?.kind === 'road' ? fromHit.value : toHit.value?.kind === 'road' ? toHit.value : null;
  if (roadHit) {
    void router.push({ path: '/drive/trip', query: { road: roadHit.id } });
    return;
  }
  odError.value = '';
  void router.push({ path: '/drive/trip', query: { from: from.value.trim(), to: to.value.trim() } });
}

// ── 公路编号键盘（PRD §4.2，对标车次号前缀键盘） ────────────────────────────
const codeQuery = ref('');
const selectedProvince = ref('');
const roadCandidates = ref<PlaceHit[]>([]);
/** A2：用户当前点选的公路候选（null = 未点选，「设为起点/终点」回退到首条） */
const selectedRoadHit = ref<PlaceHit | null>(null);
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
    selectedRoadHit.value = null;
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
    // A2：候选集变化后，若原选中项已不在新集合内则清空，
    // 避免「设为起点/终点」写进一个用户看不到的旧条目。
    if (selectedRoadHit.value && !hits.some((h) => h.id === selectedRoadHit.value?.id)) {
      selectedRoadHit.value = null;
    }
  } catch {
    roadCandidates.value = [];
    selectedRoadHit.value = null;
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
    void router.push({ path: '/drive/trip', query: { road: hit.id } });
  }
}

/** A2：点选候选时记录选中项，「设为起点/终点」用它而不是列表第一项。 */
function selectRoadHit(hit: PlaceHit) {
  selectedRoadHit.value = selectedRoadHit.value?.id === hit.id ? null : hit;
}

function setRoadAsConstraint(field: 'from' | 'to') {
  // A2：原先恒取 roadCandidates[0]，导致「设为起点」永远设成编号最小的那条。
  // 现在优先用用户点选的条目；未点选时回退到首条（与旧行为一致，不更差）。
  const hit = selectedRoadHit.value ?? roadCandidates.value[0];
  if (!hit) return;
  if (field === 'from') {
    from.value = hit.name;
    fromHit.value = hit;
  } else {
    to.value = hit.name;
    toHit.value = hit;
  }
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
        <div class="drive-home-panel">
          <!-- OD 搜索 -->
          <form
            class="drive-od rv-card"
            data-spotlight
            :class="{ 'has-suggest-open': fromOpen || toOpen }"
            @submit.prevent="goTrip"
          >
            <div class="drive-od__row">
              <label class="station-field">
                <span>起点</span>
                <div class="station-field__control">
                  <input
                    v-model="from"
                    autocomplete="off"
                    placeholder="城市 / 区县，如 上海"
                    @input="scheduleSuggest('from')"
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
                    @input="scheduleSuggest('to')"
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
              <button type="submit" class="btn primary" :disabled="odBusy">
                {{ odBusy ? '规划中…' : '出发' }}
              </button>
              <span class="drive-od__hint">按起终点规划一条自定义路线（在线高德规划，本地干线 A* 兜底）</span>
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
                @keydown.enter.prevent="(selectedRoadHit ?? roadCandidates[0]) && openRoadHit((selectedRoadHit ?? roadCandidates[0])!)"
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
                <button
                  type="button"
                  class="road-kbd__candidate"
                  :class="{ 'is-picked': selectedRoadHit?.id === hit.id }"
                  :aria-pressed="selectedRoadHit?.id === hit.id"
                  @click="selectRoadHit(hit)"
                  @dblclick="openRoadHit(hit)"
                >
                  <span class="road-kbd__badge" :style="{ '--prefix-color': roadColor(classOfRef(hit.name)) }">{{ hit.name }}</span>
                  <span class="road-kbd__candidate-sub">{{ hit.sub }}</span>
                  <span class="road-kbd__candidate-go">查看详情</span>
                </button>
              </li>
            </ul>
            <p v-else-if="codeQuery.trim() && !roadBusy" class="road-kbd__none">
              没有匹配的编号（省道需先选省）
            </p>
            <div v-if="roadCandidates.length" class="drive-actions">
              <p class="road-kbd__hint">
                {{ selectedRoadHit ? `已选 ${selectedRoadHit.name}` : '先点选一条公路，再设为起点/终点' }}
              </p>
              <button
                type="button"
                class="btn ghost btn-sm"
                :disabled="!selectedRoadHit"
                :title="selectedRoadHit ? '' : '请先在上方列表点选一条公路'"
                @click="setRoadAsConstraint('from')"
              >
                设为起点
              </button>
              <button
                type="button"
                class="btn ghost btn-sm"
                :disabled="!selectedRoadHit"
                :title="selectedRoadHit ? '' : '请先在上方列表点选一条公路'"
                @click="setRoadAsConstraint('to')"
              >
                设为终点
              </button>
              <button
                type="button"
                class="btn ghost btn-sm"
                :disabled="!selectedRoadHit"
                @click="selectedRoadHit && openRoadHit(selectedRoadHit)"
              >
                查看该公路
              </button>
            </div>
          </div>
        </div>

        <!-- 路网速览：图例 + 干线直达（背景图即全国公路网，此处不再重复画一张地图） -->
        <aside class="drive-netpanel rv-card" data-spotlight>
          <h2 class="drive-netpanel__title">全国公路网</h2>
          <p class="drive-netpanel__sub">按等级区分已入库干线，可一键进入详情</p>

          <ul class="drive-legend">
            <li v-for="l in LEGEND" :key="l.cls">
              <i class="drive-legend__dot" :style="{ background: l.color }" aria-hidden="true"></i>
              <span>{{ l.label }}</span>
            </li>
          </ul>

          <div class="drive-hotroads">
            <span class="drive-hotroads__label">干线直达 · 按已绘里程排序</span>
            <div v-if="hotRoads.length" class="drive-hotroads__chips">
              <button
                v-for="r in hotRoads"
                :key="r.key"
                type="button"
                class="drive-hotroads__chip"
                :style="{ '--prefix-color': roadColor(r.class) }"
                :title="`${r.ref} ${r.name ?? ''} · 已绘几何 ${Math.round(r.lengthKm)} km（估算，非官方里程）`"
                @click="openRoad(r.key)"
              >
                <b>{{ r.ref }}</b>
                <em>{{ Math.round(r.lengthKm) }} km</em>
              </button>
            </div>
            <p v-if="netError" class="drive-netpanel__note">{{ netError }}</p>
            <p v-else-if="!hotRoads.length" class="drive-netpanel__note">
              路网几何加载中…（暂无可直达的干线）
            </p>
            <p v-else class="drive-netpanel__note">
              里程为已绘制几何长度（估算），非官方里程。
            </p>
          </div>
        </aside>
      </section>

      <!-- 路网统计（国道/高速分母取《国家公路网规划》权威名录） -->
      <section v-if="stats" class="drive-stats" aria-label="路网统计">
        <div class="drive-stat">
          <div class="drive-stat__value">
            {{ stats.national }}<span class="drive-stat__target">/{{ stats.coverage.targetNational }}</span>
          </div>
          <div class="drive-stat__label">普通国道在册</div>
        </div>
        <div class="drive-stat">
          <div class="drive-stat__value">
            {{ stats.expressway }}<span class="drive-stat__target">/{{ stats.coverage.targetExpressway }}</span>
          </div>
          <div class="drive-stat__label">国家高速在册</div>
        </div>
        <div class="drive-stat">
          <div class="drive-stat__value">{{ stats.hasGeom }}</div>
          <div class="drive-stat__label">已收录走向（{{ Math.round(stats.hasGeomRatio * 100) }}%）</div>
        </div>
        <div class="drive-stat">
          <div class="drive-stat__value">{{ stats.spotCount }}</div>
          <div class="drive-stat__label">公路侧景点</div>
        </div>
      </section>

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
