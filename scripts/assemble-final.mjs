// 最终装配（全本地面路网，无高速）：关系+ref 种子 + 走廊地面 way
// 直接把每条 way 喂给 buildGraph（按坐标并接）→ 控制点 Dijkstra 走线；渲染并报告残余缺口。
// 用法: node scripts/assemble-final.mjs G219 tmp/G219-final.png
import { writeFileSync } from 'node:fs';
import {
  readProvOrder, PROV_TO_SLUG, openProviders, gatherWays, gatherSurfaceWays,
} from './lib/road-build.mjs';
import { buildGraph, buildTraceStream } from './lib/road-trace.mjs';
import { haversineM } from './lib/road-assemble.mjs';
import { Raster, encodePng, hexToRgb } from './lib/raster.mjs';

const ref = process.argv[2], OUT = process.argv[3] || ('tmp/final-' + ref + '.png');
const bandKm = process.argv[4] ? Number(process.argv[4]) : 13;
const ctrl = readProvOrder(ref);
const provSlugs = ctrl.provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);
const providers = openProviders(provSlugs);
let stream, totalWays;
try {
  const seed = gatherWays(ref, providers);
  const extras = gatherSurfaceWays(seed, provSlugs, { bandKm });
  totalWays = seed.length + extras.length;
  // 每条 way 作为一条链；buildGraph 按坐标 key 自动并接共享节点
  const graph = buildGraph([...seed, ...extras].map((w) => ({ points: w.points })));
  stream = buildTraceStream(graph, ctrl.controls);
  globalThis.__graph = graph; // 供本脚本后续取坐标
} finally {
  providers.close();
}
const graph = globalThis.__graph;

// 拼全线：nodes→draw；gap→直线占位
const full = [];
const gaps = [];
const addP = (p) => {
  const l = full[full.length - 1];
  if (l && Math.abs(l[0] - p[0]) < 1e-6 && Math.abs(l[1] - p[1]) < 1e-6) return;
  full.push(p);
};
for (const el of stream) {
  if (el.nodes) { for (const n of el.nodes) addP(graph.coords[n]); }
  else if (el.gap) {
    const g = el.gap;
    g.gapKm = Math.round((haversineM(g.from[0], g.from[1], g.to[0], g.to[1]) / 1000) * 100) / 100;
    gaps.push(g); addP(g.from); addP(g.to);
  }
}
let len = 0; for (let i = 1; i < full.length; i += 1) len += haversineM(full[i - 1][0], full[i - 1][1], full[i][0], full[i][1]);
console.log('ways', totalWays, '| pts', full.length, '| 总长', (len / 1000).toFixed(0), '| 残余缺口', gaps.length,
  gaps.reduce((s, g) => s + g.gapKm, 0).toFixed(0) + 'km');
for (const g of gaps) console.log('  ', g.gapKm, 'km', g.from.map((x) => x.toFixed(3)), '→', g.to.map((x) => x.toFixed(3)));

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const p of full) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
minX -= (maxX - minX) * 0.04; maxX += (maxX - minX) * 0.04; minY -= (maxY - minY) * 0.04; maxY += (maxY - minY) * 0.04;
const spanX = maxX - minX, spanY = maxY - minY, W = 1500;
const raster = new Raster(W, Math.max(64, Math.round(W * spanY / spanX)), [6, 10, 18]);
const px = (x) => ((x - minX) / spanX) * raster.w, py = (y) => raster.h - ((y - minY) / spanY) * raster.h;
raster.polyline(full.map((p) => [px(p[0]), py(p[1])]), hexToRgb('#4d9fff'), 0.95, 0.2);
const png = raster.toRgb(2, 1);
writeFileSync(OUT, encodePng(png.width, png.height, png.rgb));
console.log('→', OUT);
