/**
 * 万里路书 · 全国公路旅游网 —— 双引擎路径规划（PRD §5.1）。
 *
 * 引擎 1（在线，默认）：高德 Web 服务「驾车路径规划 v5」
 *   - 返回 GCJ-02 折线，必须 gcj02ToWgs84() 后才与 OSM/景点库对齐
 *   - strategy 10 推荐；waypoints 支持途经点
 * 引擎 2（本地，兜底 + 鸿蒙端）：roadTopology CSR + A*
 *   - OD 端点 0.03° 网格 snap，容差 5km；超限降级「端点外接段 + 干线主段」拼接
 * 两种引擎出折线后走完全相同的下游（filterSpotsAlongRoad），保证景点结果一致。
 *
 * 本地拓扑不可用时最后降级 direct（两点直连，engine 标注 direct，前端明示）。
 */
import { computeCumKm, gcj02ToWgs84 } from '@railvista/shared';
import type { RoadRoute } from '@railvista/shared';
import { getRoadEntry, getRoadGeometry } from './roadNetwork.js';
import { geocodeFallback, resolvePlace } from './roadIndex.js';
import { buildChapters } from './roadsideSpots.js';
import {
  edgeLineBetween,
  loadRoadTopology,
  nearestRoadNode,
  roadKeyOfLine,
  roadNodeCoords,
  roadRouteLeg,
  roadKeyIds,
  ROAD_SNAP_KM,
} from './roadTopology.js';

export interface PlanRouteInput {
  from: string;
  to: string;
  via?: string[];
  engine?: 'auto' | 'local';
}

export class PlaceNotFoundError extends Error {
  code = 'PLACE_NOT_FOUND';
  constructor(public field: 'from' | 'to', name: string) {
    super(`未找到「${name}」，请换个说法或直接点地图选点`);
  }
}

type Pt = { lng: number; lat: number };

const AMAP_TIMEOUT_MS = 8000;

function parseLngLat(text: string): Pt | null {
  const m = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (lng < 73 || lng > 136 || lat < 17 || lat > 55) return null;
  return { lng, lat };
}

/** OD 端点解析：坐标串 → 本地索引（地名/公路）→ 网络 geocode 兜底 */
async function resolveEndpoint(text: string, field: 'from' | 'to'): Promise<{ pt: Pt; label: string; roadKey?: string }> {
  const direct = parseLngLat(text);
  if (direct) return { pt: direct, label: `${direct.lng.toFixed(3)},${direct.lat.toFixed(3)}` };

  const hit = resolvePlace(text);
  if (hit) {
    // 公路命中：起点取几何首点（终点取末点），无几何退 bbox
    if (hit.kind === 'road') {
      const g = getRoadGeometry(hit.id);
      if (g && g.points.length >= 2) {
        const idx = field === 'from' ? 0 : g.points.length - 1;
        const p = g.points[idx]!;
        return { pt: { lng: p[0], lat: p[1] }, label: hit.name, roadKey: hit.id };
      }
    }
    if (Number.isFinite(hit.lng) && Number.isFinite(hit.lat) && (hit.lng !== 104 || hit.lat !== 35)) {
      return { pt: { lng: hit.lng, lat: hit.lat }, label: hit.name, roadKey: hit.kind === 'road' ? hit.id : undefined };
    }
  }

  const remote = await geocodeFallback(text);
  if (remote) return { pt: { lng: remote.lng, lat: remote.lat }, label: remote.name };

  throw new PlaceNotFoundError(field, text);
}

// ── 引擎 1：高德驾车规划（v5，GCJ-02 → WGS-84） ─────────────────────────────
async function amapDriveRoute(from: Pt, to: Pt, via: Pt[]): Promise<{ coords: [number, number][]; distanceM: number; durationSec: number } | null> {
  const key = process.env.AMAP_KEY;
  if (!key) return null;
  const fmt = (p: Pt) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
  const qs = new URLSearchParams({
    key,
    origin: fmt(from),
    destination: fmt(to),
    strategy: '10',
    show_fields: 'polyline,cost',
  });
  if (via.length) qs.set('waypoints', via.map(fmt).join(';'));
  try {
    const res = await fetch(`https://restapi.amap.com/v5/direction/driving?${qs}`, {
      signal: AbortSignal.timeout(AMAP_TIMEOUT_MS),
      headers: { 'User-Agent': 'RailVista/0.4.0 (drive-routing)' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      errcode?: number;
      route?: {
        paths?: Array<{
          distance?: number;
          cost?: { duration?: number };
          steps?: Array<{ polyline?: string }>;
        }>;
      };
    };
    if (json.errcode !== 0 || !json.route?.paths?.length) return null;
    const path = json.route.paths[0]!;
    const coords: [number, number][] = [];
    for (const step of path.steps ?? []) {
      if (!step.polyline) continue;
      for (const pair of step.polyline.split(';')) {
        const [glng, glat] = pair.split(',').map(Number);
        if (!Number.isFinite(glng) || !Number.isFinite(glat)) continue;
        const { lng, lat } = gcj02ToWgs84(glng, glat);
        coords.push([lng, lat]);
      }
    }
    if (coords.length < 2) return null;
    return {
      coords,
      distanceM: Number(path.distance) || 0,
      durationSec: Number(path.cost?.duration) || 0,
    };
  } catch {
    return null;
  }
}

// ── 引擎 2：本地干线 A*（snap 5km，超限端点外接） ────────────────────────────
function localDriveRoute(from: Pt, to: Pt, preferKeys: string[]):
  | { coords: [number, number][]; roadKeys: string[]; spliced: boolean }
  | null {
  if (!loadRoadTopology()) return null;
  // 容差 5km；超限用 150km 宽容 snap（端点外接段 + 干线主段拼接）
  let na = nearestRoadNode(from.lng, from.lat, ROAD_SNAP_KM);
  let nb = nearestRoadNode(to.lng, to.lat, ROAD_SNAP_KM);
  let spliced = false;
  if (na == null) {
    na = nearestRoadNode(from.lng, from.lat, 150);
    spliced = true;
  }
  if (nb == null) {
    nb = nearestRoadNode(to.lng, to.lat, 150);
    spliced = true;
  }
  if (na == null || nb == null) return null;

  const path = roadRouteLeg(na, nb, { preferRoadKeys: preferKeys.length ? roadKeyIds(preferKeys) : undefined });
  if (!path || path.length < 2) return null;

  const roadKeys = new Set<string>();
  for (let i = 1; i < path.length; i += 1) {
    const lineId = edgeLineBetween(path[i - 1]!, path[i]!);
    const key = lineId >= 0 ? roadKeyOfLine(lineId) : undefined;
    if (key) roadKeys.add(key);
  }

  const coords: [number, number][] = [[from.lng, from.lat]];
  for (const idx of path) {
    const p = roadNodeCoords(idx);
    if (p) coords.push([p.lng, p.lat]);
  }
  coords.push([to.lng, to.lat]);
  return { coords, roadKeys: [...roadKeys], spliced };
}

// ── 主入口 ───────────────────────────────────────────────────────────────────
export async function planDriveRoute(input: PlanRouteInput): Promise<RoadRoute> {
  const from = await resolveEndpoint(input.from, 'from');
  const to = await resolveEndpoint(input.to, 'to');
  const viaPts: Pt[] = [];
  for (const v of input.via ?? []) {
    viaPts.push((await resolveEndpoint(v, 'from')).pt);
  }

  const preferKeys = [from.roadKey, to.roadKey].filter((k): k is string => !!k);
  let engine = '';
  let coords: [number, number][] = [];
  let durationMin: number | undefined;
  let roadKeys: string[] = [];

  if (input.engine !== 'local') {
    const amap = await amapDriveRoute(from.pt, to.pt, viaPts);
    if (amap) {
      engine = 'amap';
      coords = amap.coords;
      if (amap.durationSec > 0) durationMin = Math.round(amap.durationSec / 60);
    }
  }
  if (!coords.length) {
    const local = localDriveRoute(from.pt, to.pt, preferKeys);
    if (local) {
      engine = local.spliced ? 'local-spliced' : 'local';
      coords = local.coords;
      roadKeys = local.roadKeys;
    }
  }
  if (!coords.length) {
    engine = 'direct';
    coords = [
      [from.pt.lng, from.pt.lat],
      [to.pt.lng, to.pt.lat],
    ];
  }

  const cum = computeCumKm(coords);
  const lengthKm = Math.round(cum[cum.length - 1]! * 10) / 10;
  const name = `${from.label} → ${to.label}`;
  const id = `od-${from.label}-${to.label}`.replace(/[^\w\u4e00-\u9fa5-]+/g, '-');

  return {
    id,
    name,
    roadKeys,
    provinces: [],
    lengthKm,
    durationMin,
    coords,
    chapters: buildChapters(coords, lengthKm),
    engine,
    engineNote: routeEngineNote(engine),
  };
}

/** C2「整条公路」入口：L1 几何直接就是折线（PRD §5.4） */
export function planRoadRoute(key: string): RoadRoute | null {
  const entry = getRoadEntry(key);
  const geom = getRoadGeometry(key);
  if (!entry || !geom) return null;
  const coords = geom.points.map((p) => [p[0], p[1]] as [number, number]);
  const cum = computeCumKm(coords);
  const lengthKm = Math.round(cum[cum.length - 1]! * 10) / 10;
  return {
    id: `road-${key}`,
    name: `${entry.ref} ${entry.name ?? ''}`.trim(),
    roadKeys: [key],
    provinces: entry.provinces,
    lengthKm,
    coords,
    chapters: buildChapters(coords, lengthKm, geom.nodes),
  };
}

/** 供 /along 响应标注引擎信息 */
export function routeEngineNote(engine: string): string {
  if (engine === 'amap') return '高德驾车规划（GCJ-02 已转 WGS-84）';
  if (engine === 'local') return '本地干线拓扑 A*';
  if (engine === 'local-spliced') return '本地干线 A*（端点外接段拼接）';
  return '两点直连（干线未覆盖，仅供示意）';
}
