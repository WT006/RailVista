/**
 * 万里路书 · 全国公路旅游网 —— L0 索引 / L1 几何读取服务（PRD §3.3）。
 *
 * 纪律（与 driveRoutes.ts / scenicSpots.ts 一致）：
 *   - L0 索引 mtime 指纹缓存，数据文件更新自动重载；
 *   - L1 几何按 key 懒加载 + 进程内 LRU，禁止启动全量读入（单条 50~800KB）；
 *   - key 先过白名单正则（国道/高速 "G318"，省道 "青海:S101"），杜绝路径穿越。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoadGeometry, RoadIndexEntry, RoadNetworkStats } from '@railvista/shared';
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

// ── L1 几何（懒加载 + LRU） ───────────────────────────────────────────────────
const GEOM_LRU_MAX = 24;
const geomCache = new Map<string, RoadGeometry>();

export function getRoadGeometry(key: string): RoadGeometry | null {
  if (!isValidRoadKey(key)) return null;
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

/** 地图公路图层：有几何的路线抽稀折线（≤160 点/条） */
export function roadNetworkOverview(): {
  roads: Array<{ key: string; ref: string; name?: string; class: RoadIndexEntry['class']; polyline: [number, number][]; lengthKm: number }>;
  updated: string;
} {
  const { entries, updated } = loadRoadIndex();
  const roads = [];
  for (const e of entries) {
    if (!e.hasGeom) continue;
    const g = getRoadGeometry(e.key);
    if (!g) continue;
    roads.push({
      key: e.key,
      ref: e.ref,
      name: e.name,
      class: e.class,
      polyline: decimatePoints(g.points, 160).map((p) => [p[0], p[1]] as [number, number]),
      lengthKm: e.lengthKm,
    });
  }
  return { roads, updated };
}

/** §3.1 覆盖诚实说明（stats 端点带出，UI 原样展示） */
const COVERAGE_NOTES = [
  '路网数据来自 OpenStreetMap 众包，里程与走向为估算，不作为导航依据',
  '高速/国道几何可查率 85~95%，省道 50~70%，县道 20~40%，乡道村道 <10%（仅名称）',
  '政策 12 条精品线官方尚未发布逐桩走向表，本产品中的走向为 OSM 编号还原的近似线位',
];

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
    coverage: {
      targetNational: 301,
      targetExpressway: 278,
      notes: COVERAGE_NOTES,
    },
    updated,
  };
}
