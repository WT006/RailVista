/**
 * Generic: fill corridor jumps via OSM relation Dijkstra (no straight densify).
 *   node scripts/fill-corridor-relation-gaps.mjs <id> <relationId> [--min 12]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
const REL = process.argv[3];
if (!id || !REL) {
  console.error('usage: node scripts/fill-corridor-relation-gaps.mjs <id> <relationId> [--min 12]');
  process.exit(1);
}
const minJump = (() => {
  const i = process.argv.indexOf('--min');
  return i >= 0 ? Number(process.argv[i + 1]) : 12;
})();
const corrPath = join(__dirname, '../data/presets/corridors', `${id}.json`);
const CONNECT_TOL = 0.02;

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

console.log('GET relation', REL);
const json = await (
  await fetch(`https://www.openstreetmap.org/api/0.6/relation/${REL}/full.json`, {
    headers: { 'User-Agent': 'RailVista/1.0 gap-fill' },
    signal: AbortSignal.timeout(180000),
  })
).json();
const nodes = new Map();
const ways = new Map();
for (const el of json.elements || []) {
  if (el.type === 'node') nodes.set(el.id, { lng: el.lon, lat: el.lat });
  if (el.type === 'way') ways.set(el.id, el);
}
const wayList = [];
for (const [, way] of ways) {
  const points = (way.nodes || []).map((nid) => nodes.get(nid)).filter(Boolean);
  if (points.length >= 2) wayList.push({ id: way.id, points });
}

function stitchDijkstra(origin, dest) {
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
  if (!start || !end || start.d > 0.05 || end.d > 0.05) return null;
  const key = (wayIdx, exitEnd) => `${wayIdx}:${exitEnd}`;
  const distMap = new Map();
  const prevMap = new Map();
  const queue = [
    { wayIdx: start.way, exitEnd: 'tail', cost: 0, reversed: false, prev: null },
    { wayIdx: start.way, exitEnd: 'head', cost: 0, reversed: true, prev: null },
  ];
  for (const s of queue) {
    distMap.set(key(s.wayIdx, s.exitEnd), 0);
    prevMap.set(key(s.wayIdx, s.exitEnd), s);
  }
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift();
    const ck = key(cur.wayIdx, cur.exitEnd);
    if (cur.cost > (distMap.get(ck) ?? Infinity)) continue;
    for (const edge of adj[cur.wayIdx][cur.exitEnd]) {
      const addCost = wayLength(wayList[edge.j].points);
      const nextExit = edge.enter === 'head' ? 'tail' : 'head';
      const nk = key(edge.j, nextExit);
      const nc = cur.cost + addCost;
      if (nc < (distMap.get(nk) ?? Infinity)) {
        const state = {
          wayIdx: edge.j,
          exitEnd: nextExit,
          cost: nc,
          reversed: edge.reverse,
          prev: prevMap.get(ck),
        };
        distMap.set(nk, nc);
        prevMap.set(nk, state);
        queue.push(state);
      }
    }
  }
  let bestEnd = null;
  for (const exitEnd of ['head', 'tail']) {
    const st = prevMap.get(key(end.way, exitEnd));
    if (st && (!bestEnd || st.cost < bestEnd.cost)) bestEnd = st;
  }
  if (!bestEnd) return null;
  const pathWays = [];
  let st = bestEnd;
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
  return line.slice(i0, i1 + 1);
}

const corr = JSON.parse(readFileSync(corrPath, 'utf8'));
let line = corr.railway.map((c) => ({ lng: c[0], lat: c[1] }));
let patched = 0;
for (let pass = 0; pass < 30; pass++) {
  let hit = false;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const gap = haversine(a, b);
    if (gap < minJump) continue;
    const bridge = stitchDijkstra(a, b);
    if (!bridge || bridge.length < 3) {
      console.warn('miss', gap.toFixed(1), a, '→', b);
      continue;
    }
    let bkm = 0;
    for (let k = 1; k < bridge.length; k++) bkm += haversine(bridge[k - 1], bridge[k]);
    if (bkm > gap * 3.5 || bkm < gap * 0.5) {
      console.warn('bad len', gap.toFixed(1), '→', bkm.toFixed(1));
      continue;
    }
    console.log(`fill ${gap.toFixed(1)} → ${bkm.toFixed(1)} pts=${bridge.length}`);
    line = [...line.slice(0, i), ...bridge.slice(1, -1), ...line.slice(i)];
    patched += 1;
    hit = true;
    break;
  }
  if (!hit) break;
}

const out = [line[0]];
for (let i = 1; i < line.length; i++) {
  if (haversine(out.at(-1), line[i]) >= 0.4) out.push(line[i]);
}
out.push(line.at(-1));
corr.railway = out.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
corr.note = `${corr.note || ''} | relation-gap-fill n=${patched}`.trim();
writeFileSync(corrPath, JSON.stringify(corr));
console.log('done', id, 'patched', patched, 'pts', corr.railway.length);
