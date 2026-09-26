import { createHash } from 'node:crypto';
import { cache } from './cache.js';
import {
  getSegmentDisk,
  getSegmentMissDisk,
  missTtlSec,
  saveSegmentDisk,
  saveSegmentMissDisk,
} from './segmentCache.js';
import { buildLocalSegment } from './localRails.js';
import * as overpassTracker from './overpassTracker.js';
import { findCorridorSliceForSegment } from './corridors.js';

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

/**
 * F1 [P0] 并发竞速 + 总预算：
 * 旧实现是「镜像串行试探」，首个镜像挂到 25s 才换下一个，一次逻辑查询最坏 3×25s ≈ 75s。
 * 现改为：镜像错峰并发发出，谁先返回非空结果谁赢；整体受单一总预算约束。
 */
/** 单个镜像请求超时（旧 25s → 默认 10s） */
const OVERPASS_SINGLE_TIMEOUT_MS = Number(process.env.RAIL_OVERPASS_SINGLE_MS || 10_000);
/** 一次逻辑查询的总预算（含错峰等待） */
const OVERPASS_TOTAL_BUDGET_MS = Number(process.env.RAIL_OVERPASS_BUDGET_MS || 12_000);
/** 并发竞速时镜像之间的错峰间隔：快的镜像直接赢，就不会惊动后续镜像 */
const OVERPASS_STAGGER_MS = Number(process.env.RAIL_OVERPASS_STAGGER_MS || 1_200);
/** 整趟 way 拉取（bbox + 各 chunk）并发上限 */
const WAY_FETCH_CONCURRENCY = Math.max(1, Number(process.env.RAIL_WAY_FETCH_CONCURRENCY || 3));

/** F4 [P1]：相同 query 的 in-flight 请求合并，避免相邻段/并发重复打公网 */
const inflightOverpass = new Map<string, Promise<OsmWay[]>>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function overpassHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

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

function parseOsmWays(json: unknown): OsmWay[] {
  const elements = (json as { elements?: Array<Record<string, unknown>> } | null)?.elements || [];
  const ways: OsmWay[] = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const tags = (el.tags || {}) as Record<string, string>;
    const geometry = el.geometry as Array<{ lon: number; lat: number }>;
    if (!Number.isFinite(geometry[0]?.lon) || !Number.isFinite(geometry[0]?.lat)) continue;
    ways.push({
      id: Number(el.id),
      highspeed: tags.highspeed === 'yes',
      points: geometry.map((g) => ({ lng: g.lon, lat: g.lat })),
    });
  }
  return ways;
}

/**
 * 镜像并发竞速：错峰发出 → 首个「非空」结果即胜出并中止其余请求；
 * 全部失败/超时/空结果时，按「有空结果则回空数组，否则抛错」收尾（与旧语义一致）。
 */
function raceOverpass(
  query: string,
  mirrors: string[],
  timeoutMs: number,
  budgetMs: number,
): Promise<OsmWay[]> {
  return new Promise<OsmWay[]>((resolve, reject) => {
    let finished = false;
    let settled = 0;
    let sawEmpty = false;
    const notes: string[] = [];
    const controllers = new Set<AbortController>();

    const abortAll = () => {
      for (const c of controllers) {
        try {
          c.abort();
        } catch {
          /* ignore */
        }
      }
      controllers.clear();
    };
    const settle = (fn: () => void) => {
      if (finished) return;
      finished = true;
      abortAll();
      fn();
    };

    // 总预算：到点还没拿到非空结果就直接放弃，不再无意义地等公网
    const budgetTimer = setTimeout(() => {
      settle(() =>
        reject(
          Object.assign(
            new Error(
              `OSM 查询超出总预算 ${budgetMs}ms（${notes.slice(0, 3).join('; ') || '无响应'}）`,
            ),
            { code: 'OVERPASS_BUDGET' },
          ),
        ),
      );
    }, budgetMs);

    const attempt = async (url: string, delayMs: number) => {
      if (delayMs > 0) await sleep(delayMs);
      if (finished) return;
      const ctrl = new AbortController();
      controllers.add(ctrl);
      const singleTimer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'RailVista/0.1 (railway geometry; educational)',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
        const ways = parseOsmWays(await res.json());
        if (ways.length) {
          clearTimeout(budgetTimer);
          settle(() => resolve(ways));
          return;
        }
        // 空结果可能是镜像故障，也可能是这里真的没轨：不抢胜，留给后续镜像
        sawEmpty = true;
        notes.push(`${overpassHost(url)}:empty`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isAbort = /abort/i.test(msg);
        notes.push(`${overpassHost(url)}:${isAbort ? 'timeout' : msg}`);
      } finally {
        clearTimeout(singleTimer);
        controllers.delete(ctrl);
      }
      settled += 1;
      if (!finished && settled >= mirrors.length) {
        clearTimeout(budgetTimer);
        settle(() => {
          if (sawEmpty) resolve([]);
          else
            reject(
              Object.assign(
                new Error(`OSM 查询失败：${notes.slice(0, 3).join('; ') || '未知错误'}`),
                { code: 'OSM_FAIL' },
              ),
            );
        });
      }
    };

    mirrors.forEach((url, i) => {
      // 单镜像（段级）立即发；多镜像错峰，避免瞬时 3 倍公网压力
      const delay = mirrors.length === 1 ? 0 : i * OVERPASS_STAGGER_MS;
      void attempt(url, delay);
    });
  });
}

async function overpass(
  query: string,
  timeoutMs = OVERPASS_SINGLE_TIMEOUT_MS,
  opts?: { maxMirrors?: number; budgetMs?: number },
): Promise<OsmWay[]> {
  const mirrors = OVERPASS_URLS.slice(0, Math.max(1, opts?.maxMirrors ?? OVERPASS_URLS.length));
  const singleMs = Math.max(2_000, Math.min(Number(timeoutMs) || OVERPASS_SINGLE_TIMEOUT_MS, OVERPASS_SINGLE_TIMEOUT_MS));
  const budgetMs = Math.max(singleMs + 500, Number(opts?.budgetMs) || OVERPASS_TOTAL_BUDGET_MS);

  // F4：in-flight 去重（含并发上限镜像数，避免不同 maxMirrors 互相污染）
  const key = createHash('sha1').update(`${mirrors.length}|${query}`).digest('hex').slice(0, 24);
  const running = inflightOverpass.get(key);
  if (running) return running;

  const task = raceOverpass(query, mirrors, singleMs, budgetMs).finally(() => {
    inflightOverpass.delete(key);
  });
  inflightOverpass.set(key, task);
  return task;
}

/** 有界并发执行任务队列（替代旧的「串行 + 每段 sleep 200ms」） */
async function runPool(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  if (!tasks.length) return;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= tasks.length) return;
      try {
        await tasks[idx]();
      } catch {
        /* 单个任务失败已在其内部捕获 */
      }
    }
  });
  await Promise.all(workers);
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

  const merge = (ways: OsmWay[]) => {
    for (const w of ways) byId.set(w.id, w);
  };

  // 分块走廊沿站序拉取（长线主路径）
  const chunks: LngLat[][] = [];
  if (stops.length <= CHUNK_STATIONS) {
    chunks.push(stops);
  } else {
    for (let i = 0; i < stops.length - 1; i += CHUNK_STATIONS - 1) {
      const chunk = stops.slice(i, Math.min(i + CHUNK_STATIONS, stops.length));
      if (chunk.length >= 2) chunks.push(chunk);
    }
  }

  // F1：bbox 与各 chunk 改为有界并发（旧实现串行 + 每段固定 sleep 200ms）
  const tasks: Array<() => Promise<void>> = [];
  // 1) 短程才用整段 bbox；长跨度（如太原→沪）bbox 过大又慢，还会混入无关干线
  if (spanKm < 650) {
    tasks.push(async () => {
      try {
        merge(await overpass(buildBboxQuery(bbox, preferHighspeed)));
      } catch (e) {
        console.warn('[rail] bbox fetch failed', e);
      }
    });
  } else {
    console.log(`[rail] skip bbox spanKm=${spanKm.toFixed(0)} (use corridor chunks)`);
  }
  chunks.forEach((chunk, ci) => {
    tasks.push(async () => {
      try {
        merge(await overpass(buildCorridorQuery(chunk, preferHighspeed)));
      } catch (e) {
        console.warn('[rail] corridor chunk failed', ci, e);
      }
    });
  });

  const t0 = Date.now();
  await runPool(tasks, WAY_FETCH_CONCURRENCY);

  console.log(
    `[rail] ways=${byId.size} hs=${preferHighspeed} stops=${stops.length} spanKm=${spanKm.toFixed(0)} tasks=${tasks.length} ${Date.now() - t0}ms`,
  );
  return [...byId.values()];
}

type EndpointRef = { wayIdx: number; end: 'head' | 'tail'; point: LngLat };

/**
 * 端点邻接：用 CONNECT_TOL 网格分桶替代 O(W²) 全比对（整趟大 bbox 时 W 可达数千）。
 * 语义与旧实现完全一致（同一阈值、同一方向判定），只是候选从「全部 way」缩到 3×3 邻域。
 */
function buildAdj(ways: OsmWay[]): Array<{ head: AdjEdge[]; tail: AdjEdge[] }> {
  const adj = ways.map(() => ({ head: [] as AdjEdge[], tail: [] as AdjEdge[] }));
  if (ways.length < 2) return adj;

  const cellKey = (cx: number, cy: number) => `${cx}:${cy}`;
  const grid = new Map<string, EndpointRef[]>();
  const push = (ref: EndpointRef) => {
    const k = cellKey(Math.floor(ref.point.lng / CONNECT_TOL), Math.floor(ref.point.lat / CONNECT_TOL));
    const bucket = grid.get(k);
    if (bucket) bucket.push(ref);
    else grid.set(k, [ref]);
  };
  for (let i = 0; i < ways.length; i += 1) {
    const pts = ways[i].points;
    if (!pts.length) continue;
    push({ wayIdx: i, end: 'head', point: pts[0] });
    push({ wayIdx: i, end: 'tail', point: pts[pts.length - 1] });
  }

  for (let i = 0; i < ways.length; i += 1) {
    const pts = ways[i].points;
    if (!pts.length) continue;
    const ends: Array<{ end: 'head' | 'tail'; point: LngLat }> = [
      { end: 'head', point: pts[0] },
      { end: 'tail', point: pts[pts.length - 1] },
    ];
    for (const { end, point } of ends) {
      const cx = Math.floor(point.lng / CONNECT_TOL);
      const cy = Math.floor(point.lat / CONNECT_TOL);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const cand of bucket) {
            if (cand.wayIdx === i) continue;
            if (dist(point, cand.point) >= CONNECT_TOL) continue;
            if (end === 'tail' && cand.end === 'head') {
              adj[i].tail.push({ j: cand.wayIdx, enter: 'head', reverse: false });
            } else if (end === 'tail' && cand.end === 'tail') {
              adj[i].tail.push({ j: cand.wayIdx, enter: 'tail', reverse: true });
            } else if (end === 'head' && cand.end === 'tail') {
              adj[i].head.push({ j: cand.wayIdx, enter: 'tail', reverse: false });
            } else if (end === 'head' && cand.end === 'head') {
              adj[i].head.push({ j: cand.wayIdx, enter: 'head', reverse: true });
            }
          }
        }
      }
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
  // v8：G/D/C 不再回退普速 Overpass（保精度 + 加速）
  return `rail:v9:${createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
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
/** 失败段短 TTL，避免同一 OD 反复打 Overpass；过短以免临时网络故障永久挡死 */
const SEGMENT_MISS_TTL_SEC = Number(process.env.CACHE_TTL_RAIL_SEG_MISS_SEC || 20 * 60);

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
  // 用循环求最小值：超长折线时 Math.min(...arr) 有展开开销与栈溢出风险
  let dFrom = Infinity;
  let dTo = Infinity;
  for (const p of line) {
    const d0 = haversineKm(p, from);
    if (d0 < dFrom) dFrom = d0;
    const d1 = haversineKm(p, to);
    if (d1 < dTo) dTo = d1;
  }
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
  const raw = `${preferHs ? 'hs' : 'conv'}|${r(from)}|${r(to)}`;
  // v10：B1/B2/B3 拼线规则调整（中段站放行 + 同走廊兜底 + 几何枢纽），bump 避免脏缓存
  return `railseg:v10:${createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

function pathFromWays(ways: OsmWay[], from: LngLat, to: LngLat): LngLat[] | null {
  if (ways.length < 1) return null;
  const adj = buildAdj(ways);
  return pathOnGraph(ways, adj, from, to, MAX_SNAP_KM);
}

/** Overpass 可选：RAIL_OVERPASS=0 时跳过（弱网/离线）；overpassTracker 降级时也跳过 */
export function isOverpassEnabled(): boolean {
  if (overpassTracker.isLocalOnly()) return false;
  const v = String(process.env.RAIL_OVERPASS ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

/** 本地轨网：G/D/C→HSR 图；K/T/Z→普速图（禁止交叉） */
function tryLocalSegment(from: LngLat, to: LngLat, preferHs: boolean): LngLat[] | null {
  return buildLocalSegment(from, to, { highspeed: preferHs });
}

async function fetchWaysForSegment(from: LngLat, to: LngLat, preferHs: boolean): Promise<OsmWay[]> {
  const byId = new Map<number, OsmWay>();
  const spanKm = haversineKm(from, to);
  const hs = preferHs ? '["highspeed"="yes"]' : '';
  // 走廊半径：短段紧一点，长段放宽以覆盖弯道偏离直线采样
  const radiusM = spanKm < 80 ? 12000 : spanKm < 200 ? 15000 : 18000;
  const samples = sampleCorridor(from, to, spanKm < 120 ? 30 : 40);
  const fetchTimeout = 25_000;
  // 段级只打 1 个镜像，避免 3×18s 拖死整趟 job
  const opOpts = { maxMirrors: 1 };

  const merge = (ways: OsmWay[]) => {
    for (const w of ways) byId.set(w.id, w);
  };

  // 1) 沿采样点走廊拉取（核心：覆盖站间中段）
  try {
    const around = aroundChain(samples, radiusM);
    const query = `
[out:json][timeout:25];
(
  way["railway"="rail"]${hs}(${around});
);
out geom;
`.trim();
    merge(await overpass(query, fetchTimeout, opOpts));
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
[out:json][timeout:25];
(
  way["railway"="rail"]${hs}(${south},${west},${north},${east});
);
out geom;
`.trim();
      merge(await overpass(query, fetchTimeout, opOpts));
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
 * 单站间段精确折线：本地分轨图优先，Overpass 可选兜底。
 * G/D/C → 仅 HSR 本地图；K/T/Z → 仅普速本地图（禁止交叉）。
 */
export async function buildSegmentGeometry(
  from: LngLat,
  to: LngLat,
  opts?: { preferHighspeed?: boolean; /** false：只走本地/磁盘，不打公网（预热用） */ network?: boolean },
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
  const missKey = `${key}:miss`;
  const cached = cache.get<LngLat[]>(key);
  if (cached && cached.length >= 2) {
    return { coords: cached, ok: true, fromCache: true };
  }
  if (cache.get<number>(missKey) === 1) {
    return { coords: [from, to], ok: false, fromCache: true, reason: 'cached_miss' };
  }

  // F2：内存未命中 → 查落盘命中（进程重启后依然有效）
  const diskHit = getSegmentDisk(key);
  if (diskHit && diskHit.length >= 2) {
    cache.set(key, diskHit, SEGMENT_CACHE_TTL_SEC);
    return { coords: diskHit, ok: true, fromCache: true };
  }
  const diskMiss = getSegmentMissDisk(key);
  if (diskMiss) {
    cache.set(missKey, 1, Math.max(5, missTtlSec(diskMiss)));
    return { coords: [from, to], ok: false, fromCache: true, reason: 'cached_miss' };
  }

  // 1) 本地轨网（分轨）
  try {
    const localLine = tryLocalSegment(from, to, preferHs);
    if (localLine && localLine.length >= 2) {
      const simplified = simplify(localLine, 0.45);
      const gate = acceptSegmentGeometry(simplified, from, to);
      if (gate.ok) {
        cache.set(key, simplified, SEGMENT_CACHE_TTL_SEC);
        saveSegmentDisk(key, simplified, SEGMENT_CACHE_TTL_SEC);
        console.log(`[rail-seg] ok via local-${preferHs ? 'hsr' : 'rail'} pts=${simplified.length}`);
        return { coords: simplified, ok: true, fromCache: false, reason: 'local' };
      }
      console.warn(`[rail-seg] local rejected ${gate.reason}`);
    }
  } catch (e) {
    console.warn('[rail-seg] local failed', e);
  }

  // 1b) S7 走廊切片兜底：本地分轨图失败后、公网前——两端同走廊时从走廊折线切片
  try {
    const slice = findCorridorSliceForSegment(from, to);
    if (slice?.coords && slice.coords.length >= 2) {
      const simplifiedSlice = simplify(
        slice.coords.map(([lng, lat]) => ({ lng, lat })),
        0.45,
      );
      const sliceGate = acceptSegmentGeometry(simplifiedSlice, from, to);
      if (sliceGate.ok) {
        cache.set(key, simplifiedSlice, SEGMENT_CACHE_TTL_SEC);
        saveSegmentDisk(key, simplifiedSlice, SEGMENT_CACHE_TTL_SEC);
        console.log(
          `[rail-seg] ok via corridor-slice:${slice.corridorId} pts=${simplifiedSlice.length}`,
        );
        return { coords: simplifiedSlice, ok: true, fromCache: false, reason: 'corridor-slice' };
      }
      console.warn(`[rail-seg] corridor-slice rejected ${sliceGate.reason}`);
    }
  } catch (e) {
    console.warn('[rail-seg] corridor-slice failed', e);
  }

  // 2) Overpass 可选兜底
  if (opts?.network === false) {
    // 预热模式：只填本地/走廊结果，不打公网，也不写负缓存（避免挡住真实请求）
    return { coords: [from, to], ok: false, fromCache: false, reason: 'local_only_prewarm' };
  }
  if (!isOverpassEnabled()) {
    cache.set(missKey, 1, SEGMENT_MISS_TTL_SEC);
    saveSegmentMissDisk(key, 'overpass_disabled', SEGMENT_MISS_TTL_SEC);
    return { coords: [from, to], ok: false, fromCache: false, reason: 'overpass_disabled' };
  }

  let lastReason = 'no_ways';
  const tryOsm = async (hs: boolean): Promise<LngLat[] | null> => {
    const ways = await fetchWaysForSegment(from, to, hs);
    if (ways.length < 1) {
      lastReason = 'overpass_empty';
      overpassTracker.recordFail();
      return null;
    }
    const line = pathFromWays(ways, from, to);
    if (!line || line.length < 2) {
      lastReason = 'path_unconnected';
      overpassTracker.recordFail();
      return null;
    }
    return line;
  };

  // G/D/C：只打 HS Overpass，禁止退回普速轨（精度 + 少一次公网往返）
  // K/T/Z：只打普速 Overpass
  const line = preferHs ? await tryOsm(true) : await tryOsm(false);

  if (!line || line.length < 2) {
    cache.set(missKey, 1, SEGMENT_MISS_TTL_SEC);
    saveSegmentMissDisk(key, lastReason, missTtlSec(lastReason));
    return { coords: [from, to], ok: false, fromCache: false, reason: lastReason };
  }

  const simplified = simplify(line, 0.45);
  const gate = acceptSegmentGeometry(simplified, from, to);
  if (!gate.ok) {
    console.warn(`[rail-seg] osm rejected ${gate.reason}`);
    cache.set(missKey, 1, SEGMENT_MISS_TTL_SEC);
    saveSegmentMissDisk(key, gate.reason, missTtlSec(gate.reason));
    overpassTracker.recordFail();
    return { coords: [from, to], ok: false, fromCache: false, reason: gate.reason };
  }
  cache.set(key, simplified, SEGMENT_CACHE_TTL_SEC);
  saveSegmentDisk(key, simplified, SEGMENT_CACHE_TTL_SEC);
  overpassTracker.recordSuccess();
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
  if (!isOverpassEnabled()) {
    return { coords: [], source: 'none', segmentsOk: 0, segmentsTotal: stops.length - 1 };
  }
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

  // 高铁专用网不连通时：不再扩大到普速 Overpass（避免贴错线，也省一次整趟拉取）
  // 缺口由站间示意 / 精品走廊兜底，精度优先于「凑完整度」

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
