/**
 * 按 bbox + 名称过滤拉取 OSM ways，Dijkstra 拼精确走廊
 * node scripts/build-corridor-from-osm-bbox.mjs <outId> --name 名 --from lng,lat --to lng,lat [--name-re 正则] [--hint a,b] [--highspeed]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outId = process.argv[2];
if (!outId) {
  console.error('usage: node scripts/build-corridor-from-osm-bbox.mjs <outId> --from lng,lat --to lng,lat ...');
  process.exit(1);
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
function has(flag) {
  return process.argv.includes(flag);
}
function parseLL(s) {
  const [lng, lat] = s.split(',').map(Number);
  return { lng, lat };
}

const displayName = arg('--name') || outId;
const from = parseLL(arg('--from'));
const to = parseLL(arg('--to'));
const nameRe = arg('--name-re');
const pad = Number(arg('--pad') || 0.35);
const CONNECT_TOL = Number(arg('--tol') || 0.008);
const hint = (arg('--hint') || '')
  .split(/[,，]/)
  .map((s) => s.trim())
  .filter(Boolean);
const wantHs = has('--highspeed');

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

const south = Math.min(from.lat, to.lat) - pad;
const north = Math.max(from.lat, to.lat) + pad;
const west = Math.min(from.lng, to.lng) - pad;
const east = Math.max(from.lng, to.lng) + pad;

let filters = `way["railway"~"^(rail|narrow_gauge)$"](${south},${west},${north},${east})`;
if (wantHs) filters = `way["railway"="rail"]["highspeed"="yes"](${south},${west},${north},${east})`;
if (nameRe) {
  filters = `way["railway"~"^(rail|narrow_gauge)$"]["name"~"${nameRe}"](${south},${west},${north},${east})`;
}

const body = `[out:json][timeout:180];
(
  ${filters};
);
out geom;`;

async function overpass() {
  const mirrors = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
  ];
  let lastErr = null;
  for (const m of mirrors) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log('OVERPASS', m, 'try', attempt);
        const res = await fetch(m, {
          method: 'POST',
          body,
          headers: { 'User-Agent': 'RailVista/0.1 bbox-corridor' },
          signal: AbortSignal.timeout(240000),
        });
        if (!res.ok) {
          console.warn('HTTP', res.status);
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        return res.json();
      } catch (e) {
        lastErr = e;
        console.warn('fail', e.message || e);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  throw lastErr || new Error('overpass failed');
}

const json = await overpass();
const wayList = [];
for (const el of json.elements || []) {
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
  wayList.push({
    id: el.id,
    name: el.tags?.name || '',
    points: el.geometry.map((g) => ({ lng: g.lon, lat: g.lat })),
  });
}
console.log('ways', wayList.length, 'bbox', { south, west, north, east }, 'filter', nameRe || (wantHs ? 'highspeed' : 'all-rail'));
if (wayList.length < 2) throw new Error('too few ways');

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
    if (dist(aHead, bTail) < CONNECT_TOL) adj[i].head.push({ j, enter: 'tail', reverse: false });
    if (dist(aHead, bHead) < CONNECT_TOL) adj[i].head.push({ j, enter: 'head', reverse: true });
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

const start = nearestWay(from);
const end = nearestWay(to);
console.log('start way', start.way, 'd', start.d.toFixed(4), 'end way', end.way, 'd', end.d.toFixed(4));

const key = (w, e) => `${w}:${e}`;
const distMap = new Map();
const prevMap = new Map();
const queue = [];
for (const exitEnd of ['head', 'tail']) {
  const s = { wayIdx: start.way, exitEnd, cost: 0, reversed: exitEnd === 'head' };
  distMap.set(key(s.wayIdx, s.exitEnd), 0);
  prevMap.set(key(s.wayIdx, s.exitEnd), { ...s, prev: null });
  queue.push(s);
}

while (queue.length) {
  queue.sort((a, b) => a.cost - b.cost);
  const cur = queue.shift();
  const ck = key(cur.wayIdx, cur.exitEnd);
  if (cur.cost > (distMap.get(ck) ?? Infinity)) continue;
  const exitNode = cur.exitEnd === 'tail' ? 'tail' : 'head';
  for (const edge of adj[cur.wayIdx][exitNode]) {
    const add = wayLength(wayList[edge.j].points);
    const nextExit = edge.enter === 'head' ? 'tail' : 'head';
    const nk = key(edge.j, nextExit);
    const nc = cur.cost + add;
    if (nc < (distMap.get(nk) ?? Infinity)) {
      distMap.set(nk, nc);
      const st = {
        wayIdx: edge.j,
        exitEnd: nextExit,
        cost: nc,
        reversed: edge.reverse,
        prev: prevMap.get(ck),
      };
      prevMap.set(nk, st);
      queue.push(st);
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
if (!bestEnd) throw new Error('path not found');

const pathWays = [];
let st = bestEnd.state;
while (st && st.prev !== undefined) {
  pathWays.unshift({ wayIdx: st.wayIdx, reversed: st.reversed });
  st = st.prev;
}
pathWays.unshift({ wayIdx: start.way, reversed: st?.reversed ?? false });

let line = [];
pathWays.forEach(({ wayIdx, reversed }, i) => {
  let pts = reversed ? [...wayList[wayIdx].points].reverse() : wayList[wayIdx].points;
  if (i > 0) pts = pts.slice(1);
  line = line.concat(pts);
});

function removeBacktracks(pts, dest) {
  if (pts.length < 3) return pts;
  const startToDest = haversine(pts[0], dest) || 1;
  const cleaned = [pts[0]];
  let maxProg = 0;
  for (let i = 1; i < pts.length; i++) {
    const prog = 1 - haversine(pts[i], dest) / startToDest;
    if (prog >= maxProg - 0.004) {
      cleaned.push(pts[i]);
      maxProg = Math.max(maxProg, prog);
    }
  }
  if (dist(cleaned.at(-1), pts.at(-1)) > 0.0001) cleaned.push(pts.at(-1));
  return cleaned.length >= 2 ? cleaned : pts;
}

let simplified = simplify(line, 0.45);
simplified = removeBacktracks(simplified, simplified.at(-1));
let km = 0;
for (let i = 1; i < simplified.length; i++) km += haversine(simplified[i - 1], simplified[i]);
const coords = simplified.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
console.log('pts', coords.length, 'km', km.toFixed(1), 'dijkstra', bestEnd.cost.toFixed(1), coords[0], '->', coords.at(-1));

const outDir = join(__dirname, '../data/presets/corridors');
mkdirSync(outDir, { recursive: true });
const meta = {
  id: outId,
  name: displayName,
  source: 'osm-bbox',
  sourceNames: [displayName, nameRe].filter(Boolean),
  note: `bbox stitch${nameRe ? ` name~${nameRe}` : wantHs ? ' highspeed' : ''}; dijkstra ${bestEnd.cost.toFixed(0)}km`,
  stationsHint: hint,
  railway: coords,
};
writeFileSync(join(outDir, `${outId}.json`), JSON.stringify(meta));
console.log('written', outId);
