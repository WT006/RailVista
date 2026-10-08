/**
 * 万里路书 · 路书库（Travel Route Book）—— 数据装载与索引服务。
 *
 * 与 driveRoutes.ts 的区别：
 *   driveRoutes   —— 单条精品自驾线路（真实行车几何）
 *   travelRoutes  —— 旅游攻略层（省 → 市 → 路线，玩法不限于自驾）
 *
 * 纪律：
 *   - 数据目录整体读一次后常驻内存（13 条路线 + 区划底座，体量在 200KB 量级）。
 *   - 区划底座的 coverage / routeIds 由 shared 层 applyRouteCoverage 回写，
 *     不在 JSON 里手写 —— 避免「加了路线忘了改区划」。
 *   - 缺失或解析失败的文件直接跳过并计数，不抛栈（这是预生成的静态数据，
 *     单个脏文件不该让整个端点挂掉）。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRAVEL_LAYERS,
  TRAVEL_LAYER_LABEL,
  applyRouteCoverage,
  matchTravelRoute,
  queryTravelRoutes,
  resolveLayer,
  summarizeTravel,
  toTravelSummary,
  type RoadbookProvince,
  type TravelCounts,
  type TravelQuery,
  type TravelRouteDetail,
  type TravelRouteListResult,
  type TravelRouteSummary,
} from '@railvista/shared';

export type { TravelQuery, TravelRouteDetail, TravelRouteSummary, RoadbookProvince };

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROADBOOK_DIR = join(__dirname, '../../../../data/presets/roadbooks');

interface RoadbookFile {
  file: string;
  version: number;
  updated: string;
  area?: string;
  note?: string;
  routes: TravelRouteDetail[];
}

interface LoadResult {
  files: RoadbookFile[];
  routes: TravelRouteDetail[];
  provinces: RoadbookProvince[];
  byId: Map<string, TravelRouteDetail>;
  byFile: Map<string, string[]>;
  skipped: string[];
}

let cache: LoadResult | null = null;

/** 读取区划底座（省 → 地级行政区）。损坏时退化为空数组而不是崩溃。 */
function loadRegions(path: string): RoadbookProvince[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { provinces?: RoadbookProvince[] };
    return raw.provinces ?? [];
  } catch (err) {
    console.warn(`[travelRoutes] _regions.json 解析失败：${(err as Error).message}`);
    return [];
  }
}

/**
 * 装载全部路线文件。
 *
 * 目录遍历在这里是安全的：roadbooks 只有十几个预生成的源文件，
 * 不存在 drive-routes 那种「248 个走廊目录」的量级问题。
 */
function loadAll(): LoadResult {
  const files: RoadbookFile[] = [];
  const skipped: string[] = [];
  const byFile = new Map<string, string[]>();
  const provinces = loadRegions(join(ROADBOOK_DIR, '_regions.json'));

  let names: string[] = [];
  try {
    names = readdirSync(ROADBOOK_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  } catch {
    names = [];
  }

  for (const name of names.sort()) {
    const path = join(ROADBOOK_DIR, name);
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as RoadbookFile;
      const routes = Array.isArray(raw.routes) ? raw.routes : [];
      files.push({
        file: name,
        version: raw.version ?? 1,
        updated: raw.updated ?? '',
        area: raw.area,
        note: raw.note,
        routes,
      });
      byFile.set(name, routes.map((r) => r.id));
    } catch (err) {
      skipped.push(`${name}: ${(err as Error).message}`);
    }
  }

  const routes = files.flatMap((f) => f.routes);
  // coverage / routeIds 回写（顺序：先装路线再算覆盖）
  applyRouteCoverage(provinces, routes);

  const byId = new Map<string, TravelRouteDetail>();
  for (const r of routes) {
    if (byId.has(r.id)) {
      // V12：重复 id 不再静默（构建脚本会对它报错），这里保留 skip 计数并留下运行期日志
      skipped.push(`重复路线 id：${r.id}（后者覆盖前者）`);
    }
    byId.set(r.id, r);
  }

  // R3：数据文件「消失」是本项目最贵的坑 —— 装载缺失必须在服务端留痕，而不是前端显示空列表
  if (skipped.length) {
    console.warn(`[travelRoutes] 装载跳过 ${skipped.length} 项：${skipped.join(' | ')}`);
  }

  return { files, routes, provinces, byId, byFile, skipped };
}

function snapshot(): LoadResult {
  if (!cache) cache = loadAll();
  return cache;
}

/** 开发期热更新：数据文件改了之后清掉缓存即可，不必重启服务。 */
export function invalidateTravelCache(): void {
  cache = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 对外查询
// ═══════════════════════════════════════════════════════════════════════════

export interface TravelRegionsPayload {
  version: number;
  updated: string;
  provinces: RoadbookProvince[];
}

export function getTravelRegions(): TravelRegionsPayload {
  const snap = snapshot();
  return {
    version: 1,
    updated: snap.files.reduce((latest, f) => (f.updated > latest ? f.updated : latest), ''),
    provinces: snap.provinces,
  };
}

export function listTravelRoutes(q: TravelQuery = {}): TravelRouteListResult {
  const snap = snapshot();
  const summaries = snap.routes.map(toTravelSummary);
  const filtered = queryTravelRoutes(summaries, q);
  // counts 始终基于全量而不是筛选结果：列表页要显示「全国有多少条」这种总量
  const counts: TravelCounts = summarizeTravel(summaries);
  return { total: filtered.length, routes: filtered, counts };
}

export function getTravelRoute(id: string): TravelRouteDetail | null {
  return snapshot().byId.get(id) ?? null;
}

export interface TravelSourceStat {
  file: string;
  area?: string;
  updated: string;
  routeCount: number;
  routeIds: string[];
}

export interface TravelOverview {
  totalRoutes: number;
  totalPois: number;
  provinces: RoadbookProvince[];
  files: TravelSourceStat[];
  skipped: string[];
  latestUpdated: string;
}

/** 一次性给列表页用的概览包（区划 + 统计 + 文件清单），避免前端打三次接口。 */
export function getTravelOverview(): TravelOverview {
  const snap = snapshot();
  const counts = summarizeTravel(snap.routes.map(toTravelSummary));
  return {
    totalRoutes: snap.routes.length,
    totalPois: snap.routes.reduce((s, r) => s + r.pois.length, 0),
    provinces: snap.provinces,
    files: snap.files.map((f) => ({
      file: f.file,
      area: f.area,
      updated: f.updated,
      routeCount: f.routes.length,
      routeIds: f.routes.map((r) => r.id),
    })),
    skipped: snap.skipped,
    latestUpdated: snap.files.reduce((latest, f) => (f.updated > latest ? f.updated : latest), ''),
  };
}

export interface TravelFacets {
  provinces: { name: string; shortName: string; count: number }[];
  cities: { name: string; province: string; count: number; coverage: string }[];
  modes: { mode: string; label: string; count: number }[];
  /** 内容分层（L1~L5，固定序 L1→L5）：count 按 resolveLayer() 结果统计，缺层恒为 0 */
  layers: { layer: string; label: string; count: number }[];
  tags: { tag: string; count: number }[];
}

/** 筛选面板的分面值（facet）：每个选项都带路线数量，避免出现点进去是空页。 */
export function getTravelFacets(): TravelFacets {
  const snap = snapshot();
  const summaries: TravelRouteSummary[] = snap.routes.map(toTravelSummary);

  const pCount = new Map<string, number>();
  const cCount = new Map<string, number>();
  const tagCount = new Map<string, number>();
  for (const r of summaries) {
    for (const p of r.provinces) pCount.set(p, (pCount.get(p) ?? 0) + 1);
    for (const c of new Set([...r.cities, r.anchorCity])) cCount.set(c, (cCount.get(c) ?? 0) + 1);
    for (const t of r.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  }

  const shortNameOf = new Map(snap.provinces.map((p) => [p.name, p.shortName]));
  const cityMeta = new Map(
    snap.provinces.flatMap((p) => p.cities.map((c) => [c.name, { province: p.shortName, coverage: c.coverage }])),
  );

  return {
    provinces: [...pCount.entries()]
      .map(([name, count]) => ({ name, shortName: shortNameOf.get(name) ?? name, count }))
      .sort((a, b) => b.count - a.count),
    cities: [...cCount.entries()]
      .map(([name, count]) => ({
        name,
        province: cityMeta.get(name)?.province ?? '',
        coverage: cityMeta.get(name)?.coverage ?? 'todo',
        count,
      }))
      .sort((a, b) => b.count - a.count),
    modes: (['selfdrive', 'charter', 'public', 'cycling', 'hiking', 'mixed'] as const).map((m) => ({
      mode: m,
      label: m,
      count: summaries.filter((r) => matchTravelRoute(r, { mode: m })).length,
    })),
    // 固定序 L1→L5（不用轮转层序）：facets 是「筛选面板」，顺序要稳定可预期
    layers: TRAVEL_LAYERS.map((l) => ({
      layer: l,
      label: TRAVEL_LAYER_LABEL[l],
      count: summaries.filter((r) => resolveLayer(r) === l).length,
    })),
    tags: [...tagCount.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh')),
  };
}

/** 某条公路编号出现在哪些路线里（「走这条路可以玩什么」的反向入口） */
export function getRoutesByRoadRef(ref: string): TravelRouteSummary[] {
  const snap = snapshot();
  const upper = ref.trim().toUpperCase();
  return snap.routes
    .filter((r) => {
      const refs = new Set([...r.roadRefs, ...r.segments.flatMap((s) => s.roadRefs ?? [])]);
      return [...refs].some((x) => x.toUpperCase() === upper);
    })
    .map(toTravelSummary);
}
