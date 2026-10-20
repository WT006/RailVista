/**
 * 万里路书 · 全国公路旅游网 —— 路径规划（PRD §5.1）。
 *
 * 主引擎：本地 roadTopology CSR + A*
 *   - OD 端点 0.03° 网格 snap，容差 5km；超限降级「端点外接段 + 干线主段」拼接
 * 在线兜底：百度驾车 → OSRM（不再调用高德 Web 服务）
 * 本地与在线均失败时降级 direct（两点直连，engine 标注 direct，前端明示）。
 */
import { computeCumKm } from '@railvista/shared';
import type { GapAnnotation, RoadPoint, RoadRoute } from '@railvista/shared';
import { getRoadEntry, getRoadGeometry, getRoadGeometryFull } from './roadNetwork.js';
import { geocodeFallback, nearestPlaceName, resolvePlace } from './roadIndex.js';
import { buildChapters } from './roadsideSpots.js';
import type { RoadGeometryNode } from '@railvista/shared';
import {
  edgeClassBetween,
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
  /**
   * auto（默认）→ 本地干线 A*，失败再试百度 / OSRM；
   * local → 只用本地拓扑。
   */
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

// ── 引擎 1.6：百度地图驾车（v2 routing，WGS-84 进出免转换） ─────────────────
// 百度 ak：coord_type=wgs84（输入）+ ret_coordtype=wgs84ll（输出），全程免 BD-09 转换；
// 国内路网数据质量优于 OSRM，排在 OSRM 之前。
async function baiduDriveRoute(from: Pt, to: Pt, via: Pt[]): Promise<{ coords: [number, number][]; distanceM: number; durationSec: number } | null> {
  const key = process.env.BAIDU_MAP_KEY;
  if (!key) return null;
  const fmt = (p: Pt) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`; // 百度坐标序：纬度在前
  const wp = via.length ? via.map(fmt).join(';') : '';
  const url = `https://api.map.baidu.com/direction/v2/routing?origin=${encodeURIComponent(fmt(from))}&destination=${encodeURIComponent(fmt(to))}${wp ? "&waypoints=" + encodeURIComponent(wp) : ""}&coord_type=wgs84&ret_coordtype=wgs84ll&tactics_infor=0&ak=${key}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(9000),
      headers: { 'User-Agent': 'RailVista/0.4.0 (drive-routing)' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: number;
      result?: {
        routes?: Array<{
          distance?: number;
          duration?: number;
          steps?: Array<{ path?: string }>;
        }>;
      };
    };
    if (json.status !== 0 || !json.result?.routes?.length) return null;
    const route = json.result.routes[0]!;
    const coords: [number, number][] = [];
    for (const step of route.steps ?? []) {
      if (!step.path) continue;
      for (const pair of step.path.split(';')) {
        const [blat, blng] = pair.split(',').map(Number);
        if (!Number.isFinite(blng) || !Number.isFinite(blat)) continue;
        coords.push([blng, blat]);
      }
    }
    if (coords.length < 2) return null;
    return {
      coords,
      distanceM: Number(route.distance) || 0,
      durationSec: Number(route.duration) || 0,
    };
  } catch {
    return null;
  }
}
/** Google / OSRM encoded polyline → [lng, lat][]（precision 5） */
function decodeOsrmPolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}
// ── 引擎 1.5：OSRM 公共实例（开源 OSM 路网，WGS-84 免转换） ──────────────────
// OSRM（router.project-osrm.org）基于全量 OSM 路网，坐标进出均为 WGS-84，
// 无 GCJ 偏移，也不占任何商业额度。
async function osrmDriveRoute(from: Pt, to: Pt, via: Pt[]): Promise<{ coords: [number, number][]; distanceM: number; durationSec: number } | null> {
  const pts = [from, ...via, to];
  const coord = pts.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  // polyline 比 geojson 小一个数量级：北京→拉萨 full 约 1–2s，geojson 常 >15s 超时掉直线
  const qs = new URLSearchParams({ overview: 'full', geometries: 'polyline' });
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coord}?${qs}`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'RailVista/0.4.0 (drive-routing)' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      code?: string;
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: string;
      }>;
    };
    if (json.code !== 'Ok' || !json.routes?.length) return null;
    const r = json.routes[0]!;
    const coords = typeof r.geometry === 'string' ? decodeOsrmPolyline(r.geometry) : [];
    if (coords.length < 2) return null;
    return {
      coords,
      distanceM: Number(r.distance) || 0,
      durationSec: Number(r.duration) || 0,
    };
  } catch {
    return null;
  }
}
// ── 引擎 2：本地干线 A*（snap 5km，超限端点外接） ────────────────────────────
/** 时长估算用等级限速（km/h）：只用来把里程折成「约几小时」，标注为估算，不代表真实路况 */
const EST_SPEED_KMH: Record<string, number> = { expressway: 85, national: 65, provincial: 50, county: 40, township: 30, connector: 40 };

function edgeClassOf(u: number, v: number): keyof typeof EST_SPEED_KMH {
  const flag = edgeClassBetween(u, v);
  if (flag & 1) return 'expressway';
  if (flag & 2) return 'national';
  if (flag & 4) return 'provincial';
  if (flag & 8) return 'county';
  if (flag & 16) return 'township';
  return 'connector'; // 跨线边（flag 0）
}

function straightKm(a: Pt, b: Pt): number {
  const dLng = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dLat = b.lat - a.lat;
  return Math.sqrt(dLng * dLng + dLat * dLat) * 111;
}

function localDriveRoute(from: Pt, to: Pt, preferKeys: string[]):
  | { coords: [number, number][]; roadKeys: string[]; spliced: boolean; estMin: number }
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
  let estMin = 0;
  for (let i = 1; i < path.length; i += 1) {
    const u = path[i - 1]!;
    const v = path[i]!;
    const lineId = edgeLineBetween(u, v);
    const key = lineId >= 0 ? roadKeyOfLine(lineId) : undefined;
    if (key) roadKeys.add(key);
    const a = roadNodeCoords(u);
    const b = roadNodeCoords(v);
    if (a && b) estMin += (straightKm(a, b) / EST_SPEED_KMH[edgeClassOf(u, v)]) * 60;
  }
  // 端点外接段（输入点到最近干线节点）按连接线速度补上
  const a0 = roadNodeCoords(path[0]!);
  const bN = roadNodeCoords(path[path.length - 1]!);
  if (a0) estMin += (straightKm(from, a0) / EST_SPEED_KMH.connector) * 60;
  if (bN) estMin += (straightKm(bN, to) / EST_SPEED_KMH.connector) * 60;

  const coords: [number, number][] = [[from.lng, from.lat]];
  for (const idx of path) {
    const p = roadNodeCoords(idx);
    if (p) coords.push([p.lng, p.lat]);
  }
  coords.push([to.lng, to.lat]);
  return { coords, roadKeys: [...roadKeys], spliced, estMin: Math.round(estMin) };
}

/**
 * OD 折线的地名锚点（供章节起名）。
 *
 * 几何自带的 nodes 只有「整条公路」入口才有（C2），点对点规划出来的折线没有，
 * 于是 buildChapters 只能退回 120km 数字窗口，章节名全是「第 7 段 · 720—840 km」——
 * 用户看不出自己会经过哪。现在按里程每 OD_CHAPTER_KM 取一个点，用行政区划库
 * 反查最近地名补上，段名变成「上海 — 湖州」。
 *
 * 首尾直接用用户输入的起终点名（source 'place'，比反查更可信）。
 */
const OD_CHAPTER_KM = 120;

function odPlaceAnchors(
  coords: [number, number][],
  cum: number[],
  fromLabel: string,
  toLabel: string,
): RoadGeometryNode[] {
  const total = cum[cum.length - 1] ?? 0;
  if (!(total > 0) || cum.length !== coords.length) return [];
  const nodes: RoadGeometryNode[] = [
    { name: fromLabel, atKm: 0, type: 'endpoint', source: 'place' },
  ];
  let cursor = 0;
  for (let target = OD_CHAPTER_KM; target < total - OD_CHAPTER_KM / 2; target += OD_CHAPTER_KM) {
    // cum 单调递增，游标只前进
    while (cursor + 1 < cum.length && cum[cursor + 1]! < target) cursor += 1;
    const p = coords[cursor];
    if (!p) continue;
    const hit = nearestPlaceName(p[0], p[1]);
    if (!hit) continue;
    const atKm = Math.round(cum[cursor]! * 10) / 10;
    const last = nodes[nodes.length - 1]!;
    if (last.name === hit.name) continue; // 相邻段落在同一个城市里，不重复起名
    nodes.push({ name: hit.name, atKm, type: 'settlement', source: 'place' });
  }
  nodes.push({ name: toLabel, atKm: Math.round(total * 10) / 10, type: 'endpoint', source: 'place' });
  return nodes;
}

// ── 主入口 ───────────────────────────────────────────────────────────────────
/** 途经点：能解析就进折线；解析不到就跳过（可写景点/任意文案，不挡 OD 规划） */
async function resolveViaSoft(text: string): Promise<Pt | null> {
  const t = text.trim();
  if (!t) return null;
  try {
    return (await resolveEndpoint(t, 'from')).pt;
  } catch (e) {
    if (e instanceof PlaceNotFoundError) return null;
    throw e;
  }
}

export async function planDriveRoute(input: PlanRouteInput): Promise<RoadRoute> {
  const from = await resolveEndpoint(input.from, 'from');
  const to = await resolveEndpoint(input.to, 'to');
  const viaPts: Pt[] = [];
  for (const v of input.via ?? []) {
    const pt = await resolveViaSoft(v);
    if (pt) viaPts.push(pt);
  }

  const preferKeys = [from.roadKey, to.roadKey].filter((k): k is string => !!k);
  let engine = '';
  let coords: [number, number][] = [];
  let durationMin: number | undefined;
  let roadKeys: string[] = [];

  // 超长 OD（北京→拉萨级，含途经点）：本地 A* 与在线规划并行。
  // 本地失败/偏慢时不再串行干等，避免公共 OSRM 慢查询把整请求拖进两点直线。
  const odStraightKm = straightKm(from.pt, to.pt);
  const raceOnline =
    input.engine !== 'local' && odStraightKm >= 800;
  const onlineRace = raceOnline
    ? (async (): Promise<{
        engine: string;
        coords: [number, number][];
        durationSec: number;
      } | null> => {
        const baidu = await baiduDriveRoute(from.pt, to.pt, viaPts);
        if (baidu) {
          return { engine: 'baidu', coords: baidu.coords, durationSec: baidu.durationSec };
        }
        const osrm = await osrmDriveRoute(from.pt, to.pt, viaPts);
        if (osrm) {
          return { engine: 'osrm', coords: osrm.coords, durationSec: osrm.durationSec };
        }
        return null;
      })()
    : null;

  // 本地优先（见 PlanRouteInput.engine 注释）。
  // 有途经点时先按 from→via…→to 逐段 A* 再首尾相接（旧实现对本地引擎直接无视 via，
  // 换成本地优先后会变成「静默少走途经点」，比报错更糟）。
  {
    const pts = [from.pt, ...viaPts, to.pt];
    const legs: [number, number][][] = [];
    const keys = new Set<string>();
    let estMin = 0;
    let spliced = false;
    let legOk = true;
    for (let i = 1; i < pts.length; i += 1) {
      const leg = localDriveRoute(pts[i - 1]!, pts[i]!, preferKeys);
      if (!leg) {
        legOk = false;
        break;
      }
      // 第 2 段起去掉与上一段重复的接驳点
      legs.push(i === 1 ? leg.coords : leg.coords.slice(1));
      for (const k of leg.roadKeys) keys.add(k);
      spliced = spliced || leg.spliced;
      estMin += leg.estMin;
    }
    if (legOk && legs.length) {
      engine = spliced ? 'local-spliced' : 'local';
      coords = legs.flat();
      roadKeys = [...keys];
      durationMin = estMin > 0 ? estMin : undefined;
    }
  }
  if (!coords.length && input.engine !== 'local') {
    const raced = onlineRace ? await onlineRace : null;
    if (raced) {
      engine = raced.engine;
      coords = raced.coords;
      if (raced.durationSec > 0) durationMin = Math.round(raced.durationSec / 60);
    }
  }
  if (!coords.length && input.engine !== 'local') {
    // 短途未并行时：串行百度 → OSRM
    const baidu = await baiduDriveRoute(from.pt, to.pt, viaPts);
    if (baidu) {
      engine = 'baidu';
      coords = baidu.coords;
      if (baidu.durationSec > 0) durationMin = Math.round(baidu.durationSec / 60);
    }
  }
  if (!coords.length && input.engine !== 'local') {
    const osrm = await osrmDriveRoute(from.pt, to.pt, viaPts);
    if (osrm) {
      engine = 'osrm';
      coords = osrm.coords;
      if (osrm.durationSec > 0) durationMin = Math.round(osrm.durationSec / 60);
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
    // v0.6.5 P0-1 同款：必须在**抽稀之前**按全分辨率链算好随坐标下发。
    // OD 折线动辄 6000+ 节点（上海→拉萨 6636），抽稀到 600 后前端若自己重算
    // haversine，里程会大幅缩水，章节区间落不到折线上 → 分段无高亮。
    cumKm: cum,
    chapters: buildChapters(coords, lengthKm, odPlaceAnchors(coords, cum, from.label, to.label)),
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
  // ⚠️ 刻意**不**用 geom.cumKm —— 那个落盘字段是历史遗留的「米」量纲且不可信
  // （实测 G318 末值 1627363.5，而 drawnKm=6331.5）。这里现算公里值并随坐标下发。
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
  if (engine === 'baidu') return '百度驾车规划（WGS-84）';
  if (engine === 'osrm') return 'OSRM 开源路网规划（OSM · WGS-84）';
  // 2026-10-11：国道/省道几何补全后本地网已是全国网（主分量覆盖 98.2% 节点）。
  // 里程是路网实算，时长是按等级限速折的估算——两件事必须分开说，不能让用户
  // 把「约 N 小时」当成导航 ETA。
  if (engine === 'local') return '本地公路网 A*（里程路网实算 · 时长按等级限速估算）';
  if (engine === 'local-spliced') return '本地公路网 A*（端点附近无干线节点，首尾为外接段 · 时长估算）';
  // 真正走到 direct：本地 + 在线兜底全失败（超时/无 key/无路）。
  return '两点直连示意：本地路网与在线规划均未成功，未做寻路（不代表真实路线）';
}
