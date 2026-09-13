/**
 * 从 OSM relation 构建走廊 JSON（精确折线入库）
 * 用法:
 *   node scripts/build-corridor-from-osm-relation.mjs <relationId> <outId> [--name 中文名] [--from lng,lat] [--to lng,lat] [--hint 站1,站2,...]
 *
 * 有 --from/--to 时用 Dijkstra 拼接（适合杂乱 member）；否则按 relation member 顺序拼接。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const relationId = process.argv[2];
const outId = process.argv[3];
if (!relationId || !outId) {
  console.error(
    'usage: node scripts/build-corridor-from-osm-relation.mjs <relationId> <outId> [--name ...] [--from lng,lat] [--to lng,lat] [--hint a,b,c]',
  );
  process.exit(1);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const displayName = argValue('--name') || outId;
const hintArg = argValue('--hint');
const stationsHint = hintArg
  ? hintArg
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
  : [];
const fromArg = argValue('--from');
const toArg = argValue('--to');
const CONNECT_TOL = Number(argValue('--tol') || 0.004);

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

function parseLL(s) {
  const [lng, lat] = s.split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error(`bad lng,lat: ${s}`);
  return { lng, lat };
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

function stitchByMembers(rel, ways, nodes) {
  let line = [];
  for (const m of rel.members || []) {
    if (m.type !== 'way') continue;
    const way = ways.get(m.ref);
    if (!way?.nodes?.length) continue;
    const pts = way.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (pts.length < 2) continue;
    const ordered = m.role === 'backward' ? [...pts].reverse() : pts;
    if (!line.length) {
      line = [...ordered];
      continue;
    }
    const tail = line.at(-1);
    const head = ordered[0];
    const end = ordered.at(-1);
    if (dist(tail, head) <= dist(tail, end)) line.push(...ordered.slice(1));
    else line.push(...[...ordered].reverse().slice(1));
  }
  return line;
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
      if (dist(aHead, bTail) < CONNECT_TOL) adj[i].head.push({ j, enter: 'tail', reverse: false });
      if (dist(aHead, bHead) < CONNECT_TOL) adj[i].head.push({ j, enter: 'head', reverse: true });
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
  if (!start || !end) throw new Error('cannot locate OD on ways');

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
  if (!bestEnd) throw new Error('path not found between OD');

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
  return { line, km: bestEnd.cost };
}

async function fetchRelationFull(id) {
  const endpoints = [
    `https://www.openstreetmap.org/api/0.6/relation/${id}/full.json`,
    `https://api.openstreetmap.org/api/0.6/relation/${id}/full.json`,
  ];
  for (const url of endpoints) {
    try {
      console.log('GET', url);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'RailVista/0.1 corridor builder' },
        signal: AbortSignal.timeout(180000),
      });
      if (res.ok) return res.json();
      console.warn('HTTP', res.status, url);
    } catch (e) {
      console.warn('fail', url, e.message || e);
    }
  }
  // Overpass fallback
  const mirrors = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];
  const body = `[out:json][timeout:180];relation(${id});(._;>>;);out body;`;
  for (const m of mirrors) {
    try {
      console.log('OVERPASS', m);
      const res = await fetch(m, {
        method: 'POST',
        body,
        headers: { 'User-Agent': 'RailVista/0.1 corridor builder' },
        signal: AbortSignal.timeout(240000),
      });
      if (res.ok) return res.json();
      console.warn('overpass HTTP', res.status);
    } catch (e) {
      console.warn('overpass fail', e.message || e);
    }
  }
  throw new Error(`cannot fetch relation ${id}`);
}

const json = await fetchRelationFull(relationId);

const nodes = new Map();
const ways = new Map();
let rel = null;
for (const el of json.elements || []) {
  if (el.type === 'node') nodes.set(el.id, { lng: el.lon, lat: el.lat });
  if (el.type === 'way') ways.set(el.id, el);
  if (el.type === 'relation' && String(el.id) === String(relationId)) rel = el;
}
if (!rel) throw new Error('relation missing');
const relName = rel.tags?.['name:zh'] || rel.tags?.name || displayName;
console.log('name', relName, 'nodes', nodes.size, 'ways', ways.size, 'members', rel.members?.length);

let line;
let method = 'member-order';
if (fromArg && toArg) {
  const origin = parseLL(fromArg);
  const dest = parseLL(toArg);
  const wayList = [];
  for (const m of rel.members || []) {
    if (m.type !== 'way') continue;
    const way = ways.get(m.ref);
    if (!way?.nodes?.length) continue;
    const points = way.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (points.length >= 2) wayList.push({ id: way.id, points });
  }
  console.log('dijkstra ways', wayList.length);
  const r = stitchDijkstra(wayList, origin, dest);
  line = r.line;
  method = 'dijkstra';
  console.log('dijkstra km ~', r.km.toFixed(1));
} else {
  line = stitchByMembers(rel, ways, nodes);
}

if (!line || line.length < 2) throw new Error('empty polyline');
const simplified = simplify(line, 0.45);
let km = 0;
for (let i = 1; i < simplified.length; i++) km += haversine(simplified[i - 1], simplified[i]);
const coords = simplified.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
console.log(
  'simplified',
  coords.length,
  'km',
  km.toFixed(1),
  'start',
  coords[0],
  'end',
  coords.at(-1),
  'method',
  method,
);

const outDir = join(__dirname, '../data/presets/corridors');
mkdirSync(outDir, { recursive: true });
const meta = {
  id: outId,
  name: displayName || relName,
  osmRelation: Number(relationId),
  source: 'osm',
  sourceNames: [relName, displayName].filter((v, i, a) => v && a.indexOf(v) === i),
  stationsHint,
  railway: coords,
};
const outPath = join(outDir, `${outId}.json`);
writeFileSync(outPath, JSON.stringify(meta));
console.log('written', outPath, `${(Buffer.byteLength(JSON.stringify(meta)) / 1024).toFixed(1)} KB`);
