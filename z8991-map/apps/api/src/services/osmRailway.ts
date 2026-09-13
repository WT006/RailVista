import { createHash } from 'node:crypto';
import { cache } from './cache.js';
import { buildLocalSegment } from './localRails.js';

export type LngLat = { lng: number; lat: number };

type OsmWay = {
  id: number;
  points: LngLat[];
  highspeed?: boolean;
};

type AdjEdge = { j: number; enter: 'head' | 'tail'; reverse: boolean };

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** 山区轨断口略放宽（约 800～1200m） */
const CONNECT_TOL = 0.012;
const CACHE_TTL_SEC = Number(process.env.CACHE_TTL_RAIL_SEC || 24 * 3600);
/** 走廊查询半径（米），越大越全但越慢 */
const CORRIDOR_RADIUS_M = 9000;
const CHUNK_STATIONS = 5;
/** 车站投影到钢轨的最大可信距离 */
const MAX_SNAP_KM = 20;

function dist(a: LngLat, b: LngLat): number {
  return Math.hypot(a.lng - b.lng, a.lat - b.lat);
}

function haversineKm(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function wayLengthKm(points: LngLat[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) sum += haversineKm(points[i - 1], points[i]);
  return sum;
}

async function overpass(
  query: string,
  timeoutMs = 25000,
  opts?: { maxMirrors?: number },
): Promise<OsmWay[]> {
  let lastErr: unknown;
  const mirrors = OVERPASS_URLS.slice(0, Math.max(1, opts?.maxMirrors ?? OVERPASS_URLS.length));
  for (const url of mirrors) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'RailVista/0.1 (railway geometry; educational)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as {
        elements?: Array<{
          type: string;
          id: number;
          tags?: Record<string, string>;
          geometry?: Array<{ lon: number; lat: number }>;
        }>;
      };
      const ways: OsmWay[] = [];
      for (const el of json.elements || []) {
        if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
        ways.push({
          id: el.id,
          highspeed: el.tags?.highspeed === 'yes',
          points: el.geometry.map((g) => ({ lng: g.lon, lat: g.lat })),
        });
      }
      return ways;
    } catch (e) {
      lastErr = e;
    }
  }
  throw Object.assign(new Error(`OSM 查询失败：${String(lastErr)}`), { code: 'OSM_FAIL' });
}

function aroundChain(stops: LngLat[], radiusM: number): string {
  // around:radius,lat,lon,lat,lon,...
  const parts = stops.map((s) => `${s.lat},${s.lng}`).join(',');
  return `around:${radiusM},${parts}`;
}

function bboxOfStops(stops: LngLat[], pad = 0.15) {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const s of stops) {
    south = Math.min(south, s.lat);
    north = Math.max(north, s.lat);
    west = Math.min(west, s.lng);
    east = Math.max(east, s.lng);
  }
  return {
    south: south - pad,
    west: west - pad,
    north: north + pad,
    east: east + pad,
  };
}

function buildCorridorQuery(stops: LngLat[], highspeedOnly: boolean): string {
  const around = aroundChain(stops, CORRIDOR_RADIUS_M);
  const hs = highspeedOnly ? '["highspeed"="yes"]' : '';
  return `
[out:json][timeout:22];
(
  way["railway"="rail"]${hs}(${around});
);
out geom;
`.trim();
}

function buildBboxQuery(
  bbox: { south: number; west: number; north: number; east: number },
  highspeedOnly: boolean,
): string {
  const { south, west, north, east } = bbox;
  const hs = highspeedOnly ? '["highspeed"="yes"]' : '';
  return `
[out:json][timeout:22];
(
  way["railway"="rail"]${hs}(${south},${west},${north},${east});
);
out geom;
`.trim();
}

async function fetchWaysAlongRoute(stops: LngLat[], preferHighspeed: boolean): Promise<OsmWay[]> {
  const byId = new Map<number, OsmWay>();
  const bbox = bboxOfStops(stops, 0.18);
  const spanKm = haversineKm(
    { lng: bbox.west, lat: bbox.south },
    { lng: bbox.east, lat: bbox.north },
  );

  // 1) 短程才用整段 bbox；长跨度（如太原→沪）bbox 过大又慢，还会混入无关干线
  if (spanKm < 650) {
    try {
      const bboxWays = await overpass(buildBboxQuery(bbox, preferHighspeed));
      for (const w of bboxWays) byId.set(w.id, w);
    } catch (e) {
      console.warn('[rail] bbox fetch failed', e);
    }
  } else {
    console.log(`[rail] skip bbox spanKm=${spanKm.toFixed(0)} (use corridor chunks)`);
  }

  // 2) 分块走廊沿站序拉取（长线主路径）
  const chunks: LngLat[][] = [];
  if (stops.length <= CHUNK_STATIONS) {
    chunks.push(stops);
  } else {
    for (let i = 0; i < stops.length - 1; i += CHUNK_STATIONS - 1) {
      const chunk = stops.slice(i, Math.min(i + CHUNK_STATIONS, stops.length));
      if (chunk.length >= 2) chunks.push(chunk);
    }
  }

  for (let ci = 0; ci < chunks.length; ci += 1) {
    try {
      const ways = await overpass(buildCorridorQuery(chunks[ci], preferHighspeed));
      for (const w of ways) byId.set(w.id, w);
    } catch (e) {
      console.warn('[rail] corridor chunk failed', ci, e);
    }
    if (ci < chunks.length - 1) await new Promise((r) => setTimeout(r, 200));
  }

  console.log(
    `[rail] ways=${byId.size} hs=${preferHighspeed} stops=${stops.length} spanKm=${spanKm.toFixed(0)}`,
  );
  return [...byId.values()];
}

function buildAdj(ways: OsmWay[]): Array<{ head: AdjEdge[]; tail: AdjEdge[] }> {
  const adj = ways.map(() => ({ head: [] as AdjEdge[], tail: [] as AdjEdge[] }));
  for (let i = 0; i < ways.length; i += 1) {
    for (let j = 0; j < ways.length; j += 1) {
      if (i === j) continue;
      const a = ways[i];
      const b = ways[j];
      const aHead = a.points[0];
      const aTail = a.points[a.points.length - 1];
      const bHead = b.points[0];
      const bTail = b.points[b.points.length - 1];
      if (dist(aTail, bHead) < CONNECT_TOL) adj[i].tail.push({ j, enter: 'head', reverse: false });
      if (dist(aTail, bTail) < CONNECT_TOL) adj[i].tail.push({ j, enter: 'tail', reverse: true });
      if (dist(aHead, bTail) < CONNECT_TOL) adj[i].head.push({ j, enter: 'tail', reverse: false });
      if (dist(aHead, bHead) < CONNECT_TOL) adj[i].head.push({ j, enter: 'head', reverse: true });
    }
  }
  return adj;
}

function nearestOnWays(
  ways: OsmWay[],
  target: LngLat,
): { wayIdx: number; pointIdx: number; dKm: number; point: LngLat } | null {
  type Hit = { wayIdx: number; pointIdx: number; dKm: number; point: LngLat };
  let best: Hit | null = null;
  for (let wayIdx = 0; wayIdx < ways.length; wayIdx += 1) {
    const w = ways[wayIdx];
    // 采样加速：长 way 每隔若干点测一次，再在邻域精修
    const step = Math.max(1, Math.floor(w.points.length / 80));
    for (let pointIdx = 0; pointIdx < w.points.length; pointIdx += step) {
      const p = w.points[pointIdx];
      const dKm = haversineKm(p, target);
      if (!best || dKm < best.dKm) best = { wayIdx, pointIdx, dKm, point: p };
    }
  }
  if (!best) return null;
  // 精修最近点
  const w = ways[best.wayIdx];
  const lo = Math.max(0, best.pointIdx - stepWindow(w.points.length));
  const hi = Math.min(w.points.length - 1, best.pointIdx + stepWindow(w.points.length));
  let refined: Hit = best;
  for (let i = lo; i <= hi; i += 1) {
    const dKm = haversineKm(w.points[i], target);
    if (dKm < refined.dKm) {
      refined = { wayIdx: refined.wayIdx, pointIdx: i, dKm, point: w.points[i] };
    }
  }
  return refined;
}

function stepWindow(n: number): number {
  return Math.max(20, Math.floor(n / 40));
}

type PathState = {
  wayIdx: number;
  exitEnd: 'head' | 'tail';
  cost: number;
  reversed: boolean;
  prev: PathState | null;
};

function dijkstraPath(
  ways: OsmWay[],
  adj: Array<{ head: AdjEdge[]; tail: AdjEdge[] }>,
  startWay: number,
  endWay: number,
): { wayIdx: number; reversed: boolean }[] | null {
  const key = (wayIdx: number, exitEnd: string) => `${wayIdx}:${exitEnd}`;
  const distMap = new Map<string, number>();
  const prevMap = new Map<string, PathState>();
  const queue: PathState[] = [
    { wayIdx: startWay, exitEnd: 'tail', cost: 0, reversed: false, prev: null },
    { wayIdx: startWay, exitEnd: 'head', cost: 0, reversed: true, prev: null },
  ];
  for (const s of queue) {
    distMap.set(key(s.wayIdx, s.exitEnd), 0);
    prevMap.set(key(s.wayIdx, s.exitEnd), s);
  }

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift()!;
    const ck = key(cur.wayIdx, cur.exitEnd);
    if (cur.cost > (distMap.get(ck) ?? Infinity)) continue;

    for (const edge of adj[cur.wayIdx][cur.exitEnd]) {
      const addCost = wayLengthKm(ways[edge.j].points);
      const nextExit: 'head' | 'tail' = edge.enter === 'head' ? 'tail' : 'head';
      const nk = key(edge.j, nextExit);
      const nc = cur.cost + addCost;
      if (nc < (distMap.get(nk) ?? Infinity)) {
        const state: PathState = {
          wayIdx: edge.j,
          exitEnd: nextExit,
          cost: nc,
          reversed: edge.reverse,
          prev: prevMap.get(ck) || null,
        };
        distMap.set(nk, nc);
        prevMap.set(nk, state);
        queue.push(state);
      }
    }
  }

  let bestEnd: PathState | null = null;
  for (const exitEnd of ['head', 'tail'] as const) {
    const st = prevMap.get(key(endWay, exitEnd));
    if (st && (!bestEnd || st.cost < bestEnd.cost)) bestEnd = st;
  }
  if (!bestEnd) return null;

  const pathWays: { wayIdx: number; reversed: boolean }[] = [];
  let st: PathState | null = bestEnd;
  while (st) {
    pathWays.unshift({ wayIdx: st.wayIdx, reversed: st.reversed });
    st = st.prev;
  }
  return pathWays;
}

function stitchWays(ways: OsmWay[], pathWays: { wayIdx: number; reversed: boolean }[]): LngLat[] {
  let line: LngLat[] = [];
  pathWays.forEach(({ wayIdx, reversed }, i) => {
    let pts = reversed ? [...ways[wayIdx].points].reverse() : [...ways[wayIdx].points];
    if (i > 0) pts = pts.slice(1);
    line = line.concat(pts);
  });
  return line;
}

function dedupe(points: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 0.00004) out.push(p);
  }
  return out;
}

/** 与 Z8991 脚本接近的抽稀 */
function simplify(points: LngLat[], minKm = 0.45): LngLat[] {
  points = dedupe(points);
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    if (haversineKm(out[out.length - 1], points[i]) >= minKm) out.push(points[i]);
  }
  const tail = points[points.length - 1];
  if (dist(out[out.length - 1], tail) > 0.0001) out.push(tail);
  return out;
}

function clipLineNearEndpoints(line: LngLat[], from: LngLat, to: LngLat): LngLat[] {
  if (line.length < 2) return line;
  let i0 = 0;
  let i1 = line.length - 1;
  let best0 = Infinity;
  let best1 = Infinity;
  for (let i = 0; i < line.length; i += 1) {
    const d0 = haversineKm(line[i], from);
    const d1 = haversineKm(line[i], to);
    if (d0 < best0) {
      best0 = d0;
      i0 = i;
    }
    if (d1 < best1) {
      best1 = d1;
      i1 = i;
    }
  }
  if (i0 > i1) [i0, i1] = [i1, i0];
  const sliced = line.slice(i0, i1 + 1);
  return sliced.length >= 2 ? sliced : line;
}

function pathOnGraph(
  ways: OsmWay[],
  adj: Array<{ head: AdjEdge[]; tail: AdjEdge[] }>,
  from: LngLat,
  to: LngLat,
  maxSnapKm = MAX_SNAP_KM,
): LngLat[] | null {
  if (haversineKm(from, to) < 0.5) return [from, to];

  const start = nearestOnWays(ways, from);
  const end = nearestOnWays(ways, to);
  if (!start || !end) return null;
  // 车站距钢轨过远则不可信（高铁站广场可达数公里）
  if (start.dKm > maxSnapKm || end.dKm > maxSnapKm) return null;

  if (start.wayIdx === end.wayIdx) {
    const pts = ways[start.wayIdx].points;
    const a = Math.min(start.pointIdx, end.pointIdx);
    const b = Math.max(start.pointIdx, end.pointIdx);
    return clipLineNearEndpoints(pts.slice(a, b + 1), from, to);
  }

  const pathWays = dijkstraPath(ways, adj, start.wayIdx, end.wayIdx);
  if (!pathWays?.length) return null;
  return clipLineNearEndpoints(stitchWays(ways, pathWays), from, to);
}

function cacheKey(stops: LngLat[], trainCode?: string): string {
  const raw = `${trainCode || ''}|${stops.map((s) => `${s.lng.toFixed(3)},${s.lat.toFixed(3)}`).join('|')}`;
  return `rail:v6:${createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

export function isHighspeedTrain(trainCode?: string): boolean {
  return !!trainCode && /^[GDC]/i.test(trainCode);
}

export type RailGeometryResult = {
  coords: [number, number][];
  source: 'osm' | 'mixed' | 'none';
  segmentsOk: number;
  segmentsTotal: number;
};

export type SegmentGeometryResult = {
  coords: LngLat[];
  ok: boolean;
  fromCache: boolean;
  reason?: string;
};

const SEGMENT_CACHE_TTL_SEC = Number(process.env.CACHE_TTL_RAIL_SEG_SEC || 24 * 3600);

/** 路径长度 / 站间距上限；过大视为绕错线 */
const MAX_LENGTH_RATIO = 2.2;
/** 端点到折线最大距离（km） */
const MAX_ENDPOINT_DIST_KM = 8;
/** 折线点相对站间弦的最大横向偏离（km） */
const MAX_LATERAL_DEV_KM = 45;

/**
 * 段级质量门禁：拒绕路 / 端点飞离 / 横向大幅偏航。
 * 不通过则不得标精确、不得写入缓存。
 */
export function acceptSegmentGeometry(
  line: LngLat[],
  from: LngLat,
  to: LngLat,
): { ok: true } | { ok: false; reason: string } {
  if (!line || line.length < 2) return { ok: false, reason: 'empty_line' };
  const chord = haversineKm(from, to);
  if (chord < 0.5) return { ok: true };
  const len = wayLengthKm(line);
  if (len > chord * MAX_LENGTH_RATIO && len - chord > 25) {
    return { ok: false, reason: `detour_ratio:${(len / chord).toFixed(2)}` };
  }
  const dFrom = Math.min(...line.map((p) => haversineKm(p, from)));
  const dTo = Math.min(...line.map((p) => haversineKm(p, to)));
  if (dFrom > MAX_ENDPOINT_DIST_KM || dTo > MAX_ENDPOINT_DIST_KM) {
    return { ok: false, reason: 'endpoint_far' };
  }
  // 弦向量；用叉积近似横向距离（度→km 粗估）
  const dx = to.lng - from.lng;
  const dy = to.lat - from.lat;
  const chordDeg = Math.hypot(dx, dy) || 1e-9;
  let maxLatKm = 0;
  const step = Math.max(1, Math.floor(line.length / 40));
  for (let i = 0; i < line.length; i += step) {
    const p = line[i];
    const cross = (p.lng - from.lng) * dy - (p.lat - from.lat) * dx;
    const latDeg = Math.abs(cross) / chordDeg;
    const midLat = ((from.lat + to.lat) / 2) * (Math.PI / 180);
    const latKm = latDeg * 111 * Math.max(0.5, Math.cos(midLat));
    if (latKm > maxLatKm) maxLatKm = latKm;
  }
  if (maxLatKm > MAX_LATERAL_DEV_KM) {
    return { ok: false, reason: `lateral:${maxLatKm.toFixed(0)}km` };
  }
  return { ok: true };
}

/** 沿站间直线加密采样，避免只查两端导致中间无轨、图不连通 */
function sampleCorridor(from: LngLat, to: LngLat, stepKm = 35): LngLat[] {
  const total = haversineKm(from, to);
  if (total <= stepKm) return [from, to];
  const n = Math.min(14, Math.max(2, Math.ceil(total / stepKm)));
  const pts: LngLat[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    pts.push({
      lng: from.lng + (to.lng - from.lng) * t,
      lat: from.lat + (to.lat - from.lat) * t,
    });
  }
  return pts;
}

function segmentCacheKey(from: LngLat, to: LngLat, preferHs: boolean): string {
  const r = (p: LngLat) => `${p.lng.toFixed(3)},${p.lat.toFixed(3)}`;
  const raw = `${preferHs ? 'hs' : 'all'}|${r(from)}|${r(to)}`;
  return `railseg:v6:${createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

function pathFromWays(ways: OsmWay[], from: LngLat, to: LngLat): LngLat[] | null {
  if (ways.length < 1) return null;
  const adj = buildAdj(ways);
  return pathOnGraph(ways, adj, from, to, MAX_SNAP_KM);
}

/** 本地高铁轨网：不依赖 Overpass，国内环境稳定 */
function tryLocalSegment(from: LngLat, to: LngLat): LngLat[] | null {
  return buildLocalSegment(from, to);
}

async function fetchWaysForSegment(from: LngLat, to: LngLat, preferHs: boolean): Promise<OsmWay[]> {
  const byId = new Map<number, OsmWay>();
  const spanKm = haversineKm(from, to);
  const hs = preferHs ? '["highspeed"="yes"]' : '';
  // 走廊半径：短段紧一点，长段放宽以覆盖弯道偏离直线采样
  const radiusM = spanKm < 80 ? 12000 : spanKm < 200 ? 15000 : 18000;
  const samples = sampleCorridor(from, to, spanKm < 120 ? 30 : 40);
  const fetchTimeout = 18000;

  const merge = (ways: OsmWay[]) => {
    for (const w of ways) byId.set(w.id, w);
  };

  // 1) 沿采样点走廊拉取（核心：覆盖站间中段）
  try {
    const around = aroundChain(samples, radiusM);
    const query = `
[out:json][timeout:15];
(
  way["railway"="rail"]${hs}(${around});
);
out geom;
`.trim();
    merge(await overpass(query, fetchTimeout));
  } catch (e) {
    console.warn('[rail-seg] corridor failed', e);
  }

  // 2) 仍太少时再补 bbox；过长 bbox 易超时
  if (byId.size < 3 && spanKm < 220) {
    try {
      const pad = spanKm < 100 ? 0.12 : 0.18;
      const bbox = bboxOfStops([from, to], pad);
      const { south, west, north, east } = bbox;
      const query = `
[out:json][timeout:15];
(
  way["railway"="rail"]${hs}(${south},${west},${north},${east});
);
out geom;
`.trim();
      merge(await overpass(query, fetchTimeout));
    } catch (e) {
      console.warn('[rail-seg] bbox failed', e);
    }
  }

  console.log(
    `[rail-seg] osm ways=${byId.size} hs=${preferHs} spanKm=${spanKm.toFixed(0)} samples=${samples.length} r=${radiusM}`,
  );
  return [...byId.values()];
}

function toCoordPairs(points: LngLat[]): [number, number][] {
  return simplify(points, 0.45).map((p) => [
    Number(p.lng.toFixed(6)),
    Number(p.lat.toFixed(6)),
  ]);
}

/**
 * 单站间段精确折线：优先本地高铁轨网，失败再 Overpass。
 */
export async function buildSegmentGeometry(
  from: LngLat,
  to: LngLat,
  opts?: { preferHighspeed?: boolean },
): Promise<SegmentGeometryResult> {
  if (
    !Number.isFinite(from.lng) ||
    !Number.isFinite(from.lat) ||
    !Number.isFinite(to.lng) ||
    !Number.isFinite(to.lat)
  ) {
    return { coords: [from, to], ok: false, fromCache: false, reason: 'bad_coords' };
  }
  if (haversineKm(from, to) < 0.5) {
    return { coords: [from, to], ok: true, fromCache: false };
  }

  const preferHs = !!opts?.preferHighspeed;
  const key = segmentCacheKey(from, to, preferHs);
  const cached = cache.get<LngLat[]>(key);
  if (cached && cached.length >= 2) {
    return { coords: cached, ok: true, fromCache: true };
  }

  // 1) 本地轨网仅为高铁仿真；普速车（K/T/Z…）禁止套用，否则银川→中卫会贴银兰经吴忠而跳过青铜峡
  if (preferHs) {
    try {
      const localLine = tryLocalSegment(from, to);
      if (localLine && localLine.length >= 2) {
        const simplified = simplify(localLine, 0.45);
        const gate = acceptSegmentGeometry(simplified, from, to);
        if (gate.ok) {
          cache.set(key, simplified, SEGMENT_CACHE_TTL_SEC);
          console.log(`[rail-seg] ok via local pts=${simplified.length}`);
          return { coords: simplified, ok: true, fromCache: false, reason: 'local' };
        }
        console.warn(`[rail-seg] local rejected ${gate.reason}`);
      }
    } catch (e) {
      console.warn('[rail-seg] local failed', e);
    }
  }

  // 2) Overpass 兜底
  let lastReason = 'no_ways';
  const tryOsm = async (hs: boolean): Promise<LngLat[] | null> => {
    const ways = await fetchWaysForSegment(from, to, hs);
    if (ways.length < 1) {
      lastReason = 'overpass_empty';
      return null;
    }
    const line = pathFromWays(ways, from, to);
    if (!line || line.length < 2) {
      lastReason = 'path_unconnected';
      return null;
    }
    return line;
  };

  let line = preferHs ? await tryOsm(true) : await tryOsm(false);
  if ((!line || line.length < 2) && preferHs) {
    line = await tryOsm(false);
  }

  if (!line || line.length < 2) {
    return { coords: [from, to], ok: false, fromCache: false, reason: lastReason };
  }

  const simplified = simplify(line, 0.45);
  const gate = acceptSegmentGeometry(simplified, from, to);
  if (!gate.ok) {
    console.warn(`[rail-seg] osm rejected ${gate.reason}`);
    return { coords: [from, to], ok: false, fromCache: false, reason: gate.reason };
  }
  cache.set(key, simplified, SEGMENT_CACHE_TTL_SEC);
  console.log(`[rail-seg] ok via osm pts=${simplified.length}`);
  return { coords: simplified, ok: true, fromCache: false, reason: 'osm' };
}

export function formatRailCoords(points: LngLat[]): [number, number][] {
  return toCoordPairs(points);
}

/**
 * 一次拉取走廊轨道图，再按站序寻路拼接——与 Z8991 精品线同思路。
 */
export async function buildRailGeometry(
  stopsIn: LngLat[],
  trainCode?: string,
): Promise<RailGeometryResult> {
  const stops = stopsIn.filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat));
  if (stops.length < 2) {
    return { coords: [], source: 'none', segmentsOk: 0, segmentsTotal: 0 };
  }

  const key = cacheKey(stops, trainCode);
  const cached = cache.get<RailGeometryResult>(key);
  if (cached) return cached;

  const preferHs = isHighspeedTrain(trainCode);
  let ways = await fetchWaysAlongRoute(stops, preferHs);
  if (ways.length < 2) {
    return { coords: [], source: 'none', segmentsOk: 0, segmentsTotal: stops.length - 1 };
  }

  let adj = buildAdj(ways);
  let merged: LngLat[] = [];
  let ok = 0;
  const total = stops.length - 1;

  const runPath = () => {
    merged = [];
    ok = 0;
    for (let i = 0; i < total; i += 1) {
      const seg = pathOnGraph(ways, adj, stops[i], stops[i + 1]);
      if (seg && seg.length >= 2) {
        ok += 1;
        if (merged.length) merged.push(...seg.slice(1));
        else merged.push(...seg);
      } else {
        if (!merged.length) merged.push(stops[i]);
        merged.push(stops[i + 1]);
      }
    }
  };

  runPath();

  // 高铁专用网不连通时，扩大到全部铁路再寻路（更接近精品线完整度）
  if (preferHs && ok < total) {
    const allWays = await fetchWaysAlongRoute(stops, false);
    if (allWays.length > ways.length) {
      ways = allWays;
      adj = buildAdj(ways);
      runPath();
    }
  }

  const simplified = simplify(merged, 0.45);
  const coords: [number, number][] = simplified.map((p) => [
    Number(p.lng.toFixed(6)),
    Number(p.lat.toFixed(6)),
  ]);

  const source: RailGeometryResult['source'] =
    ok === 0 ? 'none' : ok >= Math.ceil(total * 0.7) ? 'osm' : ok > 0 ? 'mixed' : 'none';

  const result: RailGeometryResult = {
    coords: coords.length >= 2 ? coords : [],
    source: coords.length >= 2 ? source : 'none',
    segmentsOk: ok,
    segmentsTotal: total,
  };
  if (result.source !== 'none') cache.set(key, result, CACHE_TTL_SEC);
  return result;
}
