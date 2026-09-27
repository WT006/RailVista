<script setup lang="ts">
/**
 * 线路详情页 /route/:corridorId（可选 ?from=&to=）。
 *
 * 数据来源：GET /api/atlas/corridor/:id（apps/api/src/routes/atlas.ts，只读聚合，不改数据文件）。
 * 接口失败时降级：仍展示头部信息与空景点列表，不阻塞页面。
 *
 * 页面只做「展示」：
 *  - 小地图的 from/to 切片是**最近顶点投影 + 索引区间**的粗略切片，仅用于看图，
 *    不回写、不影响任何行程 / 几何数据链路；
 *  - 「进入实时地图」只把 from/to 通过 query 带回首页预填输入框。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type AtlasCorridorDetail, type AtlasCorridorSpot } from '../api/client';
import { findRankingsByCorridor } from '../data/beautifulRailings';
import {
  SPOT_DIMENSIONS,
  UNCLASSIFIED_DIMENSION,
  dimensionColor,
  dimensionMeta,
  escHtml,
  isKnownDimension,
  type DimensionMeta,
} from '../data/spotDimensions';
import { loadAmap } from '../map/amap';
import { useLenis } from '../composables/useLenis';

useLenis();

const route = useRoute();
const router = useRouter();

const corridorId = computed(() => String(route.params.corridorId || '').trim());

const detail = ref<AtlasCorridorDetail | null>(null);
const loading = ref(true);
const notFound = ref(false);
const loadError = ref('');
const mapError = ref('');

const mapEl = ref<HTMLElement | null>(null);
let map: any = null;
let AMapRef: any = null;
let infoWindow: any = null;
let drawnOverlays: any[] = [];

/** 榜单反查：该走廊出现在哪些榜单 */
const rankHits = computed(() => findRankingsByCorridor(corridorId.value));

/** 展示用的起讫：优先 query，其次榜单条目，最后取 stationsHint 首尾 */
const displayFrom = computed(() => {
  const q = route.query.from;
  if (typeof q === 'string' && q.trim()) return q.trim();
  if (rankHits.value.length) return rankHits.value[0]!.item.from;
  const hint = detail.value?.stationsHint || [];
  return hint.length ? hint[0]! : '';
});

const displayTo = computed(() => {
  const q = route.query.to;
  if (typeof q === 'string' && q.trim()) return q.trim();
  if (rankHits.value.length) return rankHits.value[0]!.item.to;
  const hint = detail.value?.stationsHint || [];
  return hint.length ? hint[hint.length - 1]! : '';
});

const openedYear = computed(() => {
  for (const hit of rankHits.value) {
    if (hit.item.openedYear) return hit.item.openedYear;
  }
  return null;
});

const lengthKm = computed(() => {
  const fromRank = rankHits.value.find((h) => h.item.lengthKm)?.item.lengthKm;
  return fromRank || detail.value?.lengthKm || 0;
});

const stationText = computed(() => {
  const hint = detail.value?.stationsHint || [];
  if (!hint.length) return '';
  if (hint.length <= 12) return hint.join(' · ');
  return `${hint.slice(0, 6).join(' · ')} … ${hint.slice(-4).join(' · ')}`;
});

/** 六维分组 + 未分类兜底（景点可能同时属于多个维度） */
const groups = computed<Array<DimensionMeta & { spots: AtlasCorridorSpot[] }>>(() => {
  const out: Array<DimensionMeta & { spots: AtlasCorridorSpot[] }> = SPOT_DIMENSIONS.map((d) => ({
    ...d,
    spots: [],
  }));
  const other: Array<DimensionMeta & { spots: AtlasCorridorSpot[] }> = [
    { ...UNCLASSIFIED_DIMENSION, spots: [] },
  ];
  for (const spot of detail.value?.spots || []) {
    const dims = (spot.dimensions || []).filter((d) => isKnownDimension(d));
    if (!dims.length) {
      other[0]!.spots.push(spot);
      continue;
    }
    for (const d of dims) {
      const bucket = out.find((x) => x.key === d);
      if (bucket) bucket.spots.push(spot);
    }
  }
  const all = [...out, ...other].map((g) => ({
    ...g,
    spots: g.spots.slice().sort((a, b) => a.alongKm - b.alongKm),
  }));
  return all.filter((g) => g.spots.length > 0);
});

const spotTotal = computed(() => detail.value?.spots.length || 0);
const lineSpotCount = computed(() => detail.value?.lineSpotCount || 0);

/**
 * from/to 粗略切片：站点在 stationsHint 中的序号按比例映射到折线顶点索引。
 * 仅展示用，不落盘、不参与几何链路。
 */
function sliceRailway(
  railway: [number, number][],
  stationsHint: string[],
  from: string,
  to: string,
): [number, number][] {
  if (!from || !to || railway.length < 2 || stationsHint.length < 2) return railway;
  const iF = stationsHint.indexOf(from);
  const iT = stationsHint.indexOf(to);
  if (iF < 0 || iT < 0) return railway;
  const a = Math.min(iF, iT);
  const b = Math.max(iF, iT);
  const toIdx = (i: number) =>
    Math.min(railway.length - 1, Math.round((i / (stationsHint.length - 1)) * (railway.length - 1)));
  const s = toIdx(a);
  const e = toIdx(b);
  if (e - s < 2) return railway;
  return railway.slice(s, e + 1);
}

const displayPath = computed<[number, number][]>(() => {
  const d = detail.value;
  if (!d || !d.railway.length) return [];
  return sliceRailway(d.railway, d.stationsHint || [], displayFrom.value, displayTo.value);
});

function clearOverlays() {
  if (!map) return;
  for (const o of drawnOverlays) {
    try {
      map.remove(o);
    } catch {
      /* ignore */
    }
  }
  drawnOverlays = [];
}

async function drawMap() {
  if (!mapEl.value || !AMapRef) return;
  const path = displayPath.value;
  if (path.length < 2) return;
  clearOverlays();

  const line = new AMapRef.Polyline({
    path,
    strokeColor: 'var(--accent)',
    strokeWeight: 4,
    strokeOpacity: 0.95,
    strokeStyle: 'solid',
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: 60,
    bubble: true,
  });
  map.add(line);
  drawnOverlays.push(line);

  const start = path[0]!;
  const end = path[path.length - 1]!;
  for (const [pos, label, cls] of [
    [start, displayFrom.value, 'route-pin--start'],
    [end, displayTo.value, 'route-pin--end'],
  ] as Array<[[number, number], string, string]>) {
    if (!label) continue;
    const marker = new AMapRef.Marker({
      position: pos,
      anchor: 'center',
      offset: new AMapRef.Pixel(0, 0),
      zIndex: 80,
      content: `<div class="route-pin ${cls}"><span class="route-pin__dot"></span><span class="route-pin__label">${escHtml(label)}</span></div>`,
    });
    map.add(marker);
    drawnOverlays.push(marker);
  }

  // 沿线景点小圆点：最多 80 个，避免小地图上点位过密
  for (const spot of (detail.value?.spots || []).slice(0, 80)) {
    const inSlice = pointNearPath(spot.lng, spot.lat, path);
    if (!inSlice) continue;
    const color = dimensionColor(spot.dimensions);
    const marker = new AMapRef.Marker({
      position: [spot.lng, spot.lat],
      anchor: 'center',
      zIndex: 70,
      title: spot.name,
      content: `<span class="route-spot-dot" style="--dot:${color}"></span>`,
    });
    marker.on('click', () => {
      const dims = (spot.dimensions || [])
        .map((d) => `<span class="iw-dim" style="--dot:${dimensionColor([d])}">${escHtml(dimensionMeta(d).short)}</span>`)
        .join('');
      const html = `<div class="route-iw">
        <p class="route-iw__name">${escHtml(spot.name)}</p>
        <p class="route-iw__meta">沿线 ${spot.alongKm} km · 距线 ${spot.distKm} km${spot.matchKind === 'geo' ? ' · 距离推算' : ''}</p>
        ${dims ? `<p class="route-iw__dims">${dims}</p>` : ''}
        ${spot.intro ? `<p class="route-iw__intro">${escHtml(spot.intro)}</p>` : ''}
      </div>`;
      if (!infoWindow) {
        infoWindow = new AMapRef.InfoWindow({ offset: new AMapRef.Pixel(0, -12), isCustom: true });
      }
      infoWindow.setContent(html);
      infoWindow.open(map, [spot.lng, spot.lat]);
    });
    map.add(marker);
    drawnOverlays.push(marker);
  }

  try {
    map.setFitView([line], false, [40, 30, 40, 30]);
  } catch {
    map.setCenter(path[Math.floor(path.length / 2)]);
  }
}

/** 切片后只画落在切片范围内的景点：距任一端点不超过整段跨度的一定比例 */
function pointNearPath(lng: number, lat: number, path: [number, number][]): boolean {
  if (path.length < 2) return false;
  let minD = Number.POSITIVE_INFINITY;
  for (const [x, y] of path) {
    const dx = (lng - x) * 100;
    const dy = (lat - y) * 100;
    const d = dx * dx + dy * dy;
    if (d < minD) minD = d;
  }
  // 0.35 度（约 35km）以内视为在该段沿线
  return minD <= 0.35 * 0.35 * 100 * 100;
}

async function initMap() {
  const key = import.meta.env.VITE_AMAP_KEY;
  if (!key) {
    mapError.value = '未配置 VITE_AMAP_KEY，地图不可用（其余信息正常展示）';
    return;
  }
  try {
    AMapRef = await loadAmap(key, import.meta.env.VITE_AMAP_SECURITY);
  } catch {
    mapError.value = '地图脚本加载失败，其余信息正常展示';
    return;
  }
  if (!mapEl.value) return;
  map = new AMapRef.Map(mapEl.value, {
    zoom: 5,
    center: displayPath.value[0] || [104, 35],
    viewMode: '2D',
    mapStyle: 'amap://styles/grey',
  });
  await drawMap();
}

async function load() {
  loading.value = true;
  notFound.value = false;
  loadError.value = '';
  detail.value = null;
  const id = corridorId.value;
  if (!id) {
    notFound.value = true;
    loading.value = false;
    return;
  }
  try {
    detail.value = await api.getAtlasCorridor(id);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'NOT_FOUND' || code === 'BAD_REQUEST') {
      notFound.value = true;
    } else {
      loadError.value = e instanceof Error ? e.message : '线路数据加载失败';
    }
  } finally {
    loading.value = false;
  }
}

function goBack() {
  if (window.history.length > 1) router.back();
  else void router.push('/');
}

/** 「进入实时地图」：回首页并预填 OD（SelectTrip 读取 query，仅赋值不触发查询） */
function goLiveMap() {
  const q: Record<string, string> = {};
  if (displayFrom.value) q.from = displayFrom.value;
  if (displayTo.value) q.to = displayTo.value;
  void router.push({ path: '/', query: q });
}

/** 青藏线专属：走既有 Z8991 演示链路（首页 loadDemo → /api/presets/z8991） */
function goZ8991Demo() {
  void router.push({ path: '/', query: { demo: 'z8991' } });
}

function goAtlas() {
  void router.push('/atlas');
}

onMounted(async () => {
  await load();
  await initMap();
});

onUnmounted(() => {
  try {
    if (infoWindow) infoWindow.close();
  } catch {
    /* ignore */
  }
  clearOverlays();
  try {
    if (map) map.destroy?.();
  } catch {
    /* ignore */
  }
  map = null;
});

// 同一路由下切换 corridorId（排行榜 → 详情页互跳）时重载
watch(corridorId, async () => {
  await load();
  if (map) await drawMap();
});
</script>

<template>
  <div class="route-page">
    <header class="route-top">
      <button type="button" class="back-link" aria-label="返回" @click="goBack">‹</button>
      <div class="route-top__title">
        <p class="route-top__eyebrow">ROUTE DETAIL</p>
        <h1>{{ detail?.name || corridorId || '线路详情' }}</h1>
      </div>
      <button type="button" class="route-top__ghost" @click="goAtlas">全国地图 ›</button>
    </header>

    <main class="route-body">
      <p v-if="loading" class="route-tip">正在加载线路数据…</p>

      <section v-else-if="notFound" class="route-empty">
        <h2>没有找到这条线路</h2>
        <p>corridorId「{{ corridorId }}」暂未收录，或链接已失效。</p>
        <button type="button" class="route-btn route-btn--primary" @click="goBack">返回榜单</button>
      </section>

      <template v-else>
        <section v-if="loadError" class="route-warn">
          线路几何/景点数据加载失败（{{ loadError }}），以下仅展示榜单信息。
        </section>

        <section class="route-head">
          <div class="route-head__od">
            <span class="route-od">{{ displayFrom || '—' }} → {{ displayTo || '—' }}</span>
            <span v-if="lengthKm" class="route-chip">{{ lengthKm }} km</span>
            <span v-if="openedYear" class="route-chip">{{ openedYear }} 年通车</span>
          </div>
          <div v-if="rankHits.length" class="route-head__ranks">
            <span class="route-head__ranks-label">所属榜单</span>
            <span v-for="hit in rankHits" :key="hit.ranking.id" class="route-rank-badge">
              {{ hit.ranking.title }} · 第 {{ hit.item.rank }} 名
            </span>
          </div>
          <p v-if="detail?.name" class="route-head__tagline">
            {{ rankHits[0]?.item.tagline || '沿线风景概览' }}
          </p>
        </section>

        <section class="route-map-card">
          <div v-show="!mapError" ref="mapEl" class="route-map"></div>
          <p v-if="mapError" class="route-map-error">{{ mapError }}</p>
          <p v-if="stationText" class="route-map-stations">{{ stationText }}</p>
        </section>

        <div class="route-actions">
          <button type="button" class="route-btn route-btn--primary" @click="goLiveMap">
            进入实时地图
          </button>
          <button
            v-if="corridorId === 'qingzang'"
            type="button"
            class="route-btn route-btn--ghost"
            @click="goZ8991Demo"
          >
            Z8991 演示
          </button>
        </div>

        <section class="route-spots">
          <h2 class="route-spots__title">
            沿线景点
            <span class="route-spots__count">
              {{ spotTotal }} 处<template v-if="lineSpotCount">（{{ lineSpotCount }} 处数据明确标注）</template>
            </span>
          </h2>

          <p v-if="!spotTotal" class="route-tip">
            这条线路暂未收录沿线景点，可到「全国铁路景点地图」看看附近的风景。
          </p>

          <div v-for="g in groups" :key="g.key" class="route-group">
            <h3 class="route-group__title">
              <span class="route-dot" :style="{ '--dot': g.color }"></span>
              {{ g.label }}
              <span class="route-group__count">{{ g.spots.length }}</span>
            </h3>
            <ul class="route-group__list">
              <li v-for="s in g.spots" :key="`${g.key}-${s.id}`" class="route-spot">
                <div class="route-spot__head">
                  <span class="route-spot__name">{{ s.name }}</span>
                  <span class="route-spot__km">{{ s.alongKm }} km</span>
                </div>
                <p v-if="s.intro" class="route-spot__intro">{{ s.intro }}</p>
                <p class="route-spot__meta">
                  <span>距线 {{ s.distKm }} km</span>
                  <span v-if="s.matchKind === 'geo'" class="route-spot__infer">距离推算</span>
                  <span v-if="s.category" class="route-spot__cat">{{ s.category }}</span>
                </p>
              </li>
            </ul>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.route-page {
  min-height: 100%;
  padding: 14px 14px 40px;
  background: var(--bg-base);
  color: var(--text-secondary);
}

.route-top {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 560px;
  margin: 0 auto 12px;
}

.route-top__title {
  flex: 1;
  min-width: 0;
}

.route-top__eyebrow {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--accent);
  font-weight: 700;
}

.route-top__title h1 {
  margin: 1px 0 0;
  font-size: 18px;
  font-weight: 700;
}

.route-top__ghost {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: var(--border-hairline);
  color: var(--text-secondary);
  font-size: 11.5px;
  cursor: pointer;
}

.route-body {
  max-width: 560px;
  margin: 0 auto;
  display: grid;
  gap: 12px;
}

.route-tip {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.route-empty,
.route-warn {
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--border-default);
  background: var(--bg-elevated);
}

.route-empty h2 {
  margin: 0 0 6px;
  font-size: 15px;
}

.route-empty p {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.route-warn {
  font-size: 12px;
  color: var(--warning);
  border-color: rgba(223, 179, 87, 0.32);
  background: rgba(223, 179, 87, 0.08);
}

/* ── 头部信息条 ── */
.route-head {
  display: grid;
  gap: 6px;
  padding: 12px 13px;
  border-radius: 14px;
  border: 1px solid var(--border-default);
  background: linear-gradient(180deg, var(--bg-elevated), var(--bg-raised));
}

.route-head__od {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.route-od {
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--accent-container);
  background: var(--accent-container);
  color: var(--accent-hover);
  font-size: 12px;
  font-weight: 600;
}

.route-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--border-hairline);
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.route-head__ranks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.route-head__ranks-label {
  font-size: 11px;
  color: var(--text-muted);
}

.route-rank-badge {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(223, 179, 87, 0.32);
  background: rgba(223, 179, 87, 0.1);
  color: var(--warning);
  font-size: 11px;
}

.route-head__tagline {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* ── 小地图 ── */
.route-map-card {
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--border-default);
  background: var(--bg-inset);
}

.route-map {
  width: 100%;
  height: 260px;
}

.route-map-error {
  margin: 0;
  padding: 16px 13px;
  font-size: 12px;
  color: var(--text-muted);
}

.route-map-stations {
  margin: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--border-hairline);
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* ── 操作按钮 ── */
.route-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.route-btn {
  padding: 9px 16px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: transform var(--dur-micro) var(--ease-out), filter var(--dur-micro) var(--ease-out);
}

.route-btn:hover {
  transform: translateY(-1px);
}

.route-btn--primary {
  background: linear-gradient(180deg, var(--accent), var(--accent-press));
  color: var(--bg-base);
}

.route-btn--ghost {
  border-color: var(--border-strong);
  background: var(--border-hairline);
  color: var(--text-secondary);
}

/* ── 景点分组 ── */
.route-spots {
  display: grid;
  gap: 10px;
}

.route-spots__title {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
}

.route-spots__count {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.route-group {
  padding: 10px 11px;
  border-radius: 12px;
  border: 1px solid var(--border-hairline);
  background: var(--bg-elevated);
}

.route-group__title {
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-secondary);
}

.route-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--dot, var(--text-muted));
}

.route-group__count {
  font-size: 10.5px;
  font-weight: 400;
  color: var(--text-muted);
}

.route-group__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.route-spot {
  padding: 8px 9px;
  border-radius: 10px;
  background: var(--bg-inset);
  border: 1px solid var(--border-hairline);
}

.route-spot__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.route-spot__name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}

.route-spot__km {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--accent-hover);
  font-variant-numeric: tabular-nums;
}

.route-spot__intro {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.55;
}

.route-spot__meta {
  margin: 4px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 10.5px;
  color: var(--text-muted);
}

.route-spot__infer {
  color: var(--warning);
}

@media (max-width: 480px) {
  .route-map {
    height: 220px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .route-btn {
    transition: none;
  }
}
</style>

<style>
/* AMap 注入的 DOM 不受 scoped 约束，单独写全局片段 */
.route-pin {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--bg-base);
  border: 1px solid var(--border-strong);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.route-pin__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--accent);
}

.route-pin--end .route-pin__dot {
  background: var(--warning);
}

.route-spot-dot {
  display: block;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--dot, var(--text-muted));
  box-shadow: 0 0 0 2px var(--bg-raised);
}

.route-iw {
  max-width: 230px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.route-iw__name {
  margin: 0;
  font-size: 12.5px;
  font-weight: 700;
}

.route-iw__meta {
  margin: 3px 0 0;
  font-size: 10.5px;
  color: var(--accent-hover);
}

.route-iw__dims {
  margin: 5px 0 0;
  display: flex;
  gap: 4px;
}

.iw-dim {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dot, var(--text-muted));
  color: var(--bg-base);
  font-size: 10px;
  font-weight: 700;
}

.route-iw__intro {
  margin: 5px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
}
</style>
