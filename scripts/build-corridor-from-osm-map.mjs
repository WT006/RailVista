/**
 * 用 OSM 官方 /api/0.6/map 分块拉轨，Dijkstra 拼走廊（不依赖 Overpass）
 *   node scripts/build-corridor-from-osm-map.mjs <outId> --from lng,lat --to lng,lat [--name] [--hint] [--highspeed]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outId = process.argv[2];
if (!outId) {
  console.error('usage: node scripts/build-corridor-from-osm-map.mjs <outId> --from lng,lat --to lng,lat');
  process.exit(1);
}
function arg(f) {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : null;
}
function has(f) {
  return process.argv.includes(f);
}
function parseLL(s) {
  const [lng, lat] = String(s).split(',').map(Number);
  return { lng, lat };
}

const displayName = arg('--name') || outId;
const from = parseLL(arg('--from'));
const to = parseLL(arg('--to'));
const hint = (arg('--hint') || '')
  .split(/[,，]/)
  .map((s) => s.trim())
  .filter(Boolean);
const wantHs = has('--highspeed');
const pad = Number(arg('--pad') || 0.15);
const CONNECT_TOL = Number(arg('--tol') || 0.02);
const TILE = Number(arg('--tile') || 0.2); // deg per tile side (~22km)

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
function chordDistKm(p, a, b) {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy || 1e-12;
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return haversine(p, { lng: a.lng + dx * t, lat: a.lat + dy * t });
}

const south = Math.min(from.lat, to.lat) - pad;
const north = Math.max(from.lat, to.lat) + pad;
const west = Math.min(from.lng, to.lng) - pad;
const east = Math.max(from.lng, to.lng) + pad;

const tiles = [];
for (let lat = south; lat < north; lat += TILE) {
  for (let lng = west; lng < east; lng += TILE) {
    tiles.push({
      s: lat,
      w: lng,
      n: Math.min(lat + TILE, north),
      e: Math.min(lng + TILE, east),
    });
  }
}
console.log('tiles', tiles.length, 'bbox', { south, west, north, east });

async function fetchTile(t, depth = 0) {
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${t.w},${t.s},${t.e},${t.n}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'RailVista/0.1 corridor-map-tiles' },
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 400 && depth < 3) {
        const midLat = (t.s + t.n) / 2;
        const midLng = (t.w + t.e) / 2;
        const parts = [
          { s: t.s, w: t.w, n: midLat, e: midLng },
          { s: t.s, w: midLng, n: midLat, e: t.e },
          { s: midLat, w: t.w, n: t.n, e: midLng },
          { s: midLat, w: midLng, n: t.n, e: t.e },
        ];
        console.warn(`split depth=${depth}`);
        const out = { elements: [] };
        for (const p of parts) {
          const j = await fetchTile(p, depth + 1);
          out.elements.push(...(j.elements || []));
          await new Promise((r) => setTimeout(r, 500));
        }
        return out;
      }
      if (res.status === 509 || res.status === 429) {
        const wait = 15000 * attempt;
        console.warn(`rate ${res.status}, wait ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      if (attempt === 4) {
        console.warn('skip tile', e.message || e);
        return { elements: [] };
      }
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  return { elements: [] };
}

const nodes = new Map();
const ways = new Map();
let ti = 0;
for (const t of tiles) {
  ti += 1;
  process.stdout.write(`tile ${ti}/${tiles.length}... `);
  const j = await fetchTile(t);
  let nRail = 0;
  for (const el of j.elements || []) {
    if (el.type === 'node') nodes.set(el.id, { lng: el.lon, lat: el.lat });
    if (el.type === 'way' && el.tags?.railway) {
      const rw = el.tags.railway;
      if (!/^(rail|narrow_gauge)$/.test(rw)) continue;
      if (wantHs && el.tags.highspeed !== 'yes') continue;
      ways.set(el.id, el);
      nRail += 1;
    }
  }
  console.log(`ok +rail=${nRail}`);
  await new Promise((r) => setTimeout(r, 1200));
}

const odKm = haversine(from, to) || 1;
const maxLat = Math.min(90, Math.max(14, odKm * 0.12));
const wayList = [];
for (const way of ways.values()) {
  const points = (way.nodes || []).map((id) => nodes.get(id)).filter(Boolean);
  if (points.length < 2) continue;
  const mid = points[Math.floor(points.length / 2)];
  if (chordDistKm(mid, from, to) > maxLat) continue;
  wayList.push({ id: way.id, name: way.tags?.name, points });
}
console.log('ways', wayList.length, 'nodes', nodes.size);

if (wayList.length < 2) {
  console.error('too few ways');
  process.exit(1);
}

// Dijkstra
const adj = wayList.map(() => ({ head: [], tail: [] }));
for (let i = 0; i < wayList.length; i++) {
  for (let j = 0; j < wayList.length; j++) {
    if (i === j) continue;
    const a = wayList[i],
      b = wayList[j];
    const aH = a.points[0],
      aT = a.points.at(-1);
    const bH = b.points[0],
      bT = b.points.at(-1);
    if (dist(aT, bH) < CONNECT_TOL) adj[i].tail.push({ j, enter: 'head', reverse: false });
    if (dist(aT, bT) < CONNECT_TOL) adj[i].tail.push({ j, enter: 'tail', reverse: true });
    if (dist(aH, bT) < CONNECT_TOL) adj[i].head.push({ j, enter: 'tail', reverse: true });
    if (dist(aH, bH) < CONNECT_TOL) adj[i].head.push({ j, enter: 'head', reverse: false });
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
console.log('snap', start?.d.toFixed(4), end?.d.toFixed(4));

const key = (w, e) => `${w}:${e}`;
const distMap = new Map();
const prevMap = new Map();
const queue = [
  { wayIdx: start.way, exitEnd: 'tail', cost: 0, reversed: false },
  { wayIdx: start.way, exitEnd: 'head', cost: 0, reversed: true },
];
for (const s of queue) {
  distMap.set(key(s.wayIdx, s.exitEnd), 0);
  prevMap.set(key(s.wayIdx, s.exitEnd), { ...s, prev: null });
}
while (queue.length) {
  queue.sort((a, b) => a.cost - b.cost);
  const cur = queue.shift();
  const ck = key(cur.wayIdx, cur.exitEnd);
  if (cur.cost > (distMap.get(ck) ?? Infinity)) continue;
  for (const edge of adj[cur.wayIdx][cur.exitEnd]) {
    const add = wayLength(wayList[edge.j].points);
    const nextExit = edge.enter === 'head' ? 'tail' : 'head';
    const nk = key(edge.j, nextExit);
    const nc = cur.cost + add;
    if (nc < (distMap.get(nk) ?? Infinity)) {
      distMap.set(nk, nc);
      prevMap.set(nk, {
        wayIdx: edge.j,
        exitEnd: nextExit,
        cost: nc,
        reversed: edge.reverse,
        prev: prevMap.get(ck),
      });
      queue.push({ wayIdx: edge.j, exitEnd: nextExit, cost: nc, reversed: edge.reverse });
    }
  }
}
let bestEnd = null;
for (const exitEnd of ['head', 'tail']) {
  const c = distMap.get(key(end.way, exitEnd));
  if (c !== undefined && (!bestEnd || c < bestEnd.cost)) bestEnd = { cost: c, state: prevMap.get(key(end.way, exitEnd)) };
}

let line = [];
let method = 'dijkstra';
if (bestEnd) {
  const pathWays = [];
  let st = bestEnd.state;
  while (st && st.prev !== undefined) {
    pathWays.unshift({ wayIdx: st.wayIdx, reversed: st.reversed });
    st = st.prev;
  }
  pathWays.unshift({ wayIdx: start.way, reversed: st?.reversed ?? false });
  pathWays.forEach(({ wayIdx, reversed }, i) => {
    let pts = reversed ? [...wayList[wayIdx].points].reverse() : wayList[wayIdx].points;
    if (i > 0) pts = pts.slice(1);
    line = line.concat(pts);
  });
} else {
  console.warn('dijkstra miss → greedy');
  method = 'greedy';
  const segs = wayList.map((w) => ({ pts: w.points, used: false }));
  let startIdx = -1,
    startRev = false,
    bestD = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const d0 = dist(from, segs[i].pts[0]);
    const d1 = dist(from, segs[i].pts.at(-1));
    if (d0 < bestD) {
      bestD = d0;
      startIdx = i;
      startRev = false;
    }
    if (d1 < bestD) {
      bestD = d1;
      startIdx = i;
      startRev = true;
    }
  }
  if (startIdx < 0) {
    console.error('greedy no start');
    process.exit(1);
  }
  line = startRev ? [...segs[startIdx].pts].reverse() : [...segs[startIdx].pts];
  segs[startIdx].used = true;
  const bridgeMax = odKm > 200 ? 1.2 : 0.8;
  for (let guard = 0; guard < 6000; guard++) {
    const tail = line.at(-1);
    if (haversine(tail, to) < 2.5) break;
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].used) continue;
      for (const rev of [false, true]) {
        const pts = rev ? [...segs[i].pts].reverse() : segs[i].pts;
        const dJoin = dist(tail, pts[0]);
        if (dJoin > bridgeMax) continue;
        const tip = pts.at(-1);
        const gain = haversine(tail, to) - haversine(tip, to);
        if (gain < -3) continue;
        const score = dJoin * 80 - gain * 12 + chordDistKm(tip, from, to) * 2;
        if (!best || score < best.score) best = { i, pts, score };
      }
    }
    if (!best) break;
    segs[best.i].used = true;
    line = line.concat(best.pts.slice(1));
  }
  if (haversine(line.at(-1), to) > 30) {
    console.error('greedy incomplete', haversine(line.at(-1), to).toFixed(1));
    process.exit(1);
  }
}
const simplified = simplify(line, 0.45);
let km = 0;
for (let i = 1; i < simplified.length; i++) km += haversine(simplified[i - 1], simplified[i]);
const coords = simplified.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
console.log('pts', coords.length, 'km', km.toFixed(1), coords[0], '->', coords.at(-1));

mkdirSync(join(__dirname, '../data/presets/corridors'), { recursive: true });
const meta = {
  id: outId,
  name: displayName,
  source: 'osm-map-tiles',
  sourceNames: [displayName],
  stationsHint: hint,
  railway: coords,
};
writeFileSync(join(__dirname, '../data/presets/corridors', `${outId}.json`), JSON.stringify(meta));
console.log('written', outId);
