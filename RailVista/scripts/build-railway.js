/**
 * 从 OSM relation 152884 构建西宁→拉萨单条铁路折线
 * 运行: node scripts/build-railway.js
 */
const fs = require('fs');
const path = require('path');

const rawPath = path.join(__dirname, '../js/railway-osm-raw.json');
const outPath = path.join(__dirname, '../js/railway-line.js');

const XINING = { lng: 101.815, lat: 36.642 };
const LHASA = { lng: 91.117, lat: 29.654 };
const CONNECT_TOL = 0.004; // ~400m，拼接 OSM Way 端点

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

function dist(a, b) {
  return Math.hypot(a.lng - b.lng, a.lat - b.lat);
}

function haversine(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function wayLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) sum += haversine(points[i - 1], points[i]);
  return sum;
}

const ways = raw.elements
  .filter((el) => el.type === 'way' && el.geometry && el.geometry.length >= 2)
  .map((el, idx) => ({
    id: el.id,
    idx,
    points: el.geometry.map((g) => ({ lng: g.lon, lat: g.lat })),
  }));

console.log(`ways: ${ways.length}`);

// 邻接：从 way i 的 exitEnd('head'|'tail') 可进入 way j
const adj = ways.map(() => ({ head: [], tail: [] }));

for (let i = 0; i < ways.length; i += 1) {
  for (let j = 0; j < ways.length; j += 1) {
    if (i === j) continue;
    const a = ways[i];
    const b = ways[j];
    const aHead = a.points[0];
    const aTail = a.points[a.points.length - 1];
    const bHead = b.points[0];
    const bTail = b.points[b.points.length - 1];

    if (dist(aTail, bHead) < CONNECT_TOL) adj[i].tail.push({ j, enter: 'head', reverse: false });
    if (dist(aTail, bTail) < CONNECT_TOL) adj[i].tail.push({ j, enter: 'tail', reverse: true });
    if (dist(aHead, bTail) < CONNECT_TOL) adj[i].head.push({ j, enter: 'tail', reverse: false });
    if (dist(aHead, bHead) < CONNECT_TOL) adj[i].head.push({ j, enter: 'head', reverse: true });
  }
}

function nearestWay(target) {
  let best = null;
  ways.forEach((w) => {
    w.points.forEach((p, pi) => {
      const d = dist(p, target);
      if (!best || d < best.d) best = { way: w.idx, d, atHead: pi === 0, atTail: pi === w.points.length - 1 };
    });
  });
  return best;
}

const start = nearestWay(XINING);
const end = nearestWay(LHASA);
console.log(`start way ${start.way} d=${start.d.toFixed(3)}, end way ${end.way} d=${end.d.toFixed(3)}`);

// Dijkstra: state = wayIdx + exitEnd (从该 way 的哪一端出来)
function key(wayIdx, exitEnd) {
  return `${wayIdx}:${exitEnd}`;
}

const startStates = [
  { wayIdx: start.way, exitEnd: 'tail', cost: 0, prev: null, reversed: false },
  { wayIdx: start.way, exitEnd: 'head', cost: 0, prev: null, reversed: true },
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
    const w = ways[edge.j];
    const addCost = wayLength(w.points);
    const nextExit = edge.enter === 'head' ? 'tail' : 'head';
    const nk = key(edge.j, nextExit);
    const nc = cur.cost + addCost;
    if (nc < (distMap.get(nk) ?? Infinity)) {
      distMap.set(nk, nc);
      prevMap.set(nk, {
        wayIdx: edge.j,
        exitEnd: nextExit,
        cost: nc,
        reversed: edge.reverse,
        prev: prevMap.get(ck),
      });
      queue.push({ wayIdx: edge.j, exitEnd: nextExit, cost: nc, prev: prevMap.get(ck), reversed: edge.reverse });
    }
  }
}

// 找到达 end way 的最优状态
let bestEnd = null;
for (const exitEnd of ['head', 'tail']) {
  for (const k of [key(end.way, exitEnd)]) {
    const c = distMap.get(k);
    if (c !== undefined && (!bestEnd || c < bestEnd.cost)) {
      bestEnd = { key: k, cost: c, state: prevMap.get(k) };
    }
  }
}

if (!bestEnd) {
  console.error('path not found, fallback to longest chain');
  process.exit(1);
}

// 回溯路径
const pathWays = [];
let st = bestEnd.state;
while (st && st.prev !== undefined) {
  pathWays.unshift({ wayIdx: st.wayIdx, reversed: st.reversed });
  st = st.prev;
}
// 补上起点 way
pathWays.unshift({ wayIdx: start.way, reversed: st?.reversed ?? false });

console.log(`path ways: ${pathWays.length}, cost km ~ ${bestEnd.cost.toFixed(0)}`);

// 拼接坐标
let line = [];
pathWays.forEach(({ wayIdx, reversed }, i) => {
  let pts = reversed ? [...ways[wayIdx].points].reverse() : ways[wayIdx].points;
  if (i > 0) pts = pts.slice(1);
  line = line.concat(pts);
});

// 去重折返点
function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 0.00005) out.push(p);
  }
  return out;
}

function simplify(points, minKm = 0.3) {
  points = dedupe(points);
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    if (haversine(out[out.length - 1], points[i]) >= minKm) out.push(points[i]);
  }
  const tail = points[points.length - 1];
  if (dist(out[out.length - 1], tail) > 0.0001) out.push(tail);
  return out;
}

line = simplify(line, 0.45);
console.log(`final points: ${line.length}`);
console.log(`start: ${line[0].lng.toFixed(3)}, ${line[0].lat.toFixed(3)}`);
console.log(`end: ${line[line.length - 1].lng.toFixed(3)}, ${line[line.length - 1].lat.toFixed(3)}`);

const railway = line.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
const js = `/** 青藏铁路 OSM relation:152884，自动生成 */\nwindow.Z8991_RAILWAY = ${JSON.stringify(railway)};\n`;
fs.writeFileSync(outPath, js, 'utf8');
console.log(`written ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
