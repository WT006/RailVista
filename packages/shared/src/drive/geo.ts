/**
 * 万里路书 · 精品自驾公路 —— 几何投影与方向判定（零框架依赖）。
 *
 * 本模块供 Web 与鸿蒙（ArkTS）共用：不得 import 任何 vue / hono / DOM API，
 * 也不得 import schedule/ 下的铁路语义模块（保持与铁路侧完全解耦）。
 * 几何点统一采用 [lng, lat, elev?] 前两位参与计算，第三位高程可选。
 */

export type DriveLngLat = { lng: number; lat: number };

/** 折线坐标：允许 [lng, lat] 或带可选高程的 [lng, lat, elev?] */
export type DriveCoords = Array<readonly [number, number, number?]>;

/** 路径点：折线逐点 + 距起点累计里程（km） */
export interface DrivePathPoint extends DriveLngLat {
  index: number;
  distFromStart: number;
}

export interface DrivePathMetrics {
  path: DrivePathPoint[];
  lengthKm: number;
}

/** 地球半径（km） */
const EARTH_RADIUS_KM = 6371;

/** 两点球面距离（km），Haversine */
export function driveHaversineKm(a: DriveLngLat, b: DriveLngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h));
}

/** 折线 → 路径点 + 累计里程 */
export function buildPath(coords: DriveCoords): DrivePathMetrics {
  const path: DrivePathPoint[] = coords.map(([lng, lat], index) => ({
    lng,
    lat,
    index,
    distFromStart: 0,
  }));
  let lengthKm = 0;
  for (let i = 1; i < path.length; i += 1) {
    lengthKm += driveHaversineKm(path[i - 1], path[i]);
    path[i].distFromStart = lengthKm;
  }
  return { path, lengthKm };
}

/** 计算某点沿折线的累计里程（km），等价于 buildPath 后取末值 */
export function computeCumKm(coords: DriveCoords): number[] {
  const cum: number[] = new Array(coords.length);
  let acc = 0;
  cum[0] = 0;
  for (let i = 1; i < coords.length; i += 1) {
    acc += driveHaversineKm({ lng: coords[i - 1][0], lat: coords[i - 1][1] }, { lng: coords[i][0], lat: coords[i][1] });
    cum[i] = acc;
  }
  return cum;
}

/**
 * 方位角（度，0~360，自正北顺时针），用于切向与航向比对。
 */
export function bearingDeg(a: DriveLngLat, b: DriveLngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export interface ProjectResult {
  /** 投影点沿折线的里程桩（km） */
  alongKm: number;
  /** 到折线的最短距离（m） */
  offRouteM: number;
  /** 投影所在线段索引 */
  segIndex: number;
  /** 所在线段的切向方位角（度），即折线正方向 */
  tangentHeading: number;
  /** 投影点坐标 */
  point: DriveLngLat;
}

/**
 * GPS → 折线投影：返回里程桩、偏离距离、切向方位角。
 * 切向方位角用于与 GPS heading 比对，判定车辆沿折线的正/反向行驶。
 */
export function projectToRoute(
  coords: DriveCoords,
  lng: number,
  lat: number,
): ProjectResult {
  const { path, lengthKm } = buildPath(coords);
  let best: ProjectResult = {
    alongKm: 0,
    offRouteM: Infinity,
    segIndex: 0,
    tangentHeading: 0,
    point: { lng: path[0]?.lng ?? 0, lat: path[0]?.lat ?? 0 },
  };
  if (path.length === 0) return best;
  if (path.length === 1) {
    best.point = { lng: path[0].lng, lat: path[0].lat };
    best.offRouteM = driveHaversineKm({ lng, lat }, best.point) * 1000;
    return best;
  }
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = b.distFromStart - a.distFromStart || 1;
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const denom = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / denom));
    const point = { lng: a.lng + dx * t, lat: a.lat + dy * t };
    const offRouteM = driveHaversineKm({ lng, lat }, point) * 1000;
    if (offRouteM < best.offRouteM) {
      best = {
        alongKm: a.distFromStart + segLen * t,
        offRouteM,
        segIndex: i,
        tangentHeading: bearingDeg(a, b),
        point,
      };
    }
  }
  // 里程桩兜底：投影点沿路径的里程 = 距起点累计，受 lengthKm 归一不必要（自驾用绝对公里）
  return best;
}

export type DriveDirection = 'forward' | 'backward' | 'unknown';

/**
 * 由 GPS 航向与折线切向判定行驶方向。
 * - 夹角 < 90° → forward（沿折线正方向）
 * - 夹角 > 90° → backward
 * - 无航向 → unknown
 */
export function resolveDirection(
  headingDeg: number | undefined,
  tangentHeading: number,
): DriveDirection {
  if (headingDeg == null || Number.isNaN(headingDeg)) return 'unknown';
  let diff = Math.abs(((headingDeg - tangentHeading) % 360) + 360) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff < 90 ? 'forward' : 'backward';
}

/**
 * 由行驶方向与相对折线正方向的左右位置，判定小确幸在车辆哪一侧。
 * 侧向 = cross(tangent, toPoint) 的正负；反向行驶时左右翻转。
 */
export function determineSide(
  proj: ProjectResult,
  headingDeg: number | undefined,
  target: DriveLngLat,
): 'left' | 'right' | 'unknown' {
  const dir = resolveDirection(headingDeg, proj.tangentHeading);
  if (dir === 'unknown') return 'unknown';
  // 折线正方向单位向量（切向）
  const rad = (proj.tangentHeading * Math.PI) / 180;
  const tx = Math.sin(rad);
  const ty = Math.cos(rad);
  // 目标点相对投影点的向量
  const dx = target.lng - proj.point.lng;
  const dy = target.lat - proj.point.lat;
  const cross = tx * dy - ty * dx;
  // 标准右手系（x 东、y 北）：cross > 0 → 目标在切向左侧；反向行驶时左右翻转
  let side: 'left' | 'right' = cross > 0 ? 'left' : 'right';
  if (dir === 'backward') side = side === 'left' ? 'right' : 'left';
  return side;
}

/**
 * Douglas-Peucker 折线简化（保留首尾）。
 * @param coords 输入折线
 * @param toleranceM 简化容差（米）
 */
export function simplifyDP(
  coords: DriveCoords,
  toleranceM: number,
): [number, number][] {
  if (coords.length <= 2 || toleranceM <= 0) return coords.map((c) => [c[0], c[1]]);
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, coords.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = -1;
    const a = coords[start];
    const b = coords[end];
    for (let i = start + 1; i < end; i += 1) {
      const d = pointSegDistanceM(coords[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > toleranceM) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const out: [number, number][] = [];
  for (let i = 0; i < coords.length; i += 1) {
    if (keep[i]) out.push([coords[i][0], coords[i][1]]);
  }
  return out;
}

/** 点到线段距离（米），经纬度近似平面化（局部线段足够短，误差可忽略） */
function pointSegDistanceM(
  p: readonly [number, number, number?],
  a: readonly [number, number, number?],
  b: readonly [number, number, number?],
): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const denom = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  // 经度方向按纬度余弦缩放，近似米
  const metersPerDegLng = 111_320 * Math.cos((py * Math.PI) / 180);
  const ex = (px - cx) * metersPerDegLng;
  const ey = (py - cy) * 111_320;
  return Math.sqrt(ex * ex + ey * ey);
}
