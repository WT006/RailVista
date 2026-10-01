/**
 * 万里路书 · 全国公路旅游网 —— 沿程景点匹配器（零框架依赖）。
 *
 * 照抄铁路 filterSpotsAlongRailway 的签名与输出结构（progressKm 升序 + 左右侧），
 * 但距离语义按公路重定义（PRD §5.3）：公路能停下来、能绕路——
 *   roadside 0.3km（观景台/界碑/小确幸）
 *   detour5   3km（村寨/小景点，5 分钟能绕到）
 *   detour20  12km（A 级景区/古镇/名村，20 分钟能绕到）
 *   distant   35km（雪山/大湖远景，只提示「能看到」，不引导绕行）
 *
 * detourKm 为公路版核心差异字段（铁路版没有）：
 *   distKm × 2 − 0.3（往返减去本来就在路边的一点点），向下取整到 0.5km。
 *
 * 本模块供 Web 与鸿蒙（ArkTS）共用：不得 import 任何 vue / hono / DOM API。
 */
import type {
  AlongRouteOptions,
  AlongSpot,
  RoadsideSpot,
  RoadVisibility,
} from '../types.js';
import { buildPath, driveHaversineKm, projectToRoute, type DriveCoords } from './geo.js';

/** 可见性 → 缓冲半径（km），见上表；PRD §5.3 必须写死的取值 */
export const ROAD_BUFFER_KM: Record<RoadVisibility, number> = {
  roadside: 0.3,
  detour5: 3,
  detour20: 12,
  distant: 35,
};

/** C1/C2 场景默认 minScore（过滤路人 POI）；C3 实时场景调用方传 45 */
export const ALONG_DEFAULT_MIN_SCORE = 35;

/** 默认全局缓冲上限：取 distant 档（各 spot 再按自身可见性分档收紧） */
const DEFAULT_BUFFER_KM = ROAD_BUFFER_KM.distant;

function bufferFor(spot: RoadsideSpot, capKm: number): number {
  const v = spot.visibility ?? 'detour20';
  return Math.min(ROAD_BUFFER_KM[v] ?? ROAD_BUFFER_KM.detour20, capKm);
}

/**
 * 绕行里程（km）：distKm×2−0.3，向下取整到 0.5；就在路边（≤0.15km）记 0。
 * UI 上直接写「绕行 4.5 公里 · 约 8 分钟」（按 30km/h 绕行速度估算约数）。
 */
export function detourKmOf(distKm: number): number {
  if (distKm <= 0.15) return 0;
  return Math.max(0.5, Math.floor((distKm * 2 - 0.3) / 0.5) * 0.5);
}

/** 分类前缀匹配：'nature' 命中 'nature.mountain'；完整串也命中自身 */
function categoryMatches(category: string, prefixes: string[]): boolean {
  return prefixes.some((p) => category === p || category.startsWith(`${p}.`));
}

/**
 * 由投影点切向与「投影点 → 景点」向量的叉积判定左右侧（相对路线正方向）。
 * 与 geo.ts determineSide 同一坐标系（x 东 y 北，cross>0 为左侧），但不需要
 * 行驶航向——沿程匹配时车辆尚未出发，侧向以路线正方向为基准。
 */
function sideOfProjection(
  tangentHeadingDeg: number,
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
): { side: 'left' | 'right'; confidence: 'high' | 'mid' | 'low' } {
  const rad = (tangentHeadingDeg * Math.PI) / 180;
  const tx = Math.sin(rad);
  const ty = Math.cos(rad);
  const dx = toLng - fromLng;
  const dy = toLat - fromLat;
  const cross = tx * dy - ty * dx;
  // 近距离（侧向偏角可靠）高置信；远距离投影切向可能漂移，降级
  const distKm = driveHaversineKm({ lng: fromLng, lat: fromLat }, { lng: toLng, lat: toLat });
  return {
    side: cross > 0 ? 'left' : 'right',
    confidence: distKm <= 1 ? 'high' : distKm <= 8 ? 'mid' : 'low',
  };
}

/**
 * 按路线折线过滤公路侧景点：dist ≤ 可见性分档缓冲，按 progressKm 升序。
 *
 * 性能注意：本函数对传入 spots 做全量投影（O(N·M)）。3 万景点 × 千点折线时，
 * 调用方应先用 spotGrid.ts 的网格索引把候选压缩到路线 bbox 外扩 buffer 覆盖的
 * 格内（实测可压到 300~800 个），再交给本函数。
 */
export function filterSpotsAlongRoad(
  spots: RoadsideSpot[],
  coords: readonly [number, number, number?][] | DriveCoords,
  opts: AlongRouteOptions = {},
): AlongSpot[] {
  if (!spots?.length || !coords || coords.length < 2) return [];

  const capKm = Math.min(opts.bufferKm ?? DEFAULT_BUFFER_KM, DEFAULT_BUFFER_KM);
  const minScore = opts.minScore ?? ALONG_DEFAULT_MIN_SCORE;
  const autoSide = opts.autoSide !== false;
  const categories = opts.categories?.length ? opts.categories : null;

  const { path, lengthKm } = buildPath(coords as DriveCoords);
  if (lengthKm <= 0 || path.length < 2) return [];

  const matched: AlongSpot[] = [];
  for (const spot of spots) {
    if (!Number.isFinite(spot.lng) || !Number.isFinite(spot.lat)) continue;
    if (spot.score < minScore) continue;
    if (categories && !categoryMatches(spot.category || 'other', categories)) continue;

    // projectToRoute 接收原始折线元组（内部自行 buildPath），不能传 path 点对象
    const proj = projectToRoute(coords as DriveCoords, spot.lng, spot.lat);
    const distKm = proj.offRouteM / 1000;
    if (distKm > bufferFor(spot, capKm)) continue;

    let side: AlongSpot['side'] = 'unknown';
    let sideConfidence: AlongSpot['sideConfidence'] = 'low';
    if (autoSide && distKm > 0.02) {
      const s = sideOfProjection(
        proj.tangentHeading,
        proj.point.lng,
        proj.point.lat,
        spot.lng,
        spot.lat,
      );
      side = s.side;
      sideConfidence = s.confidence;
    } else if (autoSide) {
      side = 'right'; // 就在路中线上，无从谈左右
      sideConfidence = 'low';
    }

    matched.push({
      id: String(spot.id),
      name: spot.name,
      lng: spot.lng,
      lat: spot.lat,
      progressKm: Math.round(proj.alongKm * 100) / 100,
      distKm: Math.round(distKm * 100) / 100,
      side,
      sideConfidence,
      category: spot.category || 'other',
      score: spot.score,
      detourKm: detourKmOf(distKm),
      stayMin: spot.stayMin,
      intro: spot.intro,
      tier: spot.tier,
      visibility: spot.visibility,
      honors: spot.honors,
      bestView: spot.bestView,
      canPark: spot.canPark,
      province: spot.province,
    });
  }

  matched.sort((a, b) => a.progressKm - b.progressKm || b.score - a.score);
  if (opts.maxCount && matched.length > opts.maxCount) {
    // 截断前按分数保优：每 50km 窗口内保留分数更高者，避免头部截断丢掉全程亮点
    return topSpotsWindowed(matched, opts.maxCount, Math.max(30, lengthKm / 24));
  }
  return matched;
}

/** 分窗口保优截断：把全程按 windowKm 切窗，窗内按 score 降序填充至 maxCount */
function topSpotsWindowed(sorted: AlongSpot[], maxCount: number, windowKm: number): AlongSpot[] {
  const byWindow = new Map<number, AlongSpot[]>();
  for (const s of sorted) {
    const w = Math.floor(s.progressKm / windowKm);
    const list = byWindow.get(w);
    if (list) list.push(s);
    else byWindow.set(w, [s]);
  }
  const out: AlongSpot[] = [];
  let round = 0;
  while (out.length < maxCount) {
    let added = false;
    for (const list of byWindow.values()) {
      if (out.length >= maxCount) break;
      if (round < list.length) {
        out.push(list[round]!);
        added = true;
      }
    }
    if (!added) break;
    round += 1;
  }
  out.sort((a, b) => a.progressKm - b.progressKm);
  return out;
}
