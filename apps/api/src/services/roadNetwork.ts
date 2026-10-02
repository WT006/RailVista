/**
 * 万里路书 · 全国公路旅游网 —— L0 索引 / L1 几何读取服务（PRD §3.3）。
 *
 * 纪律（与 driveRoutes.ts / scenicSpots.ts 一致）：
 *   - L0 索引 mtime 指纹缓存，数据文件更新自动重载；
 *   - L1 几何按 key 懒加载 + 进程内 LRU，禁止启动全量读入（单条 50~800KB）；
 *   - key 先过白名单正则（国道/高速 "G318"，省道 "青海:S101"），杜绝路径穿越。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoadGeometry, RoadIndexEntry, RoadNetworkStats, RoadPoint, GapAnnotation } from '@railvista/shared';
import { computeCumKm } from '@railvista/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROADS_DIR = join(__dirname, '../../../../data/roads');
const INDEX_FILES = ['national.json', 'expressway.json', 'provincial.json'] as const;

/** §3.2 主键白名单：国道/高速 G+1~4 位（含 G15W 并行线）；省道及以下 省:编号 */
const KEY_RE = /^G\d{1,4}[WEN]?$|^.+:[SXYC]\d{1,4}$/;

export function isValidRoadKey(key: string): boolean {
  return KEY_RE.test(key);
}

interface IndexFile {
  version: number;
  updated: string;
  count: number;
  roads: RoadIndexEntry[];
}

interface IndexCache {
  mtime: number;
  entries: RoadIndexEntry[];
  updated: string;
}

let indexCache: IndexCache | null = null;

function indexMtime(): number {
  let m = 0;
  for (const f of INDEX_FILES) {
    const p = join(ROADS_DIR, 'index', f);
    if (existsSync(p)) m = Math.max(m, statSync(p).mtimeMs);
  }
  return m;
}

/** L0 索引全量（mtime 变化自动重载） */
export function loadRoadIndex(): { entries: RoadIndexEntry[]; updated: string } {
  const mtime = indexMtime();
  if (indexCache && indexCache.mtime === mtime) {
    return { entries: indexCache.entries, updated: indexCache.updated };
  }
  const entries: RoadIndexEntry[] = [];
  let updated = '';
  for (const f of INDEX_FILES) {
    const p = join(ROADS_DIR, 'index', f);
    if (!existsSync(p)) continue;
    try {
      const idx = JSON.parse(readFileSync(p, 'utf8')) as IndexFile;
      entries.push(...idx.roads);
      updated = idx.updated || updated;
    } catch {
      /* 单文件损坏不阻塞其余分片 */
    }
  }
  indexCache = { mtime, entries, updated };
  return { entries, updated };
}

export function getRoadEntry(key: string): RoadIndexEntry | null {
  return loadRoadIndex().entries.find((r) => r.key === key) ?? null;
}

/**
 * B2-1：读取权威名录里的官方里程。
 *
 * 关键背景：build-road-index.mjs 的 mergeGeometry() 会用几何实测长度
 * **覆盖** 索引里的 lengthKm（见 build-road-index.mjs:241），所以
 * entry.lengthKm 对「有几何」的公路来说是几何长度而非官方里程 ——
 * 直接拿它算覆盖率会得到假性的 100%（G318 实测：index 1953.5 / 官方 5476）。
 * 因此覆盖率必须对权威名录的 officialLengthKm 计算。
 */
let officialCache: { mtime: number; map: Map<string, number> } | null = null;

export function officialLengthKm(key: string): number {
  if (!officialCache) {
    const map = new Map<string, number>();
    for (const f of ['national.json', 'expressway.json', 'provincial.json']) {
      const p = join(ROADS_DIR, 'authoritative', f);
      if (!existsSync(p)) continue;
      try {
        const raw = JSON.parse(readFileSync(p, 'utf8')) as {
          roads?: Array<{ key?: string; ref?: string; province?: string; officialLengthKm?: number }>;
        };
        for (const r of raw.roads ?? []) {
          const k = r.key ?? (r.province && r.ref ? `${r.province}:${r.ref}` : r.ref);
          const km = r.officialLengthKm ?? 0;
          if (k && km > 0) map.set(k, km);
        }
      } catch {
        /* 单文件损坏不阻塞 */
      }
    }
    officialCache = { mtime: indexMtime(), map };
  }
  return officialCache.map.get(key) ?? 0;
}

// ── L1 几何（懒加载 + LRU） ───────────────────────────────────────────────────
// B3-2：LRU 上限 24 < 现有几何文件数 33，浏览超过 24 条路必然抖动，
// 每次 miss 重新 readFileSync + JSON.parse（最大 596KB），且同步 IO 阻塞事件循环。
// 提到 64 可一次覆盖全部在册几何，抖动消失。
const GEOM_LRU_MAX = 64;
const geomCache = new Map<string, RoadGeometry>();
/**
 * 几何缓存的 mtime 指纹。
 * 原实现只按 key 缓存、从不校验文件是否变化 —— 抓取脚本重跑后
 * 几何文件已更新（如补上 endpointsUnverified），但 API 仍返回旧对象，
 * 表现为「改了数据却没生效」。这里与 L0 索引保持同一套 mtime 重载纪律。
 */
let geomMtimeSeen = 0;

function currentGeomMtime(): number {
  let m = 0;
  try {
    for (const f of existsSync(join(ROADS_DIR, 'geom')) ? readdirSync(join(ROADS_DIR, 'geom')) : []) {
      if (!f.endsWith('.json')) continue;
      const p = join(ROADS_DIR, 'geom', f);
      m = Math.max(m, statSync(p).mtimeMs);
    }
  } catch {
    /* 目录不可读时保持既有缓存 */
  }
  return m;
}

export function getRoadGeometry(key: string): RoadGeometry | null {
  if (!isValidRoadKey(key)) return null;
  const mtime = currentGeomMtime();
  if (mtime !== geomMtimeSeen) {
    geomCache.clear();
    overviewCache = null;
    geomMtimeSeen = mtime;
  }
  const hit = geomCache.get(key);
  if (hit) {
    geomCache.delete(key);
    geomCache.set(key, hit);
    return hit;
  }
  const path = join(ROADS_DIR, 'geom', `${key.replace(/[^\w:]/g, '_')}.json`);
  if (!existsSync(path)) return null;
  try {
    const g = JSON.parse(readFileSync(path, 'utf8')) as RoadGeometry;
    if (!Array.isArray(g.points) || g.points.length < 2) return null;
    if (!Array.isArray(g.cumKm) || g.cumKm.length !== g.points.length) {
      g.cumKm = computeCumKm(g.points);
    }
    geomCache.set(key, g);
    if (geomCache.size > GEOM_LRU_MAX) {
      const oldest = geomCache.keys().next().value;
      if (oldest) geomCache.delete(oldest);
    }
    return g;
  } catch {
    return null;
  }
}

/**
 * L1 几何完整读取（含 segments + gapAnnotations + 统计）。
 * segments 缺失时按单段处理（segments: []、segmentCount: 1、gapCount: 0），向后兼容。
 */
export function getRoadGeometryFull(key: string): (RoadGeometry & {
  segments: RoadPoint[][];
  gapAnnotations: GapAnnotation[];
  segmentCount: number;
  gapCount: number;
}) | null {
  const g = getRoadGeometry(key);
  if (!g) return null;
  const segments = Array.isArray(g.segments) ? g.segments : [];
  const gapAnnotations = Array.isArray(g.gapAnnotations) ? g.gapAnnotations : [];
  return { ...g, segments, gapAnnotations, segmentCount: 1 + segments.length, gapCount: gapAnnotations.length };
}

/** 折线抽稀：均匀取样至 ≤ maxPoints（地图渲染用，不改原始几何） */
export function decimatePoints<T extends [number, number, number?]>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(points[Math.round(i * step)]!);
  }
  return out;
}

/**
 * B3-2：overview 结果按索引 mtime 缓存。
 * 原实现每次请求都要遍历 33 条几何、readFileSync + JSON.parse 合计约 5.72MB，
 * 同步 IO 期间阻塞整个事件循环，是「忽好忽坏」（限流 429 / 请求超时）的主要成因之一。
 * 索引 `updated` 天然是缓存键：数据变了索引必然变，缓存自动失效。
 */
let overviewCache: { updated: string; payload: ReturnType<typeof buildNetworkOverview> } | null = null;

/** 地图公路图层：有几何的路线抽稀折线（≤160 点/条） */
export function roadNetworkOverview(): {
  roads: Array<{ key: string; ref: string; name?: string; class: RoadIndexEntry['class']; polyline: [number, number][]; lengthKm: number; segments?: [number, number][][]; gapCount?: number }>;
  updated: string;
} {
  const { updated } = loadRoadIndex();
  if (overviewCache && overviewCache.updated === updated) return overviewCache.payload;
  const payload = buildNetworkOverview();
  overviewCache = { updated, payload };
  return payload;
}

function buildNetworkOverview(): {
  roads: Array<{ key: string; ref: string; name?: string; class: RoadIndexEntry['class']; polyline: [number, number][]; lengthKm: number; segments?: [number, number][][]; gapCount?: number }>;
  updated: string;
} {
  const { entries, updated } = loadRoadIndex();
  const roads = [];
  for (const e of entries) {
    if (!e.hasGeom) continue;
    const g = getRoadGeometry(e.key);
    if (!g) continue;
    const segments =
      Array.isArray(g.segments) && g.segments.length > 0
        ? g.segments.map((seg) => decimatePoints(seg, 160).map((p) => [p[0], p[1]] as [number, number]))
        : undefined;
    const gapCount = Array.isArray(g.gapAnnotations) ? g.gapAnnotations.length : 0;
    roads.push({
      key: e.key,
      ref: e.ref,
      name: e.name,
      class: e.class,
      polyline: decimatePoints(g.points, 160).map((p) => [p[0], p[1]] as [number, number]),
      lengthKm: e.lengthKm,
      segments,
      gapCount: gapCount > 0 ? gapCount : undefined,
    });
  }
  return { roads, updated };
}

/**
 * §3.1 覆盖诚实说明（stats 端点带出，UI 原样展示）。
 * B3-2/A8：原第2 条声称「县道 20~40%，乡道村道 <10%（仅名称）」，
 * 但实测县/乡/村道索引条目为 0 条 —— 不是「仅名称」而是一条都没有。
 * 这里改为如实披露，避免对外误导。
 */
const COVERAGE_NOTES = [
  '路网数据来自 OpenStreetMap 众包，里程与走向为估算，不作为导航依据',
  '几何可查率：国道约 11%（301 条中 33 条已收录）、高速暂未收录、省道暂未收录；县道/乡道/村道名录尚未建设，暂不可查',
  '政策 12 条精品线官方尚未发布逐桩走向表，本产品中的走向为 OSM 编号还原的近似线位',
  '公路几何为 OSM 众包局部还原，与官方走向可能不符；「已贯通里程」可能远小于名义里程',
];

/**
 * B2-1：读取 data/roads/coverage-gap.csv 的质检结论。
 * 索引里的 status 字段全是 ok/unverified（0 条 broken），与质检结论矛盾，
 * 导致前端拿不到「这条几何是坏的」这个信号。此处按 mtime 缓存解析结果。
 */
let qualityCache: { mtime: number; data: NonNullable<RoadNetworkStats['quality']> } | null = null;

function readCoverageQuality(): NonNullable<RoadNetworkStats['quality']> {
  const path = join(ROADS_DIR, 'coverage-gap.csv');
  if (!existsSync(path)) return { noGeometry: 0, broken: 0, suspectGap: 0 };
  const mtime = statSync(path).mtimeMs;
  if (qualityCache && qualityCache.mtime === mtime) return qualityCache.data;
  const out = { noGeometry: 0, broken: 0, suspectGap: 0 };
  try {
    const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      const status = (cells[5] ?? '').trim();
      if (status === 'no-geometry') out.noGeometry += 1;
      else if (status === 'broken') out.broken += 1;
      else if (status === 'suspect_gap') out.suspectGap += 1;
    }
  } catch {
    /* 质检文件缺失不影响主流程 */
  }
  qualityCache = { mtime, data: out };
  return out;
}

export function networkStats(spotCount: number): RoadNetworkStats {
  const { entries, updated } = loadRoadIndex();
  const count = (cls: RoadIndexEntry['class']) => entries.filter((r) => r.class === cls).length;
  const withGeom = entries.filter((r) => r.hasGeom);
  const totalKm = entries.reduce((s, r) => s + (r.hasGeom ? r.lengthKm : 0), 0);
  return {
    national: count('national'),
    expressway: count('expressway'),
    provincial: count('provincial'),
    county: count('county'),
    township: count('township'),
    village: count('village'),
    totalKm: Math.round(totalKm),
    hasGeom: withGeom.length,
    hasGeomRatio: entries.length ? Math.round((withGeom.length / entries.length) * 100) / 100 : 0,
    spotCount,
    quality: readCoverageQuality(),
    coverage: {
      targetNational: 301,
      targetExpressway: 278,
      notes: COVERAGE_NOTES,
    },
    updated,
  };
}
