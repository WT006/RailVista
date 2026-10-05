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

/**
 * 中国陆地经纬度外包框（度数，WGS-84）。
 *
 * 取值说明（PRD §6.2 P2-3 境外 POI 过滤）：
 *   lng ∈ [73.5, 134.77]，lat ∈ [17.5, 53.56]
 *   - 73.5°：新疆西部最西端（塔什库尔干）
 *   - 134.77°：黑龙江—乌苏里江主航道最东端（抚远/黑瞎子岛方向）；
 *     故意大于 135° 是为了把真正落在黑龙江省内的抚远市（lng≈134.3）保住，
 *     而把 lng≥135 的"伯力—哈巴罗夫斯克"（俄罗斯远东，错放为"黑龙江"）剔除。
 *   - 17.5°：南海南沙最南（曾母暗沙方向）
 *   - 53.56°：黑龙江漠河北极村
 *
 * 注意：bbox 是**矩形近似**而非多边形精确边界。南海九段线内、藏南等争议区
 * 会暂时保留（这些区域的 POI 通常本来就不会被抓入公路侧景点库）。
 * 一旦引入简化版中国陆地多边形（参考 scripts/lib/china-bbox.mjs 占位），
 * 应替换为多边形点-在-内测试 —— 这是已规划的演进方向。
 */
export const CHINA_LAND_BBOX = Object.freeze({
  minLng: 73.5,
  minLat: 17.5,
  maxLng: 134.77,
  maxLat: 53.56,
});

/** 经纬度是否落在 CHINA_LAND_BBOX 范围内（含边界） */
export function isWithinChinaLand(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= CHINA_LAND_BBOX.minLng &&
    lng <= CHINA_LAND_BBOX.maxLng &&
    lat >= CHINA_LAND_BBOX.minLat &&
    lat <= CHINA_LAND_BBOX.maxLat
  );
}

const CJK_RE = /[\u4e00-\u9fff]/;
const CN_COUNTRY_RE =
  /^(CN|CHN|China|PRC|HK|MO|TW|中国|中华人民共和国|香港|澳门|台湾)$/i;
/** 喜马拉雅南坡常见境外拉丁名（即便坐标被错标成西藏也不入库） */
const FOREIGN_NAME_RE =
  /\b(Nepal|Kathmandu|Pokhara|Namche|Lukla|Sikkim|Gangtok|Thimphu|Paro|Hanuman|Chorten|Melamchi|Lobuche|Kongma|Chukhung|Everest viewpoint|Haa valley|Bahrabise|Nasim Pati)\b/i;

type SpotCountryTags = {
  osmTags?: Record<string, string | undefined>;
};

/**
 * 喜马拉雅南坡矩形：西藏省 bbox 会扫进尼泊尔 / 锡金 / 不丹。
 * 中文名（樟木、聂拉木、亚东、马卡鲁山）保留；纯拉丁名视为邻国 POI。
 */
export function inHimalayaExteriorBand(lng: number, lat: number): boolean {
  if (lng >= 80 && lng < 88.35 && lat >= 26.2 && lat < 28.15) return true;
  if (lng >= 88.35 && lng <= 92.2 && lat >= 26.4 && lat < 27.72) return true;
  return false;
}

/**
 * 公路侧景点是否可展示 / 入库。
 * 比 CHINA_LAND_BBOX 更严：挡邻国 country 标签、喜马拉雅南坡拉丁名。
 */
export function isAdmissibleChinaPoi(
  spot: Pick<RoadsideSpot, 'lng' | 'lat' | 'name'> & SpotCountryTags,
): boolean {
  if (!isWithinChinaLand(spot.lng, spot.lat)) return false;
  const tags = spot.osmTags;
  if (tags) {
    const country = tags['addr:country'] || tags['is_in:country'] || tags.country;
    if (country && !CN_COUNTRY_RE.test(String(country).trim())) return false;
  }
  const name = String(spot.name ?? '');
  if (inHimalayaExteriorBand(spot.lng, spot.lat) && !CJK_RE.test(name)) return false;
  if (FOREIGN_NAME_RE.test(name) && !CJK_RE.test(name)) return false;
  return true;
}

/**
 * 剔除国境外 / 邻国错标 POI；NaN 坐标一并丢弃。
 */
export function partitionByChinaLand(spots: RoadsideSpot[]): {
  kept: RoadsideSpot[];
  dropped: RoadsideSpot[];
} {
  const kept: RoadsideSpot[] = [];
  const dropped: RoadsideSpot[] = [];
  for (const s of spots) {
    if (isAdmissibleChinaPoi(s as RoadsideSpot & SpotCountryTags)) kept.push(s);
    else dropped.push(s);
  }
  return { kept, dropped };
}

export interface SpotGrid {
  /** 原始 spots 数组长度（含境外与非法坐标），便于上层做覆盖率审计 */
  size: number;
  /** cellKey → 原始 spots 数组下标列表（已剔除境外与非法坐标） */
  cells: Map<number, number[]>;
}

function cellKeyOf(lng: number, lat: number): number {
  const col = Math.floor((lng + 180) / SPOT_GRID_CELL_DEG);
  const row = Math.floor((lat + 90) / SPOT_GRID_CELL_DEG);
  return col * COL_STRIDE + row;
}

/**
 * 建网格：O(M)。不可展示的境外 / 邻国错标 POI 直接跳过。
 */
export function buildSpotGrid(spots: RoadsideSpot[]): SpotGrid {
  const cells = new Map<number, number[]>();
  for (let i = 0; i < spots.length; i += 1) {
    const s = spots[i]!;
    if (!isAdmissibleChinaPoi(s as RoadsideSpot & SpotCountryTags)) continue;
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
