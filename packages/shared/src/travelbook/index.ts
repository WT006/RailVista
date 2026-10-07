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
  TravelLayer,
  TravelPoiCategory,
  TravelRouteDetail,
  TravelSegment,
  TravelTier,
} from './types.js';
import {
  LAYER_RANK_RANGE,
  RECOMMEND_LAYER_ROTATION,
  RECOMMEND_ROTATION_STEP,
  TRAVEL_DIFFICULTY_LABEL,
  TRAVEL_LAYER_LABEL,
  TRAVEL_MODE_LABEL,
  TRAVEL_POI_CATEGORY_LABEL,
  TRAVEL_SHAPE_LABEL,
  TRAVEL_TIER_LABEL,
  TravelDifficulty,
  resolveLayer,
} from './types.js';

export const ROADBOOK_POI_CATEGORIES = Object.keys(
  TRAVEL_POI_CATEGORY_LABEL,
) as TravelPoiCategory[];

export {
  TRAVEL_MODE_LABEL,
  TRAVEL_SHAPE_LABEL,
  TRAVEL_TIER_LABEL,
  TRAVEL_DIFFICULTY_LABEL,
  TRAVEL_LAYER_LABEL,
  LAYER_RANK_RANGE,
  RECOMMEND_LAYER_ROTATION,
  RECOMMEND_ROTATION_STEP,
};

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

/** 内容分层文案；未知值原样返回（与 modeText / shapeText 同风格） */
export function layerText(layer: string): string {
  return TRAVEL_LAYER_LABEL[layer as TravelLayer] ?? layer;
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

/** V9：`layer` → 允许搭配的 `tier`。L5 允许 city 或 regional（区域级冷门目的地）。 */
const LAYER_EXPECTED_TIERS: Record<TravelLayer, TravelTier[]> = {
  L1: ['national'],
  L2: ['regional'],
  L3: ['city'],
  L4: ['city'],
  L5: ['city', 'regional'],
};

/** V6：`practical.carFree` 的最小字数（低于此视为「写了等于没写」） */
const MIN_CARFREE_LENGTH = 20;

/** V7：`mileageNote` 的建议最小字数（低于此降级为 warn） */
const MIN_MILEAGE_NOTE_LENGTH = 8;

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
  // V5：intro.days / plan.length 必须与 days 三者一致（原为 warn，升级为 error）
  if (r.intro?.days && r.intro.days !== r.days) {
    push('error', `intro.days(${r.intro.days}) 与 days(${r.days}) 不一致`, 'intro.days');
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

  // ═══════════════════════════════════════════════════════════════════════
  // 内容完整性判据（设计文档 §3.2 的 V1~V9、V13、V16、V17）
  // ═══════════════════════════════════════════════════════════════════════

  const nodes = Array.isArray(r.nodes) ? r.nodes : [];
  const segments = Array.isArray(r.segments) ? r.segments : [];
  const pois = Array.isArray(r.pois) ? r.pois : [];
  const plan = Array.isArray(r.plan) ? r.plan : [];
  const modes = Array.isArray(r.modes) ? r.modes : [];

  // V1 景点下限：低于 6 个撑不起一条成品行程
  if (pois.length < 6) push('error', `pois 不足 6 个（当前 ${pois.length} 个）`, 'pois');
  // V2 必去景点下限：没有 3 个必去说明路线缺乏核心卖点
  const mustSeeCount = pois.filter((p) => p?.mustSee).length;
  if (mustSeeCount < 3) push('error', `mustSee 景点不足 3 个（当前 ${mustSeeCount} 个）`, 'pois');
  // V3 骨架节点下限
  if (nodes.length < 4) push('error', `nodes 不足 4 个（当前 ${nodes.length} 个）`, 'nodes');
  // V4 关键路段下限
  if (segments.length < 3) push('error', `segments 不足 3 段（当前 ${segments.length} 段）`, 'segments');

  // V5 逐日行程条数必须与建议天数一致
  if (typeof r.days === 'number' && r.days > 0 && plan.length !== r.days) {
    push('error', `plan.length(${plan.length}) 必须等于 days(${r.days})`, 'plan');
  }

  // V6 无车方案：必须写，且不能是敷衍的一句话
  const carFree = (r.practical?.carFree ?? '').trim();
  if (carFree.length < MIN_CARFREE_LENGTH) {
    push(
      'error',
      `practical.carFree 需写清无车接驳方案且不少于 ${MIN_CARFREE_LENGTH} 字（当前 ${carFree.length} 字）`,
      'practical.carFree',
    );
  }

  // V7 里程口径说明：非空为 error，过短降级 warn（避免把估算值包装成实测值）
  const mileageNote = (r.mileageNote ?? '').trim();
  if (!mileageNote) push('error', '缺少里程口径说明 mileageNote', 'mileageNote');
  else if (mileageNote.length < MIN_MILEAGE_NOTE_LENGTH) {
    push('warn', `mileageNote 过短（${mileageNote.length} 字），建议写明估算口径与构成`, 'mileageNote');
  }

  // V8 自驾兜底：本库默认每条路线都要能自驾；纯徒步 / 岛屿步行类允许例外，但必须在 summary 里注明
  if (modes.length && !modes.includes('selfdrive')) {
    const summaryText = r.summary ?? '';
    const hikingException = r.primaryMode === 'hiking' && /徒步|步道/.test(summaryText);
    const islandException = r.shape === 'point' && /岛屿|步行/.test(summaryText);
    if (!hikingException && !islandException) {
      push(
        'error',
        'modes 需包含 selfdrive（徒步/岛屿类例外须满足 primaryMode=hiking 或 shape=point 且在 summary 中注明）',
        'modes',
      );
    }
  }

  // V9 layer 与 tier 一致性（仅在显式标注 layer 时校验；缺省走推断，不报错）
  if (r.layer) {
    const expectedTiers = LAYER_EXPECTED_TIERS[r.layer];
    if (r.tier && expectedTiers && !expectedTiers.includes(r.tier)) {
      push(
        'error',
        `layer=${r.layer} 与 tier=${r.tier} 不一致（${r.layer} 期望 tier=${expectedTiers.join('/')}）`,
        'layer',
      );
    }
  }

  // V13 资料来源（warn 级，但数据组必写）
  if (!r.sources?.length) push('warn', '缺少数据来源 sources（至少 1 条）', 'sources');

  // V16 L4 周末线：一半用户是高铁 + 租车/公交，必须同时支持自驾与公共交通
  // （用 resolveLayer 结果判定，layer 缺省走推断时同样生效）
  if (modes.length && resolveLayer(r) === 'L4') {
    if (!modes.includes('selfdrive') || !modes.includes('public')) {
      push('error', 'L4（周末周边）路线需同时支持 selfdrive 与 public 两种玩法', 'modes');
    }
  }

  // V17 anchorCity 应落在 cities 内（applyRouteCoverage 会 union，不算硬错，但通常是笔误）
  if (r.anchorCity && Array.isArray(r.cities) && r.cities.length && !r.cities.includes(r.anchorCity)) {
    push('warn', `anchorCity「${r.anchorCity}」不在 cities 中（通常是笔误）`, 'anchorCity');
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
