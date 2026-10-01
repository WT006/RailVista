/**
 * 延长胶济客专 jiaojikezhuan：潍坊→胶州北→青岛（G942 等勿被迫走济青北站走廊）。
 *   node scripts/extend-jiaojikezhuan-to-qingdao.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const path = join(root, 'data/presets/corridors/jiaojikezhuan.json');

const OVERPASS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const VIA = [
  { name: '潍坊', lng: 119.0915313, lat: 36.6961413 },
  { name: '胶州北', lng: 119.992475, lat: 36.424152 },
  { name: '青岛', lng: 120.3076944, lat: 36.065375 },
];

const CONNECT_TOL = 0.03;

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
          'User-Agent': 'RailVista/0.1 extend-jiaojikezhuan',
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
      w.points.forEach((p) => {
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

const south = 35.9;
const north = 36.95;
const west = 118.9;
const east = 120.5;

console.log('fetch 潍坊→青岛 rails…');
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
  if (el.type === 'way' && el.tags?.railway === 'rail') ways.set(el.id, el);
}
console.log('ways', ways.size);

const wayList = [];
for (const w of ways.values()) {
  const points = (w.nodes || []).map((id) => nodes.get(id)).filter(Boolean);
  if (points.length < 2) continue;
  // 优先非济青北站走廊：排除 name 含济青 且远离胶济的？先全收再经站 Dijkstra
  wayList.push({ id: w.id, name: w.tags?.name, points });
}

let tailLine = [];
let usedOsm = true;
for (let i = 0; i < VIA.length - 1; i++) {
  const a = VIA[i];
  const b = VIA[i + 1];
  const hit = stitchDijkstra(wayList, a, b);
  const ok = hit && hit.snap0 < 5 && hit.snap1 < 5 && hit.line.length >= 2;
  // 拒绝对 jiqing 北偏：中点应靠近胶济（潍坊-青岛弦）而非太北
  let okPath = ok;
  if (ok) {
    const mid = hit.line[Math.floor(hit.line.length / 2)];
    const chordMid = {
      lng: (a.lng + b.lng) / 2,
      lat: (a.lat + b.lat) / 2,
    };
    const drift = haversine(mid, chordMid);
    if (drift > 25) {
      console.warn(`  reject drift ${drift.toFixed(1)}km on ${a.name}→${b.name}`);
      okPath = false;
    }
  }
  console.log(
    `  ${a.name}→${b.name}`,
    okPath ? `OSM ${hit.km.toFixed(1)}km snap ${hit.snap0.toFixed(2)}/${hit.snap1.toFixed(2)}` : 'FALLBACK densify',
  );
  let seg = okPath ? hit.line : densify([a, b], 1.2);
  if (!okPath) usedOsm = false;
  if (!tailLine.length) tailLine = [...seg];
  else {
    if (haversine(tailLine.at(-1), seg[0]) > haversine(tailLine.at(-1), seg.at(-1))) {
      seg = [...seg].reverse();
    }
    tailLine.push(...seg.slice(1));
  }
}

const tailCoords = simplify(tailLine).map((p) => [
  Number(p.lng.toFixed(6)),
  Number(p.lat.toFixed(6)),
]);

const corr = JSON.parse(readFileSync(path, 'utf8'));
if (!existsSync(path + '.bak-extend-qd')) copyFileSync(path, path + '.bak-extend-qd');

const weifang = VIA[0];
const { i: wfIdx, d: wfD } = nearestIdx(weifang, corr.railway);
console.log('old 潍坊 idx', wfIdx, 'dist', wfD.toFixed(2), 'of', corr.railway.length);

// keep 济南→潍坊, append 潍坊→青岛
const head = corr.railway.slice(0, wfIdx + 1);
const joined = [...head];
const t0 = tailCoords[0];
if (t0) {
  const gap = haversine(
    { lng: joined.at(-1)[0], lat: joined.at(-1)[1] },
    { lng: t0[0], lat: t0[1] },
  );
  if (gap > 0.3) joined.push(t0);
  joined.push(...tailCoords.slice(1));
}

corr.railway = joined;
corr.source = usedOsm ? 'local-rail-graph+osm-extend' : 'local-rail-graph+anchors-extend';
corr.note = [
  corr.note || '',
  'extend: 潍坊→胶州北→青岛（胶济客专），避免 G942 等被迫走济青北站走廊绕开淄博/潍坊',
]
  .join(' | ')
  .replace(/^\s*\|\s*/, '');

const hints = new Set(corr.stationsHint || []);
for (const n of ['济南', '淄博', '潍坊', '胶州北', '青岛']) hints.add(n);
// OD ends: 济南 … 青岛
corr.stationsHint = ['济南', ...[...hints].filter((n) => n !== '济南' && n !== '青岛'), '青岛'];

writeFileSync(path, JSON.stringify(corr));
console.log('written pts', corr.railway.length);
for (const v of [
  { name: '济南', lng: 116.9851524, lat: 36.6708478 },
  { name: '淄博', lng: 118.0503244, lat: 36.7868463 },
  ...VIA,
]) {
  console.log(v.name, 'dist', minDist(v, corr.railway).toFixed(2), 'km');
}
