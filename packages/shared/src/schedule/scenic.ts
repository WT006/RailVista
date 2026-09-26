import type { ScenicSpot, SpotVisibility } from '../types.js';
import { buildRailwayMetrics } from './progress.js';
import {
  pickLineRef,
  projectSpotToLine,
  resolveSpotSide,
  type SpotRuntimeSide,
} from './spotSide.js';

/** visibility → 默认最大贴线距离（km），见 docs/scenic-spots-spec.md */
export const SCENIC_DEFAULT_MAX_DIST_KM: Record<SpotVisibility, number> = {
  on_track: 3,
  window: 8,
  distant: 35,
};

export type ScenicSpotInput = Pick<
  ScenicSpot,
  | 'id'
  | 'name'
  | 'lng'
  | 'lat'
  | 'intro'
  | 'visibility'
  | 'maxDistKm'
  | 'category'
  | 'nightOnly'
  | 'side'
  | 'source'
  | 'viewScale'
  | 'viewMinutes'
  | 'dimensions'
  | 'subtype'
  | 'tags'
  | 'lines'
  | 'sideRefDirection'
  | 'bestView'
  | 'honors'
  | 'sources'
  | 'verification'
  | 'reviewedAt'
  | 'reviewRound'
  | 'status'
>;

function maxDistFor(spot: ScenicSpotInput): number {
  if (spot.maxDistKm != null && Number.isFinite(spot.maxDistKm) && spot.maxDistKm > 0) {
    return spot.maxDistKm;
  }
  const v = spot.visibility || 'window';
  return SCENIC_DEFAULT_MAX_DIST_KM[v] ?? SCENIC_DEFAULT_MAX_DIST_KM.window;
}

export interface FilterSpotsOptions {
  /**
   * 当前行程折线方向是否与 sideRefDirection 基准相反。
   * 不传时自动推断（见 spotSide.ts resolveSpotSide）。
   */
  reversed?: boolean;
  /** 优先匹配的走廊 id，用于取 lines[] 中正确的里程区间 */
  corridorId?: string;
  /** 是否启用左右侧自动判定，默认 true */
  autoSide?: boolean;
}

/**
 * 单个景点在当前行程折线上的左右侧判定（§3.6 新增 resolveSide 入口）。
 * tripsPolyline 为 null 或不足 2 点 → 返回 null（调用方按 unknown 处理）。
 */
export function resolveSide(
  tripPolyline: [number, number][] | null | undefined,
  spot: ScenicSpotInput,
  options: FilterSpotsOptions = {},
): SpotRuntimeSide | null {
  if (!tripPolyline || tripPolyline.length < 2) return null;
  if (!Number.isFinite(spot.lng) || !Number.isFinite(spot.lat)) return null;

  const { path, lengthKm } = buildRailwayMetrics(tripPolyline);
  if (lengthKm <= 0 || path.length < 2) return null;

  return resolveSpotSide({
    path,
    lengthKm,
    lng: spot.lng,
    lat: spot.lat,
    storedSide: spot.side,
    lineRef: pickLineRef(spot.lines, options.corridorId),
    sideRefDirection: spot.sideRefDirection as SpotRuntimeSide['sideRefDirection'] | undefined,
    reversed: options.reversed,
  });
}

/**
 * 按行程折线过滤风景点：dist ≤ 阈值，按沿线 progressKm 升序。
 * 折线为空或不足 2 点 → []。
 *
 * 0.1.1 起同时输出运行时左右侧判定结果：
 *   sideRuntime / sideConfidence / sideFlipped / sideNeedsReview / alongKmFrom|To / matchedCorridorId
 */
export function filterSpotsAlongRailway(
  spots: ScenicSpotInput[],
  railway: [number, number][] | null | undefined,
  options: FilterSpotsOptions = {},
): ScenicSpot[] {
  if (!spots?.length || !railway || railway.length < 2) return [];

  const { path, lengthKm } = buildRailwayMetrics(railway);
  if (lengthKm <= 0 || path.length < 2) return [];

  const autoSide = options.autoSide !== false;
  const matched: ScenicSpot[] = [];

  for (const spot of spots) {
    if (!Number.isFinite(spot.lng) || !Number.isFinite(spot.lat)) continue;

    const proj = projectSpotToLine(path, lengthKm, spot.lng, spot.lat);
    if (!proj) continue;
    if (proj.distKm > maxDistFor(spot)) continue;

    const lineRef = pickLineRef(spot.lines, options.corridorId);
    let runtime: SpotRuntimeSide | null = null;
    if (autoSide) {
      runtime = resolveSpotSide({
        path,
        lengthKm,
        lng: spot.lng,
        lat: spot.lat,
        storedSide: spot.side,
        lineRef,
        sideRefDirection: spot.sideRefDirection as SpotRuntimeSide['sideRefDirection'] | undefined,
        reversed: options.reversed,
      });
    }

    matched.push({
      id: String(spot.id),
      name: spot.name,
      lng: spot.lng,
      lat: spot.lat,
      intro: spot.intro,
      visibility: spot.visibility || 'window',
      category: spot.category,
      nightOnly: spot.nightOnly,
      side: runtime?.side ?? spot.side,
      maxDistKm: spot.maxDistKm,
      distKm: Math.round(proj.distKm * 100) / 100,
      progressKm: Math.round(proj.alongKm * 100) / 100,
      source: spot.source || 'curated',
      // v3 扩展字段原样透传（v2 数据为 undefined，读取端按可选处理）
      viewScale: spot.viewScale,
      viewMinutes: spot.viewMinutes,
      dimensions: spot.dimensions,
      subtype: spot.subtype,
      tags: spot.tags,
      lines: spot.lines,
      sideRefDirection: spot.sideRefDirection,
      bestView: spot.bestView,
      honors: spot.honors,
      sources: spot.sources,
      verification: spot.verification,
      reviewedAt: spot.reviewedAt,
      reviewRound: spot.reviewRound,
      status: spot.status,
      // 运行时定侧结果
      sideRuntime: runtime?.side,
      sideConfidence: runtime?.confidence,
      sideFlipped: runtime?.flipped,
      sideNeedsReview: runtime?.needsReview,
      sideReason: runtime?.reason,
      alongKmFrom: lineRef?.alongKmFrom,
      alongKmTo: lineRef?.alongKmTo,
      matchedCorridorId: lineRef?.corridorId,
    });
  }

  matched.sort((a, b) => (a.progressKm ?? 0) - (b.progressKm ?? 0));
  return matched;
}
