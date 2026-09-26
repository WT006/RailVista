import type { ScenicSpot, SpotVisibility } from '../types.js';
import { buildRailwayMetrics, projectToRailway } from './progress.js';

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

/**
 * 按行程折线过滤风景点：dist ≤ 阈值，按沿线 progressKm 升序。
 * 折线为空或不足 2 点 → []。
 */
export function filterSpotsAlongRailway(
  spots: ScenicSpotInput[],
  railway: [number, number][] | null | undefined,
): ScenicSpot[] {
  if (!spots?.length || !railway || railway.length < 2) return [];

  const { path, lengthKm } = buildRailwayMetrics(railway);
  if (lengthKm <= 0 || path.length < 2) return [];

  const matched: ScenicSpot[] = [];
  for (const spot of spots) {
    if (!Number.isFinite(spot.lng) || !Number.isFinite(spot.lat)) continue;
    const proj = projectToRailway(path, lengthKm, spot.lng, spot.lat);
    if (proj.distKm > maxDistFor(spot)) continue;
    matched.push({
      id: String(spot.id),
      name: spot.name,
      lng: spot.lng,
      lat: spot.lat,
      intro: spot.intro,
      visibility: spot.visibility || 'window',
      category: spot.category,
      nightOnly: spot.nightOnly,
      side: spot.side,
      maxDistKm: spot.maxDistKm,
      distKm: Math.round(proj.distKm * 100) / 100,
      progressKm: Math.round(proj.progress * lengthKm * 100) / 100,
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
      sources: spot.sources,
      verification: spot.verification,
      reviewedAt: spot.reviewedAt,
      reviewRound: spot.reviewRound,
      status: spot.status,
    });
  }

  matched.sort((a, b) => (a.progressKm ?? 0) - (b.progressKm ?? 0));
  return matched;
}
