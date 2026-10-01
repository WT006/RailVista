/**
 * 重建 kunli（昆明→丽江）：
 * - 昆明→大理：Overpass rail + 经站 Dijkstra（广通北/楚雄/南华/祥云）
 * - 大理→丽江：滇藏 OSM relation 预切片（kunli_dali_lijiang.json）
 *
 * node scripts/rebuild-kunli-corridor.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');

const OVERPASS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const STOPS = {
  昆明: { lng: 102.720287, lat: 25.0186616 },
  广通北: { lng: 101.7640778, lat: 25.1672389 },
  楚雄: { lng: 101.542658, lat: 25.085362 },
  南华: { lng: 101.2594428, lat: 25.1895356 },
  祥云: { lng: 100.55698, lat: 25.45375 },
  大理: { lng: 100.2503917, lat: 25.5925944 },
  鹤庆: { lng: 100.2167454, lat: 26.5556454 },
  丽江: { lng: 100.2512118, lat: 26.8143271 },
};

const VIA_NAMES = ['昆明', '广通北', '楚雄', '南华', '祥云', '大理'];
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
function toCoords(line) {
  return simplify(line).map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
}
function lengthKm(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) {
    s += haversine(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
  }
  return s;
}
function minDistKm(pt, coords) {
  let m = Infinity;
  for (const c of coords) {
    const d = haversine(pt, { lng: c[0], lat: c[1] });
    if (d < m) m = d;
  }
  return m;
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
          'User-Agent': 'RailVista/0.1 rebuild-kunli',
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

/** 与 build-corridor-from-osm-relation.mjs 同构的 Dijkstra */
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
        if (!best || d < best.d) {
          best = { way: idx, d, atHead: pi === 0, atTail: pi === w.points.length - 1 };
        }
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

  const snap0 = haversine(origin, line[0]);
  const snap1 = haversine(dest, line.at(-1));
  return { line, km: bestEnd.cost, snap0, snap1 };
}

function stitchVia(wayList, points) {
  let merged = [];
  let usedOsm = true;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const hit = stitchDijkstra(wayList, a, b);
    const ok = hit && hit.snap0 < 5 && hit.snap1 < 5 && hit.line.length >= 2;
    console.log(
      `  leg ${VIA_NAMES[i]}→${VIA_NAMES[i + 1]}`,
      ok
        ? `OSM ${hit.km.toFixed(1)}km snap ${hit.snap0.toFixed(2)}/${hit.snap1.toFixed(2)}`
        : 'FALLBACK densify',
    );
    let seg;
    if (ok) {
      seg = hit.line;
    } else {
      usedOsm = false;
      seg = densify([a, b], 1.2);
    }
    if (!merged.length) merged = [...seg];
    else {
      // 方向对齐
      if (haversine(merged.at(-1), seg[0]) > haversine(merged.at(-1), seg.at(-1))) {
        seg = [...seg].reverse();
      }
      merged.push(...seg.slice(1));
    }
  }
  return { line: merged, usedOsm };
}

// —— fetch rails ——
const south = 24.85;
const north = 25.75;
const west = 100.1;
const east = 102.9;

console.log('fetch Kunming→Dali rails…');
const namedQ = `
[out:json][timeout:180];
(
  way["railway"="rail"]["name"~"昆楚大|广昆|楚大铁路|楚大线"](${south},${west},${north},${east});
  way["railway"="rail"]["highspeed"="yes"](${south},${west},${north},${east});
);
(._;>;);
out body;
`;

let json = await overpass(namedQ);
let nodes = new Map();
let ways = new Map();
for (const el of json.elements || []) {
  if (el.type === 'node') nodes.set(el.id, { lng: el.lon, lat: el.lat });
  if (el.type === 'way' && el.tags?.railway === 'rail') ways.set(el.id, el);
}
console.log('named/hs ways', ways.size);

if (ways.size < 40) {
  console.log('fallback: all rail in bbox…');
  json = await overpass(`
[out:json][timeout:180];
way["railway"="rail"](${south},${west},${north},${east});
(._;>;);
out body;
`);
  nodes = new Map();
  ways = new Map();
  for (const el of json.elements || []) {
    if (el.type === 'node') nodes.set(el.id, { lng: el.lon, lat: el.lat });
    if (el.type === 'way' && el.tags?.railway === 'rail') ways.set(el.id, el);
  }
  console.log('all rail ways', ways.size);
}

const wayList = [];
for (const w of ways.values()) {
  const points = (w.nodes || []).map((id) => nodes.get(id)).filter(Boolean);
  if (points.length < 2) continue;
  wayList.push({ id: w.id, name: w.tags?.name, points });
}
console.log('wayList', wayList.length);

const viaPts = VIA_NAMES.map((n) => STOPS[n]);
const { line: kmDaliLine, usedOsm } = stitchVia(wayList, viaPts);
const kmDaliCoords = toCoords(kmDaliLine);
console.log('KM→Dali pts', kmDaliCoords.length, 'km≈', lengthKm(kmDaliCoords).toFixed(1), usedOsm ? 'OSM' : 'mixed');

// —— Dali→Lijiang ——
const daliLijiangPath = join(corrDir, 'kunli_dali_lijiang.json');
if (!existsSync(daliLijiangPath)) throw new Error('missing kunli_dali_lijiang.json');
const daliLijiang = JSON.parse(readFileSync(daliLijiangPath, 'utf8'));
let dlCoords = daliLijiang.railway;
if (
  haversine({ lng: dlCoords[0][0], lat: dlCoords[0][1] }, STOPS.大理) >
  haversine({ lng: dlCoords.at(-1)[0], lat: dlCoords.at(-1)[1] }, STOPS.大理)
) {
  dlCoords = [...dlCoords].reverse();
}

let bestI = 0;
let bestD = Infinity;
for (let i = 0; i < dlCoords.length; i++) {
  const d = haversine(STOPS.大理, { lng: dlCoords[i][0], lat: dlCoords[i][1] });
  if (d < bestD) {
    bestD = d;
    bestI = i;
  }
}
console.log('大理→大丽段折线', bestD.toFixed(2), 'km @', bestI);
const approach = bestD > 0.25 && bestD <= 8 ? [[STOPS.大理.lng, STOPS.大理.lat]] : [];
dlCoords = dlCoords.slice(bestI);

let merged = [...kmDaliCoords, ...approach, ...dlCoords];
// 去重过近接点
const cleaned = [merged[0]];
for (let i = 1; i < merged.length; i++) {
  const a = cleaned.at(-1);
  const b = merged[i];
  if (dist({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] }) > 0.00015) cleaned.push(b);
}
merged = cleaned;

const corridor = {
  id: 'kunli',
  name: '滇藏铁路大丽段',
  source: usedOsm ? 'osm' : 'osm+anchors',
  sourceNames: ['滇藏铁路', '大丽铁路', '昆楚大铁路'],
  note:
    '昆明→大理经站 Overpass Dijkstra（昆楚大/高速轨优先）+ 滇藏 relation 大理→丽江；与丽香共享丽江枢纽。C118 客运径路。',
  osmRelation: 3431754,
  stationsHint: ['昆明', '广通北', '楚雄', '南华', '祥云', '大理', '鹤庆', '丽江'],
  railway: merged.map((c) => [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))]),
};

writeFileSync(join(corrDir, 'kunli.json'), JSON.stringify(corridor));
console.log('written kunli pts', corridor.railway.length, 'km≈', lengthKm(corridor.railway).toFixed(1));
for (const [name, pt] of Object.entries(STOPS)) {
  console.log(name, 'dist', minDistKm(pt, corridor.railway).toFixed(2), 'km');
}
