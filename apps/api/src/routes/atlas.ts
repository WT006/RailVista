/**
 * 全国铁路景点地图（/atlas）只读聚合路由。
 *
 * 严格只读：仅 readFileSync 读取 data/presets/**，**不修改任何数据文件**。
 * 模式照抄 routes/presets.ts。
 *
 * - GET /api/atlas/overview   → 全部走廊（折线抽稀 ≤300 点）+ 全量景点 + 景点↔线路归属统计
 * - GET /api/atlas/corridor/:id → 单条走廊完整折线（线路详情页小地图用）
 *
 * 双源融合（v0.5.5）：一次请求同时返回铁路与公路两套数据，前端单页叠加显示。
 *   铁路：corridors（248 走廊）+ spots（铁路景点，来自 data/presets/scenic-spots.json）
 *   公路：roadCorridors（已挂几何的编号公路）+ roadSpots（公路侧景点，来自
 *        data/roads/roadside-spots.json，**排除 source=migrated:* 的铁路迁移条**）
 */
import { Hono } from 'hono';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenicSpots } from '../services/scenicSpots.js';
import { roadNetworkOverview } from '../services/roadNetwork.js';
import { getRoadsideSpots } from '../services/roadsideSpots.js';
import { dedupeAtlasRoadSpots, isAtlasRoadDisplaySpot } from '@railvista/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const presetsDir = join(__dirname, '../../../../data/presets');
const corridorsDir = join(presetsDir, 'corridors');
const spotsPath = join(presetsDir, 'scenic-spots.json');
// 公路侧（双源融合的另一半）：编号公路几何 + 公路景点库
const roadsDir = join(__dirname, '../../../../data/roads');
const GEOM_DIR = join(roadsDir, 'geom');
const SPOTS_PATH = join(roadsDir, 'roadside-spots.json');

export const atlasRoute = new Hono();

/** 每条走廊抽稀后的最大点数（等距抽样，必含首尾） */
const MAX_POLYLINE_POINTS = 300;
/** 几何归属判定：默认半径（km），按景点自身 maxDistKm 覆盖并夹在区间内 */
const GEO_MIN_KM = 5;
const GEO_MAX_KM = 40;
const GEO_DEFAULT_KM = 20;
/** 网格索引cell 边长（度），约 25km */
const GRID_CELL_DEG = 0.25;
/** 聚合结果缓存时长（ms）——数据文件是静态的，缓存只为避免每次请求重算几何归属 */
const OVERVIEW_TTL_MS = 60_000;

type CorridorFile = {
  id?: string;
  name?: string;
  stationsHint?: string[];
  railway?: Array<[number, number]>;
  note?: string;
};

export type AtlasCorridor = {
  id: string;
  name: string;
  stationsHint: string[];
  polyline: [number, number][];
  /** 景点 lines[].corridorId 明确标注的数量 */
  lineSpotCount: number;
  /** 按沿线距离推算得到的景点数量 */
  geoSpotCount: number;
  /** 综合展示用：line 优先，无 line 时用 geo */
  spotCount: number;
  spotIds: string[];
  lengthKm: number;
};

export type AtlasSpot = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  intro?: string;
  category?: string;
  dimensions?: string[];
  lines?: Array<{ corridorId?: string; alongKmFrom?: number; alongKmTo?: number; distKm?: number }>;
  /** 所属走廊（line 标注优先，其次几何推算） */
  corridorIds: string[];
  /** line = 数据明确标注；geo = 按沿线距离推算；null = 未归属 */
  matchKind: 'line' | 'geo' | null;
  /** 数据来源：rail=铁路景点库，road=公路景点库（前端合并筛选/着色时用） */
  origin?: 'rail' | 'road';
  /** 采集/库内省份。公路侧只作来源标签；展示用前端 displayProvince / displayCity */
  province?: string;
  /** 观赏评分（0–100）：公路侧有，铁路侧数据源无此字段 */
  score?: number;
  /** 质量分级 A/B/C */
  tier?: string;
  /** 公路景点来源：hand-curated / osm_batch … */
  source?: string;
  /** OSM 海拔（米），图集用来挡测绘小山峰 */
  ele?: number;
  /** OSM 是否挂了 wikipedia / wikipedia:zh / wikidata */
  hasWiki?: boolean;
};

/** 线路详情页用：景点在该走廊上的里程位置 */
export type AtlasCorridorSpot = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  intro?: string;
  category?: string;
  dimensions: string[];
  /** line = 数据明确标注；geo = 按沿线距离推算 */
  matchKind: 'line' | 'geo' | null;
  /** 距线路起点的沿线里程（km） */
  alongKm: number;
  /** 到线路的最近距离（km） */
  distKm: number;
};

/** 公路线路（编号公路，仅含已挂几何的） */
export type AtlasRoadCorridor = {
  key: string;
  ref: string;
  name?: string;
  class: string;
  polyline: [number, number][];
  lengthKm: number;
  /** 沿线 20km 内的公路景点数 */
  spotCount: number;
  spotIds: string[];
};

export type AtlasOverview = {
  corridors: AtlasCorridor[];
  spots: AtlasSpot[];
  /** 公路线路（双源融合的公路侧） */
  roadCorridors: AtlasRoadCorridor[];
  /** 公路侧景点（已排除从铁路迁移来的条目） */
  roadSpots: AtlasSpot[];
  meta: {
    corridorCount: number;
    spotCount: number;
    roadCorridorCount: number;
    /** 图集落图数量（已滤测绘噪音） */
    roadSpotCount: number;
    /** 公路原生景点库总量（未做落图过滤） */
    roadSpotLibraryCount: number;
    /** 公路景点库中被排除的铁路迁移条数量 */
    roadMigratedExcluded: number;
    generatedAt: string;
    buildMs: number;
  };
};

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** 等距抽样抽稀到 maxPoints，必含首尾点 */
function thinPolyline(points: Array<[number, number]>, maxPoints: number): Array<[number, number]> {
  const valid = (points || []).filter(
    (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  );
  if (valid.length <= maxPoints) return valid.map(([lng, lat]) => [round4(lng), round4(lat)] as [number, number]);
  const out: Array<[number, number]> = [];
  const step = (valid.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round(i * step);
    const p = valid[Math.min(valid.length - 1, idx)];
    out.push([round4(p[0]), round4(p[1])]);
  }
  return out;
}

function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function polylineLengthKm(points: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += haversineKm(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return sum;
}

/**
 * 把景点投影到走廊折线上，得到「沿线里程 + 离线距离」。
 * 局部切平面近似（与 shared/schedule 的定侧算法同一套 KM_PER_DEG 常数），
 * 仅在展示层用于排序与「距线 X km」提示，不参与任何几何/行程计算。
 */
function projectAlongKm(
  poly: Array<[number, number]>,
  lng: number,
  lat: number,
): { alongKm: number; distKm: number } {
  if (poly.length < 2) return { alongKm: 0, distKm: 0 };
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const kx = 111.32 * cosLat;
  const ky = 110.574;
  let acc = 0;
  let bestAlong = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 1; i < poly.length; i += 1) {
    const [x1, y1] = poly[i - 1]!;
    const [x2, y2] = poly[i]!;
    const segKm = haversineKm(x1, y1, x2, y2);
    const vx = (x2 - x1) * kx;
    const vy = (y2 - y1) * ky;
    const px = (lng - x1) * kx;
    const py = (lat - y1) * ky;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? (px * vx + py * vy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = x1 + (x2 - x1) * t;
    const cy = y1 + (y2 - y1) * t;
    const d = haversineKm(lng, lat, cx, cy);
    if (d < bestDist) {
      bestDist = d;
      bestAlong = acc + segKm * t;
    }
    acc += segKm;
  }
  return { alongKm: Math.round(bestAlong * 10) / 10, distKm: Math.round(bestDist * 10) / 10 };
}

function listCorridorFiles(): string[] {
  if (!existsSync(corridorsDir)) return [];
  return readdirSync(corridorsDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
}

function readCorridor(file: string): CorridorFile | null {
  try {
    return JSON.parse(readFileSync(join(corridorsDir, file), 'utf8')) as CorridorFile;
  } catch {
    return null;
  }
}

function geoRadiusKm(maxDistKm?: number): number {
  const raw = Number.isFinite(maxDistKm) && (maxDistKm as number) > 0 ? (maxDistKm as number) : GEO_DEFAULT_KM;
  return Math.min(GEO_MAX_KM, Math.max(GEO_MIN_KM, raw));
}

type RawSpot = {
  id?: string;
  name?: string;
  lng?: number;
  lat?: number;
  intro?: string;
  category?: string;
  dimensions?: string[];
  maxDistKm?: number;
  lines?: Array<{ corridorId?: string; alongKmFrom?: number; alongKmTo?: number; distKm?: number }>;
};

/**
 * 用网格索引把景点几何归属到走廊：
 * 全部走廊折线点入格 → 每个景点只查半径内的格子，避免 432 × 248 × 300 的全量比对。
 */
function buildGeoIndex(corridors: Array<{ id: string; polyline: Array<[number, number]> }>) {
  const grid = new Map<string, Array<{ cid: string; lng: number; lat: number }>>();
  for (const c of corridors) {
    for (const [lng, lat] of c.polyline) {
      const key = `${Math.floor(lng / GRID_CELL_DEG)}:${Math.floor(lat / GRID_CELL_DEG)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push({ cid: c.id, lng, lat });
      else grid.set(key, [{ cid: c.id, lng, lat }]);
    }
  }
  return grid;
}

function geoMatch(
  grid: ReturnType<typeof buildGeoIndex>,
  lng: number,
  lat: number,
  radiusKm: number,
): Map<string, number> {
  const best = new Map<string, number>();
  const dLat = radiusKm / 111;
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLng = radiusKm / (111 * cosLat);
  const x0 = Math.floor((lng - dLng) / GRID_CELL_DEG);
  const x1 = Math.floor((lng + dLng) / GRID_CELL_DEG);
  const y0 = Math.floor((lat - dLat) / GRID_CELL_DEG);
  const y1 = Math.floor((lat + dLat) / GRID_CELL_DEG);
  for (let cx = x0; cx <= x1; cx += 1) {
    for (let cy = y0; cy <= y1; cy += 1) {
      const bucket = grid.get(`${cx}:${cy}`);
      if (!bucket) continue;
      for (const p of bucket) {
        const d = haversineKm(lng, lat, p.lng, p.lat);
        if (d > radiusKm) continue;
        const prev = best.get(p.cid);
        if (prev == null || d < prev) best.set(p.cid, d);
      }
    }
  }
  return best;
}

let overviewCache: { at: number; data: AtlasOverview } | null = null;

/**
 * 公路侧单独缓存。
 * 铁路侧的 overviewCache 只有 60s TTL，而公路侧构建要读几何 + 遍历上万景点
 * （实测 42s），若跟着 60s 一起重建会周期性卡死请求链路。
 * 公路数据变更极少（路网几何 + 景点库都是构建期产物），故按「文件指纹 + 10 分钟」
 * 双条件缓存：数据没变就一直复用。
 */
const ROAD_TTL_MS = 600_000;
type RoadLayerCache = {
  stamp: string;
  at: number;
  data: {
    roadCorridors: AtlasRoadCorridor[];
    roadSpots: AtlasSpot[];
    excluded: number;
    /** 公路原生景点库总量（未做图集落图过滤） */
    libraryCount: number;
  };
};
let roadCache: RoadLayerCache | null = null;
let cacheStamp = '';

function stamp(): string {
  let spotsMtime = 0;
  try {
    spotsMtime = existsSync(spotsPath) ? statSync(spotsPath).mtimeMs : 0;
  } catch {
    spotsMtime = 0;
  }
  let corridorCount = 0;
  let corridorMtime = 0;
  try {
    const files = listCorridorFiles();
    corridorCount = files.length;
    for (const f of files) {
      const st = statSync(join(corridorsDir, f)).mtimeMs;
      if (st > corridorMtime) corridorMtime = st;
    }
  } catch {
    /* ignore */
  }
  return `${spotsMtime}|${corridorCount}|${corridorMtime}`;
}

function buildOverview(): AtlasOverview {
  const t0 = Date.now();
  const files = listCorridorFiles();
  const corridors: Array<{ id: string; name: string; stationsHint: string[]; polyline: Array<[number, number]>; lengthKm: number; full: Array<[number, number]> }> = [];

  for (const file of files) {
    const raw = readCorridor(file);
    if (!raw) continue;
    const id = String(raw.id || file.replace(/\.json$/, ''));
    const full = Array.isArray(raw.railway) ? raw.railway : [];
    if (full.length < 2) continue;
    const polyline = thinPolyline(full, MAX_POLYLINE_POINTS);
    corridors.push({
      id,
      name: String(raw.name || id),
      stationsHint: Array.isArray(raw.stationsHint) ? raw.stationsHint.slice(0, 40) : [],
      polyline,
      lengthKm: Math.round(polylineLengthKm(full)),
      full,
    });
  }

  const rawSpots = (loadScenicSpots() as unknown as RawSpot[]) || [];
  const grid = buildGeoIndex(corridors);

  const lineIdsByCorridor = new Map<string, string[]>();
  const geoIdsByCorridor = new Map<string, string[]>();
  const spots: AtlasSpot[] = [];

  for (const s of rawSpots) {
    const lng = Number(s.lng);
    const lat = Number(s.lat);
    const id = String(s.id || s.name || '');
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !id) continue;

    // 1) 数据明确标注（权威）
    const lineIds: string[] = [];
    for (const l of s.lines || []) {
      const cid = l?.corridorId ? String(l.corridorId) : '';
      if (cid && !lineIds.includes(cid)) lineIds.push(cid);
    }
    // 2) 几何推算（数据尚未标注 lines 时的兜底，供「哪些地方景点多」统计）
    const geo = geoMatch(grid, lng, lat, geoRadiusKm(s.maxDistKm));
    const geoIds = [...geo.keys()];

    const merged: string[] = [];
    for (const cid of [...lineIds, ...geoIds]) {
      if (!merged.includes(cid)) merged.push(cid);
    }

    for (const cid of lineIds) {
      const arr = lineIdsByCorridor.get(cid);
      if (arr) arr.push(id);
      else lineIdsByCorridor.set(cid, [id]);
    }
    for (const cid of geoIds) {
      const arr = geoIdsByCorridor.get(cid);
      if (arr) arr.push(id);
      else geoIdsByCorridor.set(cid, [id]);
    }

    spots.push({
      id,
      name: String(s.name || id),
      lng: round4(lng),
      lat: round4(lat),
      intro: s.intro,
      category: s.category,
      dimensions: Array.isArray(s.dimensions) ? s.dimensions : undefined,
      // v0.6.3：透出省份供前端省份筛选（铁路侧约 328/760 有值，如实透传，不补假数据）
      province:
        typeof (s as unknown as Record<string, unknown>).province === 'string' &&
        String((s as unknown as Record<string, unknown>).province)
          ? String((s as unknown as Record<string, unknown>).province)
          : undefined,
      lines: s.lines,
      corridorIds: merged,
      matchKind: lineIds.length ? 'line' : geoIds.length ? 'geo' : null,
    });
  }

  const out: AtlasCorridor[] = corridors.map((c) => {
    const lineIds = lineIdsByCorridor.get(c.id) || [];
    const geoIds = (geoIdsByCorridor.get(c.id) || []).filter((x) => !lineIds.includes(x));
    return {
      id: c.id,
      name: c.name,
      stationsHint: c.stationsHint,
      polyline: c.polyline,
      lineSpotCount: lineIds.length,
      geoSpotCount: geoIds.length,
      spotCount: lineIds.length || geoIds.length,
      spotIds: lineIds.length ? lineIds : geoIds,
      lengthKm: c.lengthKm,
    };
  });

  // ── 公路侧（双源融合）：线路 + 公路原生景点 ────────────────────────────────
  // 任一侧加载失败都不影响铁路侧（Promise 级别的降级在前端，这里用 try 兜住即可）
  const road = getRoadLayer();
  const roadCorridors = road.roadCorridors;
  const roadSpots = road.roadSpots;
  const roadMigratedExcluded = road.excluded;
  const roadSpotLibraryCount = road.libraryCount;

  // 铁路景点补来源标记，前端合并成一个列表时可区分
  for (const s of spots) s.origin = 'rail';

  return {
    corridors: out,
    spots,
    roadCorridors,
    roadSpots,
    meta: {
      corridorCount: out.length,
      spotCount: spots.length,
      roadCorridorCount: roadCorridors.length,
      /** 图集实际落图（已滤测绘噪音） */
      roadSpotCount: roadSpots.length,
      /** 公路原生库总量，供 UI「展示 N / 库内 M」 */
      roadSpotLibraryCount,
      roadMigratedExcluded,
      generatedAt: new Date().toISOString(),
      buildMs: Date.now() - t0,
    },
  };
}

/** 公路图层指纹：几何目录与景点库任一变化即失效；含落图规则版本以免规则改了仍吃旧缓存 */
function roadStamp(): string {
  // 与落图/去重规则同步 bump（v3 = 近名去重 + 城区限流）
  let out = 'atlas-road-display:v3|';
  try {
    if (existsSync(SPOTS_PATH)) out += String(statSync(SPOTS_PATH).mtimeMs);
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(GEOM_DIR)) {
      for (const f of readdirSync(GEOM_DIR).slice(0, 400)) {
        if (!f.endsWith('.json')) continue;
        out += `${f}:${statSync(join(GEOM_DIR, f)).mtimeMs};`;
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function getRoadLayer(): RoadLayerCache['data'] {
  const now = Date.now();
  const cur = roadStamp();
  if (roadCache && roadCache.stamp === cur && now - roadCache.at < ROAD_TTL_MS) {
    return roadCache.data;
  }
  const data = buildRoadLayer();
  roadCache = { stamp: cur, at: now, data };
  return data;
}

function buildRoadLayer(): RoadLayerCache['data'] {
  const empty = {
    roadCorridors: [] as AtlasRoadCorridor[],
    roadSpots: [] as AtlasSpot[],
    excluded: 0,
    libraryCount: 0,
  };
  try {
    // 取 250 条上限：索引里 hasGeom 标了 15107 条，但实际几何文件只有 448 个
    // （既有数据不一致，本轮不修数据），按里程降序取前 250 条能覆盖到全部
    // 真实有几何的干线（约 201 条），剩下的会因文件缺失被 buildNetworkOverview 跳过。
    const { roads } = roadNetworkOverview({ limit: 250, maxPoints: 160 });
    const all = getRoadsideSpots() as unknown as Array<Record<string, unknown>>;
    // 公路网只显示公路原生景点；source=migrated:* 是早期从铁路侧迁来的，
    // 它们的坐标贴铁路走廊，画在公路网上位置就是错的（需求方明确指出的严重问题）
    const native = all.filter((s) => !String(s.source ?? '').startsWith('migrated'));
    const excluded = all.length - native.length;
    const libraryCount = native.length;

    const roadGrid = buildGeoIndex(roads.map((r) => ({ id: r.key, polyline: r.polyline })));
    const roadIdsByKey = new Map<string, string[]>();
    const candidates: AtlasSpot[] = [];
    for (const s of native) {
      const lng = Number(s.lng);
      const lat = Number(s.lat);
      const id = String(s.id ?? s.name ?? '');
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !id) continue;
      const tags = s.osmTags && typeof s.osmTags === 'object' ? (s.osmTags as Record<string, unknown>) : {};
      const ele = Number.parseFloat(String(tags.ele ?? ''));
      const name = String(s.name ?? id);
      const score = Number.isFinite(Number(s.score)) ? Number(s.score) : undefined;
      const category = typeof s.category === 'string' ? s.category : undefined;
      const source = typeof s.source === 'string' && s.source ? s.source : undefined;
      const hasWiki = Boolean(tags.wikipedia || tags['wikipedia:zh'] || tags.wikidata);
      if (
        !isAtlasRoadDisplaySpot({
          name,
          lng,
          lat,
          score,
          category,
          source,
          ele: Number.isFinite(ele) ? ele : undefined,
        })
      ) {
        continue;
      }
      candidates.push({
        id,
        name,
        lng: round4(lng),
        lat: round4(lat),
        intro: typeof s.intro === 'string' ? s.intro.slice(0, 60) : undefined,
        category,
        province: typeof s.province === 'string' && s.province ? s.province : undefined,
        score,
        tier: typeof s.tier === 'string' ? s.tier : undefined,
        source,
        ele: Number.isFinite(ele) ? ele : undefined,
        hasWiki: hasWiki || undefined,
        corridorIds: [],
        matchKind: null,
        origin: 'road',
      });
    }
    // 近名合并 + 城区密集聚限流（城门群 / 馆群），再挂公路归属
    const roadSpots = dedupeAtlasRoadSpots(candidates);
    for (const spot of roadSpots) {
      const keys = [...geoMatch(roadGrid, spot.lng, spot.lat, 20).keys()];
      spot.corridorIds = keys;
      spot.matchKind = keys.length ? 'geo' : null;
      for (const k of keys) {
        const arr = roadIdsByKey.get(k);
        if (arr) arr.push(spot.id);
        else roadIdsByKey.set(k, [spot.id]);
      }
    }
    const roadCorridors: AtlasRoadCorridor[] = roads.map((r) => {
      const ids = roadIdsByKey.get(r.key) ?? [];
      return {
        key: r.key,
        ref: r.ref,
        name: r.name,
        class: r.class,
        polyline: r.polyline,
        lengthKm: r.lengthKm,
        spotCount: ids.length,
        spotIds: ids,
      };
    });
    return { roadCorridors, roadSpots, excluded, libraryCount };
  } catch {
    // 公路侧不可用（无路网数据/服务未初始化）：铁路侧完整保留
    return empty;
  }
}

function getOverview(): AtlasOverview {
  const now = Date.now();
  const cur = stamp();
  if (overviewCache && cacheStamp === cur && now - overviewCache.at < OVERVIEW_TTL_MS) {
    return overviewCache.data;
  }
  const data = buildOverview();
  overviewCache = { at: now, data };
  cacheStamp = cur;
  return data;
}

atlasRoute.get('/overview', (c) => {
  try {
    const data = getOverview();
    /*
     * v0.6.3：此处**不再**返回 roadCorridors / roadSpots。
     * 公路侧一旦并入，响应体从 ~200KB 涨到 4.4MB（624 铁路 + 1.2 万公路景点），
     * 浏览器要解析 4.4MB JSON 再把 1.2 万个点交给 AMap 聚类，主线程长时间阻塞，
     * 表现为「可选要素一直不加载、页面卡住」（实测冷加载路径）。
     * 公路侧改由 /atlas/road 按需提供：meta 里仍带 roadSpotCount 等轻量计数，
     * 侧栏能显示「铁路 624 · 公路 12087」，但明细等用户真要看公路时才拉。
     */
    const { roadCorridors: _rc, roadSpots: _rs, ...railOnly } = data;
    return c.json({ ok: true, data: railOnly });
  } catch (e) {
    return c.json(
      { ok: false, error: { code: 'ATLAS_FAIL', message: e instanceof Error ? e.message : '聚合失败' } },
      500,
    );
  }
});

/** v0.6.3：公路侧明细（编号公路折线 + 公路原生景点），前端按需拉取 */
atlasRoute.get('/road', (c) => {
  try {
    const { roadCorridors, roadSpots, meta } = getOverview();
    return c.json({
      ok: true,
      data: {
        roadCorridors,
        roadSpots,
        meta: {
          roadCorridorCount: meta.roadCorridorCount,
          roadSpotCount: meta.roadSpotCount,
          roadSpotLibraryCount: meta.roadSpotLibraryCount,
          roadMigratedExcluded: meta.roadMigratedExcluded,
          generatedAt: meta.generatedAt,
        },
      },
    });
  } catch (e) {
    return c.json(
      { ok: false, error: { code: 'ATLAS_ROAD_FAIL', message: e instanceof Error ? e.message : '公路图层聚合失败' } },
      500,
    );
  }
});

atlasRoute.get('/corridor/:id', (c) => {
  const id = String(c.req.param('id') || '').trim();
  if (!id) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: '缺少 corridorId' } }, 400);
  }
  const file = join(corridorsDir, `${id}.json`);
  if (!existsSync(file)) {
    return c.json(
      { ok: false, error: { code: 'NOT_FOUND', message: `走廊不存在：${id}` } },
      404,
    );
  }
  try {
    const raw = readCorridor(`${id}.json`);
    const railway = Array.isArray(raw?.railway) ? raw!.railway! : [];
    const overview = getOverview();
    const hit = overview.corridors.find((x) => x.id === id);
    const spotIds = hit?.spotIds || [];

    // 详情页景点：数据 lines 标注优先，其次几何推算；统一按沿线里程升序
    const idSet = new Set(spotIds);
    const corridorSpots: AtlasCorridorSpot[] = [];
    for (const s of overview.spots) {
      if (!idSet.has(s.id)) continue;
      const lineRef = (s.lines || []).find((l) => l?.corridorId === id);
      const proj = projectAlongKm(railway, s.lng, s.lat);
      corridorSpots.push({
        id: s.id,
        name: s.name,
        lng: s.lng,
        lat: s.lat,
        intro: s.intro,
        category: s.category,
        dimensions: Array.isArray(s.dimensions) ? s.dimensions : [],
        matchKind: s.matchKind,
        // lines 里写了里程就以数据为准，否则用投影推算
        alongKm:
          lineRef && Number.isFinite(lineRef.alongKmFrom)
            ? Number(lineRef.alongKmFrom)
            : proj.alongKm,
        distKm: Number.isFinite(lineRef?.distKm) ? Number(lineRef!.distKm) : proj.distKm,
      });
    }
    corridorSpots.sort((a, b) => a.alongKm - b.alongKm);

    return c.json({
      ok: true,
      data: {
        id,
        name: String(raw?.name || id),
        stationsHint: Array.isArray(raw?.stationsHint) ? raw!.stationsHint : [],
        note: raw?.note,
        railway: railway.map(([lng, lat]) => [round4(lng), round4(lat)] as [number, number]),
        lengthKm: hit?.lengthKm ?? Math.round(polylineLengthKm(railway)),
        spotIds,
        lineSpotCount: hit?.lineSpotCount || 0,
        geoSpotCount: hit?.geoSpotCount || 0,
        spots: corridorSpots,
      },
    });
  } catch (e) {
    return c.json(
      { ok: false, error: { code: 'ATLAS_FAIL', message: e instanceof Error ? e.message : '读取失败' } },
      500,
    );
  }
});
