/**
 * 沪昆走廊补上海虹桥进路：hsr-rails 提取时东端落在闵行一带，
 * 距虹桥站 ~9–12km，地图上「列车」与「上海虹桥」脱节。
 *
 *   node scripts/patch-hukun-hongqiao-approach.mjs
 *
 * 依赖：data/presets/corridors/_hsr-rails.geojson、hukun.json、stations-geo.json
 * 幂等：起点已在虹桥 0.5km 内则跳过。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const hukunPath = join(root, 'data/presets/corridors/hukun.json');
const hsrPath = join(root, 'data/presets/corridors/_hsr-rails.geojson');
const geoPath = join(root, 'data/stations-geo.json');

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

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const hq = geo['上海虹桥'];
if (!hq?.lng || !hq?.lat) {
  console.error('stations-geo missing 上海虹桥');
  process.exit(1);
}
const c = JSON.parse(readFileSync(hukunPath, 'utf8'));
const dest = { lng: c.railway[0][0], lat: c.railway[0][1] };
const dStart = haversine(hq, dest);
if (dStart < 0.5) {
  console.log(`[hukun-hongqiao] skip, start already ${dStart.toFixed(3)} km from 上海虹桥`);
  process.exit(0);
}

const hsr = JSON.parse(readFileSync(hsrPath, 'utf8'));
const WANT = /沪昆高速|京沪高铁|沪苏湖|沪杭|虹桥/;
const ways = [];
for (const f of hsr.features || []) {
  const name = f.properties?.name || '';
  if (!WANT.test(name)) continue;
  const g = f.geometry;
  const lines =
    g?.type === 'LineString'
      ? [g.coordinates]
      : g?.type === 'MultiLineString'
        ? g.coordinates
        : [];
  for (const line of lines) {
    const pts = line.map((xy) => ({ lng: xy[0], lat: xy[1] }));
    if (pts.some((p) => p.lng > 121.1 && p.lng < 121.5 && p.lat > 30.9 && p.lat < 31.35)) {
      ways.push(pts);
    }
  }
}

const MERGE = 0.12;
const BRIDGE = 0.45;
const nodes = [];
function addNode(p) {
  for (let i = 0; i < nodes.length; i++) {
    if (haversine(nodes[i], p) < MERGE) return i;
  }
  nodes.push({ ...p });
  return nodes.length - 1;
}
const adj = new Map();
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
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    const d = haversine(nodes[i], nodes[j]);
    if (d > 0 && d <= BRIDGE) {
      addEdge(i, j, d * 1.15);
      addEdge(j, i, d * 1.15);
    }
  }
}

function nearest(p) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = haversine(p, nodes[i]);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return { i: bi, d: bd };
}

const s = nearest(hq);
const t = nearest(dest);
const dist = new Array(nodes.length).fill(Infinity);
const prevN = new Array(nodes.length).fill(-1);
dist[s.i] = 0;
const used = new Array(nodes.length).fill(false);
for (let k = 0; k < nodes.length; k++) {
  let u = -1;
  let best = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    if (!used[i] && dist[i] < best) {
      best = dist[i];
      u = i;
    }
  }
  if (u < 0 || best === Infinity) break;
  used[u] = true;
  if (u === t.i) break;
  for (const e of adj.get(u) || []) {
    if (dist[u] + e.w < dist[e.b]) {
      dist[e.b] = dist[u] + e.w;
      prevN[e.b] = u;
    }
  }
}

if (!Number.isFinite(dist[t.i])) {
  console.error('[hukun-hongqiao] no path in hsr-rails graph');
  process.exit(1);
}

const path = [];
for (let u = t.i; u >= 0; u = prevN[u]) path.push(nodes[u]);
path.reverse();
const simp = [path[0]];
for (let i = 1; i < path.length; i++) {
  if (haversine(simp.at(-1), path[i]) >= 0.35) simp.push(path[i]);
}
if (haversine(simp.at(-1), path.at(-1)) > 0.05) simp.push(path.at(-1));

const head = [[Number(hq.lng.toFixed(6)), Number(hq.lat.toFixed(6))]];
for (const p of simp) {
  const xy = [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))];
  if (haversine({ lng: head.at(-1)[0], lat: head.at(-1)[1] }, { lng: xy[0], lat: xy[1] }) >= 0.12) {
    head.push(xy);
  }
}
while (
  head.length &&
  haversine({ lng: head.at(-1)[0], lat: head.at(-1)[1] }, dest) < 0.2
) {
  head.pop();
}

const merged = [...head, ...c.railway];
const out = [merged[0]];
for (let i = 1; i < merged.length; i++) {
  if (
    haversine(
      { lng: out.at(-1)[0], lat: out.at(-1)[1] },
      { lng: merged[i][0], lat: merged[i][1] },
    ) >= 0.12
  ) {
    out.push(merged[i]);
  }
}

c.railway = out;
const note = String(c.note || '');
if (!note.includes('Hongqiao approach')) {
  c.note = `${note} | prepend Hongqiao approach`.trim();
}
writeFileSync(hukunPath, JSON.stringify(c));
console.log(
  `[hukun-hongqiao] prepended ${head.length} pts, path ${dist[t.i].toFixed(1)} km, start dHq=${haversine(hq, { lng: out[0][0], lat: out[0][1] }).toFixed(3)} km, total ${out.length}`,
);
