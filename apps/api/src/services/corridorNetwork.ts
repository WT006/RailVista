/**
 * 精品走廊统一路网：多条走廊在共享枢纽处连通，OD 最短路后截取拼线。
 * 单走廊命中失败时使用，支持 2+ 段跨线精品展示。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRailwayMetrics,
  haversineKm,
  pointAtProgress,
  projectToRailway,
  slicePolylineByOd,
} from '@railvista/shared';
import {
  type CorridorPreset,
  type CorridorStop,
  loadCorridors,
  corridorFitsStops,
  isHsrCorridor,
  isConventionalCorridor,
} from './corridors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stationsGeoPath = join(__dirname, '../../../../data/stations-geo.json');

let stationsGeoCache: Record<string, { lng?: number; lat?: number }> | null = null;
let stationsGeoMtime = 0;

function loadStationsGeo(): Record<string, { lng?: number; lat?: number }> {
  if (!existsSync(stationsGeoPath)) return {};
  try {
    const m = statSync(stationsGeoPath).mtimeMs;
    if (stationsGeoCache && m <= stationsGeoMtime) return stationsGeoCache;
    stationsGeoCache = JSON.parse(readFileSync(stationsGeoPath, 'utf8')) as Record<
      string,
      { lng?: number; lat?: number }
    >;
    stationsGeoMtime = m;
    return stationsGeoCache;
  } catch {
    return stationsGeoCache || {};
  }
}

export type NetworkMatch = {
  coords: [number, number][];
  corridorIds: string[];
  corridorNames: string[];
  transferHubs: string[];
  /** 路网路径走廊跳数（含起终走廊） */
  hops: number;
  score: number;
};

type HubLink = {
  toId: string;
  hub: string;
  /** 估计换乘代价（km），同站名视为 0 */
  transferKm: number;
  /** 几何接驳（__geo_）枢纽的最近点对：本走廊点 → 对面走廊点（B3） */
  geoPt?: [number, number];
  geoPtTo?: [number, number];
};

type CorridorGraph = {
  /** corridorId → 邻接（共享枢纽） */
  adj: Map<string, HubLink[]>;
  byId: Map<string, CorridorPreset>;
  fp: string;
};

const MAX_HOPS = 8;
const START_NEAR_KM = 40;
/** 经停桥接最大跨距（合肥南→蚌埠南约 125km）；过大则易乱跳 */
const BRIDGE_MAX_KM = 280;
/** B3 几何枢纽：bbox 粗筛的膨胀角（约 5km） */
const B3_BBOX_PAD_DEG = 0.05;
/**
 * 拼线相对经停示意折线的最大偏离（km）。
 * 合福/京沪正线通常 <90；绕沪昆经上海可达 300+。
 */
const MAX_SCHEMATIC_DEV_KM = 140;

function normalize(name: string): string {
  return name.replace(/站$/g, '').trim();
}

function isSyntheticHub(hub: string): boolean {
  return hub.startsWith('__geo_') || hub.startsWith('__bridge:');
}

function parseBridgeHub(hub: string): { fromName: string; toName: string } | null {
  if (!hub.startsWith('__bridge:')) return null;
  const body = hub.slice('__bridge:'.length);
  const [fromName, toName] = body.split('|');
  if (!fromName || !toName) return null;
  return { fromName, toName };
}

function hintKeys(c: CorridorPreset): string[] {
  return [...new Set((c.stationsHint || []).map(normalize).filter(Boolean))];
}

function onHintsExact(name: string, hints: string[]): boolean {
  const n = normalize(name);
  return hints.some((h) => normalize(h) === n);
}

function nearCorridor(c: CorridorPreset, stop: CorridorStop, maxKm: number): boolean {
  if (stop.lng == null || stop.lat == null) return false;
  const { path, lengthKm } = buildRailwayMetrics(c.railway);
  if (lengthKm <= 0) return false;
  return projectToRailway(path, lengthKm, stop.lng, stop.lat).distKm <= maxKm;
}

/** 站是否可作为该走廊的入口/出口（名命中或贴线） */
function stopTouchesCorridor(c: CorridorPreset, stop: CorridorStop): boolean {
  const hints = hintKeys(c);
  if (onHintsExact(stop.name, hints)) return true;
  const n = normalize(stop.name);
  const stem = n.replace(/[东西南北]$/u, '');
  for (const h of hints) {
    if (h === n) return true;
    const hs = h.replace(/[东西南北]$/u, '');
    if (stem.length >= 2 && hs === stem && h !== n) return false;
  }
  return nearCorridor(c, stop, START_NEAR_KM);
}

/** B2 用：忽略方位冲突的纯几何贴线判断（OD 已被单走廊拒收，这里只关心可达性） */
function touchesCorridorGeo(c: CorridorPreset, stop: CorridorStop): boolean {
  if (onHintsExact(stop.name, hintKeys(c))) return true;
  return nearCorridor(c, stop, START_NEAR_KM);
}

function sharedHubs(a: CorridorPreset, b: CorridorPreset): string[] {
  const sa = new Set(hintKeys(a));
  const out: string[] = [];
  for (const h of hintKeys(b)) {
    if (sa.has(h)) out.push(h);
  }
  return out;
}

function polylineBBox(railway: [number, number][]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of railway) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function boxesOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
  padDeg: number,
): boolean {
  return (
    a.minX - padDeg <= b.maxX &&
    b.minX - padDeg <= a.maxX &&
    a.minY - padDeg <= b.maxY &&
    b.minY - padDeg <= a.maxY
  );
}

/** 等距圆柱近似平方距离（km²），仅用于 B3 采样粗筛 */
function approxDistSq(a: [number, number], b: [number, number]): number {
  const dx = (a[0] - b[0]) * 111.32 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 110.57;
  return dx * dx + dy * dy;
}

/** 两条折线的最近点对（采样近似 + 邻域细化）；精确 haversine 判定 ≤maxKm 才返回 */
function nearestPointsBetween(
  a: [number, number][],
  b: [number, number][],
  maxKm: number,
): { dKm: number; pa: [number, number]; pb: [number, number] } | null {
  if (a.length < 2 || b.length < 2) return null;
  let best = { dSq: Infinity, ai: -1, bi: -1 };
  const step = Math.max(1, Math.floor(Math.max(a.length, b.length) / 120));
  for (let i = 0; i < a.length; i += step) {
    for (let j = 0; j < b.length; j += step) {
      const dSq = approxDistSq(a[i], b[j]);
      if (dSq < best.dSq) best = { dSq, ai: i, bi: j };
    }
  }
  if (best.ai < 0) return null;
  const span = step;
  for (let i = Math.max(0, best.ai - span); i <= Math.min(a.length - 1, best.ai + span); i++) {
    for (let j = Math.max(0, best.bi - span); j <= Math.min(b.length - 1, best.bi + span); j++) {
      const dSq = approxDistSq(a[i], b[j]);
      if (dSq < best.dSq) best = { dSq, ai: i, bi: j };
    }
  }
  const pa = a[best.ai];
  const pb = b[best.bi];
  const dKm = haversineKm({ lng: pa[0], lat: pa[1] }, { lng: pb[0], lat: pb[1] });
  if (dKm > maxKm) return null;
  return { dKm, pa, pb };
}

function hubPointOnCorridor(
  c: CorridorPreset,
  hub: string,
): { lng: number; lat: number } | null {
  if (c.railway.length < 2) return null;
  const { path, lengthKm } = buildRailwayMetrics(c.railway);
  if (lengthKm <= 0) return null;

  // 优先用 stations-geo 真实坐标投影到走廊，避免站序等分插值把枢纽插飞
  const geo = loadStationsGeo()[normalize(hub)];
  if (geo?.lng != null && geo?.lat != null) {
    const proj = projectToRailway(path, lengthKm, Number(geo.lng), Number(geo.lat));
    if (proj.distKm <= 45) {
      return { lng: proj.point.lng, lat: proj.point.lat };
    }
  }

  const hints = hintKeys(c);
  const idx = hints.indexOf(normalize(hub));
  if (idx < 0) return null;
  const frac = hints.length <= 1 ? 0 : idx / (hints.length - 1);
  const pt = pointAtProgress(path, lengthKm, frac);
  return { lng: pt.lng, lat: pt.lat };
}

function corridorLengthKm(c: CorridorPreset): number {
  const { lengthKm } = buildRailwayMetrics(c.railway);
  return lengthKm;
}

let graphCacheHsr: CorridorGraph | null = null;
let graphCacheConv: CorridorGraph | null = null;
let graphCacheAll: CorridorGraph | null = null;

export function clearCorridorNetworkCache(): void {
  graphCacheHsr = null;
  graphCacheConv = null;
  graphCacheAll = null;
}

function buildGraph(corridors: CorridorPreset[]): CorridorGraph {
  const byId = new Map(corridors.map((c) => [c.id, c]));
  const adj = new Map<string, HubLink[]>();
  for (const c of corridors) adj.set(c.id, []);

  for (let i = 0; i < corridors.length; i++) {
    for (let j = i + 1; j < corridors.length; j++) {
      const a = corridors[i];
      const b = corridors[j];
      const hubs = sharedHubs(a, b);
      if (!hubs.length) continue;
      const hub =
        hubs.find(
          (h) =>
            h === hintKeys(a)[0] ||
            h === hintKeys(a).at(-1) ||
            h === hintKeys(b)[0] ||
            h === hintKeys(b).at(-1),
        ) || hubs[0];
      adj.get(a.id)!.push({ toId: b.id, hub, transferKm: 0 });
      adj.get(b.id)!.push({ toId: a.id, hub, transferKm: 0 });
    }
  }

  for (let i = 0; i < corridors.length; i++) {
    for (let j = i + 1; j < corridors.length; j++) {
      const a = corridors[i];
      const b = corridors[j];
      if (sharedHubs(a, b).length) continue;
      const endsA = [a.railway[0], a.railway.at(-1)!];
      const endsB = [b.railway[0], b.railway.at(-1)!];
      let best = { d: Infinity, hub: '' };
      for (const pa of endsA) {
        for (const pb of endsB) {
          const d = haversineKm(
            { lng: pa[0], lat: pa[1] },
            { lng: pb[0], lat: pb[1] },
          );
          if (d < best.d) best = { d, hub: `__geo_${a.id}_${b.id}` };
        }
      }
      if (best.d <= 12) {
        adj.get(a.id)!.push({ toId: b.id, hub: best.hub, transferKm: best.d });
        adj.get(b.id)!.push({ toId: a.id, hub: best.hub, transferKm: best.d });
      }
    }
  }

  // B3：几何枢纽自动发现——无共享 hint 的走廊对，折线最近点对 ≤3km 自动建边。
  // 即使 hints 未补全，京广∩沪昆(株洲)、河茂∩黎湛(河唇)也能自动连通。
  // 粗筛（bbox）+ 采样近似 + 邻域细化，避免 O(n²) 全量 haversine。
  const boxes = corridors.map((c) => polylineBBox(c.railway));
  for (let i = 0; i < corridors.length; i++) {
    for (let j = i + 1; j < corridors.length; j++) {
      const a = corridors[i];
      const b = corridors[j];
      if (adj.get(a.id)!.some((l) => l.toId === b.id)) continue;
      if (!boxesOverlap(boxes[i], boxes[j], B3_BBOX_PAD_DEG)) continue;
      const near = nearestPointsBetween(a.railway, b.railway, 3);
      if (!near) continue;
      const hub = `__geo_${a.id}_${b.id}`;
      adj.get(a.id)!.push({
        toId: b.id,
        hub,
        transferKm: near.dKm,
        geoPt: near.pa,
        geoPtTo: near.pb,
      });
      adj.get(b.id)!.push({
        toId: a.id,
        hub,
        transferKm: near.dKm,
        geoPt: near.pb,
        geoPtTo: near.pa,
      });
    }
  }

  return {
    adj,
    byId,
    fp: corridors.map((c) => c.id).join(','),
  };
}

type GraphKind = 'hsr' | 'conventional' | 'all';

function getGraph(kind: GraphKind = 'all'): CorridorGraph {
  const all = loadCorridors();
  const corridors =
    kind === 'hsr'
      ? all.filter(isHsrCorridor)
      : kind === 'conventional'
        ? all.filter(isConventionalCorridor)
        : all;
  const fingerprint = `${kind}:${corridors.map((c) => c.id).join(',')}`;
  const cached =
    kind === 'hsr' ? graphCacheHsr : kind === 'conventional' ? graphCacheConv : graphCacheAll;
  if (cached && cached.fp === fingerprint) return cached;
  const g = buildGraph(corridors);
  g.fp = fingerprint;
  if (kind === 'hsr') graphCacheHsr = g;
  else if (kind === 'conventional') graphCacheConv = g;
  else graphCacheAll = g;
  return g;
}

type PathNode = {
  id: string;
  ids: string[];
  hubs: Array<string | null>;
  /** 与 hubs 对齐：__geo_ 枢纽的最近点对（B3），其余为 null */
  geoTrail: Array<{ pa: [number, number]; pb: [number, number] } | null>;
  hops: number;
  costKm: number;
  tip: { lng: number; lat: number } | null;
};

type ExpandLink = {
  toId: string;
  hub: string;
  transferKm: number;
  /** 经停桥接：下一段入口投影点 */
  entryTip?: { lng: number; lat: number } | null;
  /** B3 几何接驳：最近点对（本走廊 → 对面走廊） */
  geoPt?: [number, number];
  geoPtTo?: [number, number];
};

/** 走廊覆盖的经停下标（名命中或贴线） */
function stopIndicesOnCorridor(c: CorridorPreset, stops: CorridorStop[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < stops.length; i++) {
    if (stopTouchesCorridor(c, stops[i])) out.push(i);
  }
  return out;
}

/**
 * 枢纽换乘是否对后续经停有用：后续站更贴下一段走廊，而非仍走当前走廊。
 * 避免「经停含上饶」就把合福误换成沪昆（后续黄山北/合肥南仍在合福上）。
 */
function hubServesLaterStops(
  hubKey: string,
  curC: CorridorPreset,
  nextC: CorridorPreset,
  stops: CorridorStop[],
): boolean {
  const hubIdx = stops.findIndex((s) => normalize(s.name) === hubKey);
  if (hubIdx < 0) return false;
  const later = stops.slice(hubIdx + 1);
  if (!later.length) return true;
  let nextHits = 0;
  let curHits = 0;
  for (const s of later) {
    if (stopTouchesCorridor(nextC, s)) nextHits += 1;
    if (stopTouchesCorridor(curC, s)) curHits += 1;
  }
  return nextHits > 0 && nextHits >= curHits;
}

/**
 * 当前走廊已覆盖的最远经停 → 后续站所在走廊的桥接边。
 * 补全合福↔京沪这类「无共享 hint、端点又不够近」的缺口，避免被迫绕沪昆。
 */
function stopBridgeLinks(
  curId: string,
  usedIds: string[],
  stops: CorridorStop[],
  byId: Map<string, CorridorPreset>,
): ExpandLink[] {
  const curC = byId.get(curId);
  if (!curC) return [];
  const onCur = stopIndicesOnCorridor(curC, stops);
  if (!onCur.length) return [];
  const lastIdx = onCur[onCur.length - 1];
  if (lastIdx >= stops.length - 1) return [];
  const fromStop = stops[lastIdx];
  const fromPt =
    fromStop.lng != null && fromStop.lat != null
      ? { lng: Number(fromStop.lng), lat: Number(fromStop.lat) }
      : hubPointOnCorridor(curC, normalize(fromStop.name));
  if (!fromPt) return [];

  const out: ExpandLink[] = [];
  const seen = new Set<string>();
  for (let j = lastIdx + 1; j < stops.length; j++) {
    const toStop = stops[j];
    for (const c of byId.values()) {
      if (usedIds.includes(c.id) || seen.has(c.id)) continue;
      if (!stopTouchesCorridor(c, toStop)) continue;
      const toPt =
        toStop.lng != null && toStop.lat != null
          ? { lng: Number(toStop.lng), lat: Number(toStop.lat) }
          : hubPointOnCorridor(c, normalize(toStop.name));
      if (!toPt) continue;
      const d = haversineKm(fromPt, toPt);
      if (d > BRIDGE_MAX_KM) continue;
      // 禁止跨过「既不在当前廊、也不在目标廊」的中间经停——否则会 上海虹桥→宁波 跳过沪杭，画出站间直线
      let skipsOrphan = false;
      for (let k = lastIdx + 1; k < j; k++) {
        const mid = stops[k];
        if (stopTouchesCorridor(curC, mid) || stopTouchesCorridor(c, mid)) continue;
        skipsOrphan = true;
        break;
      }
      if (skipsOrphan) continue;
      seen.add(c.id);
      out.push({
        toId: c.id,
        hub: `__bridge:${normalize(fromStop.name)}|${normalize(toStop.name)}`,
        transferKm: d,
        entryTip: toPt,
      });
    }
  }
  return out;
}

/** 进入走廊能新覆盖多少「尚未被路径覆盖」的经停；0 则重罚（沪昆对厦门北→北京南无增量） */
function noveltyPenaltyKm(
  nextId: string,
  usedIds: string[],
  stops: CorridorStop[],
  byId: Map<string, CorridorPreset>,
  endIds: Set<string>,
): number {
  const covered = new Set<number>();
  for (const id of usedIds) {
    const c = byId.get(id);
    if (!c) continue;
    for (const i of stopIndicesOnCorridor(c, stops)) covered.add(i);
  }
  const nextC = byId.get(nextId);
  if (!nextC) return 900;
  let fresh = 0;
  for (let i = 0; i < stops.length; i++) {
    if (covered.has(i)) continue;
    if (stopTouchesCorridor(nextC, stops[i])) fresh += 1;
  }
  // 只加罚不加负分：负代价会破坏 bestCost 剪枝（绕路先到某走廊会压过直达起点）
  if (fresh > 0) return 0;
  if (endIds.has(nextId)) return 120;
  return 850;
}

/** 起点走廊：仅蹭到始发站、盖不住后续经停的，加重罚（太原南不要先套郑太再进大西） */
function startCorridorPenaltyKm(id: string, stops: CorridorStop[], byId: Map<string, CorridorPreset>): number {
  const c = byId.get(id);
  if (!c) return 500;
  const idx = stopIndicesOnCorridor(c, stops);
  if (!idx.length) return 500;
  const coversBeyondOrigin = idx.some((i) => i > 0);
  if (coversBeyondOrigin) return 0;
  // 只覆盖终点走廊的对称情况少见；仅覆盖下标 0 时视为弱起点
  return idx.length === 1 && idx[0] === 0 ? 220 : 0;
}

/**
 * 最短多段路径：地理折线 + 经停有用枢纽优先 + 经停桥接 + 覆盖增量
 *（避免济南→杭州绕上海、厦门北→北京南绕沪昆）。
 */
function findCorridorPath(
  startIds: string[],
  endIds: Set<string>,
  stops: CorridorStop[],
  kind: GraphKind = 'all',
): {
  ids: string[];
  hubs: Array<string | null>;
  geoTrail: Array<{ pa: [number, number]; pb: [number, number] } | null>;
} | null {
  const g = getGraph(kind);
  const first = stops[0];
  const last = stops[stops.length - 1];
  const startTip =
    first.lng != null && first.lat != null
      ? { lng: Number(first.lng), lat: Number(first.lat) }
      : null;
  const endTip =
    last.lng != null && last.lat != null
      ? { lng: Number(last.lng), lat: Number(last.lat) }
      : null;
  const stopHubs = new Set(stops.map((s) => normalize(s.name)).filter(Boolean));

  const bestCost = new Map<string, number>();
  const pq: PathNode[] = [];
  const goals: PathNode[] = [];

  for (const id of startIds) {
    if (!g.byId.get(id)) continue;
    const cost0 =
      noveltyPenaltyKm(id, [], stops, g.byId, endIds) +
      startCorridorPenaltyKm(id, stops, g.byId);
    bestCost.set(id, cost0);
    pq.push({
      id,
      ids: [id],
      hubs: [null],
      geoTrail: [null],
      hops: 1,
      costKm: cost0,
      tip: startTip,
    });
  }

  while (pq.length) {
    pq.sort((a, b) => a.costKm - b.costKm);
    const cur = pq.shift()!;
    if ((bestCost.get(cur.id) ?? Infinity) < cur.costKm - 1e-6) continue;

    if (endIds.has(cur.id) && cur.hops >= 2) {
      let finish = cur.costKm;
      if (cur.tip && endTip) finish += haversineKm(cur.tip, endTip);
      goals.push({ ...cur, costKm: finish });
    }
    if (cur.hops >= MAX_HOPS) continue;

    const curC = g.byId.get(cur.id)!;
    const adjLinks: ExpandLink[] = (g.adj.get(cur.id) || []).map((l) => ({
      toId: l.toId,
      hub: l.hub,
      transferKm: l.transferKm,
      geoPt: l.geoPt,
      geoPtTo: l.geoPtTo,
    }));
    const bridges = stopBridgeLinks(cur.id, cur.ids, stops, g.byId);
    // 桥接优先于同名图边重复目标时的劣质绕行，一并扩展
    const expandLinks = [...adjLinks, ...bridges];

    for (const link of expandLinks) {
      if (!g.byId.get(link.toId)) continue;
      if (cur.ids.includes(link.toId)) continue;

      const bridge = parseBridgeHub(link.hub);
      const hubKey =
        bridge || link.hub.startsWith('__geo_') ? '' : normalize(link.hub);
      const nextC = g.byId.get(link.toId)!;
      const hubPreferred =
        Boolean(hubKey && stopHubs.has(hubKey)) &&
        hubServesLaterStops(hubKey, curC, nextC, stops);

      let hubPt: { lng: number; lat: number } | null = null;
      if (bridge && link.entryTip) {
        hubPt = link.entryTip;
      } else if (hubKey) {
        hubPt =
          hubPointOnCorridor(curC, hubKey) || hubPointOnCorridor(nextC, hubKey);
      } else if (link.hub.startsWith('__geo_')) {
        // B3：优先用建边时记录的最近点对；端点建边退回端点最近对
        if (link.geoPt && link.geoPtTo) {
          hubPt = { lng: link.geoPt[0], lat: link.geoPt[1] };
        } else {
          let bestPair = { d: Infinity, pt: curC.railway.at(-1)! };
          for (const pa of [curC.railway[0], curC.railway.at(-1)!]) {
            for (const pb of [nextC.railway[0], nextC.railway.at(-1)!]) {
              const d = haversineKm(
                { lng: pa[0], lat: pa[1] },
                { lng: pb[0], lat: pb[1] },
              );
              if (d < bestPair.d) bestPair = { d, pt: pa };
            }
          }
          hubPt = { lng: bestPair.pt[0], lat: bestPair.pt[1] };
        }
      }

      const geoStep =
        cur.tip && hubPt ? haversineKm(cur.tip, hubPt) : corridorLengthKm(curC) * 0.3;

      let transferPenalty: number;
      if (bridge) {
        transferPenalty = 15 + link.transferKm;
      } else if (link.hub.startsWith('__geo_')) {
        transferPenalty = 25 + link.transferKm;
      } else if (hubPreferred) {
        transferPenalty = 0;
      } else {
        transferPenalty = 280;
      }

      const novelty = noveltyPenaltyKm(link.toId, cur.ids, stops, g.byId, endIds);
      const nextCost = cur.costKm + geoStep + transferPenalty + novelty;
      const prev = bestCost.get(link.toId);
      if (prev != null && prev <= nextCost && !endIds.has(link.toId)) continue;

      bestCost.set(link.toId, Math.min(prev ?? Infinity, nextCost));
      pq.push({
        id: link.toId,
        ids: [...cur.ids, link.toId],
        hubs: [...cur.hubs, link.hub],
        geoTrail: [
          ...cur.geoTrail,
          link.geoPt && link.geoPtTo ? { pa: link.geoPt, pb: link.geoPtTo } : null,
        ],
        hops: cur.hops + 1,
        costKm: nextCost,
        tip: hubPt,
      });
    }
  }

  if (!goals.length) return null;
  goals.sort((a, b) => a.costKm - b.costKm || a.hops - b.hops);
  return { ids: goals[0].ids, hubs: goals[0].hubs, geoTrail: goals[0].geoTrail };
}

function resolveStopPoint(
  stop: CorridorStop,
  corridor: CorridorPreset,
): { lng: number; lat: number } | null {
  if (stop.lng != null && stop.lat != null && Number.isFinite(stop.lng) && Number.isFinite(stop.lat)) {
    return { lng: Number(stop.lng), lat: Number(stop.lat) };
  }
  const hints = hintKeys(corridor);
  if (onHintsExact(stop.name, hints)) {
    return hubPointOnCorridor(corridor, normalize(stop.name));
  }
  return null;
}

function sliceBetween(
  corridor: CorridorPreset,
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
): [number, number][] | null {
  const sliced = slicePolylineByOd(corridor.railway, from, to);
  if (!sliced || sliced.length < 2) return null;
  return sliced;
}

function appendUnique(out: [number, number][], segment: [number, number][]): void {
  for (let i = 0; i < segment.length; i++) {
    const p = segment[i];
    if (!out.length) {
      out.push(p);
      continue;
    }
    const last = out[out.length - 1];
    if (Math.hypot(last[0] - p[0], last[1] - p[1]) < 1e-5) continue;
    out.push(p);
  }
}

/** 拼线相对经停示意折线的最大偏离，用于拒绝沪昆三角绕行等大弯 */
function maxDeviationFromStopSchematic(
  coords: [number, number][],
  stops: CorridorStop[],
): number {
  const schem = stops
    .filter((s) => s.lng != null && s.lat != null)
    .map((s) => [Number(s.lng), Number(s.lat)] as [number, number]);
  if (schem.length < 2 || coords.length < 2) return Infinity;
  const { path, lengthKm } = buildRailwayMetrics(schem);
  if (lengthKm <= 0) return Infinity;
  let maxD = 0;
  const step = Math.max(1, Math.floor(coords.length / 100));
  for (let i = 0; i < coords.length; i += step) {
    const d = projectToRailway(path, lengthKm, coords[i][0], coords[i][1]).distKm;
    if (d > maxD) maxD = d;
  }
  // 始终检查终点
  const last = coords[coords.length - 1];
  maxD = Math.max(
    maxD,
    projectToRailway(path, lengthKm, last[0], last[1]).distKm,
  );
  return maxD;
}

/** 相邻点最大跳跃（km）；桥接换乘允许到 BRIDGE_MAX_KM，方向拼错会出现 800km+ */
function maxAdjacentJumpKm(coords: [number, number][]): number {
  let maxD = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineKm(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
    if (d > maxD) maxD = d;
  }
  return maxD;
}

/** 拼线结果统一守卫：OD 贴近、经停贴合、单调进度、无巨跳、无大绕行 */
function validateNetworkCoords(
  coords: [number, number][],
  stops: CorridorStop[],
  first: CorridorStop,
  last: CorridorStop,
): boolean {
  if (coords.length < 4) return false;

  // 起终点必须贴近行程 OD（方向拼反时常见起点落在换乘枢纽）
  if (first.lng != null && first.lat != null) {
    const d0 = haversineKm(
      { lng: coords[0][0], lat: coords[0][1] },
      { lng: Number(first.lng), lat: Number(first.lat) },
    );
    if (d0 > 45) return false;
  }
  if (last.lng != null && last.lat != null) {
    const d1 = haversineKm(
      { lng: coords[coords.length - 1][0], lat: coords[coords.length - 1][1] },
      { lng: Number(last.lng), lat: Number(last.lat) },
    );
    if (d1 > 45) return false;
  }

  if (!corridorFitsStops(coords, stops, 45)) return false;
  if (maxAdjacentJumpKm(coords) > BRIDGE_MAX_KM) return false;
  if (!stopsProgressMostlyMonotonic(coords, stops)) return false;

  const withCoord = stops.filter((s) => s.lng != null && s.lat != null);
  const stationKm = withCoord.reduce((sum, s, i) => {
    if (i === 0) return 0;
    const prev = withCoord[i - 1];
    return (
      sum +
      haversineKm(
        { lng: Number(prev.lng), lat: Number(prev.lat) },
        { lng: Number(s.lng), lat: Number(s.lat) },
      )
    );
  }, 0);
  const { lengthKm: railKm } = buildRailwayMetrics(coords);
  // 示意里程比不可靠（走廊折线本身弯曲大）；用相对经停折线的最大偏离拦绕行
  if (maxDeviationFromStopSchematic(coords, withCoord) > MAX_SCHEMATIC_DEV_KM) return false;
  if (stationKm > 80 && railKm < stationKm * 0.4) return false;
  // 方向/折返错误时折线里程会远超站间弦长之和
  if (stationKm > 80 && railKm > stationKm * 2.2) return false;
  return true;
}

/**
 * B2：起终同走廊兜底。走到这里说明单走廊匹配已失败（matchCorridor/slice 均未成），
 * 原逻辑直接 return null 会与单走廊逻辑形成「让位死锁」（珠海北/吐鲁番北/杭州南类）。
 * 现改为：把该走廊作为唯一链路，OD 站直接投影切片（等效把 OD 投到走廊再 slice）。
 */
function matchSameCorridorDirect(
  sharedIds: string[],
  g: CorridorGraph,
  stops: CorridorStop[],
  first: CorridorStop,
  last: CorridorStop,
): NetworkMatch | null {
  let best: { c: CorridorPreset; coords: [number, number][]; d: number } | null = null;
  for (const id of sharedIds) {
    const c = g.byId.get(id);
    if (!c) continue;
    let from0 = resolveStopPoint(first, c);
    if (!from0) {
      // OD 站贴线兜底：投影点作为切入点（贴线 ≤ START_NEAR_KM 才会进入此分支上游）
      if (first.lng == null || first.lat == null) continue;
      const { path, lengthKm } = buildRailwayMetrics(c.railway);
      if (lengthKm <= 0) continue;
      const proj = projectToRailway(path, lengthKm, Number(first.lng), Number(first.lat));
      if (proj.distKm > START_NEAR_KM) continue;
      from0 = { lng: proj.point.lng, lat: proj.point.lat };
    }
    let toLast = resolveStopPoint(last, c);
    if (!toLast) {
      if (last.lng == null || last.lat == null) continue;
      const { path, lengthKm } = buildRailwayMetrics(c.railway);
      if (lengthKm <= 0) continue;
      const proj = projectToRailway(path, lengthKm, Number(last.lng), Number(last.lat));
      if (proj.distKm > START_NEAR_KM) continue;
      toLast = { lng: proj.point.lng, lat: proj.point.lat };
    }
    const sliced = sliceBetween(c, from0, toLast);
    if (!sliced || sliced.length < 2) continue;
    const odGap = Math.max(
      haversineKm(from0, { lng: Number(first.lng), lat: Number(first.lat) }),
      haversineKm(toLast, { lng: Number(last.lng), lat: Number(last.lat) }),
    );
    if (!best || odGap < best.d) best = { c, coords: sliced, d: odGap };
  }
  if (!best) return null;
  if (!validateNetworkCoords(best.coords, stops, first, last)) return null;
  return {
    coords: best.coords,
    corridorIds: [best.c.id],
    corridorNames: [best.c.name],
    transferHubs: [],
    hops: 1,
    score: 1,
  };
}

/**
 * 有坐标经停在折线上的投影进度应大致沿行程单调。
 * 方向拼反会出现「福州南 0、厦门北 0.05、合肥南 0.2、北京南 0.8、蚌埠南 1」类乱序。
 */
function stopsProgressMostlyMonotonic(
  coords: [number, number][],
  stops: CorridorStop[],
  maxKm = 45,
): boolean {
  const { path, lengthKm } = buildRailwayMetrics(coords);
  if (lengthKm <= 0) return false;
  let last = -0.02;
  let counted = 0;
  for (const s of stops) {
    if (s.lng == null || s.lat == null) continue;
    const proj = projectToRailway(path, lengthKm, Number(s.lng), Number(s.lat));
    if (proj.distKm > maxKm) continue;
    counted += 1;
    // 允许少量投影噪声（联络线/平行线），禁止明显折返
    if (proj.progress + 0.04 < last) return false;
    last = Math.max(last, proj.progress);
  }
  return counted >= 2;
}

/**
 * 单走廊未命中时：路网寻路并拼线。
 * G/D → 高铁路网；C → 全库；K/T/Z → 普速路网。
 */
export function matchCorridorNetwork(
  stops: CorridorStop[],
  opts?: { trainCode?: string },
): NetworkMatch | null {
  if (stops.length < 2) return null;
  const trainCode = opts?.trainCode;
  const code = trainCode != null ? String(trainCode).trim() : '';
  let kind: GraphKind = 'all';
  if (code) {
    // C 必须单独分支：不可写进 /^[GDC]/，否则永远走 hsr
    if (/^[GD]/i.test(code)) kind = 'hsr';
    else if (/^C/i.test(code)) kind = 'all';
    else kind = 'conventional';
  }

  const first = stops[0];
  const last = stops[stops.length - 1];
  const g = getGraph(kind);
  const corridors = [...g.byId.values()];

  const startIds = corridors.filter((c) => stopTouchesCorridor(c, first)).map((c) => c.id);
  const endIds = new Set(
    corridors.filter((c) => stopTouchesCorridor(c, last)).map((c) => c.id),
  );
  if (!startIds.length || !endIds.size) return null;

  // 起终落在同一走廊：走到这里说明单走廊匹配已失败，不再直接让位（B2 解除死锁），
  // 以 OD 投影切片兜底（珠海北/吐鲁番北/杭州南类端点站）。
  // 严格交集优先（touch 判定通过更可信）；方位冲突导致 touch 失败时用纯几何贴线再试。
  const sharedCorridorIds = startIds.filter((id) => endIds.has(id));
  if (sharedCorridorIds.length) {
    const direct = matchSameCorridorDirect(sharedCorridorIds, g, stops, first, last);
    if (direct) return direct;
  }
  const sharedGeoIds = corridors
    .filter((c) => touchesCorridorGeo(c, first) && touchesCorridorGeo(c, last))
    .map((c) => c.id);
  if (sharedGeoIds.length) {
    const direct = matchSameCorridorDirect(sharedGeoIds, g, stops, first, last);
    if (direct) return direct;
  }

  const path = findCorridorPath(startIds, endIds, stops, kind);
  if (!path || path.ids.length < 2) return null;

  const chain = path.ids.map((id) => g.byId.get(id)!);
  const transferHubs: string[] = [];
  for (let i = 1; i < path.hubs.length; i++) {
    const h = path.hubs[i];
    if (!h) continue;
    const bridge = parseBridgeHub(h);
    if (bridge) transferHubs.push(`${bridge.fromName}→${bridge.toName}`);
    else if (h.startsWith('__geo_')) transferHubs.push('(几何接驳)');
    else transferHubs.push(h);
  }

  const from0 = resolveStopPoint(first, chain[0]);
  if (!from0) return null;
  const toLast = resolveStopPoint(last, chain[chain.length - 1]);
  if (!toLast) return null;

  /** 每段走廊上的换乘投影（上一段终点 / 下一段起点可不同，短距跳接） */
  const transfers: Array<{ onPrev: { lng: number; lat: number }; onNext: { lng: number; lat: number } }> =
    [];
  for (let i = 0; i < chain.length - 1; i++) {
    const hubName = path.hubs[i + 1];
    const bridge = hubName ? parseBridgeHub(hubName) : null;
    if (bridge) {
      const fromStop =
        stops.find((s) => normalize(s.name) === bridge.fromName) ||
        ({ name: bridge.fromName } as CorridorStop);
      const toStop =
        stops.find((s) => normalize(s.name) === bridge.toName) ||
        ({ name: bridge.toName } as CorridorStop);
      const onPrev =
        resolveStopPoint(fromStop, chain[i]) ||
        hubPointOnCorridor(chain[i], bridge.fromName);
      const onNext =
        resolveStopPoint(toStop, chain[i + 1]) ||
        hubPointOnCorridor(chain[i + 1], bridge.toName);
      if (!onPrev || !onNext) return null;
      transfers.push({ onPrev, onNext });
    } else if (hubName && !isSyntheticHub(hubName)) {
      const onPrev = hubPointOnCorridor(chain[i], hubName);
      const onNext = hubPointOnCorridor(chain[i + 1], hubName);
      if (!onPrev || !onNext) return null;
      transfers.push({ onPrev, onNext });
    } else {
      // B3：优先用建边时记录的最近点对（中段几何枢纽）；端点建边退回端点最近对
      const geoPair = path.geoTrail?.[i + 1];
      if (geoPair) {
        transfers.push({
          onPrev: { lng: geoPair.pa[0], lat: geoPair.pa[1] },
          onNext: { lng: geoPair.pb[0], lat: geoPair.pb[1] },
        });
        continue;
      }
      const a = chain[i];
      const b = chain[i + 1];
      let best = {
        d: Infinity,
        pa: a.railway.at(-1)!,
        pb: b.railway[0],
      };
      for (const pa of [a.railway[0], a.railway.at(-1)!]) {
        for (const pb of [b.railway[0], b.railway.at(-1)!]) {
          const d = haversineKm(
            { lng: pa[0], lat: pa[1] },
            { lng: pb[0], lat: pb[1] },
          );
          if (d < best.d) best = { d, pa, pb };
        }
      }
      transfers.push({
        onPrev: { lng: best.pa[0], lat: best.pa[1] },
        onNext: { lng: best.pb[0], lat: best.pb[1] },
      });
    }
  }

  const coords: [number, number][] = [];
  for (let i = 0; i < chain.length; i++) {
    const fromPt = i === 0 ? from0 : transfers[i - 1].onNext;
    const toPt = i === chain.length - 1 ? toLast : transfers[i].onPrev;
    const seg = sliceBetween(chain[i], fromPt, toPt);
    if (!seg) return null;
    // 段与段接缝：同站换乘应贴合；桥接允许 BRIDGE_MAX_KM；方向拼错会出现数百公里跳跃
    if (coords.length && seg.length) {
      const gap = haversineKm(
        { lng: coords[coords.length - 1][0], lat: coords[coords.length - 1][1] },
        { lng: seg[0][0], lat: seg[0][1] },
      );
      if (gap > BRIDGE_MAX_KM) return null;
    }
    appendUnique(coords, seg);
  }
  if (!validateNetworkCoords(coords, stops, first, last)) return null;

  return {
    coords,
    corridorIds: path.ids,
    corridorNames: path.ids.map((id) => g.byId.get(id)!.name),
    transferHubs,
    hops: path.ids.length,
    score: 1 / path.ids.length,
  };
}
