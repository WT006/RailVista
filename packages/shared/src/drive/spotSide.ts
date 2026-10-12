/**
 * 公路版左右侧判定（与铁路 schedule/spotSide.ts 同算法，领域常量按公路重定）。
 *
 * ## 为什么必须新写一个
 *
 * geo.ts 的 `determineSide()` 是这么算的：
 *   cross = tx * dy - ty * dx
 * 其中 (tx,ty) 是切向**单位向量**（sin/cos of bearing），而 (dx,dy) 是
 * **经纬度差（度）**。两者量纲根本不同 —— 1 度经度在中纬只约 85 km，
 * 1 度纬度是 110.574 km。铁路 spotSide.ts §3.4 把这个坑写得很清楚：
 * 混量纲叉乘的符号**会翻转**。构造一个反例：
 *   A = tx*dy = 1, B = ty*dx = 1.2  → degree 空间 cross = -0.2（判右）
 *   换成公里：110.574 − 1.2×85.3 = +8.2（判左）
 * 同一条路线、同一个景点，两种算法给出相反的左右。所以公路侧必须
 * 把「方向向量」与「偏移向量」换算到**同一个局部 ENU 公里平面**再叉乘。
 *
 * ## 与铁路的差异
 *  - 阈值：铁路 SIDE_BOTH_DIST_KM=0.3（车厢穿过，两侧都能看）；
 *    公路是**你自己开着车**，距路中心线 80 m 以内才算「就在路上」，
 *    超过就要明确拐左还是拐右 —— 所以 ROAD_SIDE_BOTH_KM=0.08。
 *  - 置信度：公路按垂距分档（≤1km high / ≤8km mid / 更远 low），
 *    远处投影切向容易漂移。
 */
import type { DriveCoords } from './geo.js';
import { buildPath, driveHaversineKm, type DrivePathPoint } from './geo.js';

/**
 * 纬度 1° 对应公里 / 经度 1° 在赤道对应公里（使用时乘 cos(lat)）。
 *
 * ⚠️ 与铁路 schedule/spotSide.ts 的同名常量**取值必须一致**（两处独立定义，
 * 改一处必须同步改另一处）。这里不 export：两个模块都从 index.ts 整体导出，
 * 同名会触发 TS2308「已导出同名成员」而编译失败 —— 真正需要跨领域复用的常量
 * 应另起 geo 模块，不要靠重名导出。
 */
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG = 111.32;
/**
 * 判定为「就在路上（两侧同侧）」的垂距上限（km）。
 * 公路不是火车：过了 80 m 就得明确说往左拐还是往右拐。
 */
export const ROAD_SIDE_BOTH_KM = 0.08;

export interface RoadSideProjection {
  /** 投影点在路线上的累计里程（km），夹在 [0, 路线全长] 内 */
  alongKm: number;
  /** 景点到路线中心线的垂距（km） */
  distKm: number;
  /** 局部 ENU 公里平面的叉积（km²）；> 0 表示景点在**行进方向左侧** */
  crossKm2: number;
  /** 该路段航向角（度，正北为 0，顺时针） */
  headingDeg: number;
  /** 投影点坐标 */
  point: { lng: number; lat: number };
  /**
   * 投影被 clamp 到折线首/末段之外**超过 1 km** → 方位无从判定。
   * 1 km 以内不算：起终城市里的景点落在路线起点的几公里之外很常见
   * （起点锚点在高速环道，不在市中心），此时用端点切向外推仍能给出可信方位。
   */
  clampedOutside: boolean;
  /** 外推距离（km）：投影落在端点之外的距离，0 表示正常投影 */
  extrapolatedKm: number;
}

function rad(d: number): number {
  return (d * Math.PI) / 180;
}

/**
 * 把经纬差换算到以 `a` 为原点的局部东(x)/北(y) **公里**平面。
 * 这一步就是修掉上文量纲陷阱的关键。
 */
function toLocalKm(
  a: { lng: number; lat: number },
  p: { lng: number; lat: number },
  latRef: number,
): { x: number; y: number } {
  const kx = KM_PER_DEG_LNG * Math.cos(rad(latRef));
  return { x: (p.lng - a.lng) * kx, y: (p.lat - a.lat) * KM_PER_DEG_LAT };
}

/**
 * 景点 → 路线折线投影（公里平面，含叉积）。
 * 返回 null 表示折线不可用或坐标非法。
 */
export function projectSpotToPath(
  coords: DriveCoords,
  lng: number,
  lat: number,
  path?: DrivePathPoint[],
  lengthKm?: number,
): RoadSideProjection | null {
  if (!coords || coords.length < 2) return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  // 允许调用方传入（或复用）已建好的 path，避免 N 个景点各建一次折线
  let p: DrivePathPoint[];
  let total: number;
  if (path && path.length === coords.length && typeof lengthKm === 'number') {
    p = path;
    total = lengthKm;
  } else {
    const built = buildPath(coords);
    p = built.path;
    total = built.lengthKm;
  }
  if (!(total > 0) || p.length < 2) return null;

  const s = { lng, lat };
  let best: RoadSideProjection | null = null;

  for (let i = 1; i < p.length; i += 1) {
    const a = p[i - 1];
    const b = p[i];
    const latRef = (a.lat + b.lat) / 2;

    const bb = toLocalKm(a, b, latRef);
    const ss = toLocalKm(a, s, latRef);
    const l2 = bb.x * bb.x + bb.y * bb.y;
    if (l2 <= 0) continue;

    const rawT = (ss.x * bb.x + ss.y * bb.y) / l2;
    const t = Math.max(0, Math.min(1, rawT));
    // 外推距离：投影落在段外时沿段方向的偏移（km）
    const segKm = Math.sqrt(l2);
    const extrapolatedKm = Math.abs(rawT - t) * segKm;

    const vx = ss.x - bb.x * t;
    const vy = ss.y - bb.y * t;
    const perp = Math.hypot(vx, vy);

    if (!best || perp < best.distKm) {
      // 投影点坐标反算回经纬度（沿线段线性插值，与 t 一致）
      const point = { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
      const segLen = b.distFromStart - a.distFromStart;
      // 方位叉积用**未 clamp** 的 t：投影在端点外不远时，沿该段方向外推仍成立，
      // 直接 clamp 会把「起终城市里的景点」全部判成 unknown（实测过半）。
      const tx = t === rawT ? t : rawT;
      const ex = ss.x - bb.x * tx;
      const ey = ss.y - bb.y * tx;
      const isEndSeg = i === 1 || i === p.length - 1;
      best = {
        alongKm: Math.round((a.distFromStart + segLen * t) * 100) / 100,
        distKm: Math.round(driveHaversineKm(s, point) * 1000) / 1000,
        crossKm2: bb.x * ey - bb.y * ex,
        headingDeg: (Math.atan2(bb.x, bb.y) * 180) / Math.PI,
        point,
        // 只有「在首/末段之外」且外推超过 1 km 才判方位无从确定；
        // 内圈段的 clamp 不会造成「在路线覆盖范围外」，不应牵连方位。
        clampedOutside: isEndSeg && extrapolatedKm > 1,
        extrapolatedKm: isEndSeg ? Math.round(extrapolatedKm * 100) / 100 : 0,
      };
    }
  }
  return best;
}

export type RoadSide = 'left' | 'right' | 'both' | 'unknown';

export interface RoadSideResult {
  side: RoadSide;
  confidence: 'high' | 'mid' | 'low';
  reason?: string;
}

/**
 * 由投影结果定左右侧（含 both / unknown 退化）。
 *
 * 语义对齐铁路 spotSide.ts 的先后顺序：**先判「判不出来」，再判「两侧」**。
 * `both` 是确定的结论（贴线），不是「没把握」；只有投影落到路线端点之外
 * 才判 unknown + low。
 */
export function resolveRoadSide(proj: RoadSideProjection): RoadSideResult {
  const distKm = Math.round(proj.distKm * 100) / 100;

  if (proj.clampedOutside) {
    return {
      side: 'unknown',
      confidence: 'low',
      reason: `投影落在路线${proj.alongKm <= 0 ? '起点' : '终点'}之外 ${proj.extrapolatedKm} km，开车不会经过，方位无意义`,
    };
  }
  if (distKm <= ROAD_SIDE_BOTH_KM) {
    return { side: 'both', confidence: 'high', reason: `距路中心线 ${distKm} km，就在路上` };
  }
  const confidence = distKm <= 1 ? 'high' : distKm <= 8 ? 'mid' : 'low';
  // 端点外推判出的方位最多算 mid：方向是借来的，不该和正常投影一样标 high
  const effConfidence: RoadSideResult['confidence'] =
    proj.extrapolatedKm > 0 && confidence === 'high' ? 'mid' : confidence;
  return {
    side: proj.crossKm2 > 0 ? 'left' : 'right',
    confidence: effConfidence,
    ...(effConfidence === 'low' || proj.extrapolatedKm > 0
      ? {
          reason:
            proj.extrapolatedKm > 0
              ? `投影落在路线端点外 ${proj.extrapolatedKm} km，按端点方向外推判定`
              : `距路 ${distKm} km，远处投影切向可能漂移，方位仅供参考`,
        }
      : {}),
  };
}

/** 车辆实际行驶方向 vs 路线正方向：反向时左右互换（both / unknown 不变） */
export function flipRoadSide(side: RoadSide, reversed: boolean): RoadSide {
  if (!reversed) return side;
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side;
}

// ── 展示文案 ─────────────────────────────────────────────────────────────────
// 不能复用 schedule/spotSide.ts 的 sideLabel —— 那里写死了「列车左侧」。
// 公路的主体是**你自己开的车**，文案必须是「行进方向左/右侧」。

export const ROAD_SIDE_LABELS: Record<RoadSide, string> = {
  left: '行进方向左侧',
  right: '行进方向右侧',
  both: '就在路上',
  unknown: '方位待定',
};

/** 紧凑场景（地图气泡 / 徽标）用的短文案 */
export const ROAD_SIDE_SHORT: Record<RoadSide, string> = {
  left: '左侧',
  right: '右侧',
  both: '路上',
  unknown: '待定',
};

/**
 * 箭头。左右不能只靠颜色区分（色觉障碍可读性），必须与文字并存。
 * both 用 ⇅ 表示「路穿过它」，unknown 用 · 而不是 ? —— ? 会被读成「出错了」。
 */
export const ROAD_SIDE_ARROWS: Record<RoadSide, string> = {
  left: '←',
  right: '→',
  both: '⇅',
  unknown: '·',
};

export function roadSideLabel(side?: RoadSide | null): string {
  return ROAD_SIDE_LABELS[side && side !== 'unknown' ? side : 'unknown'];
}

export function roadSideShort(side?: RoadSide | null): string {
  return ROAD_SIDE_SHORT[side && side !== 'unknown' ? side : 'unknown'];
}

export function roadSideArrow(side?: RoadSide | null): string {
  return ROAD_SIDE_ARROWS[side && side !== 'unknown' ? side : 'unknown'];
}
