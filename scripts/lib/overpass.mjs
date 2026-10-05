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
import { PROVINCE_BBOXES, mergeProvincialWays } from './province-bbox.mjs';

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

/**
 * 按 ref 抓 way（带缓存）。
 * 长线（officialKm > 1000km）route relation 优先：成员覆盖比散 way 全，bbox 过滤后串接。
 * 短线（≤1000km 或未传 officialKm）way 查询优先，覆盖不足时回退 route relation（向后兼容）。
 * 共线 relation（ref 形如 G318;G317）按成员 way 的 ref 正则过滤。
 */
export async function fetchWaysForRef(ref, bbox, { timeoutSec = 90, useCache = true, officialKm = 0 } = {}) {
  if (useCache) {
    const cached = readWaysCache(ref);
    if (cached && cached.length > 0) {
      console.log(`    （缓存命中 ref=${ref}，${cached.length} ways）`);
      return { ways: cached, source: 'ways' };
    }
  }
  const [s, w, n, e] = bbox;
  const esc = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inBbox = (pt) => pt[1] >= s && pt[1] <= n && pt[0] >= w && pt[0] <= e;

  // route relation 查询（`>;out geom` 展开全国整条，须按 bbox 过滤 member way 后重新串接）
  const queryRelation = async () => {
    const rq = `[out:json][timeout:${timeoutSec}];rel["route"="road"]["ref"="${ref}"](${s},${w},${n},${e});out body;>;out geom;`;
    const relElements = await overpassQuery(rq, timeoutSec);
    const rels = relElements.filter((el) => el.type === 'relation');
    if (rels.length === 0) return null;
    const relWays = elementsToWays(relElements, ref).filter((way) => way.geom.some(inBbox));
    const seen = new Set();
    return relWays.filter((way) => (seen.has(way.id) ? false : (seen.add(way.id), true)));
  };

  // way 查询（正则匹配含多编号共线的 way，ref="G318;G214" 这类分段很常见，精确匹配会断链）
  const queryWays = async () => {
    const q = `[out:json][timeout:${timeoutSec}];way["highway"]["ref"~"(^|;)${esc}(;|$)"](${s},${w},${n},${e});out geom;`;
    return elementsToWays(await overpassQuery(q, timeoutSec), ref);
  };

  // 长线（officialKm > 1000km）relation 优先：成员覆盖比散 way 全，减少 orphan 段
  if (officialKm > 1000) {
    try {
      const relWays = await queryRelation();
      if (relWays && relWays.length >= 3) {
        if (useCache) writeWaysCache(ref, relWays);
        return { ways: relWays, source: 'relation' };
      }
    } catch {
      /* relation 失败回退 way 查询 */
    }
    const ways = await queryWays();
    if (ways.length >= 3) {
      if (useCache) writeWaysCache(ref, ways);
      return { ways, source: 'ways' };
    }
    return { ways, source: 'ways' };
  }

  // 短线（≤1000km 或未传 officialKm）保持 way 优先，不足 3 回退 relation
  const ways = await queryWays();
  if (ways.length >= 3) {
    if (useCache) writeWaysCache(ref, ways);
    return { ways, source: 'ways' };
  }
  try {
    const relWays = await queryRelation();
    if (relWays && relWays.length > 0) {
      if (useCache) writeWaysCache(ref, relWays);
      return { ways: relWays, source: 'relation' };
    }
  } catch {
    /* relation 失败保留 way 结果 */
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

function totalKm(coords) {
  let acc = 0;
  for (let i = 1; i < coords.length; i += 1) acc += haversineKm(coords[i - 1], coords[i]);
  return acc;
}

function tryAttach(main, piece) {
  if (!main.length || piece.length < 2) return false;
  const tail = main[main.length - 1];
  const head = piece[0];
  const d = haversineKm(tail, head);
  if (d > 5) return false;
  // 保留拼接点：splice 段长 = 端点距（≤5km）。丢弃端点会让跳点放大到
  // 「端点距 + 相邻段长」，质检（跳点 >5km 标 broken）会误伤
  main.push(...piece);
  return true;
}

/** 头部拼接：piece 末点贴 main 首点（西部线段只能从头上接回来） */
function tryAttachHead(main, piece) {
  if (!main.length || piece.length < 2) return false;
  const d = haversineKm(piece[piece.length - 1], main[0]);
  if (d > 5) return false;
  main.unshift(...piece);
  return true;
}

/**
 * orphan 链几何去重：OSM 常把同一路段拆成多个 relation/way，
 * chainWays 会生成几何重复的 orphan 链（例如同一段路因方向相反或仅覆盖中间部分，
 * 导致首尾点并不接近）。本函数用采样点重叠度判定重复：
 * 对每条链按 sampleIntervalKm 采样，检查有多少采样点落在另一条链的 thresholdKm 内；
 * 重叠比例 >= minOverlap 即视为重复，优先保留较长链作为 canonical。
 */
function deduplicateChains(
  chains,
  { sampleIntervalKm = 2, thresholdKm = 2, minOverlap = 0.5 } = {},
) {
  if (!chains || chains.length <= 1) return chains;
  const sorted = [...chains].sort((a, b) => totalKm(b) - totalKm(a));

  // 为每条链预计算采样点，避免重复计算
  const samplesList = sorted.map((chain) => {
    if (chain.length < 2) return [];
    const pts = [chain[0]];
    let acc = 0;
    for (let i = 1; i < chain.length; i += 1) {
      acc += haversineKm(chain[i - 1], chain[i]);
      if (acc >= sampleIntervalKm) {
        pts.push(chain[i]);
        acc = 0;
      }
    }
    if (chain.length > 1) pts.push(chain[chain.length - 1]);
    return pts;
  });

  const kept = [];
  const keptSamples = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const c = sorted[i];
    if (c.length < 2) continue;
    const samples = samplesList[i];
    if (samples.length === 0) continue;

    let duplicate = false;
    for (const kSamples of keptSamples) {
      let matched = 0;
      for (const p of samples) {
        let min = Infinity;
        for (const q of kSamples) {
          const d = haversineKm(p, q);
          if (d < min) min = d;
          if (min <= thresholdKm) break;
        }
        if (min <= thresholdKm) matched += 1;
      }
      if (matched / samples.length >= minOverlap) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      kept.push(c);
      keptSamples.push(samples);
    }
  }
  return kept;
}

/**
 * 多链贪心串接：chainWays 断链后，从剩余池继续开新链，再按 5km 容差把
 * 端点相近的链拼到主链（不动点迭代：拼接延长主链后，原先够不着的段可能够着了）。
 * officialKm > 0 时全程受「官方里程 × 1.6」封顶（防多编号共线误匹配越串越远）。
 */
export function chainAll(ways, officialKm = 0, toleranceM = 800) {
  const maxKm = officialKm > 0 ? officialKm * 1.6 : 0;
  let pool = ways.slice();
  const chains = [];
  while (pool.length > 0 && chains.length < 400) {
    const { chain, remaining } = chainWays(pool, toleranceM, maxKm);
    if (!chain || chain.length < 2 || remaining.length === pool.length) break;
    chains.push(chain);
    pool = remaining;
  }
  if (chains.length === 0) return { main: [], segments: [], gapAnnotations: [], orphans: 0 };
  // 按长度排序，主链最长；其余尝试端点并接（≤5km 且不超上限），不动点直到无可拼接
  chains.sort((a, b) => totalKm(b) - totalKm(a));
  let main = chains.shift() ?? [];
  let rest = chains;
  for (;;) {
    let attached = false;
    const next = [];
    for (const c of rest) {
      if (maxKm > 0 && totalKm(main) + totalKm(c) > maxKm) {
        next.push(c); // 超上限的段不拼（诚实留给 orphan，verify 会标记偏差）
        continue;
      }
      if (tryAttach(main, c)) {
        attached = true;
      } else if (tryAttach(main, c.slice().reverse())) {
        attached = true;
      } else if (tryAttachHead(main, c)) {
        attached = true;
      } else if (tryAttachHead(main, c.slice().reverse())) {
        attached = true;
      } else {
        next.push(c);
      }
    }
    rest = next;
    if (!attached || !rest.length) break;
  }
  // orphan 链不再丢弃（结构性修复）：按里程降序存入 segments，
  // 即使 ref 标注不全也能把已知的每一段都画出来，G318 立刻从部分段涨到接近全量。
  // 先对 orphan 链做几何去重，避免 OSM 多 relation/way 覆盖同一路段导致里程虚高。
  rest = deduplicateChains(rest, { sampleIntervalKm: 2, thresholdKm: 2, minOverlap: 0.5 });
  const segments = rest.sort((a, b) => totalKm(b) - totalKm(a));
  const gapAnnotations = computeGapAnnotations(main, segments);
  return { main, segments, gapAnnotations, orphans: segments.length };
}

/**
 * 计算段间断点标注：主链末点↔segments 首点、segments 之间的未贯通处。
 * atKm 为断点在全线中的里程位置（主链总里程 + 已遍历 segments 里程累计）。
 * gapKm > 200 时 status='suspect'（可疑大断点，可能串错），否则 'normal'。
 * segments 按里程降序排列（chainAll 已排序），段间断点如实标注不插值伪造连续。
 */
export function computeGapAnnotations(main, segments) {
  if (!segments || segments.length === 0) return [];
  const annotations = [];
  const mainCum = main.length > 0 ? computeCumKm(main) : [0];
  let cumKm = mainCum[mainCum.length - 1] ?? 0;
  let prevEnd = main.length > 0 ? main[main.length - 1] : null;
  let fromSeg = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (!seg || seg.length < 2) continue;
    const segStart = seg[0];
    if (prevEnd) {
      const gapKm = haversineKm(prevEnd, segStart);
      const status = gapKm > 200 ? 'suspect' : 'normal';
      annotations.push({
        atKm: Math.round(cumKm * 100) / 100,
        gapKm: Math.round(gapKm * 100) / 100,
        fromSeg,
        toSeg: i + 1,
        status,
      });
    }
    let segKm = 0;
    for (let j = 1; j < seg.length; j += 1) segKm += haversineKm(seg[j - 1], seg[j]);
    cumKm += segKm;
    prevEnd = seg[seg.length - 1];
    fromSeg = i + 1;
  }
  return annotations;
}

/**
 * 断链点局部补取：around 查询找几何上确实连通的 way（不限 ref，宁缺毋滥）。
 * 城市区域（>50 ways）返回空数组并标注 urban_skip，避免误串城市道路。
 */
export async function fetchConnectingWaysAround(pt, radiusM = 2000, { timeoutSec = 30 } = {}) {
  const [lng, lat] = pt;
  const q = `[out:json][timeout:${timeoutSec}];way["highway"](around:${lat},${lng},${radiusM});out geom;`;
  const elements = await overpassQuery(q, timeoutSec);
  const ways = elementsToWays(elements, '');
  if (ways.length > 50) {
    console.log(`    （around ${radiusM}m 返回 ${ways.length} ways，城市区域跳过）`);
    return { ways: [], status: 'urban_skip' };
  }
  return { ways, status: ways.length > 0 ? 'normal' : 'no_connect' };
}
/**
 * 按省分片抓取：遍历 34 省 bbox，每片独立缓存（key 含省码），合并去重，断点续抓。
 * 单条全国查询易超时/限流；分片命中率高且可断点续抓（已完成的省分片缓存命中即跳过）。
 * 单省超时记入 provincesFailed，不中断整体。
 */
export async function fetchWaysByProvincialTiling(ref, officialKm = 0, { timeoutSec = 90 } = {}) {
  const waysByProvince = [];
  const provincesHit = [];
  const provincesFailed = [];
  for (const prov of PROVINCE_BBOXES) {
    const cacheFile = join(ROADS_CACHE_DIR, `ways-${String(ref).replace(/[^\w]/g, '')}-${prov.code}.json`);
    let cached = null;
    try {
      if (existsSync(cacheFile)) cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    } catch {
      /* ignore broken cache */
    }
    if (cached && cached.length > 0) {
      console.log(`    ${prov.name}（缓存命中 ${cached.length} ways）`);
      waysByProvince.push(cached);
      provincesHit.push(prov.code);
      continue;
    }
    try {
      const result = await fetchWaysForRef(ref, prov.bbox, { timeoutSec, useCache: false, officialKm });
      if (result.ways.length > 0) {
        try {
          mkdirSync(ROADS_CACHE_DIR, { recursive: true });
          writeFileSync(cacheFile, JSON.stringify(result.ways), 'utf8');
        } catch {
          /* cache write best-effort */
        }
        waysByProvince.push(result.ways);
        provincesHit.push(prov.code);
        console.log(`    ${prov.name}（${result.ways.length} ways，${result.source}）`);
      }
    } catch (e) {
      provincesFailed.push({ code: prov.code, name: prov.name, error: e.message });
      console.log(`    ${prov.name} 失败：${e.message}`);
    }
  }
  const ways = mergeProvincialWays(waysByProvince);
  return { ways, source: 'provincial-tiling', provincesHit, provincesFailed };
}
