/**
 * 万里路书 · 路书库（Travel Route Book）
 *
 * 提供「省 → 市 → 路线」三层的数据契约 + 零依赖筛选/统计纯函数。
 * API 侧与 Web 侧共用本模块，保证列表筛选逻辑只有一份。
 */
export * from './types.js';

import type {
  RoadbookCity,
  RoadbookProvince,
  TravelPoiCategory,
  TravelRouteDetail,
  TravelSegment,
} from './types.js';
import {
  TRAVEL_POI_CATEGORY_LABEL,
  TRAVEL_MODE_LABEL,
  TRAVEL_SHAPE_LABEL,
  TRAVEL_TIER_LABEL,
  TRAVEL_DIFFICULTY_LABEL,
  TravelDifficulty,
} from './types.js';

export const ROADBOOK_POI_CATEGORIES = Object.keys(
  TRAVEL_POI_CATEGORY_LABEL,
) as TravelPoiCategory[];

export { TRAVEL_MODE_LABEL, TRAVEL_SHAPE_LABEL, TRAVEL_TIER_LABEL, TRAVEL_DIFFICULTY_LABEL };

export function difficultyText(d: number): string {
  return TRAVEL_DIFFICULTY_LABEL[(Math.min(5, Math.max(1, d)) as TravelDifficulty)] ?? '中等';
}

export function modeText(mode: string): string {
  return TRAVEL_MODE_LABEL[mode as keyof typeof TRAVEL_MODE_LABEL] ?? mode;
}

export function shapeText(shape: string): string {
  return TRAVEL_SHAPE_LABEL[shape as keyof typeof TRAVEL_SHAPE_LABEL] ?? shape;
}

export function tierText(tier: string): string {
  return TRAVEL_TIER_LABEL[tier as keyof typeof TRAVEL_TIER_LABEL] ?? tier;
}

// ═══════════════════════════════════════════════════════════════════════════
// Schema 校验：给装载器与构建脚本共用（发现断链比线上崩更有价值）
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationIssue {
  level: 'error' | 'warn';
  routeId?: string;
  field?: string;
  message: string;
}

const REQUIRED_STRING_FIELDS: (keyof TravelRouteDetail)[] = [
  'id',
  'name',
  'subtitle',
  'anchorCity',
  'summary',
  'startNode',
  'endNode',
];

/** 校验单条路线。返回 error/warn 列表；装载器遇到 error 应拒绝入库。 */
export function validateTravelRoute(r: TravelRouteDetail): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (level: 'error' | 'warn', message: string, field?: string) =>
    issues.push({ level, routeId: r?.id, field, message });

  for (const f of REQUIRED_STRING_FIELDS) {
    if (typeof r[f] !== 'string' || !String(r[f]).trim()) push('error', `缺少必填字段 ${String(f)}`, String(f));
  }
  if (!Array.isArray(r.provinces) || !r.provinces.length) push('error', 'provinces 不能为空', 'provinces');
  if (!Array.isArray(r.cities) || !r.cities.length) push('error', 'cities 不能为空', 'cities');
  if (!Array.isArray(r.modes) || !r.modes.length) push('error', 'modes 不能为空', 'modes');
  else if (!r.modes.includes(r.primaryMode)) push('error', 'primaryMode 必须包含在 modes 中', 'primaryMode');
  if (typeof r.totalKm !== 'number' || !(r.totalKm > 0)) push('error', 'totalKm 必须为正数', 'totalKm');
  if (typeof r.days !== 'number' || !(r.days > 0)) push('error', 'days 必须为正整数', 'days');
  if (r.difficulty < 1 || r.difficulty > 5) push('error', 'difficulty 需在 1~5', 'difficulty');
  if (!r.intro?.overview) push('error', '缺少整体介绍 intro.overview', 'intro');
  if (!r.intro?.bestSeason) push('warn', '缺少最佳季节文字说明', 'intro.bestSeason');
  if (!r.intro?.difficultyNote) push('warn', '缺少难度成因说明', 'intro.difficultyNote');
  if (!r.intro?.audience?.length) push('warn', '缺少适合人群', 'intro.audience');
  if (r.intro?.days && r.intro.days !== r.days) {
    push('warn', `intro.days(${r.intro.days}) 与 days(${r.days}) 不一致`, 'intro.days');
  }

  const nodeNames = new Set<string>();
  for (const n of r.nodes ?? []) {
    if (!n?.name) continue;
    if (nodeNames.has(n.name)) push('error', `节点名重复：${n.name}`, 'nodes');
    nodeNames.add(n.name);
    if (!Number.isFinite(n.lng) || !Number.isFinite(n.lat)) {
      push('error', `节点 ${n.name} 坐标非法`, 'nodes');
    }
    if (n.province && r.provinces.length && !r.provinces.includes(n.province)) {
      push('warn', `节点 ${n.name} 的省份 ${n.province} 不在 provinces 中`, 'nodes');
    }
  }
  if (!nodeNames.has(r.startNode)) push('error', `startNode「${r.startNode}」不在 nodes 中`, 'startNode');
  if (!nodeNames.has(r.endNode)) push('error', `endNode「${r.endNode}」不在 nodes 中`, 'endNode');

  const poiIds = new Set<string>();
  let segSum = 0;
  for (const s of r.segments ?? []) {
    segSum += s.distanceKm ?? 0;
    if (nodeNames.size && !nodeNames.has(s.fromNode)) {
      push('error', `路段 ${s.name} 起点「${s.fromNode}」不在 nodes 中`, 'segments');
    }
    if (nodeNames.size && !nodeNames.has(s.toNode)) {
      push('error', `路段 ${s.name} 终点「${s.toNode}」不在 nodes 中`, 'segments');
    }
    if (!s.roadRefs?.length) push('warn', `路段 ${s.name} 未标注道路`, 'roadRefs');
    else if (
      !s.refPending &&
      !/^[GSXYC]\d+$/.test(s.roadRefs[0]) &&
      s.roadClass !== '景区公路' &&
      s.roadClass !== '步道' &&
      s.roadClass !== '乡道'
    ) {
      // 景区/村道常常没有稳定的公开编号，允许写俗名；国道级路段必须给编号
      push('warn', `路段 ${s.name} 未给出标准编号道路：${s.roadRefs.join('/')}`, 'roadRefs');
    }
    for (const pid of s.poiIds ?? []) if (!poiIds.has(pid)) poiIds.add(pid);
  }
  if (r.segments?.length && r.totalKm) {
    const diff = Math.abs(segSum - r.totalKm) / r.totalKm;
    if (diff > 0.25) {
      push(
        'warn',
        `分段里程合计 ${segSum.toFixed(0)}km 与 totalKm ${r.totalKm}km 偏差 ${(diff * 100).toFixed(0)}%（超 25% 需核对口径）`,
        'totalKm',
      );
    }
  }

  const actualPoiIds = new Set<string>();
  for (const p of r.pois ?? []) {
    if (!p?.id) continue;
    if (actualPoiIds.has(p.id)) push('error', `景点 id 重复：${p.id}`, 'pois');
    actualPoiIds.add(p.id);
    if (!p.province || !p.city) push('warn', `景点 ${p.name} 缺少省市信息`, 'pois');
    if (!p.intro) push('warn', `景点 ${p.name} 缺少介绍`, 'pois');
    if (p.city && r.cities.length && !r.cities.includes(p.city)) {
      push('warn', `景点 ${p.name} 的城市 ${p.city} 不在 cities 中`, 'pois');
    }
  }
  for (const pid of poiIds) {
    if (!actualPoiIds.has(pid)) push('error', `路段引用了不存在的景点 id：${pid}`, 'segments.poiIds');
  }

  for (const d of r.plan ?? []) {
    if (nodeNames.size && !nodeNames.has(d.fromNode)) push('error', `第 ${d.day} 天起点不在 nodes 中`, 'plan');
    if (nodeNames.size && !nodeNames.has(d.toNode)) push('error', `第 ${d.day} 天终点不在 nodes 中`, 'plan');
    for (const pid of d.poiIds ?? []) {
      if (!actualPoiIds.has(pid)) push('error', `第 ${d.day} 天引用了不存在的景点 id：${pid}`, 'plan.poiIds');
    }
  }

  return issues;
}

/** 把区域文件里挂载 ≥1 条路线的城市标记为 covered/partial。 */
export function applyRouteCoverage(
  provinces: RoadbookProvince[],
  routes: TravelRouteDetail[],
): void {
  const byCity = new Map<string, string[]>();
  for (const r of routes) {
    for (const c of new Set([...r.cities, r.anchorCity])) {
      const list = byCity.get(c) ?? [];
      list.push(r.id);
      byCity.set(c, list);
    }
  }
  for (const p of provinces) {
    for (const c of p.cities) {
      const ids = byCity.get(c.name) ?? c.alias?.flatMap((a) => byCity.get(a) ?? []) ?? [];
      c.routeIds = [...new Set(ids)];
      const anchored = routes.some((r) => r.anchorCity === c.name);
      if (c.routeIds.length) {
        c.coverage = anchored ? 'covered' : 'partial';
      } else if (c.coverage !== 'todo') {
        c.coverage = 'todo';
      }
    }
  }
}

/** 路线涉及的道路编号 → 该编号在哪些路线出现（交叉索引，供「按公路找路线」） */
export function indexRoadRefs(routes: TravelRouteDetail[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const r of routes) {
    for (const ref of new Set([...r.roadRefs, ...r.segments.flatMap((s: TravelSegment) => s.roadRefs ?? [])])) {
      if (!ref) continue;
      map[ref] = [...new Set([...(map[ref] ?? []), r.id])];
    }
  }
  return map;
}

export type { RoadbookCity, RoadbookProvince };
