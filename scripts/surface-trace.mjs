// 地面路走廊走线探针：构建排除高速(motorway)的全省地面路网，在缺口走廊内求最短路
// 用法: node scripts/surface-trace.mjs G219 36 [out.png]
import { writeFileSync } from 'node:fs';
import { readProvOrder, PROV_TO_SLUG, openProviders, gatherWays } from './lib/road-build.mjs';
import { buildGraph, buildTraceStream, stitchGapsWithComponents, streamToItems } from './lib/road-trace.mjs';
import { assembleComponents, haversineM } from './lib/road-assemble.mjs';
import { loadNodes, openRvwn } from './lib/rvwn.mjs';
import { Raster, encodePng, hexToRgb } from './lib/raster.mjs';

const ref = process.argv[2], gi = Number(process.argv[3]), OUT = process.argv[4] || 'tmp/surface.png';
const ctrl = readProvOrder(ref);
const provSlugs = ctrl.provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);

// 缺口坐标
const providers = openProviders(provSlugs);
let gap;
try {
  const r = assembleComponents(gatherWays(ref, providers), { minComponentM: 20 });
  const graph = buildGraph(r.components);
  let stream = buildTraceStream(graph, ctrl.controls);
  stream = stitchGapsWithComponents(stream, graph, r.components);
  gap = streamToItems(stream, graph).filter((x) => x.fill).map((x) => x.fill)[gi];
} finally { providers.close(); }

console.log('缺口', gap.from.map((x) => x.toFixed(3)), '→', gap.to.map((x) => x.toFixed(3)));
const minX = Math.min(gap.from[0], gap.to[0]), maxX = Math.max(gap.from[0], gap.to[0]);
const minY = Math.min(gap.from[1], gap.to[1]), maxY = Math.max(gap.from[1], gap.to[1]);
const span = Math.max(maxX - minX, maxY - minY), m = Math.max(0.15, span * 0.3);
const box = { minX: minX - m, maxX: maxX + m, minY: minY - m, maxY: maxY + m };

// 全局地面图（按 OSM id）
const coordById = new Map();
const adj = new Map();
const addEdge = (a, b, w) => {
  let m1 = adj.get(a); if (!m1) { m1 = new Map(); adj.set(a, m1); }
  if (!m1.has(b) || w < m1.get(b)) m1.set(b, w);
};
for (const slug of provSlugs) {
  const nodes = loadNodes('data/roads/net/' + slug + '.rvwn');
  const inBoxIdx = new Set();
  for (let i = 0; i < nodes.ids.length; i += 1) {
    if (nodes.lngs[i] >= box.minX && nodes.lngs[i] <= box.maxX && nodes.lats[i] >= box.minY && nodes.lats[i] <= box.maxY) inBoxIdx.add(i);
  }
  const rv = openRvwn('data/roads/net/' + slug + '.rvwn');
  try {
    for (const w of rv.iterateWays()) {
      if (/motorway/.test(w.highway)) continue; // 排除高速/快速
      const idx = rv.readWayIndices(w);
      if (!idx.some((i) => inBoxIdx.has(i))) continue;
      for (let k = 0; k < idx.length - 1; k += 1) {
        const i = idx[k], j = idx[k + 1];
        const a = nodes.ids[i], b = nodes.ids[j];
        const pa = [nodes.lngs[i], nodes.lats[i]], pb = [nodes.lngs[j], nodes.lats[j]];
        if (!Number.isFinite(pa[0]) || !Number.isFinite(pb[0])) continue;
        coordById.set(a, pa); coordById.set(b, pb);
        const d = haversineM(pa[0], pa[1], pb[0], pb[1]);
        addEdge(a, b, d); addEdge(b, a, d);
      }
    }
  } finally { rv.close(); }
}

// 找最近 id
const nearestId = (p) => {
  let best = null, bd = Infinity;
  for (const [id, q] of coordById) { const d = haversineM(p[0], p[1], q[0], q[1]); if (d < bd) { bd = d; best = id; } }
  return best;
};
const s = nearestId(gap.from), t = nearestId(gap.to);
console.log('地面节点', coordById.size, '边', adj.size, '| 起距', s !== null, '讫距', t !== null);
// Dijkstra
const dist = new Map([[s, 0]]), prev = new Map(), heap = new Map();
const pq = [[0, s]];
while (pq.length) {
  pq.sort((a, b) => a[0] - b[0]);
  const [d, u] = pq.shift();
  if (d !== dist.get(u)) continue;
  if (u === t) break;
  for (const [v, w] of adj.get(u) ?? []) {
    const nd = d + w;
    if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); pq.push([nd, v]); }
  }
}
if (!dist.has(t)) { console.log('地面仍不可达，离讫最近', Math.min(...[...dist.keys()].map((u) => haversineM(gap.to[0], gap.to[1], coordById.get(u)[0], coordById.get(u)[1])) / 1000).toFixed(1), 'km'); process.exit(0); }
const path = []; let c = t; while (c !== undefined) { path.push(c); if (c === s) break; c = prev.get(c); }
path.reverse();
const pts = path.map((id) => coordById.get(id));
let len = 0; for (let i = 1; i < pts.length; i += 1) len += haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
console.log('地面走线', pts.length, '点', (len / 1000).toFixed(1), 'km');

// 渲染该走廊：蓝=地面走线
let minX2 = Infinity, maxX2 = -Infinity, minY2 = Infinity, maxY2 = -Infinity;
for (const p of pts) { if (p[0] < minX2) minX2 = p[0]; if (p[0] > maxX2) maxX2 = p[0]; if (p[1] < minY2) minY2 = p[1]; if (p[1] > maxY2) maxY2 = p[1]; }
minX2 -= (maxX2 - minX2) * 0.05; maxX2 += (maxX2 - minX2) * 0.05; minY2 -= (maxY2 - minY2) * 0.05; maxY2 += (maxY2 - minY2) * 0.05;
const sx = maxX2 - minX2, sy = maxY2 - minY2, W = 1400;
const raster = new Raster(W, Math.max(64, Math.round(W * sy / sx)), [6, 10, 18]);
const px = (x) => ((x - minX2) / sx) * raster.w, py = (y) => raster.h - ((y - minY2) / sy) * raster.h;
raster.polyline(pts.map((p) => [px(p[0]), py(p[1])]), hexToRgb('#4d9fff'), 0.95, 0.2);
const png = raster.toRgb(2, 1);
writeFileSync(OUT, encodePng(png.width, png.height, png.rgb));
console.log('→', OUT);
