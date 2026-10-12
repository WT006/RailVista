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
import { buildPath, type DriveCoords, type DrivePathPoint } from './geo.js';
import { projectSpotToPath, resolveRoadSide, type RoadSide } from './spotSide.js';

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
 *
 * 2026-10-12：原实现（上面的注释所描述的那版）**有量纲错误** ——
 * 切向用的是单位向量（sin/cos），偏移用的是经纬度差（度），两者混乘后
 * 符号会翻转（构造反例见 spotSide.ts 顶部注释）。已整体迁到
 * `spotSide.ts` 的局部 ENU 公里平面实现，并补上 both（贴线）/ unknown（端点外）。
 *
 * 保留本函数只为兼容旧调用方；新的匹配一律走 projectSpotToPath + resolveRoadSide。
 */
export function sideOfProjection(
  tangentHeadingDeg: number,
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
): { side: 'left' | 'right'; confidence: 'high' | 'mid' | 'low' } {
  // 修正版：把切向单位向量与经纬度偏移都换算到同一个公里平面后再叉乘
  const r = (tangentHeadingDeg * Math.PI) / 180;
  const tx = Math.sin(r);
  const ty = Math.cos(r);
  const kx = 111.32 * Math.cos((fromLat * Math.PI) / 180);
  const ky = 110.574;
  const dx = (toLng - fromLng) * kx;
  const dy = (toLat - fromLat) * ky;
  const cross = tx * dy - ty * dx;
  const distKm = Math.hypot(dx, dy);
  return {
    side: cross > 0 ? 'left' : 'right',
    confidence: distKm <= 1 ? 'high' : distKm <= 8 ? 'mid' : 'low',
  };
}

/**
 * 本次路线尺度下的「顺路可达」分档（与数据里静态的 detourClass 是两回事）：
 * 静态 detourClass 讲的是这个景点**本身**离干线多远；
 * 这里讲的是它离**你正在走的这条线**多远。
 */
export function alongClassOf(distKm: number): NonNullable<AlongSpot['detourClass']> {
  if (distKm <= 1) return 'pass';
  if (distKm <= 12) return 'detour';
  return 'spur';
}

/**
 * 「为什么值得专程跑一趟」——只写可核实的资质，没有就不写。
 *
 * 注意区分两种 spur：
 *  - 数据层静态标注的（景点本身离任何干线都远）→ 用 spot.spurReason
 *  - 相对**本次路线**远（>12km），但景点本身可能就在某条干线上 → 这里现算
 * 后者如果不给理由，用户只会看到一个「专程绕行」标签却不知道凭什么值得绕。
 */
function spurReasonOf(spot: RoadsideSpot, distKm: number): string | undefined {
  const why = spot.honors?.length ? spot.honors.join('、') : spot.level;
  if (!why) return undefined; // 没有可核实的资质就不编理由
  return `距本次路线 ${distKm.toFixed(0)} km，需专程绕行；${why}，值得为它单独安排时间`;
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
  const includeSpur = opts.includeSpur !== false;

  const { path, lengthKm } = buildPath(coords as DriveCoords);
  if (lengthKm <= 0 || path.length < 2) return [];

  const matched: AlongSpot[] = [];
  for (const spot of spots) {
    if (!Number.isFinite(spot.lng) || !Number.isFinite(spot.lat)) continue;
    if (spot.score < minScore) continue;
    if (categories && !categoryMatches(spot.category || 'other', categories)) continue;

    // 公里平面投影（修正了旧实现的量纲陷阱），一次性拿到里程 / 垂距 / 叉积
    const proj = projectSpotToPath(coords as DriveCoords, spot.lng, spot.lat, path, lengthKm);
    if (!proj) continue;
    const distKm = proj.distKm;
    if (distKm > bufferFor(spot, capKm)) continue;

    // 静态 detourClass 是景点自身属性；alongClass 是「相对本次路线」的分档，
    // UI 展示以后者为准（用户只关心他正走的这条路好不好到）。
    const alongClass = alongClassOf(distKm);
    if (!includeSpur && (alongClass === 'spur' || spot.detourClass === 'spur')) continue;

    let side: RoadSide = 'unknown';
    let sideConfidence: AlongSpot['sideConfidence'] = 'low';
    if (autoSide) {
      const s = resolveRoadSide(proj);
      side = s.side;
      sideConfidence = s.confidence;
    }

    matched.push({
      id: String(spot.id),
      name: spot.name,
      lng: spot.lng,
      lat: spot.lat,
      progressKm: proj.alongKm,
      distKm: Math.round(distKm * 100) / 100,
      side,
      sideConfidence,
      category: spot.category || 'other',
      score: spot.score,
      detourKm: detourKmOf(distKm),
      detourClass: alongClass,
      // 静态理由优先（景点本身就远离干线）；相对本次路线远时才现算
      spurReason: spot.spurReason ?? (alongClass === 'spur' ? spurReasonOf(spot, distKm) : undefined),
      stayMin: spot.stayMin,
      intro: spot.intro,
      tagline: spot.tagline,
      tier: spot.tier,
      visibility: spot.visibility,
      honors: spot.honors,
      level: spot.level,
      tags: spot.tags,
      bestView: spot.bestView,
      canPark: spot.canPark,
      province: spot.province,
      city: spot.city,
      visitHours: spot.visitHours,
      ticketNote: spot.ticketNote,
      accessNote: spot.accessNote,
      rating: spot.rating,
      ratingSource: spot.ratingSource,
      photoUrl: spot.photoUrl,
      address: spot.address,
      roadRefs: spot.roadRefs,
      roadDistKm: spot.roadDistKm,
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
