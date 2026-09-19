/**
 * 济青走廊东端补青岛进路：源「济青高速线」止于胶州北一带，
 * 与「青荣」青岛站侧差约 15.7km（hsr-rails 真断口）。
 * 用显式 densify 桥接 + 青荣侧贴青岛站（银兰断口模式，写 note）。
 *
 *   node scripts/patch-jiqing-qingdao-approach.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrPath = join(root, 'data/presets/corridors/jiqing.json');
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

function densify(a, b, stepKm = 2) {
  const d = haversine(a, b);
  const n = Math.max(1, Math.ceil(d / stepKm));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({
      lng: a.lng + (b.lng - a.lng) * t,
      lat: a.lat + (b.lat - a.lat) * t,
    });
  }
  return out;
}

function toXY(p) {
  return [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))];
}

if (!existsSync(corrPath) || !existsSync(hsrPath)) {
  console.error('missing jiqing.json or _hsr-rails.geojson');
  process.exit(1);
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const qd = geo['青岛'];
if (!qd?.lng) {
  console.error('stations-geo missing 青岛');
  process.exit(1);
}

const c = JSON.parse(readFileSync(corrPath, 'utf8'));
const tip = { lng: c.railway.at(-1)[0], lat: c.railway.at(-1)[1] };
const gap0 = haversine(tip, qd);
if (gap0 < 0.5) {
  console.log(`[jiqing-qingdao] skip, end already ${gap0.toFixed(3)} km from 青岛`);
  process.exit(0);
}

const hsr = JSON.parse(readFileSync(hsrPath, 'utf8'));
const WANT = /济青|青荣|潍荣/;
const MERGE = 0.15;
const SOFT = 1.0;
const PAD = 1.2;

const minLng = Math.min(qd.lng, tip.lng) - PAD;
const maxLng = Math.max(qd.lng, tip.lng) + PAD;
const minLat = Math.min(qd.lat, tip.lat) - PAD;
const maxLat = Math.max(qd.lat, tip.lat) + PAD;

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
    if (pts.some((p) => p.lng >= minLng && p.lng <= maxLng && p.lat >= minLat && p.lat <= maxLat)) {
      ways.push(pts);
    }
  }
}

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
    if (prev >= 0) {
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
    if (d > 0 && d <= SOFT) {
      addEdge(i, j, d);
      addEdge(j, i, d);
    }
  }
}

function nearest(p) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = haversine(nodes[i], p);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return { i: bi, d: bd };
}

const s = nearest(qd);
const t = nearest(tip);
const comp = new Array(nodes.length).fill(-1);
let cid = 0;
for (let i = 0; i < nodes.length; i++) {
  if (comp[i] >= 0) continue;
  const q = [i];
  comp[i] = cid;
  for (let qi = 0; qi < q.length; qi++) {
    for (const e of adj.get(q[qi]) || []) {
      if (comp[e.b] < 0) {
        comp[e.b] = cid;
        q.push(e.b);
      }
    }
  }
  cid += 1;
}

const ca = [];
const cb = [];
for (let i = 0; i < nodes.length; i++) {
  if (comp[i] === comp[s.i]) ca.push(i);
  if (comp[i] === comp[t.i]) cb.push(i);
}

let best = { d: Infinity, a: -1, b: -1 };
for (const a of ca) {
  for (const b of cb) {
    const d = haversine(nodes[a], nodes[b]);
    if (d < best.d) best = { d, a, b };
  }
}
if (!Number.isFinite(best.d) || best.a < 0) {
  console.error('[jiqing-qingdao] cannot find component gap');
  process.exit(1);
}

console.log(
  `[jiqing-qingdao] tip→青岛 gap=${gap0.toFixed(1)}km; component minGap=${best.d.toFixed(1)}km; ways=${ways.length} nodes=${nodes.length}`,
);

// tip → gapB → densify → gapA → (along qd component) → 青岛
const gapB = nodes[best.b];
const gapA = nodes[best.a];

// dijkstra gapA → Qingdao on graph with soft bridges already in adj
function dijkstra(fromI, toI) {
  const dist = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(-1);
  dist[fromI] = 0;
  const used = new Set();
  for (;;) {
    let u = -1;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (!used.has(i) && dist[i] < bestD) {
        bestD = dist[i];
        u = i;
      }
    }
    if (u < 0) break;
    used.add(u);
    if (u === toI) break;
    for (const e of adj.get(u) || []) {
      if (dist[u] + e.w < dist[e.b]) {
        dist[e.b] = dist[u] + e.w;
        prev[e.b] = u;
      }
    }
  }
  if (!Number.isFinite(dist[toI])) return null;
  const path = [];
  for (let u = toI; u >= 0; u = prev[u]) path.push(nodes[u]);
  path.reverse();
  return { path, km: dist[toI] };
}

const tail = dijkstra(best.a, s.i);
if (!tail) {
  console.error('[jiqing-qingdao] no path gapA→青岛 on 青荣 side');
  process.exit(1);
}

const bridge = densify(gapB, gapA, 2);
const append = [];
// from current tip toward gapB if needed
if (haversine(tip, gapB) > 0.25) {
  append.push(...densify(tip, gapB, 2).slice(1));
}
// explicit gap (skip first = gapB already)
append.push(...bridge.slice(1));
// 青荣 side to Qingdao (skip first = gapA)
for (const p of tail.path.slice(1)) append.push(p);
// snap end to station
append.push({ lng: qd.lng, lat: qd.lat });

let railway = c.railway.map(([lng, lat]) => ({ lng, lat }));
for (const p of append) {
  if (haversine(railway.at(-1), p) >= 0.12) railway.push(p);
}
railway[railway.length - 1] = { lng: qd.lng, lat: qd.lat };

c.railway = railway.map(toXY);
c.stationsHint = [
  '济南东',
  '章丘北',
  '邹平',
  '淄博北',
  '临淄北',
  '青州市北',
  '潍坊北',
  '高密北',
  '胶州北',
  '青岛',
];
const names = new Set([
  ...(c.sourceNames || []),
  '济青高速线',
  '济青高速铁路',
  '青荣城际线',
  '青荣城际铁路',
]);
c.sourceNames = [...names];
let note = String(c.note || '');
if (!note.includes('Qingdao approach')) {
  note = `${note} | Qingdao approach: explicit ~${best.d.toFixed(1)}km bridge 胶州北侧→青荣/青岛 (hsr source gap)`.trim();
}
c.note = note.replace(/^\| /, '');

writeFileSync(corrPath, JSON.stringify(c));
const endD = haversine({ lng: c.railway.at(-1)[0], lat: c.railway.at(-1)[1] }, qd);
console.log(
  `[jiqing-qingdao] appended bridge+tail; pts=${c.railway.length}; end→青岛 ${endD.toFixed(3)}km`,
);

const clean = spawnSync(
  process.execPath,
  [join(__dirname, 'clean-corridors.mjs'), '--write', '--id', 'jiqing'],
  { stdio: 'inherit' },
);
if (clean.status !== 0) process.exit(clean.status || 1);

const after = JSON.parse(readFileSync(corrPath, 'utf8'));
const afterEnd = {
  lng: after.railway.at(-1)[0],
  lat: after.railway.at(-1)[1],
};
console.log(
  `[jiqing-qingdao] after clean end→青岛 ${haversine(afterEnd, qd).toFixed(3)}km hints=${after.stationsHint.join('-')}`,
);
