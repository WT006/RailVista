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
 *  - 「进入实时地图」进入全屏线路地图（/route/:id/map），不再回首页选车。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type AtlasCorridorDetail, type AtlasCorridorSpot } from '../api/client';
import { ATLAS_RAIL_STROKE } from '../data/atlasColors';
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
import {
  addMarker,
  addPolyline,
  createInfoWindow,
  createMap,
  loadMapEngine,
  type InfoWindowHandle,
  type MapHandle,
  type MarkerHandle,
  type PolylineHandle,
} from '../map/engine';

/** MapLibre paint 只认实色，不认 CSS 变量 */
function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const route = useRoute();
const router = useRouter();

const corridorId = computed(() => String(route.params.corridorId || '').trim());

const detail = ref<AtlasCorridorDetail | null>(null);
const loading = ref(true);
const notFound = ref(false);
const loadError = ref('');
const mapError = ref('');

const mapEl = ref<HTMLElement | null>(null);
let map: MapHandle | null = null;
let infoWindow: InfoWindowHandle | null = null;
let drawnOverlays: Array<PolylineHandle | MarkerHandle> = [];

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
  map?.clearInfoWindow();
  for (const o of drawnOverlays) {
    try {
      o.remove();
    } catch {
      /* ignore */
    }
  }
  drawnOverlays = [];
}

async function drawMap() {
  if (!map) return;
  const path = displayPath.value;
  if (path.length < 2) return;
  clearOverlays();

  const line = await addPolyline(map, {
    path,
    color: readToken('--rail', ATLAS_RAIL_STROKE),
    weight: 4,
    opacity: 0.95,
    zIndex: 60,
  });
  drawnOverlays.push(line);

  const start = path[0]!;
  const end = path[path.length - 1]!;
  for (const [pos, label, cls] of [
    [start, displayFrom.value, 'route-pin--start'],
    [end, displayTo.value, 'route-pin--end'],
  ] as Array<[[number, number], string, string]>) {
    if (!label) continue;
    const marker = addMarker(map, {
      position: pos,
      anchor: 'center',
      zIndex: 80,
      contentHtml: `<div class="route-pin ${cls}"><span class="route-pin__dot"></span><span class="route-pin__label">${escHtml(label)}</span></div>`,
    });
    drawnOverlays.push(marker);
  }

  for (const spot of (detail.value?.spots || []).slice(0, 80)) {
    const inSlice = pointNearPath(spot.lng, spot.lat, path);
    if (!inSlice) continue;
    const color = dimensionColor(spot.dimensions);
    const marker = addMarker(map, {
      position: [spot.lng, spot.lat],
      anchor: 'center',
      zIndex: 70,
      title: spot.name,
      contentHtml: `<span class="route-spot-dot" style="--dot:${color}"></span>`,
    });
    marker.onClick(() => {
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
        infoWindow = createInfoWindow({ offsetPx: [0, -12] });
      }
      infoWindow.setContent(html);
      infoWindow.open(map!, [spot.lng, spot.lat]);
    });
    drawnOverlays.push(marker);
  }

  try {
    map.fitBounds(line.getBoundsCoords(), { top: 40, right: 30, bottom: 40, left: 30 }, false);
  } catch {
    map.setCenter(path[Math.floor(path.length / 2)]!);
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
  if (!import.meta.env.VITE_TIANDITU_TK) {
    mapError.value = '未配置 VITE_TIANDITU_TK，地图不可用（其余信息正常展示）';
    return;
  }
  try {
    await loadMapEngine();
  } catch {
    mapError.value = '地图引擎加载失败，其余信息正常展示';
    return;
  }
  if (!mapEl.value) return;
  map = createMap(mapEl.value, {
    zoom: 5,
    center: displayPath.value[0] || [104, 35],
  });
  await new Promise<void>((resolve) => {
    if (map!.raw.isStyleLoaded()) resolve();
    else map!.raw.once('load', () => resolve());
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

/** 优先回上一页（榜单 / 全国地图）；无历史时回选程首页 */
function goBack() {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back();
    return;
  }
  void router.push('/');
}

/** 「进入实时地图」：直达全屏线路地图，跳过选车页 */
function goLiveMap() {
  const id = corridorId.value;
  if (!id) return;
  const q: Record<string, string> = {};
  if (displayFrom.value) q.from = displayFrom.value;
  if (displayTo.value) q.to = displayTo.value;
  void router.push({ path: `/route/${id}/map`, query: q });
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
    infoWindow?.close();
  } catch {
    /* ignore */
  }
  clearOverlays();
  try {
    map?.destroy();
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
      <button type="button" class="route-back" @click="goBack">
        <span class="route-back__icon" aria-hidden="true">‹</span>
        返回
      </button>
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
        <button type="button" class="route-btn route-btn--primary" @click="goBack">返回主页</button>
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
  position: relative;
  z-index: 1;
  min-height: 100%;
  /* 勿用 padding 简写：会盖掉 base.css 按断点设的 padding-top
     （手机 safe-top / ≥840 appbar-offset），导致返回栏被 sticky 顶栏压住。 */
  padding-inline: 14px;
  /* 底部避让悬浮页签胶囊（--bottomnav-h 已含 8vp 悬浮留白）+ Home 指示条安全区 */
  padding-bottom: calc(40px + var(--bottomnav-h) + env(safe-area-inset-bottom, 0px));
  /* 半透明遮罩压住背景星点，卡片再叠一层；勿用全透明否则字叠光斑。
     双声明：不支持 color-mix 时回退不透明底，避免整页透穿。 */
  background: var(--surface-0);
  background: color-mix(in srgb, var(--surface-0) 78%, transparent);
  color: var(--text-2);
}

.route-top {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 560px;
  margin: 0 auto 12px;
}

.route-back {
  appearance: none;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 36px;
  padding: 0 12px 0 8px;
  border: 1px solid var(--line-default);
  border-radius: var(--radius-full);
  background: var(--surface-1);
  color: var(--text-1);
  font-family: inherit;
  font-size: var(--fs-meta);
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  box-shadow: var(--elev-1);
}

.route-back:hover {
  border-color: var(--line-accent);
  background: var(--surface-2);
}

.route-back__icon {
  font-size: 20px;
  line-height: 1;
  margin-top: -1px;
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
  border-radius: var(--radius-full);
  border: 1px solid var(--line-default);
  background: var(--line-hairline);
  color: var(--text-2);
  font-size: var(--fs-micro);
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
  color: var(--text-3);
}

.route-empty,
.route-warn {
  padding: 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-default);
  background: var(--surface-2);
}

.route-empty h2 {
  margin: 0 0 6px;
  font-size: 15px;
}

.route-empty p {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--text-3);
}

.route-warn {
  font-size: 12px;
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 32%, transparent);
  background: color-mix(in srgb, var(--warning) 8%, transparent);
}

/* ── 头部信息条 ── */
.route-head {
  display: grid;
  gap: 6px;
  padding: 12px 13px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-default);
  background: var(--surface-1);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--surface-0) 45%, var(--surface-2)),
    color-mix(in srgb, var(--surface-0) 40%, var(--surface-1))
  );
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.route-head__od {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.route-od {
  padding: 2px 9px;
  border-radius: var(--radius-full);
  border: 1px solid var(--accent-soft);
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-size: 12px;
  font-weight: 600;
}

.route-chip {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--line-hairline);
  color: var(--text-3);
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
  color: var(--text-3);
}

.route-rank-badge {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  border: 1px solid color-mix(in srgb, var(--warning) 32%, transparent);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  color: var(--warning);
  font-size: 11px;
}

.route-head__tagline {
  margin: 0;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
}

/* ── 小地图 ── */
.route-map-card {
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--line-default);
  background: var(--surface-sunken);
  background: color-mix(in srgb, var(--surface-0) 50%, var(--surface-sunken));
}

.route-map {
  width: 100%;
  height: 260px;
}

.route-map-error {
  margin: 0;
  padding: 16px 13px;
  font-size: 12px;
  color: var(--text-3);
}

.route-map-stations {
  margin: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--line-hairline);
  font-size: 11px;
  color: var(--text-3);
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
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: transform var(--dur-micro) var(--ease-standard), filter var(--dur-micro) var(--ease-standard);
}

.route-btn:hover {
  transform: translateY(-1px);
}

.route-btn--primary {
  background: linear-gradient(180deg, var(--accent), var(--accent-press));
  color: var(--surface-0);
}

.route-btn--ghost {
  border-color: var(--line-strong);
  background: var(--line-hairline);
  color: var(--text-2);
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
  color: var(--text-3);
}

.route-group {
  padding: 10px 11px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-hairline);
  background: var(--surface-2);
  background: color-mix(in srgb, var(--surface-0) 42%, var(--surface-2));
  backdrop-filter: blur(var(--glass-blur-tile)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur-tile)) saturate(var(--glass-saturate));
}

.route-group__title {
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-cap);
  font-weight: 700;
  color: var(--text-2);
}

.route-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--dot, var(--text-3));
}

.route-group__count {
  font-size: var(--fs-micro);
  font-weight: 400;
  color: var(--text-3);
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
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  border: 1px solid var(--line-hairline);
}

.route-spot__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.route-spot__name {
  font-size: var(--fs-cap);
  font-weight: 600;
  color: var(--text-1);
}

.route-spot__km {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--accent-hover);
  font-variant-numeric: tabular-nums;
}

.route-spot__intro {
  margin: 3px 0 0;
  font-size: var(--fs-micro);
  color: var(--text-3);
  line-height: 1.55;
}

.route-spot__meta {
  margin: 4px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: var(--fs-micro);
  color: var(--text-3);
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
  border-radius: var(--radius-full);
  background: var(--surface-0);
  border: 1px solid var(--line-strong);
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
}

.route-pin__dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--accent);
}

.route-pin--end .route-pin__dot {
  background: var(--warning);
}

.route-spot-dot {
  display: block;
  width: 9px;
  height: 9px;
  border-radius: var(--radius-full);
  background: var(--dot, var(--text-3));
  box-shadow: 0 0 0 2px var(--surface-1);
}

.route-iw {
  max-width: 230px;
  padding: 9px 11px;
  border-radius: var(--radius-sm);
  background: var(--surface-0);
  border: 1px solid var(--line-default);
  color: var(--text-2);
}

.route-iw__name {
  margin: 0;
  font-size: var(--fs-cap);
  font-weight: 700;
}

.route-iw__meta {
  margin: 3px 0 0;
  font-size: var(--fs-micro);
  color: var(--accent-hover);
}

.route-iw__dims {
  margin: 5px 0 0;
  display: flex;
  gap: 4px;
}

.iw-dim {
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--dot, var(--text-3));
  color: var(--surface-0);
  font-size: 10px;
  font-weight: 700;
}

.route-iw__intro {
  margin: 5px 0 0;
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.5;
}
</style>
