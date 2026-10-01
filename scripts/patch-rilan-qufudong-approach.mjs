/**
 * 日兰高铁 rilan：中段补曲阜东进路（~6.5km→贴站），改善与京沪交汇门禁。
 *   node scripts/patch-rilan-qufudong-approach.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const path = join(root, 'data/presets/corridors/rilan.json');
const hsrPath = join(root, 'data/presets/corridors/_hsr-rails.geojson');
const geo = JSON.parse(readFileSync(join(root, 'data/stations-geo.json'), 'utf8'));

const MERGE = 0.12;
const BRIDGE = 0.45;

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

function buildGraph(ways) {
  const nodes = [];
  const adj = new Map();
  function addNode(p) {
    for (let i = 0; i < nodes.length; i++) {
      if (haversine(nodes[i], p) < MERGE) return i;
    }
    nodes.push({ ...p });
    return nodes.length - 1;
  }
  function addEdge(a, b, w) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ b, w });
  }
  for (const pts of ways) {
    let prev = -1;
    for (const p of pts) {
      const i = addNode(p);
      if (prev >= 0 && prev !== i) {
        const w = haversine(nodes[prev], nodes[i]);
        addEdge(prev, i, w);
        addEdge(i, prev, w);
      }
      prev = i;
    }
  }
  return { nodes, adj };
}

function dijkstra(graph, start, goal) {
  const { nodes, adj } = graph;
  const dist = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(-1);
  dist[start] = 0;
  const pq = [[0, start]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, u] = pq.shift();
    if (d > dist[u]) continue;
    if (u === goal) break;
    for (const { b, w } of adj.get(u) || []) {
      const nd = d + w;
      if (nd < dist[b]) {
        dist[b] = nd;
        prev[b] = u;
        pq.push([nd, b]);
      }
    }
  }
  if (!Number.isFinite(dist[goal])) return null;
  const path = [];
  for (let cur = goal; cur >= 0; cur = prev[cur]) path.push(nodes[cur]);
  path.reverse();
  return { path, km: dist[goal] };
}

function nearestNode(graph, pt, maxKm = 8) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const d = haversine(graph.nodes[i], pt);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (bestD > maxKm) return null;
  return { i: best, d: bestD };
}

function nearestOnPolyline(pt, coords) {
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

function simplify(points, minKm = 0.35) {
  if (!points.length) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (haversine(out.at(-1), points[i]) >= minKm) out.push(points[i]);
  }
  const last = points.at(-1);
  if (haversine(out.at(-1), last) > 0.05) out.push(last);
  return out;
}

const station = geo['曲阜东'];
if (!station) throw new Error('曲阜东 missing in stations-geo');
const target = { lng: station.lng, lat: station.lat };

const corr = JSON.parse(readFileSync(path, 'utf8'));
const { i: nearIdx, d: nearD } = nearestOnPolyline(target, corr.railway);
console.log('current 曲阜东', nearD.toFixed(2), 'km @', nearIdx);
if (nearD < 1.5) {
  console.log('already close enough');
  process.exit(0);
}

const hsr = JSON.parse(readFileSync(hsrPath, 'utf8'));
const pad = 0.4;
const bbox = {
  minLng: Math.min(target.lng, corr.railway[nearIdx][0]) - pad,
  maxLng: Math.max(target.lng, corr.railway[nearIdx][0]) + pad,
  minLat: Math.min(target.lat, corr.railway[nearIdx][1]) - pad,
  maxLat: Math.max(target.lat, corr.railway[nearIdx][1]) + pad,
};

const ways = [];
for (const f of hsr.features || []) {
  const g = f.geometry;
  if (!g) continue;
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const line of lines) {
    const pts = line
      .map((c) => ({ lng: c[0], lat: c[1] }))
      .filter((p) => p.lng >= bbox.minLng && p.lng <= bbox.maxLng && p.lat >= bbox.minLat && p.lat <= bbox.maxLat);
    if (pts.length >= 2) ways.push(pts);
  }
}
console.log('hsr ways in bbox', ways.length);

const graph = buildGraph(ways);
const railPt = { lng: corr.railway[nearIdx][0], lat: corr.railway[nearIdx][1] };
const a = nearestNode(graph, railPt, 10);
const b = nearestNode(graph, target, 5);
if (!a || !b) {
  console.error('cannot snap to hsr graph', a, b);
  // fallback: densify spur to station then back (V) — bad; instead insert station projection spur once
  process.exit(1);
}

const hit = dijkstra(graph, a.i, b.i);
if (!hit || hit.km > 25) {
  console.error('dijkstra fail/km', hit?.km);
  process.exit(1);
}
console.log('approach', hit.km.toFixed(2), 'km snap', a.d.toFixed(2), b.d.toFixed(2));

let approach = simplify(hit.path);
// ensure ends at station
if (haversine(approach.at(-1), target) > 0.15) approach.push(target);
// orient: start near polyline
if (haversine(approach[0], railPt) > haversine(approach.at(-1), railPt)) {
  approach = [...approach].reverse();
}

const approachCoords = approach.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);

// splice: ... nearIdx → approach → reverse(approach without ends) → continue
// Actually for mid-station we want the mainline to pass near station, not a spur.
// Prefer: replace a window around nearIdx with a path that goes via station.
// Strategy: cut [nearIdx-2 .. nearIdx+2], insert approach from left cut to station to right cut via reverse+continue.
// Simpler: insert approach to station and back onto next rail point (creates short V) — verify may flag turn.
// Better: shift local segment — find points within 15km of station and pull them, OR replace nearest segment with via-station path.

// Build via-station local replace:
// left = nearest point west of station along corridor (smaller idx toward 日照)
// right = nearest point that continues past after approach length
const leftIdx = Math.max(0, nearIdx - 3);
const rightIdx = Math.min(corr.railway.length - 1, nearIdx + 3);
const leftPt = { lng: corr.railway[leftIdx][0], lat: corr.railway[leftIdx][1] };
const rightPt = { lng: corr.railway[rightIdx][0], lat: corr.railway[rightIdx][1] };

const leftNode = nearestNode(graph, leftPt, 12);
const rightNode = nearestNode(graph, rightPt, 12);
const stationNode = nearestNode(graph, target, 5);
if (!leftNode || !rightNode || !stationNode) {
  console.error('window snap fail', leftNode, rightNode, stationNode);
  process.exit(1);
}

const leg1 = dijkstra(graph, leftNode.i, stationNode.i);
const leg2 = dijkstra(graph, stationNode.i, rightNode.i);
if (!leg1 || !leg2 || leg1.km + leg2.km > 40) {
  console.error('via-station legs fail', leg1?.km, leg2?.km);
  process.exit(1);
}

let via = simplify([...leg1.path, ...leg2.path.slice(1)]);
if (haversine(via[0], leftPt) > haversine(via.at(-1), leftPt)) via = [...via].reverse();
// ensure station on via
const stOnVia = via.some((p) => haversine(p, target) < 1.2);
if (!stOnVia) {
  // inject station at closest
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < via.length; i++) {
    const d = haversine(via[i], target);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  via.splice(bi + 1, 0, target);
}

const viaCoords = via.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
const next = [
  ...corr.railway.slice(0, leftIdx + 1),
  ...viaCoords.slice(1),
  ...corr.railway.slice(rightIdx),
];

if (!existsSync(path + '.bak-qufudong')) copyFileSync(path, path + '.bak-qufudong');
corr.railway = next;
const hints = new Set(corr.stationsHint || []);
hints.add('曲阜东');
// keep OD order roughly 日照西 ... 兰考南
const od0 = corr.stationsHint?.[0];
const od1 = corr.stationsHint?.at(-1);
corr.stationsHint = [
  od0,
  ...[...hints].filter((n) => n !== od0 && n !== od1),
  od1,
].filter(Boolean);
corr.note = [corr.note || '', 'patch: 曲阜东 mid-approach via local HSR graph']
  .join(' | ')
  .replace(/^\s*\|\s*/, '');

writeFileSync(path, JSON.stringify(corr));
const { d: after } = nearestOnPolyline(target, corr.railway);
console.log('written pts', corr.railway.length, '曲阜东', after.toFixed(2), 'km');
