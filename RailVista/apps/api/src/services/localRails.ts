import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LngLat } from './osmRailway.js';

export type LocalRailWay = {
  id: number;
  points: LngLat[];
  name?: string;
  highspeed: boolean;
  /** 轴对齐包围盒，加速走廊过滤 */
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
};

export type LocalRailKind = 'hsr' | 'rail';

type GeoFeature = {
  properties?: { osm_id?: number; name?: string; hsr?: number | boolean; highspeed?: boolean };
  geometry?: {
    type?: string;
    coordinates?: number[][] | number[][][];
  };
};

type GraphFile = {
  version?: number;
  kind?: string;
  ways?: Array<{
    id?: number;
    name?: string;
    highspeed?: boolean;
    points: Array<[number, number] | LngLat>;
  }>;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = join(__dirname, '../../../../data');
const HSR_GEOJSON = join(DATA_ROOT, 'presets/corridors/_hsr-rails.geojson');
const HSR_GRAPH = join(DATA_ROOT, 'rails/china-hsr.graph');
const RAIL_GRAPH = join(DATA_ROOT, 'rails/china-rail.graph');
const RAIL_GEOJSON = join(DATA_ROOT, 'rails/china-rail.geojson');

let hsrCache: LocalRailWay[] | null = null;
let railCache: LocalRailWay[] | null = null;

function bboxOf(points: LngLat[]) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    minLng = Math.min(minLng, p.lng);
    minLat = Math.min(minLat, p.lat);
    maxLng = Math.max(maxLng, p.lng);
    maxLat = Math.max(maxLat, p.lat);
  }
  return { minLng, minLat, maxLng, maxLat };
}

function asLineStrings(geom: GeoFeature['geometry']): LngLat[][] {
  if (!geom?.coordinates?.length) return [];
  if (geom.type === 'LineString') {
    const pts = (geom.coordinates as number[][])
      .filter((c) => c.length >= 2)
      .map((c) => ({ lng: c[0], lat: c[1] }));
    return pts.length >= 2 ? [pts] : [];
  }
  if (geom.type === 'MultiLineString') {
    const out: LngLat[][] = [];
    for (const line of geom.coordinates as number[][][]) {
      const pts = line
        .filter((c) => c.length >= 2)
        .map((c) => ({ lng: c[0], lat: c[1] }));
      if (pts.length >= 2) out.push(pts);
    }
    return out;
  }
  return [];
}

function pointOf(p: [number, number] | LngLat): LngLat | null {
  if (Array.isArray(p) && p.length >= 2) {
    const lng = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat };
  }
  const o = p as LngLat;
  if (!Number.isFinite(o.lng) || !Number.isFinite(o.lat)) return null;
  return { lng: o.lng, lat: o.lat };
}

function loadWaysFromGraph(path: string, forceHs?: boolean): LocalRailWay[] {
  if (!existsSync(path)) return [];
  const json = JSON.parse(readFileSync(path, 'utf8')) as GraphFile;
  const ways: LocalRailWay[] = [];
  let seq = 1;
  for (const w of json.ways || []) {
    const points: LngLat[] = [];
    for (const raw of w.points || []) {
      const pt = pointOf(raw);
      if (pt) points.push(pt);
    }
    if (points.length < 2) continue;
    ways.push({
      id: Number(w.id) || seq++,
      points,
      name: w.name,
      highspeed: forceHs ?? !!w.highspeed,
      bbox: bboxOf(points),
    });
  }
  return ways;
}

function loadWaysFromGeoJson(path: string, forceHs?: boolean): LocalRailWay[] {
  if (!existsSync(path)) return [];
  const json = JSON.parse(readFileSync(path, 'utf8')) as { features?: GeoFeature[] };
  const ways: LocalRailWay[] = [];
  let seq = 1;
  for (const f of json.features || []) {
    const lines = asLineStrings(f.geometry);
    for (const points of lines) {
      const hs =
        forceHs ??
        !!(f.properties?.hsr || f.properties?.highspeed);
      ways.push({
        id: Number(f.properties?.osm_id) || seq++,
        points,
        name: f.properties?.name,
        highspeed: hs,
        bbox: bboxOf(points),
      });
    }
  }
  return ways;
}

/** 测试或热更新时可清空 */
export function clearLocalRailsCache(): void {
  hsrCache = null;
  railCache = null;
}

export function loadLocalHsrRails(): LocalRailWay[] {
  if (hsrCache) return hsrCache;
  const t0 = Date.now();
  let ways = loadWaysFromGraph(HSR_GRAPH, true);
  let src = 'china-hsr.graph';
  if (!ways.length) {
    ways = loadWaysFromGeoJson(HSR_GEOJSON, true);
    src = '_hsr-rails.geojson';
  }
  hsrCache = ways;
  if (!ways.length) console.warn('[local-rails] missing HSR assets');
  else console.log(`[local-rails] loaded ${ways.length} HSR ways from ${src} in ${Date.now() - t0}ms`);
  return hsrCache;
}

/** 普速轨网：优先 graph，其次合成 geojson；不含高铁仿真轨 */
export function loadLocalConventionalRails(): LocalRailWay[] {
  if (railCache) return railCache;
  const t0 = Date.now();
  let ways = loadWaysFromGraph(RAIL_GRAPH, false).filter((w) => !w.highspeed);
  let src = 'china-rail.graph';
  if (!ways.length) {
    ways = loadWaysFromGeoJson(RAIL_GEOJSON, false).filter((w) => !w.highspeed);
    src = 'china-rail.geojson';
  }
  // 再兜底：图文件可能未标 highspeed=false，整文件当作普速
  if (!ways.length && existsSync(RAIL_GRAPH)) {
    ways = loadWaysFromGraph(RAIL_GRAPH, false);
    src = 'china-rail.graph(all)';
  }
  if (!ways.length && existsSync(RAIL_GEOJSON)) {
    ways = loadWaysFromGeoJson(RAIL_GEOJSON, false);
    src = 'china-rail.geojson(all)';
  }
  railCache = ways;
  if (!ways.length) console.warn('[local-rails] missing conventional rail assets (run scripts/build-rail-graph.mjs)');
  else console.log(`[local-rails] loaded ${ways.length} conventional ways from ${src} in ${Date.now() - t0}ms`);
  return railCache;
}

export function loadLocalRails(kind: LocalRailKind): LocalRailWay[] {
  return kind === 'hsr' ? loadLocalHsrRails() : loadLocalConventionalRails();
}

function expandBbox(
  samples: LngLat[],
  padDeg: number,
): { minLng: number; minLat: number; maxLng: number; maxLat: number } {
  const b = bboxOf(samples);
  return {
    minLng: b.minLng - padDeg,
    minLat: b.minLat - padDeg,
    maxLng: b.maxLng + padDeg,
    maxLat: b.maxLat + padDeg,
  };
}

function bboxOverlap(
  a: { minLng: number; minLat: number; maxLng: number; maxLat: number },
  b: { minLng: number; minLat: number; maxLng: number; maxLat: number },
): boolean {
  return !(a.maxLng < b.minLng || a.minLng > b.maxLng || a.maxLat < b.minLat || a.minLat > b.maxLat);
}

/**
 * 从本地轨网取走廊附近 ways（不访问 Overpass）。
 * padDeg≈0.15 ≈ 15km。
 */
export function queryLocalWaysAlong(
  samples: LngLat[],
  opts?: { padDeg?: number; highspeedOnly?: boolean; kind?: LocalRailKind },
): LocalRailWay[] {
  const kind: LocalRailKind =
    opts?.kind ?? (opts?.highspeedOnly === false ? 'rail' : 'hsr');
  const ways = loadLocalRails(kind);
  if (!ways.length || samples.length < 1) return [];
  const padDeg = opts?.padDeg ?? 0.16;
  const window = expandBbox(samples, padDeg);
  const out: LocalRailWay[] = [];
  for (const w of ways) {
    if (opts?.highspeedOnly && !w.highspeed) continue;
    if (kind === 'rail' && w.highspeed) continue;
    if (!bboxOverlap(window, w.bbox)) continue;
    out.push(w);
  }
  return out;
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

function dist(a: LngLat, b: LngLat): number {
  return Math.hypot(a.lng - b.lng, a.lat - b.lat);
}

/** 点到 OD 弦的近似垂直距离（km） */
function distToChordKm(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy || 1e-12;
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const proj = { lng: a.lng + dx * t, lat: a.lat + dy * t };
  return haversineKm(p, proj);
}

/** 沿 OD 前进比例 0→1（投影到弦） */
function alongChord(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy || 1e-12;
  return Math.max(0, Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2));
}

type Seg = { pts: LngLat[]; used: boolean; name?: string };

/** 只保留贴近 OD 走廊的轨段，避免窜到京广等旁线 */
function filterWaysInCorridor(
  ways: LocalRailWay[],
  from: LngLat,
  to: LngLat,
  maxLateralKm: number,
): LocalRailWay[] {
  const odKm = haversineKm(from, to) || 1;
  return ways.filter((w) => {
    const mid = w.points[Math.floor(w.points.length / 2)];
    const head = w.points[0];
    const tail = w.points[w.points.length - 1];
    const latMid = distToChordKm(mid, from, to);
    const latHead = distToChordKm(head, from, to);
    const latTail = distToChordKm(tail, from, to);
    if (Math.min(latMid, latHead, latTail) > maxLateralKm) return false;
    const a0 = alongChord(head, from, to);
    const a1 = alongChord(tail, from, to);
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    if (hi < -0.05 || lo > 1.05) return false;
    const segKm = haversineKm(head, mid) + haversineKm(mid, tail);
    if (segKm < 0.8 && latMid > maxLateralKm * 0.5) return false;
    const alongSpan = Math.abs(a1 - a0) * odKm;
    if (segKm > 3 && alongSpan < segKm * 0.25 && latMid > 8) return false;
    return true;
  });
}

/**
 * OD 走廊贪心拼线：强制沿弦前进 + 惩罚横向偏离，避免绕涿州等旁线。
 * allowPrefer=false 时跳过「共享干线名整线」锁定，避免京港等超长干线拼偏后无回退。
 */
export function stitchLocalOd(
  from: LngLat,
  to: LngLat,
  ways: LocalRailWay[],
  opts?: { allowPrefer?: boolean; allWays?: LocalRailWay[] },
): LngLat[] | null {
  if (ways.length < 1) return null;
  const allowPrefer = opts?.allowPrefer !== false;
  const catalog = opts?.allWays || ways;
  const odKm = haversineKm(from, to) || 1;
  const maxLateral = Math.min(90, Math.max(14, odKm * 0.09));

  const near = (w: LocalRailWay, p: LngLat, lim: number) => {
    const d0 = dist(p, w.points[0]);
    const d1 = dist(p, w.points[w.points.length - 1]);
    return Math.min(d0, d1) <= lim;
  };
  const namesNear = (p: LngLat, source: LocalRailWay[]) => {
    const c = new Map<string, number>();
    for (const w of source) {
      if (!w.name || !near(w, p, 0.35)) continue;
      c.set(w.name, (c.get(w.name) || 0) + 1);
    }
    return c;
  };
  const ns = namesNear(from, ways);
  const ne = namesNear(to, ways);
  let preferredName: string | null = null;
  let bestCommon = 0;
  if (allowPrefer) {
    for (const [name, a] of ns) {
      const b = ne.get(name) || 0;
      if (b <= 0) continue;
      const score = a + b;
      if (score > bestCommon) {
        bestCommon = score;
        preferredName = name;
      }
    }
  }

  let poolWays: LocalRailWay[];
  if (preferredName && bestCommon >= 4) {
    const named = catalog.filter((w) => w.name === preferredName);
    if (named.length >= 8) {
      console.log(`[local-rails] prefer line "${preferredName}" ways=${named.length}`);
      poolWays = named;
    } else {
      poolWays = filterWaysInCorridor(ways, from, to, maxLateral);
      preferredName = null;
    }
  } else {
    preferredName = null;
    poolWays = filterWaysInCorridor(ways, from, to, maxLateral);
  }
  if (poolWays.length < 3) poolWays = ways;

  const segs: Seg[] = poolWays.map((w) => ({ pts: w.points, used: false, name: w.name }));
  let currentName = preferredName;
  const namedLine = Boolean(preferredName && poolWays.every((w) => !w.name || w.name === preferredName));
  const softLateral = namedLine ? Infinity : maxLateral * 1.25;
  const bridgeMax = namedLine ? (odKm > 300 ? 1.8 : 0.8) : odKm > 300 ? 1.3 : 0.55;

  let startIdx = -1;
  let startRev = false;
  let startScore = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (const rev of [false, true]) {
      const pts = rev ? [...s.pts].reverse() : s.pts;
      const d0 = dist(from, pts[0]);
      if (d0 > 0.28) continue;
      const tip = pts[pts.length - 1];
      const toward = alongChord(tip, from, to) - alongChord(pts[0], from, to);
      const tipToDest = haversineKm(tip, to);
      const lateral = namedLine ? 0 : distToChordKm(tip, from, to);
      const nameBonus = preferredName && s.name === preferredName ? -30 : 0;
      const score = d0 * 1000 - toward * 220 + tipToDest * 0.15 + lateral * 2 + nameBonus;
      if (score < startScore) {
        startScore = score;
        startIdx = i;
        startRev = rev;
      }
    }
  }
  if (startIdx < 0) {
    let startD = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const d0 = dist(from, s.pts[0]);
      const d1 = dist(from, s.pts[s.pts.length - 1]);
      if (d0 < startD) {
        startD = d0;
        startIdx = i;
        startRev = false;
      }
      if (d1 < startD) {
        startD = d1;
        startIdx = i;
        startRev = true;
      }
    }
    if (startIdx < 0 || startD > 0.25) return null;
  }

  let line: LngLat[] = startRev
    ? [...segs[startIdx].pts].reverse()
    : [...segs[startIdx].pts];
  segs[startIdx].used = true;
  currentName = segs[startIdx].name || currentName;

  function pickNext(maxD: number, minAlongGain: number) {
    const tail = line[line.length - 1];
    const along0 = alongChord(tail, from, to);
    const dist0 = haversineKm(tail, to);
    let best: { i: number; pts: LngLat[]; score: number; name?: string } | null = null;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].used) continue;
      for (const rev of [false, true]) {
        const pts = rev ? [...segs[i].pts].reverse() : segs[i].pts;
        const d = dist(tail, pts[0]);
        if (d > maxD) continue;
        const tip = pts[pts.length - 1];
        const along1 = alongChord(tip, from, to);
        const alongGain = along1 - along0;
        if (alongGain < minAlongGain) continue;
        const dist1 = haversineKm(tip, to);
        if (d > 0.25 && dist1 > dist0 - 2) continue;
        const lateral = distToChordKm(tip, from, to);
        if (lateral > softLateral) continue;
        const sameName = currentName && segs[i].name === currentName ? -40 : 0;
        const score = d * 600 - alongGain * 120 + (dist1 - dist0) * 8 + (namedLine ? 0 : lateral * 3) + sameName;
        if (!best || score < best.score) {
          best = { i, pts, score, name: segs[i].name };
        }
      }
    }
    return best;
  }

  while (haversineKm(line[line.length - 1], to) > 2.5) {
    const best =
      pickNext(0.04, 0.001) ||
      pickNext(0.08, 0) ||
      pickNext(0.15, -0.002) ||
      pickNext(0.3, -0.005) ||
      pickNext(0.55, -0.01) ||
      (odKm > 200 ? pickNext(0.9, -0.015) : null) ||
      (odKm > 200 ? pickNext(bridgeMax, -0.02) : null);
    if (!best) break;
    segs[best.i].used = true;
    if (best.name) currentName = best.name;
    line.push(...best.pts.slice(1));
  }

  if (haversineKm(line[line.length - 1], to) > 6) {
    let guard = 0;
    while (haversineKm(line[line.length - 1], to) > 3 && guard++ < 2000) {
      const tail = line[line.length - 1];
      const along0 = alongChord(tail, from, to);
      const dist0 = haversineKm(tail, to);
      let best: { i: number; pts: LngLat[]; score: number; name?: string } | null = null;
      for (let i = 0; i < segs.length; i++) {
        if (segs[i].used) continue;
        for (const rev of [false, true]) {
          const pts = rev ? [...segs[i].pts].reverse() : segs[i].pts;
          const d = dist(tail, pts[0]);
          if (d > bridgeMax) continue;
          const tip = pts[pts.length - 1];
          const alongGain = alongChord(tip, from, to) - along0;
          if (alongGain < -0.02) continue;
          const dist1 = haversineKm(tip, to);
          const closer = dist1 - dist0;
          if (closer > 2) continue;
          if (d > 0.35 && closer > -5) continue;
          const lateral = distToChordKm(tip, from, to);
          if (lateral > softLateral) continue;
          const sameName = currentName && segs[i].name === currentName ? -30 : 0;
          const score = d * 500 + closer * 20 - alongGain * 80 + (namedLine ? 0 : lateral * 4) + sameName;
          if (!best || score < best.score) {
            best = { i, pts, score, name: segs[i].name };
          }
        }
      }
      if (!best) break;
      segs[best.i].used = true;
      if (best.name) currentName = best.name;
      line.push(...best.pts.slice(1));
    }
  }

  if (haversineKm(line[line.length - 1], to) > 20) {
    console.warn(
      `[local-rails] stitch abort: end far ${haversineKm(line[line.length - 1], to).toFixed(1)}km used=${segs.filter((s) => s.used).length}/${segs.length}`,
    );
    return null;
  }
  if (haversineKm(line[0], from) > 20) {
    console.warn(`[local-rails] stitch abort: start far ${haversineKm(line[0], from).toFixed(1)}km`);
    return null;
  }

  let i0 = 0;
  let i1 = line.length - 1;
  let best0 = Infinity;
  let best1 = Infinity;
  for (let i = 0; i < line.length; i++) {
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
  let sliced = line.slice(i0, i1 + 1);
  if (sliced.length < 2) return null;

  const backTol = namedLine ? 0.02 : 0.008;
  const cleaned: LngLat[] = [sliced[0]];
  let maxAlong = alongChord(sliced[0], from, to);
  for (let i = 1; i < sliced.length; i++) {
    const a = alongChord(sliced[i], from, to);
    if (a >= maxAlong - backTol) {
      cleaned.push(sliced[i]);
      maxAlong = Math.max(maxAlong, a);
    }
  }
  if (cleaned.length >= 2) sliced = cleaned;

  let len = 0;
  for (let i = 1; i < sliced.length; i++) len += haversineKm(sliced[i - 1], sliced[i]);
  if (len < odKm * 0.6) {
    console.warn(`[local-rails] stitch abort: short len=${len.toFixed(0)} od=${odKm.toFixed(0)}`);
    return null;
  }
  const maxRatio = namedLine
    ? odKm < 500
      ? 1.75
      : 1.9
    : odKm < 200
      ? 1.45
      : odKm < 500
        ? 1.55
        : 1.7;
  if (len > odKm * maxRatio + 20) {
    console.warn(
      `[local-rails] stitch abort: detour len=${len.toFixed(0)} od=${odKm.toFixed(0)} ratio=${(len / odKm).toFixed(2)}`,
    );
    return null;
  }

  if (!namedLine) {
    let maxLat = 0;
    for (let i = 0; i < sliced.length; i += Math.max(1, Math.floor(sliced.length / 40))) {
      maxLat = Math.max(maxLat, distToChordKm(sliced[i], from, to));
    }
    if (maxLat > maxLateral * 1.5) {
      console.warn(
        `[local-rails] stitch abort: lateral ${maxLat.toFixed(0)}km > ${(maxLateral * 1.5).toFixed(0)}`,
      );
      return null;
    }
  }

  return sliced;
}

/** 查询并拼出站间精确折线（纯本地） */
export function buildLocalSegment(
  from: LngLat,
  to: LngLat,
  opts?: { highspeed?: boolean },
): LngLat[] | null {
  const preferHs = opts?.highspeed !== false;
  const kind: LocalRailKind = preferHs ? 'hsr' : 'rail';
  const catalog = loadLocalRails(kind);
  const spanKm = haversineKm(from, to);
  const samples: LngLat[] = [];
  const n = Math.min(16, Math.max(2, Math.ceil(spanKm / 40)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    samples.push({
      lng: from.lng + (to.lng - from.lng) * t,
      lat: from.lat + (to.lat - from.lat) * t,
    });
  }

  const tryPad = (padDeg: number) => {
    const ways = queryLocalWaysAlong(samples, {
      padDeg,
      kind,
      highspeedOnly: preferHs,
    });
    console.log(
      `[local-rails] query kind=${kind} ways=${ways.length} spanKm=${spanKm.toFixed(0)} samples=${samples.length} pad=${padDeg}`,
    );
    if (ways.length < 1) return null;
    const preferred = stitchLocalOd(from, to, ways, { allowPrefer: true, allWays: catalog });
    if (preferred) return preferred;
    return stitchLocalOd(from, to, ways, { allowPrefer: false, allWays: catalog });
  };

  const narrow = spanKm < 80 ? 0.12 : spanKm < 250 ? 0.15 : 0.18;
  const wide = spanKm < 80 ? 0.16 : spanKm < 250 ? 0.2 : 0.26;
  return tryPad(narrow) || (wide > narrow + 0.01 ? tryPad(wide) : null);
}
