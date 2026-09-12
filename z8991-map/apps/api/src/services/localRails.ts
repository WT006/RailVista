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

type GeoFeature = {
  properties?: { osm_id?: number; name?: string; hsr?: number | boolean };
  geometry?: {
    type?: string;
    coordinates?: number[][] | number[][][];
  };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const HSR_PATH = join(__dirname, '../../../../data/presets/corridors/_hsr-rails.geojson');

let cache: LocalRailWay[] | null = null;

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

export function loadLocalHsrRails(): LocalRailWay[] {
  if (cache) return cache;
  if (!existsSync(HSR_PATH)) {
    console.warn('[local-rails] missing', HSR_PATH);
    cache = [];
    return cache;
  }
  const t0 = Date.now();
  const json = JSON.parse(readFileSync(HSR_PATH, 'utf8')) as {
    features?: GeoFeature[];
  };
  const ways: LocalRailWay[] = [];
  let seq = 1;
  for (const f of json.features || []) {
    const lines = asLineStrings(f.geometry);
    for (const points of lines) {
      ways.push({
        id: Number(f.properties?.osm_id) || seq++,
        points,
        name: f.properties?.name,
        highspeed: true,
        bbox: bboxOf(points),
      });
    }
  }
  cache = ways;
  console.log(`[local-rails] loaded ${ways.length} ways from hsr-rails in ${Date.now() - t0}ms`);
  return cache;
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
 * 从本地高铁轨网取走廊附近 ways（不访问 Overpass）。
 * padDeg≈0.15 ≈ 15km。
 */
export function queryLocalWaysAlong(
  samples: LngLat[],
  opts?: { padDeg?: number; highspeedOnly?: boolean },
): LocalRailWay[] {
  const ways = loadLocalHsrRails();
  if (!ways.length || samples.length < 1) return [];
  const padDeg = opts?.padDeg ?? 0.16;
  const window = expandBbox(samples, padDeg);
  const out: LocalRailWay[] = [];
  for (const w of ways) {
    if (opts?.highspeedOnly && !w.highspeed) continue;
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
    // 段在 OD 轴上至少有一部分落在 [ -5%, 105% ]
    const a0 = alongChord(head, from, to);
    const a1 = alongChord(tail, from, to);
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    if (hi < -0.05 || lo > 1.05) return false;
    // 极短无关联络线：相对 OD 太短且偏离轴
    const segKm = haversineKm(head, mid) + haversineKm(mid, tail);
    if (segKm < 0.8 && latMid > maxLateralKm * 0.5) return false;
    // 几乎垂直于 OD 的短段（易引入锯齿）
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
  opts?: { allowPrefer?: boolean },
): LngLat[] | null {
  if (ways.length < 1) return null;
  const allowPrefer = opts?.allowPrefer !== false;
  const odKm = haversineKm(from, to) || 1;
  // 长途干线相对弦线弯曲大（京沪可偏几十公里），半宽随里程放宽
  const maxLateral = Math.min(90, Math.max(14, odKm * 0.09));

  // 若首末附近共享干线名（如京沪高铁），优先整线使用，避免弦线过滤砍掉弯段
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
    // 整库同名 ways，避免走廊 pad 漏掉沿海弯段
    const named = loadLocalHsrRails().filter((w) => w.name === preferredName);
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
  // 命名干线（京沪）数据常有 1°+ 拓扑断口，且相对 OD 弦线可偏 200km+
  const softLateral = namedLine ? Infinity : maxLateral * 1.25;
  const bridgeMax = namedLine ? (odKm > 300 ? 1.8 : 0.8) : odKm > 300 ? 1.3 : 0.55;

  // 起点：靠近 from，且朝 to 明显前进（避免站场短岔线原地打转）
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
      // 强惩罚不朝终点前进的站场短段
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
        // 大跨接时必须净靠近终点，避免站场岔线互连
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

  // 终点仍远：跨拓扑断口（命名干线常见 1°+ 间隙）
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

  // 去掉明显折返：沿弦进度回退过大的点（命名干线放宽，沿海弯段投影会抖）
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
  // 绕路过多则拒绝（短途严、长途宽；命名干线更宽）
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
export function buildLocalSegment(from: LngLat, to: LngLat): LngLat[] | null {
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
    const ways = queryLocalWaysAlong(samples, { padDeg });
    console.log(
      `[local-rails] query ways=${ways.length} spanKm=${spanKm.toFixed(0)} samples=${samples.length} pad=${padDeg}`,
    );
    if (ways.length < 1) return null;
    // 先试干线名偏好；失败再走廊过滤（避免京港等超长线锁定后拼到远端）
    const preferred = stitchLocalOd(from, to, ways, { allowPrefer: true });
    if (preferred) return preferred;
    return stitchLocalOd(from, to, ways, { allowPrefer: false });
  };

  // 先窄走廊防旁线；失败再略放宽（长途干线需要）
  const narrow = spanKm < 80 ? 0.12 : spanKm < 250 ? 0.15 : 0.18;
  const wide = spanKm < 80 ? 0.16 : spanKm < 250 ? 0.2 : 0.26;
  return tryPad(narrow) || (wide > narrow + 0.01 ? tryPad(wide) : null);
}
