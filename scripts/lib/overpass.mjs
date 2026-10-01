/**
 * Overpass 公共库（scripts/lib/overpass.mjs）—— 供公路侧全部抓取脚本共用。
 *
 * 从 scripts/build-drive-route.mjs 抽取（PRD §10.1「直接复用」项）。
 * 抓取纪律（v1 踩过的坑，必须继承）：
 *   - 必须带 User-Agent
 *   - 多端点 failover：maps.mail.ru（实测最稳）→ overpass-api.de → overpass.osm.ch → kumi.systems
 *   - 本地磁盘缓存 data/cache/roads/ways-{ref}.json，命中不重复请求
 *   - Overpass 的 geometry 是 {lat, lon} 对象数组，不是 [lng, lat] 元组，
 *     必须 el.geometry.map(p => [p.lon, p.lat])
 *   - route relation 的 `>;out geom` 会展开全国整条超出 bbox，必须按 bbox 过滤 member
 *     后重新串接（本库只负责取数，串接由调用方 chainWays 完成）
 */

export const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const OVERPASS_USER_AGENT = 'RailVista/0.4.0 (drive-net-builder)';

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROADS_CACHE_DIR = join(__dirname, '../../data/cache/roads');

function cachePath(ref) {
  return join(ROADS_CACHE_DIR, `ways-${String(ref).replace(/[^\w]/g, '')}.json`);
}

export function readWaysCache(ref) {
  try {
    if (existsSync(cachePath(ref))) return JSON.parse(readFileSync(cachePath(ref), 'utf8'));
  } catch {
    /* ignore broken cache */
  }
  return null;
}

export function writeWaysCache(ref, ways) {
  try {
    mkdirSync(ROADS_CACHE_DIR, { recursive: true });
    writeFileSync(cachePath(ref), JSON.stringify(ways), 'utf8');
  } catch {
    /* cache write is best-effort */
  }
}

/** Overpass 查询：多端点故障转移，返回 elements 数组 */
export async function overpassQuery(query, timeoutSec = 60) {
  let lastErr = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(timeoutSec * 1000),
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} @ ${ep}`);
        continue;
      }
      const j = await res.json();
      if (Array.isArray(j.elements)) return j.elements;
      lastErr = new Error(`no elements @ ${ep}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`overpass 全部实例失败：${lastErr?.message}`);
}

/** elements → 标准 way 列表（geometry 已转 [lng, lat] 元组） */
export function elementsToWays(elements, fallbackRef) {
  return elements
    .filter((el) => el.type === 'way' && Array.isArray(el.geometry))
    .map((el) => ({
      id: el.id,
      ref: el.tags?.ref ?? fallbackRef,
      highway: el.tags?.highway ?? '',
      name: el.tags?.name ?? '',
      geom: el.geometry.map((p) => [p.lon, p.lat]),
    }));
}

/** 按 ref 抓 way（带缓存）：way 查询优先，覆盖不足时回退 route relation */
export async function fetchWaysForRef(ref, bbox, { timeoutSec = 90, useCache = true } = {}) {
  if (useCache) {
    const cached = readWaysCache(ref);
    if (cached && cached.length > 0) {
      console.log(`    （缓存命中 ref=${ref}，${cached.length} ways）`);
      return { ways: cached, source: 'ways' };
    }
  }
  const [s, w, n, e] = bbox;
  let ways = [];
  // 正则匹配含多编号共线的 way（ref="G318;G214" 这类分段很常见，精确匹配会断链）
  const esc = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const q = `[out:json][timeout:${timeoutSec}];way["highway"]["ref"~"(^|;)${esc}(;|$)"](${s},${w},${n},${e});out geom;`;
  ways = elementsToWays(await overpassQuery(q, timeoutSec), ref);
  if (ways.length >= 3) {
    if (useCache) writeWaysCache(ref, ways);
    return { ways, source: 'ways' };
  }
  // 回退：route relation（成员 way 覆盖更完整，但 `>;out geom` 展开全国整条，须按 bbox 过滤）
  const rq = `[out:json][timeout:${timeoutSec}];rel["route"="road"]["ref"="${ref}"](${s},${w},${n},${e});out body;>;out geom;`;
  const relElements = await overpassQuery(rq, timeoutSec);
  const rels = relElements.filter((el) => el.type === 'relation');
  if (rels.length > 0) {
    const inBbox = (pt) => pt[1] >= s && pt[1] <= n && pt[0] >= w && pt[0] <= e;
    const relWays = elementsToWays(relElements, ref).filter((way) => way.geom.some(inBbox));
    const seen = new Set();
    const deduped = relWays.filter((way) => (seen.has(way.id) ? false : (seen.add(way.id), true)));
    if (deduped.length > 0) {
      if (useCache) writeWaysCache(ref, deduped);
      return { ways: deduped, source: 'relation' };
    }
  }
  return { ways, source: 'ways' };
}

// ── 几何工具（内联实现，避免依赖编译产物 dist/ —— 与 build-drive-route.mjs 同一纪律） ──

export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export function computeCumKm(coords) {
  const cum = new Array(coords.length);
  let acc = 0;
  cum[0] = 0;
  for (let i = 1; i < coords.length; i += 1) {
    acc += haversineKm(coords[i - 1], coords[i]);
    cum[i] = acc;
  }
  return cum;
}

/** Douglas-Peucker（保留首尾），toleranceM 单位米 */
export function simplifyDP(coords, toleranceM) {
  if (coords.length <= 2 || toleranceM <= 0) return coords.map((c) => [c[0], c[1]]);
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const pointSegDistanceM = (p, a, b) => {
    const [px, py] = p;
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const metersPerDegLng = 111_320 * Math.cos((py * Math.PI) / 180);
    const ex = (px - cx) * metersPerDegLng;
    const ey = (py - cy) * 111_320;
    return Math.sqrt(ex * ex + ey * ey);
  };
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = pointSegDistanceM(coords[i], coords[start], coords[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > toleranceM) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }
  const out = [];
  for (let i = 0; i < coords.length; i += 1) if (keep[i]) out.push([coords[i][0], coords[i][1]]);
  return out;
}

/**
 * 端点最近邻串接成链：起点取最西端点 way（自西向东），先向后（tail）再向前（head）
 * 双向延伸。toleranceM 默认 800（v1 实测值；PRD Step 2 为 300m 双向串接，调用方可收紧）。
 * maxKm > 0 时按官方里程封顶（×系数由调用方算好传入），防止多编号共线误匹配导致
 * 贪心链越串越远（G227 曾串到 2600km+，官方仅 341km）。
 * 返回 { chain, gaps, remaining }——remaining 为未用上的 way 数组（调用方可继续开新链）。
 */
export function chainWays(ways, toleranceM = 800, maxKm = 0) {
  if (!ways.length) return { chain: [], gaps: 0, remaining: [] };
  const pool = ways.slice();
  // 起点取最西端点的 way
  let startIdx = 0;
  let westLng = Infinity;
  pool.forEach((w, i) => {
    const l = Math.min(...w.geom.map((p) => p[0]));
    if (l < westLng) {
      westLng = l;
      startIdx = i;
    }
  });
  const first = pool.splice(startIdx, 1)[0];
  let chain = first.geom.slice();
  let chainKm = 0;

  const nearestWay = (pt) => {
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const w = pool[i];
      for (const end of [w.geom[0], w.geom[w.geom.length - 1]]) {
        const d = haversineKm(pt, end) * 1000;
        if (d < bestDist) {
          bestDist = d;
          best = { idx: i, way: w, end };
        }
      }
    }
    return best && bestDist <= toleranceM ? best : null;
  };

  const withinCap = (extraKm) => maxKm <= 0 || chainKm + extraKm <= maxKm;

  /** 逐段求和的折线长度（km），含跨接段 */
  const pieceLenKm = (fromPt, pts) => {
    let acc = haversineKm(fromPt, pts[0]);
    for (let i = 1; i < pts.length; i += 1) acc += haversineKm(pts[i - 1], pts[i]);
    return acc;
  };

  // 向后延伸（tail）
  let guard = pool.length + 2;
  while (guard-- > 0) {
    const tail = chain[chain.length - 1];
    const hit = nearestWay(tail);
    if (!hit) break;
    const geom = hit.way.geom;
    const forward = geom[0] === hit.end || haversineKm(geom[0], tail) <= haversineKm(geom[geom.length - 1], tail);
    const piece = forward ? geom.slice(1) : geom.slice(0, -1).reverse();
    const pieceKm = pieceLenKm(tail, piece);
    if (!withinCap(pieceKm)) break;
    chain = chain.concat(piece);
    chainKm += pieceKm;
    pool.splice(hit.idx, 1);
  }
  // 向前延伸（head）
  guard = pool.length + 2;
  while (guard-- > 0) {
    const head = chain[0];
    const hit = nearestWay(head);
    if (!hit) break;
    const geom = hit.way.geom;
    const forward = geom[geom.length - 1] === hit.end || haversineKm(geom[geom.length - 1], head) <= haversineKm(geom[0], head);
    const piece = forward ? geom : geom.slice().reverse();
    const pieceKm = pieceLenKm(head, piece);
    if (!withinCap(pieceKm)) break;
    chain = piece.slice(0, -1).concat(chain);
    chainKm += pieceKm;
    pool.splice(hit.idx, 1);
  }

  return { chain, gaps: pool.length, remaining: pool };
}
