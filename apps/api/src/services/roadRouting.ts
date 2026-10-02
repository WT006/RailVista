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
import type { GapAnnotation, RoadPoint, RoadRoute } from '@railvista/shared';
import { getRoadEntry, getRoadGeometry, getRoadGeometryFull } from './roadNetwork.js';
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
    // A4：原文案提示「直接点地图选点」，但自驾页从未实现地图点选
    // （DriveHome 的 SVG 上没有任何获取坐标的 handler），属于错误引导。
    // 改为提示真实可用的替代路径。
    super(`未找到「${name}」，请改用城市/区县名，或先在「按公路编号」中选定公路`);
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

/** C2「整条公路」入口：L1 几何直接就是折线（PRD §5.4），含多段 segments + 断点标注 */
export function planRoadRoute(key: string): (RoadRoute & {
  segments?: RoadPoint[][];
  gapAnnotations?: GapAnnotation[];
}) | null {
  const entry = getRoadEntry(key);
  const geom = getRoadGeometryFull(key);
  if (!entry || !geom) return null;
  const coords = geom.points.map((p) => [p[0], p[1]] as [number, number]);
  const cum = computeCumKm(coords);
  // v0.6.0：里程用去重后里程（双向分隔道路只计一条），与官方里程可比；
  // 主链长度仅代表最长连通分量，长线会显著小于全线里程。
  const lengthKm = Number.isFinite((geom as { totalKm?: number }).totalKm)
    ? Math.round(((geom as { totalKm?: number }).totalKm as number) * 10) / 10
    : Math.round(cum[cum.length - 1]! * 10) / 10;
  const hasSegments = geom.segments.length > 0;
  return {
    id: `road-${key}`,
    name: `${entry.ref} ${entry.name ?? ''}`.trim(),
    roadKeys: [key],
    provinces: entry.provinces,
    lengthKm,
    coords,
    // v0.6.5（P0-1）：全分辨率主链的累计里程，与上面 coords 一一对应。
    // /along 会把 coords 抽稀到 ≤600 点并同步切片本数组 —— 前端据此把
    // 「章节 atKm」映射回折线点。若让前端自己在抽稀链上重算，里程会缩水
    // （G318 实测 117.8km / 7.2%），末段将落在重算链外导致无高亮。
    cumKm: cum,
    // v0.6.5：nodes 现在也承载「沿几何反查出来的中途地名」（见
    // scripts/fill-road-place-anchors.mjs），与「起讫点声明」是两回事。
    // B2-1 当初因 nodes[0].name="上海" 而几何首点其实在西藏，把 nodes 整体禁用；
    // 现在端点不可信只影响 UI 的「起点 — 终点」标题（DriveRoad 仍按 B2-1 降级为
    // 「全线走向（端点待核）」），中途地名段照常展示 —— 实测 G217/G318 两条主干
    // 都带 endpointsUnverified，禁用 nodes 会让它们的分段永久退化成 120km 数字区间。
    // 量纲不可信的老数据由 buildChapters 内部的 sanitizePlaceNodes 兜住。
    chapters: buildChapters(coords, lengthKm, geom.nodes),
    engine: 'local',
    engineNote: hasSegments
      ? `本地干线几何（部分段，${geom.gapCount} 处未贯通）`
      : routeEngineNote('local'),
    segments: hasSegments ? geom.segments : undefined,
    gapAnnotations: hasSegments ? geom.gapAnnotations : undefined,
  };
}

/** 供 /along 响应标注引擎信息 */
export function routeEngineNote(engine: string): string {
  if (engine === 'amap') return '高德驾车规划（GCJ-02 已转 WGS-84）';
  if (engine === 'local') return '本地干线拓扑 A*';
  if (engine === 'local-spliced') return '本地干线 A*（端点外接段拼接）';
  // A3 实测：本地路网连通分量 1237 个、主分量 bbox 仅 lng[84.8,109.1]/lat[25.3,40.3]（青藏东部），
  // 华东/华南/华北均不在主分量内，跨省 OD 无法规划。这里如实说明覆盖边界，
  // 避免用户把两点直线误认为真实路线规划结果。
  return '两点直连示意：本地路网仅覆盖青藏部分干线，跨省规划暂不可用（不代表真实路线）';
}
