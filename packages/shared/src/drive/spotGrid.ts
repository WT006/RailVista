/**
 * 万里路书 · 全国公路旅游网 —— 景点网格索引（零框架依赖）。
 *
 * 性能背景（PRD §5.2）：折线 N 点 × 景点 M 个的朴素投影是 O(N·M)，
 * 300km 路线（简化后 ~1500 点）× 3 万景点 = 4500 万次投影，太慢。
 * 把景点按 0.05° 网格（约 5km）分桶，只取路线 bbox 外扩 buffer 覆盖到的
 * 格内景点参与投影，实测可把参与量压到 300~800 个，单次 <30ms。
 *
 * 纯 JS Map<number, number[]> 实现（key = col * 8192 + row），Web 与鸿蒙共用。
 */
import type { AlongRouteOptions, AlongSpot, RoadsideSpot } from '../types.js';
import { filterSpotsAlongRoad } from './alongRoute.js';

/** 网格边长（度）：0.05° ≈ 5km */
export const SPOT_GRID_CELL_DEG = 0.05;
/** 行数上限（lat -90..90 → 3600 行），列偏移乘子 */
const COL_STRIDE = 8192;

export interface SpotGrid {
  /** 建网格时的景点总数 */
  size: number;
  /** cellKey → 景点下标列表 */
  cells: Map<number, number[]>;
}

function cellKeyOf(lng: number, lat: number): number {
  const col = Math.floor((lng + 180) / SPOT_GRID_CELL_DEG);
  const row = Math.floor((lat + 90) / SPOT_GRID_CELL_DEG);
  return col * COL_STRIDE + row;
}

/** 建网格：O(M)。坐标非法的景点跳过（不参与任何查询）。 */
export function buildSpotGrid(spots: RoadsideSpot[]): SpotGrid {
  const cells = new Map<number, number[]>();
  for (let i = 0; i < spots.length; i += 1) {
    const s = spots[i]!;
    if (!Number.isFinite(s.lng) || !Number.isFinite(s.lat)) continue;
    const key = cellKeyOf(s.lng, s.lat);
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  }
  return { size: spots.length, cells };
}

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** 折线 bbox（含外扩 bufferKm 的度数换算；纬度余弦缩放经度方向） */
export function bboxOfCoords(
  coords: readonly [number, number, number?][],
  bufferKm = 0,
): BBox | null {
  if (!coords || coords.length === 0) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const dLat = bufferKm / 111.32;
  const dLng = bufferKm / (111.32 * Math.max(0.2, Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)));
  return {
    minLng: minLng - dLng,
    maxLng: maxLng + dLng,
    minLat: minLat - dLat,
    maxLat: maxLat + dLat,
  };
}

/** 取 bbox 覆盖格内的候选景点下标（去重） */
export function queryGrid(grid: SpotGrid, bbox: BBox): number[] {
  const c0 = Math.floor((bbox.minLng + 180) / SPOT_GRID_CELL_DEG);
  const c1 = Math.floor((bbox.maxLng + 180) / SPOT_GRID_CELL_DEG);
  const r0 = Math.floor((bbox.minLat + 90) / SPOT_GRID_CELL_DEG);
  const r1 = Math.floor((bbox.maxLat + 90) / SPOT_GRID_CELL_DEG);
  const out: number[] = [];
  const seen = new Set<number>();
  for (let c = c0; c <= c1; c += 1) {
    for (let r = r0; r <= r1; r += 1) {
      const list = grid.cells.get(c * COL_STRIDE + r);
      if (!list) continue;
      for (const idx of list) {
        if (!seen.has(idx)) {
          seen.add(idx);
          out.push(idx);
        }
      }
    }
  }
  return out;
}

/** 便捷入口：网格取候选 → 候选集上跑 filterSpotsAlongRoad */
export function spotsAlongRoute(
  spots: RoadsideSpot[],
  grid: SpotGrid,
  coords: readonly [number, number, number?][],
  opts: AlongRouteOptions = {},
): AlongSpot[] {
  if (!coords || coords.length < 2) return [];
  const bufferKm = Math.min(opts.bufferKm ?? 35, 35);
  const bbox = bboxOfCoords(coords, bufferKm);
  if (!bbox) return [];
  const candidates = queryGrid(grid, bbox);
  if (!candidates.length) return [];
  const subset = candidates.map((i) => spots[i]!);
  return filterSpotsAlongRoad(subset, coords, opts);
}
