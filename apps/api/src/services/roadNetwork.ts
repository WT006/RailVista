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

function geomFilePath(key: string): string {
  return join(ROADS_DIR, 'geom', `${key.replace(/[:/\\*?"<>|]/g, '_')}.json`);
}

/**
 * 索引 hasGeom 是上次完整构建留下的；本机 gitignore 掉 1.5 万条几何后会谎报「有折线」。
 * 加载时按磁盘文件纠正，搜索仍能命中省道，点开则诚实显示「几何待构建」。
 */
function reconcileHasGeomFromDisk(entries: RoadIndexEntry[]): void {
  for (const e of entries) {
    e.hasGeom = existsSync(geomFilePath(e.key));
  }
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
  reconcileHasGeomFromDisk(entries);
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

/**
 * mtime 指纹的采样节流（ms）。
 * 原实现每次 getRoadGeometry() 都遍历 data/roads/geom 全部文件做 statSync：
 * 全国地图一次聚合要取 200+ 条路 × 448 个文件 ≈ 9 万次同步 stat，实测首次构建 42s。
 * 几何是构建期产物、变化以分钟计，5s 内复用上一次采样值完全够用，
 * 且不会漏掉"抓取脚本刚跑完"这种情况（只是最多晚 5s 生效）。
 */
const GEOM_MTIME_TTL_MS = 5000;
let geomMtimeValue = 0;
let geomMtimeAt = 0;

function currentGeomMtime(): number {
  const now = Date.now();
  if (geomMtimeAt && now - geomMtimeAt < GEOM_MTIME_TTL_MS) return geomMtimeValue;
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
  geomMtimeValue = m;
  geomMtimeAt = now;
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
  // 文件名规则必须与 scripts/lib/road-ref.mjs 的 keyToFileName 一致：
  // 只替换 ':' 与文件系统非法字符，中文省名原样保留（改成 \w 会把中文变成 _，
  // 而 ':' 在 Windows 上会被当成 NTFS 数据流，导致省道几何写丢）。
  const path = join(ROADS_DIR, 'geom', `${key.replace(/[:/\\*?"<>|]/g, '_')}.json`);
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
 * v0.6.5：抽稀并**同时返回被选中点的下标**。
 *
 * 背景（P0-1 根因）：/along 响应把主链从 3669 点抽稀到 600 点后返回给前端，
 * 前端为了给「分段」定位折线，只能在这条**降采样后的短链**上重算 haversine 累计里程。
 * 但抽稀本身会「切掉弯道」——点数越少折线越直，累计里程必然缩水
 * （实测 G318 抽稀后重算 1509.5km，而全分辨率是 1627.4km，缩水 117.8km / 7.2%）。
 * 于是末段（1518.6~1568.8km）完全落在重算链之外，遍历不到任何点 → `d=""` → 无高亮。
 * 全量扫描约 2619 条路存在这种「无高亮段」。
 *
 * 为什么不用「等弧长抽稀」：实测它更差（G318 缩水 126.9km / 7.8%）。
 * 抽稀减少点数必然切弯道，重新分布采样点并不能保住总长 —— 这是抽稀的固有代价。
 *
 * 正解：**不要让前端重算里程**。里程是全分辨率链的固有属性，应当在抽稀**之前**
 * 算好、随坐标一起下发（见 `planRoadRoute` 返回的 `cumKm`），
 * 抽稀时按下标同步切片即可保持一一对应。
 *
 * @returns 抽稀后的点 + 每个点在原数组中的下标
 */
export function decimatePointsWithIndex<T extends [number, number, number?]>(
  points: T[],
  maxPoints: number,
): { points: T[]; indices: number[] } {
  if (points.length <= maxPoints) {
    return { points, indices: points.map((_, i) => i) };
  }
  const step = (points.length - 1) / (maxPoints - 1);
  const out: T[] = [];
  const indices: number[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round(i * step);
    indices.push(idx);
    out.push(points[idx]!);
  }
  return { points: out, indices };
}

/**
 * B3-2：overview 结果按索引 mtime 缓存。
 * 原实现每次请求都要遍历 33 条几何、readFileSync + JSON.parse 合计约 5.72MB，
 * 同步 IO 期间阻塞整个事件循环，是「忽好忽坏」（限流 429 / 请求超时）的主要成因之一。
 * 索引 `updated` 天然是缓存键：数据变了索引必然变，缓存自动失效。
 */
/** v0.6.0：地图图层默认只回干线（高速+国道）；等级可选、条数有上限，避免把 1.5 万条几何推给浏览器 */
export const OVERVIEW_DEFAULT_CLASSES: RoadIndexEntry['class'][] = ['expressway', 'national'];

let overviewCache: { updated: string; payload: ReturnType<typeof buildNetworkOverview> } | null = null;

/** 地图公路图层：有几何的路线抽稀折线（≤160 点/条） */
export function roadNetworkOverview(opts: { classes?: RoadIndexEntry['class'][]; limit?: number; maxPoints?: number } = {}): {
  roads: Array<{ key: string; ref: string; name?: string; class: RoadIndexEntry['class']; polyline: [number, number][]; lengthKm: number; segments?: [number, number][][]; gapCount?: number; precision?: string; componentCount?: number }>;
  totals: Record<string, number>;
  updated: string;
} {
  const classes = opts.classes?.length ? opts.classes : OVERVIEW_DEFAULT_CLASSES;
  const limit = Math.max(1, Math.min(2000, opts.limit ?? 600));
  const maxPoints = Math.max(20, Math.min(400, opts.maxPoints ?? 120));
  const cacheKey = classes.join(',') + '|' + limit + '|' + maxPoints;
  const { updated } = loadRoadIndex();
  if (overviewCache && overviewCache.updated === updated + '|' + cacheKey) return overviewCache.payload;
  const payload = buildNetworkOverview(classes, limit, maxPoints);
  overviewCache = { updated: updated + '|' + cacheKey, payload };
  return payload;
}

function buildNetworkOverview(
  classes: RoadIndexEntry['class'][],
  limit: number,
  maxPoints: number,
): {
  roads: Array<{ key: string; ref: string; name?: string; class: RoadIndexEntry['class']; polyline: [number, number][]; lengthKm: number; segments?: [number, number][][]; gapCount?: number; precision?: string; componentCount?: number }>;
  totals: Record<string, number>;
  updated: string;
} {
  const { entries, updated } = loadRoadIndex();
  const totals: Record<string, number> = {};
  for (const e of entries) totals[e.class] = (totals[e.class] ?? 0) + 1;
  const picked = entries
    .filter((e) => e.hasGeom && classes.includes(e.class))
    .sort((a, b) => b.lengthKm - a.lengthKm)
    .slice(0, limit);
  const roads = [];
  for (const e of picked) {
    const g = getRoadGeometry(e.key);
    if (!g) continue;
    // 背景图层不需要其余连通分量：一条干线动辄上百个分量，全带上会让响应涨到 MB 级
    // （实测 8.5MB → 只回主链后 0.9MB）。分量的完整走向由 /drive/road/:key 提供。
    const gapCount = Array.isArray(g.gapAnnotations) ? g.gapAnnotations.length : 0;
    roads.push({
      key: e.key,
      ref: e.ref,
      name: e.name,
      class: e.class,
      polyline: decimatePoints(g.points, maxPoints).map((p) => [p[0], p[1]] as [number, number]),
      lengthKm: e.lengthKm,
      gapCount: gapCount > 0 ? gapCount : undefined,
      precision: e.precision,
      componentCount: e.componentCount,
    });
  }
  return { roads, totals, updated };
}

/**
 * §3.1 覆盖诚实说明（stats 端点带出，UI 原样展示）。
 * B3-2/A8：原第2 条声称「县道 20~40%，乡道村道 <10%（仅名称）」，
 * 但实测县/乡/村道索引条目为 0 条 —— 不是「仅名称」而是一条都没有。
 * 这里改为如实披露，避免对外误导。
 */
const COVERAGE_NOTES = [
  '路网数据来自 OpenStreetMap 众包，里程与走向为估算，不作为导航依据',
  'v0.6.0 起改为「省份 PBF 全量要素库 → 本地装配」：国道/高速/省道/县道/乡道/村道均按编号还原走向，' +
    '不再按编号逐条抓取（OSM 中 89% 的路段没有 ref 标签，按编号抓必然漏段）',
  '里程为「去重后里程」：双向分隔道路的平行对向车道只计一条，与官方里程可比',
  '精度分级 A/B/C：A=与官方里程偏差≤10%，B=≤25%，C=偏差更大或官方里程未知（多为规划调整过编号的老路）',
  '几何由 OSM 共享节点拓扑装配（连通分量 + 直行优先），未贯通处如实标注断点，不做插值拼接',
  '省道/县道/乡道几何是构建产物（data/roads/geom，仓库不入库）。本机需 pnpm roads:build 才能打开编号折线；首页底图 PNG 仍含全等级路网',
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

/** 《国家公路网规划》权威名录 ref 集合（mtime 随索引一起失效即可） */
let authRefCache: { mtime: number; national: Set<string>; expressway: Set<string> } | null = null;

function loadAuthoritativeRefs(): { national: Set<string>; expressway: Set<string> } {
  const mtime = indexMtime();
  if (authRefCache && authRefCache.mtime === mtime) {
    return { national: authRefCache.national, expressway: authRefCache.expressway };
  }
  const load = (file: string): Set<string> => {
    const out = new Set<string>();
    const p = join(ROADS_DIR, 'authoritative', file);
    if (!existsSync(p)) return out;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as {
        roads?: Array<{ key?: string; ref?: string }>;
      };
      for (const r of raw.roads ?? []) {
        const k = r.key ?? r.ref;
        if (k) out.add(k);
      }
    } catch {
      /* 单文件损坏不阻塞 */
    }
    return out;
  };
  const national = load('national.json');
  const expressway = load('expressway.json');
  authRefCache = { mtime, national, expressway };
  return { national, expressway };
}

export function networkStats(spotCount: number): RoadNetworkStats {
  const { entries, updated } = loadRoadIndex();
  const auth = loadAuthoritativeRefs();
  /** 国道/高速「在册」只计权威名录交集，避免 OSM 多编号把分母冲破（曾出现 306/301） */
  const countOfficial = (cls: 'national' | 'expressway', refs: Set<string>) =>
    entries.filter((r) => r.class === cls && refs.has(r.key)).length;
  const count = (cls: RoadIndexEntry['class']) => entries.filter((r) => r.class === cls).length;
  const withGeom = entries.filter((r) => r.hasGeom);
  const totalKm = entries.reduce((s, r) => s + (r.hasGeom ? r.lengthKm : 0), 0);
  const classes: RoadIndexEntry['class'][] = ['expressway', 'national', 'provincial', 'county', 'township', 'village'];
  const coverageByClass = classes.map((cls) => {
    const rows = entries.filter((r) => r.class === cls);
    const geom = rows.filter((r) => r.hasGeom);
    const byPrecision = { A: 0, B: 0, C: 0, X: 0 };
    for (const r of geom) {
      const p = (r as RoadIndexEntry & { precision?: string }).precision;
      if (p === 'A' || p === 'B' || p === 'C' || p === 'X') byPrecision[p] += 1;
    }
    return {
      class: cls,
      total: rows.length,
      withGeometry: geom.length,
      coverage: rows.length ? Math.round((geom.length / rows.length) * 100) / 100 : 0,
      lengthKm: Math.round(rows.reduce((s, r) => s + (r.hasGeom ? r.lengthKm : 0), 0)),
      precision: byPrecision,
    };
  });
  return {
    coverageByClass,
    national: countOfficial('national', auth.national),
    expressway: countOfficial('expressway', auth.expressway),
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
      targetNational: auth.national.size || 301,
      targetExpressway: auth.expressway.size || 278,
      notes: COVERAGE_NOTES,
    },
    updated,
  };
}
