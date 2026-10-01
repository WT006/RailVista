/**
 * 修补 hukunxian 上海→杭州段：过「上海松江」（2024-12 沪昆普速改线新枢纽）。
 * 旧折线在松江西侧约 9km，导致 Z175 等车蓝线绕开松江。
 *
 *   node scripts/patch-hukunxian-songjiang.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const path = join(root, 'data/presets/corridors/hukunxian.json');

const OVERPASS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

/** 沪杭普速径路锚点（wiki / 既有 geo） */
const VIA = [
  { name: '上海', lng: 121.455, lat: 31.25 },
  { name: '上海松江', lng: 121.2262833, lat: 30.9846806 },
  { name: '嘉兴', lng: 120.758, lat: 30.767 },
  { name: '海宁', lng: 120.486, lat: 30.48 },
  { name: '杭州', lng: 120.1786, lat: 30.246 },
];

const CONNECT_TOL = 0.025;

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
function dist(a, b) {
  return Math.hypot(a.lng - b.lng, a.lat - b.lat);
}
function wayLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += haversine(points[i - 1], points[i]);
  return sum;
}
function simplify(points, minKm = 0.45) {
  if (!points.length) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (haversine(out.at(-1), points[i]) >= minKm) out.push(points[i]);
  }
  const last = points.at(-1);
  if (dist(out.at(-1), last) > 0.0001) out.push(last);
  return out;
}
function densify(anchors, stepKm = 1.2) {
  const out = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const d = haversine(a, b);
    const n = Math.max(1, Math.ceil(d / stepKm));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t });
    }
  }
  out.push(anchors.at(-1));
  return out;
}
function minDist(pt, coords) {
  let m = Infinity;
  for (const c of coords) {
    const d = haversine(pt, { lng: c[0], lat: c[1] });
    if (d < m) m = d;
  }
  return m;
}
function nearestIdx(pt, coords) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversine(pt, { lng: coords[i][0], lat: coords[i][1] });
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { i: best, d: bestD };
}

async function overpass(query) {
  for (const u of OVERPASS) {
    try {
      console.log('OVERPASS', u);
      const res = await fetch(u, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RailVista/0.1 patch-hukunxian-songjiang',
        },
        signal: AbortSignal.timeout(180000),
      });
      console.log('status', res.status);
      if (!res.ok) continue;
      return res.json();
    } catch (e) {
      console.warn('fail', u, e.message);
    }
  }
  throw new Error('overpass failed');
}

function stitchDijkstra(wayList, origin, dest) {
  const adj = wayList.map(() => ({ head: [], tail: [] }));
  for (let i = 0; i < wayList.length; i++) {
    for (let j = 0; j < wayList.length; j++) {
      if (i === j) continue;
      const a = wayList[i];
      const b = wayList[j];
      const aHead = a.points[0];
      const aTail = a.points.at(-1);
      const bHead = b.points[0];
      const bTail = b.points.at(-1);
      if (dist(aTail, bHead) < CONNECT_TOL) adj[i].tail.push({ j, enter: 'head', reverse: false });
      if (dist(aTail, bTail) < CONNECT_TOL) adj[i].tail.push({ j, enter: 'tail', reverse: true });
      if (dist(aHead, bTail) < CONNECT_TOL) adj[i].head.push({ j, enter: 'tail', reverse: true });
      if (dist(aHead, bHead) < CONNECT_TOL) adj[i].head.push({ j, enter: 'head', reverse: false });
    }
  }

  function nearestWay(target) {
    let best = null;
    wayList.forEach((w, idx) => {
      w.points.forEach((p, pi) => {
        const d = dist(p, target);
        if (!best || d < best.d) best = { way: idx, d };
      });
    });
    return best;
  }

  const start = nearestWay(origin);
  const end = nearestWay(dest);
  if (!start || !end) return null;

  const key = (wayIdx, exitEnd) => `${wayIdx}:${exitEnd}`;
  const startStates = [
    { wayIdx: start.way, exitEnd: 'tail', cost: 0, reversed: false },
    { wayIdx: start.way, exitEnd: 'head', cost: 0, reversed: true },
  ];
  const distMap = new Map();
  const prevMap = new Map();
  const queue = [...startStates];
  for (const s of startStates) {
    distMap.set(key(s.wayIdx, s.exitEnd), 0);
    prevMap.set(key(s.wayIdx, s.exitEnd), { ...s, prev: null });
  }

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift();
    const ck = key(cur.wayIdx, cur.exitEnd);
    if (cur.cost > (distMap.get(ck) ?? Infinity)) continue;
    const exitNode = cur.exitEnd === 'tail' ? 'tail' : 'head';
    for (const edge of adj[cur.wayIdx][exitNode]) {
      const w = wayList[edge.j];
      const addCost = wayLength(w.points);
      const nextExit = edge.enter === 'head' ? 'tail' : 'head';
      const nk = key(edge.j, nextExit);
      const nc = cur.cost + addCost;
      if (nc < (distMap.get(nk) ?? Infinity)) {
        distMap.set(nk, nc);
        const state = {
          wayIdx: edge.j,
          exitEnd: nextExit,
          cost: nc,
          reversed: edge.reverse,
          prev: prevMap.get(ck),
        };
        prevMap.set(nk, state);
        queue.push(state);
      }
    }
  }

  let bestEnd = null;
  for (const exitEnd of ['head', 'tail']) {
    const c = distMap.get(key(end.way, exitEnd));
    if (c !== undefined && (!bestEnd || c < bestEnd.cost)) {
      bestEnd = { cost: c, state: prevMap.get(key(end.way, exitEnd)) };
    }
  }
  if (!bestEnd) return null;

  const pathWays = [];
  let st = bestEnd.state;
  while (st) {
    pathWays.unshift({ wayIdx: st.wayIdx, reversed: st.reversed });
    st = st.prev;
  }

  let line = [];
  pathWays.forEach(({ wayIdx, reversed }, i) => {
    let pts = reversed ? [...wayList[wayIdx].points].reverse() : wayList[wayIdx].points;
    if (i > 0) pts = pts.slice(1);
    line = line.concat(pts);
  });

  if (line.length >= 2) {
    let i0 = 0;
    let i1 = line.length - 1;
    let best0 = Infinity;
    let best1 = Infinity;
    for (let i = 0; i < line.length; i++) {
      const d0 = dist(line[i], origin);
      const d1 = dist(line[i], dest);
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
    if (sliced.length >= 2) line = sliced;
  }

  return {
    line,
    snap0: haversine(origin, line[0]),
    snap1: haversine(dest, line.at(-1)),
    km: bestEnd.cost,
  };
}

const south = 29.95;
const north = 31.45;
const west = 119.9;
const east = 121.7;

console.log('fetch Shanghai→Hangzhou rails…');
// 含 highspeed：2024-12 后沪昆普速已改线贴松江枢纽，命名轨/高速轨在枢纽共站
const json = await overpass(`
[out:json][timeout:180];
(
  way["railway"="rail"](${south},${west},${north},${east});
);
(._;>;);
out body;
`);

const nodes = new Map();
const ways = new Map();
for (const el of json.elements || []) {
  if (el.type === 'node') nodes.set(el.id, { lng: el.lon, lat: el.lat });
  if (el.type === 'way' && el.tags?.railway === 'rail') {
    // 排除仅建设中/废弃
    if (el.tags.railway === 'construction' || el.tags.railway === 'abandoned') continue;
    ways.set(el.id, el);
  }
}
console.log('ways', ways.size, 'nodes', nodes.size);

const wayList = [];
for (const w of ways.values()) {
  // 优先非 pure highspeed 的轨，但也保留 highspeed（松江枢纽共线）
  const points = (w.nodes || []).map((id) => nodes.get(id)).filter(Boolean);
  if (points.length < 2) continue;
  wayList.push({ id: w.id, name: w.tags?.name, hs: w.tags?.highspeed === 'yes', points });
}

let headLine = [];
let usedOsm = true;
for (let i = 0; i < VIA.length - 1; i++) {
  const a = VIA[i];
  const b = VIA[i + 1];
  const hit = stitchDijkstra(wayList, a, b);
  const ok = hit && hit.snap0 < 4 && hit.snap1 < 4 && hit.line.length >= 2;
  console.log(
    `  ${a.name}→${b.name}`,
    ok ? `OSM ${hit.km.toFixed(1)}km snap ${hit.snap0.toFixed(2)}/${hit.snap1.toFixed(2)}` : 'FALLBACK densify',
  );
  let seg = ok ? hit.line : densify([a, b], 1.2);
  if (!ok) usedOsm = false;
  if (!headLine.length) headLine = [...seg];
  else {
    if (haversine(headLine.at(-1), seg[0]) > haversine(headLine.at(-1), seg.at(-1))) {
      seg = [...seg].reverse();
    }
    headLine.push(...seg.slice(1));
  }
}

const headCoords = simplify(headLine).map((p) => [
  Number(p.lng.toFixed(6)),
  Number(p.lat.toFixed(6)),
]);
console.log('new head pts', headCoords.length, 'songjiang dist', minDist(VIA[1], headCoords).toFixed(2), 'km');

const corr = JSON.parse(readFileSync(path, 'utf8'));
if (!existsSync(path + '.bak-songjiang')) copyFileSync(path, path + '.bak-songjiang');

const hangzhou = VIA[VIA.length - 1];
const { i: hangIdx, d: hangD } = nearestIdx(hangzhou, corr.railway);
console.log('old hangzhou idx', hangIdx, 'dist', hangD.toFixed(2), 'km');

// 从杭州接点起保留旧折线（去昆明）
const tail = corr.railway.slice(hangIdx);
const joined = [...headCoords];
const t0 = tail[0];
if (t0) {
  const gap = haversine(
    { lng: joined.at(-1)[0], lat: joined.at(-1)[1] },
    { lng: t0[0], lat: t0[1] },
  );
  if (gap > 0.3 && gap <= 8) {
    // 短缝直连
    joined.push(t0);
    joined.push(...tail.slice(1));
  } else if (gap <= 0.3) {
    joined.push(...tail.slice(1));
  } else {
    console.warn('large join gap', gap.toFixed(2), 'km — still splice');
    joined.push(...tail);
  }
}

corr.railway = joined;
corr.source = usedOsm ? 'osm+patch-songjiang' : 'anchors+patch-songjiang';
corr.note = [
  corr.note || '',
  'patch: 上海→杭州改经上海松江（2024-12 沪昆普速改线新枢纽），修复 Z175 等绕开松江',
]
  .join(' | ')
  .replace(/^\s*\|\s*/, '');

const hints = new Set(corr.stationsHint || []);
for (const n of ['上海松江', '海宁', '杭州', '嘉兴', '上海']) hints.add(n);
// 保留杭州南/东供高铁对照，但普速终点「杭州」必须在 hints
corr.stationsHint = [...hints];

writeFileSync(path, JSON.stringify(corr));
console.log('written hukunxian pts', corr.railway.length);
for (const v of VIA) {
  console.log(v.name, 'dist', minDist(v, corr.railway).toFixed(2), 'km');
}
