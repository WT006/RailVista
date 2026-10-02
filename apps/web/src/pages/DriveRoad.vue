<script setup lang="ts">
/**
 * 万里路书 · 单条公路详情页（PRD §2.3 DriveRoad）。
 *
 * G318 这类编号页：全线里程、起点终点、途经省市、分段（几何 nodes）、
 * 沿线景点（走 C2 整条公路入口）、诚实边界标注（估算里程 / 走向还原）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import DriveSubNav from '../components/DriveSubNav.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import { useRoadDraw } from '../composables/useRoadDraw';

usePointerSpotlight();
import outlineRaw from '../assets/china-outline.svg?raw';
import { CHINA_OUTLINE_VIEWBOX, lngLatToViewBox } from '../data/chinaBackdrop';
import { ROAD_COLORS, roadColor, roadClassLabel, classOfRef } from '../data/roadColors';
import type { AlongSpot, RoadIndexEntry, RoadRoute } from '@railvista/shared';

const route = useRoute();
const router = useRouter();
const code = String(route.params.code ?? '');

function tierColor(tier: string): string {
  if (tier === 'A') return ROAD_COLORS.expressway;
  if (tier === 'C') return ROAD_COLORS.provincial;
  return ROAD_COLORS.national;
}

const routePathRef = ref<SVGPathElement | null>(null);
useRoadDraw(routePathRef);

const VIEW_W = CHINA_OUTLINE_VIEWBOX.width;
const VIEW_H = CHINA_OUTLINE_VIEWBOX.height;
const outlinePaths = (() => {
  const m = /<g[^>]*>([\s\S]*?)<\/g>/.exec(outlineRaw);
  return m ? m[1].trim() : '';
})();

const loading = ref(true);
const error = ref('');
/** B3：几何与景点独立降级 —— 索引/几何失败仍展示页面，景点失败给独立重试 */
const indexError = ref('');
const alongError = ref('');
const retryingAlong = ref(false);
const entry = ref<RoadIndexEntry | null>(null);
const roadRoute = ref<RoadRoute | null>(null);
const spots = ref<AlongSpot[]>([]);
const geometryNote = ref('');

/** B2-1：端点可信度与里程覆盖率（来自 /api/drive/road/:key） */
const endpointsUnverified = ref(false);
const connectedKm = ref(0);
const nominalKm = ref(0);
const coveragePct = ref<number | null>(null);

/**
 * B3：索引请求失败但几何成功时，模板仍需要 entry 的若干字段。
 * 这里用 roadKey 合成一个最小可用条目，避免模板解引用 null 而整页白屏。
 */
const entryView = computed<RoadIndexEntry>(() => {
  if (entry.value) return entry.value;
  const roadKey = code.includes(':') ? code.split(':')[1]! : code;
  return {
    key: code,
    ref: roadKey,
    name: undefined,
    class: classOfRef(roadKey),
    provinces: [],
    fromPlace: '—',
    toPlace: '—',
    lengthKm: 0,
    bbox: [0, 0, 0, 0],
    spotCount: 0,
    hasGeom: !!roadRoute.value,
    source: 'osm_only',
    status: 'unverified',
  };
});

const routePath = computed(() => {
  const coords = roadRoute.value?.coords;
  if (!coords || coords.length < 2) return '';
  let d = '';
  coords.forEach(([lng, lat], i) => {
    const [x, y] = lngLatToViewBox(lng, lat);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return d;
});

/** 多段几何（orphan 链）SVG 路径：虚线渲染未贯通段 */
const segmentPaths = computed(() => {
  const segs = roadRoute.value?.segments;
  if (!segs?.length) return [];
  return segs
    .map((seg) => {
      if (seg.length < 2) return '';
      let d = '';
      seg.forEach(([lng, lat], i) => {
        const [x, y] = lngLatToViewBox(lng, lat);
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      });
      return d;
    })
    .filter(Boolean);
});

/** 段间断点标注 */
const gapAnnotations = computed(() => roadRoute.value?.gapAnnotations ?? []);
const hasGaps = computed(() => gapAnnotations.value.length > 0);
const gapKmTotal = computed(() =>
  Math.round(gapAnnotations.value.reduce((s, g) => s + g.gapKm, 0)),
);
const maxGapKm = computed(() =>
  gapAnnotations.value.reduce((m, g) => Math.max(m, g.gapKm), 0).toFixed(1),
);
/** v0.6.0 精度分级与分量数（来自 geom 的 precision / componentCount / stitchedGaps） */
const precision = ref<string | null>(null);
const componentCount = ref(1);
const stitchedGaps = ref(0);
const PRECISION_TEXT: Record<string, string> = {
  A: '走向已核对（与官方里程偏差 ≤10%）',
  B: 'OSM 还原（偏差 ≤25%）',
  C: 'OSM 还原（官方里程未知或偏差更大）',
  X: '走向存疑（偏差 >50%，仅供参考）',
};
const precisionText = computed(() => (precision.value ? PRECISION_TEXT[precision.value] ?? 'OSM 还原' : 'OSM 还原'));

const viewBoxAttr = computed(() => {
  const r = roadRoute.value;
  // 视野必须覆盖「主链 + 全部连通分量」：G318 这类长线的主链与其余分量
  // 可能分处东西两端，只按主链算视野会把大部分线段裁到画布外。
  const all: [number, number][] = [];
  for (const p of r?.coords ?? []) all.push([p[0], p[1]]);
  for (const seg of r?.segments ?? []) for (const p of seg) all.push([p[0], p[1]]);
  if (!all.length) return `0 0 ${VIEW_W} ${VIEW_H}`;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [lng, lat] of all) {
    const [x, y] = lngLatToViewBox(lng, lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const padX = Math.max((maxX - minX) * 0.08, 20);
  const padY = Math.max((maxY - minY) * 0.08, 20);
  return `${(minX - padX).toFixed(1)} ${(minY - padY).toFixed(1)} ${(maxX - minX + padX * 2).toFixed(1)} ${(maxY - minY + padY * 2).toFixed(1)}`;
});

/** 里程分段：按几何 nodes（端点/城市）切段 */
const segments = computed(() => {
  const r = roadRoute.value;
  if (!r?.chapters?.length) return [];
  return r.chapters;
});

/** 沿线景点 Top（按分数） */
const topSpots = computed(() => [...spots.value].sort((a, b) => b.score - a.score).slice(0, 12));

onMounted(load);

/**
 * B3：原先用 Promise.all，任一请求失败即整页红字「加载失败」。
 * 实际数据里 558/591 条路 hasGeom:false —— 此时 getDriveAlong 返 404，
 * 但 getDriveRoad 仍能正常返回索引，属于「部分可用」而非「整页失败」。
 * 改为两个请求各自 settle，互不牵连。
 */
async function load() {
  loading.value = true;
  error.value = '';
  indexError.value = '';
  alongError.value = '';

  const [roadRes, alongRes] = await Promise.allSettled([
    api.getDriveRoad(code),
    api.getDriveAlong({ road: code, max: 200 }),
  ]);

  if (roadRes.status === 'fulfilled') {
    entry.value = roadRes.value.entry;
    geometryNote.value = roadRes.value.note ?? '';
    endpointsUnverified.value = roadRes.value.endpointsUnverified ?? false;
    connectedKm.value = roadRes.value.connectedKm ?? 0;
    nominalKm.value = roadRes.value.nominalKm ?? roadRes.value.entry.lengthKm ?? 0;
    coveragePct.value = roadRes.value.coveragePct ?? null;
    // v0.6.0：精度分级 / 连通分量数 / 缝合断档数（无字段时保持旧行为）
    const extra = roadRes.value as unknown as {
      precision?: string | null;
      segmentCount?: number;
      componentCount?: number;
      stitchedGaps?: number;
    };
    precision.value = extra.precision ?? null;
    componentCount.value = extra.componentCount ?? extra.segmentCount ?? 1;
    stitchedGaps.value = extra.stitchedGaps ?? 0;
  } else {
    indexError.value = roadRes.reason instanceof Error ? roadRes.reason.message : '公路索引加载失败';
  }

  if (alongRes.status === 'fulfilled') {
    roadRoute.value = alongRes.value.route;
    spots.value = alongRes.value.spots;
  } else {
    alongError.value = alongRes.reason instanceof Error ? alongRes.reason.message : '沿途景点加载失败';
  }

  // 索引也没有 → 确实无从展示，整页错误态
  if (!entry.value && !roadRoute.value) {
    error.value = indexError.value || '公路不在册';
  }
  loading.value = false;
}

/** 景点区独立重试（不重载整页） */
async function retryAlong() {
  if (retryingAlong.value) return;
  retryingAlong.value = true;
  alongError.value = '';
  try {
    const data = await api.getDriveAlong({ road: code, max: 200 });
    roadRoute.value = data.route;
    spots.value = data.spots;
  } catch (e) {
    alongError.value = e instanceof Error ? e.message : '沿途景点加载失败';
  } finally {
    retryingAlong.value = false;
  }
}

function goTripLive() {
  void router.push(`/drive/trip?road=${encodeURIComponent(code)}&mode=live`);
}
</script>

<template>
  <div class="drive-page">

    <main class="rv-shell">
      <DriveSubNav />

      <div v-if="loading" class="drive-skeleton">
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
        <div class="drive-skeleton__line drive-skeleton__line--mid" />
        <div class="drive-skeleton__line drive-skeleton__line--wide" />
        <div class="drive-skeleton__line drive-skeleton__line--narrow" />
        <div class="drive-skeleton__line drive-skeleton__line--mid" />
      </div>
      <div v-else-if="error" class="drive-empty drive-empty--error">{{ error }}</div>

      <template v-else>
        <!-- P6：公路详情页 header 重构（鸿蒙布局/排版规范）——
             编号徽章与名称左对齐成行，元信息改为「事实卡」栅格（dt/dd），
             不再是一串裸 span 挤在一行。 -->
        <header class="drive-road-hero">
          <div class="drive-road-hero__id">
            <span
              class="drive-road-hero__ref"
              :style="{ '--prefix-color': roadColor(entryView.class) }"
              aria-hidden="true"
            >{{ entryView.ref }}</span>
            <div class="drive-road-hero__names">
              <p class="drive-road-hero__class">
                {{ roadClassLabel(entryView.class) }}<template v-if="entryView.name"> · {{ entryView.name }}</template>
              </p>
              <!-- B2-1：端点未经验证时不展示「上海 —聂拉木」这种会被误读的标题 -->
              <h1 class="drive-road-hero__title">
                <template v-if="!endpointsUnverified">{{ entryView.fromPlace }} — {{ entryView.toPlace }}</template>
                <template v-else>全线走向（端点待核）</template>
              </h1>
            </div>
          </div>

          <dl class="drive-road-facts">
            <div class="drive-road-fact">
              <dt>收录里程</dt>
              <dd v-if="nominalKm > 0">
                {{ connectedKm }}<small> km</small>
                <em class="drive-road-fact__sub">/ 官方 {{ nominalKm }} km · {{ coveragePct }}%</em>
              </dd>
              <dd v-else-if="roadRoute">{{ roadRoute.lengthKm }}<small> km</small><em class="drive-road-fact__sub">OSM 估算</em></dd>
              <dd v-else>约 {{ entryView.lengthKm }}<small> km</small><em class="drive-road-fact__sub">官方里程</em></dd>
            </div>
            <div v-if="precision" class="drive-road-fact">
              <dt>几何精度</dt>
              <dd>
                <span class="drive-road-precision" :data-grade="precision">{{ precisionText }}</span>
              </dd>
            </div>
            <div v-if="componentCount > 1" class="drive-road-fact">
              <dt>连通情况</dt>
              <dd>{{ componentCount }}<small> 段</small><em class="drive-road-fact__sub">{{ componentCount - 1 }} 处未贯通</em></dd>
            </div>
            <div v-if="entryView.provinces.length" class="drive-road-fact">
              <dt>途经</dt>
              <dd class="drive-road-fact__provs">{{ entryView.provinces.join(' · ') }}</dd>
            </div>
            <div class="drive-road-fact">
              <dt>沿线景点</dt>
              <dd>{{ spots.length }}<small> 处</small></dd>
            </div>
          </dl>
        </header>

        <!-- B2-1：端点标注不可信 / 里程覆盖不足的诚实提示（统一 note 组件样式） -->
        <div v-if="endpointsUnverified" class="drive-road-note" data-grade="warn">
          <strong>端点待核</strong>
          <p>
            端点地名与已收录几何相距较远（远超 50km），因此本页不展示「起点 — 终点」的里程标注：
            已落库的折线只是该编号被 OSM 记录到的部分路段，顺序与真实走向未必一致。
            官方逐桩走向表尚未发布，此处不作导航依据。
          </p>
        </div>
        <div v-else-if="componentCount > 1" class="drive-road-note" data-grade="warn">
          <strong>未完全贯通</strong>
          <p>
            该编号在 OSM 中未贯通：共 {{ componentCount }} 段，合计 {{ connectedKm }} km（另有
            {{ stitchedGaps }} 处 &le;1.5km 的城区断档已按几何接续）。
            虚线段为其余连通分量，不代表实际连接关系。
          </p>
        </div>

        <!-- 几何待补 / 索引失败的诚实提示 -->
        <div v-if="geometryNote" class="drive-road-note" data-grade="info">
          <p>{{ geometryNote }}</p>
        </div>
        <div v-if="indexError" class="drive-road-note" data-grade="danger">
          <strong>公路索引加载失败</strong>
          <p>{{ indexError }}</p>
        </div>

        <!-- B3：几何/景点缺失时的占位说明，而不是整页红字 -->
        <div v-if="!roadRoute && !alongError" class="drive-road-note" data-grade="info">
          <p>
            该公路的几何尚未收录，暂无法展示走向与沿途景点。可先到
            <router-link to="/drive">首页按起点/终点规划</router-link>。
          </p>
        </div>

        <div v-if="roadRoute" class="drive-trip-grid drive-road-grid">
          <section class="drive-trip-map rv-card" data-spotlight>
            <svg :viewBox="viewBoxAttr" class="drive-trip-map__svg" role="img" aria-label="路线示意图">
              <g class="drive-netmap__outline" v-html="outlinePaths" />
              <path ref="routePathRef" class="drive-trip-map__route" :d="routePath" :stroke="roadColor(entryView.class)" />
              <path
                v-for="(d, i) in segmentPaths"
                :key="'seg-' + i"
                class="drive-trip-map__segment"
                :d="d"
                :stroke="roadColor(entryView.class)"
                stroke-dasharray="4 3"
                opacity="0.45"
              />
              <circle
                v-for="s in spots.slice(0, 160)"
                :key="s.id"
                class="drive-trip-map__dot"
                :cx="lngLatToViewBox(s.lng, s.lat)[0]"
                :cy="lngLatToViewBox(s.lng, s.lat)[1]"
                r="2.4"
                :fill="tierColor(s.tier)"
              >
                <title>{{ s.name }} · K{{ Math.round(s.progressKm) }}</title>
              </circle>
            </svg>
            <p class="drive-trip-map__hint">
              全线走向（OSM 众包还原，{{ precisionText }}）
            </p>
            <p v-if="hasGaps" class="drive-trip-map__gap-note">
              ⚠ {{ gapAnnotations.length }} 处未贯通（最大断口约 {{ maxGapKm }} km），虚线段为其余连通分量
            </p>
          </section>

          <aside class="drive-trip-side">
            <section v-if="segments.length" class="rv-card drive-chapters">
              <h2 class="drive-block-title">分段</h2>
              <ul class="drive-chapterlist">
                <li v-for="(ch, i) in segments" :key="i">
                  <span class="drive-chapterlist__range">{{ Math.round(ch.fromKm) }}—{{ Math.round(ch.toKm) }} km</span>
                  {{ ch.title }}
                </li>
              </ul>
            </section>

            <section class="rv-card">
              <h2 class="drive-block-title">沿线景点 Top{{ topSpots.length }}</h2>

              <!-- B3：景点加载失败时的独立错误态 + 重试（不牵连整页） -->
              <div v-if="alongError" class="drive-road-degraded">
                <p>沿途景点加载失败：{{ alongError }}</p>
                <button type="button" class="btn ghost btn-sm" :disabled="retryingAlong" @click="retryAlong">
                  {{ retryingAlong ? '重试中…' : '重试' }}
                </button>
              </div>

              <template v-else>
                <ul v-if="topSpots.length" class="drive-road-spots">
                  <li v-for="s in topSpots" :key="s.id">
                    <span class="drive-spot__km">K{{ Math.round(s.progressKm) }}</span>
                    <span class="drive-road-spot__name">{{ s.name }}</span>
                    <span class="drive-spot__tier" :class="'is-' + s.tier">{{ s.tier }}</span>
                  </li>
                </ul>
                <p v-else class="drive-road-degraded">
                  已收录几何，但该路段暂无匹配景点（景点库仍在扩充中）。
                </p>
                <div class="drive-actions">
                  <router-link class="btn primary btn-sm" :to="`/drive/trip?road=${encodeURIComponent(code)}`">
                    看全部沿程景点 →
                  </router-link>
                  <button type="button" class="btn ghost btn-sm" @click="goTripLive">实时态（我在哪）</button>
                </div>
              </template>
            </section>
          </aside>
        </div>

        <footer class="drive-footnote">
          路网数据来自 OpenStreetMap 众包数据，里程与走向为估算，不作为导航依据。
        </footer>
      </template>
    </main>
  </div>
</template>
