// 完整装配 + 高德补线，渲染 PNG 并报告未补段（不写 geom）
// 用法: node scripts/fill-and-render.mjs G219 tmp/G219-filled.png
import { writeFileSync } from 'node:fs';
import {
  readProvOrder, PROV_TO_SLUG, openProviders, gatherWays,
} from './lib/road-build.mjs';
import { buildGraph, buildTraceStream, stitchGapsWithComponents, streamToItems } from './lib/road-trace.mjs';
import { assembleComponents, haversineM } from './lib/road-assemble.mjs';
import { fillGap } from './lib/road-fill.mjs';
import { Raster, encodePng, hexToRgb } from './lib/raster.mjs';

const ref = process.argv[2], OUT = process.argv[3] || ('tmp/filled-' + ref + '.png');
const ctrl = readProvOrder(ref);
const first = ctrl.controls[0], last = ctrl.controls[ctrl.controls.length - 1];
const provSlugs = ctrl.provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);
const providers = openProviders(provSlugs);
let items;
try {
  const ways = gatherWays(ref, providers);
  const r = assembleComponents(ways, { minComponentM: 20 });
  const graph = buildGraph(r.components);
  let stream = buildTraceStream(graph, ctrl.controls);
  stream = stitchGapsWithComponents(stream, graph, r.components);
  items = streamToItems(stream, graph);
} finally {
  providers.close();
}

const fillItems = items.filter((x) => x.fill);
console.log('待补缺口:', fillItems.length);
const full = [];
const unresolved = [];
let legs = 0;
for (const it of items) {
  if (it.draw) {
    for (const p of it.draw) {
      const l = full[full.length - 1];
      if (l && l[0] === p[0] && l[1] === p[1]) continue;
      full.push(p);
    }
  } else {
    const km = it.fill.gapKm ?? (Math.round((haversineM(it.fill.from[0], it.fill.from[1], it.fill.to[0], it.fill.to[1]) / 1000) * 10) / 10);
    process.stdout.write('补缺口 ' + km + 'km ... ');
    const r = await fillGap(it.fill, { ref });
    legs += r.legs;
    unresolved.push(...r.unresolved);
    console.log('腿', r.legs, r.unresolved.length ? ('未补' + r.unresolved.reduce((s, x) => s + x.km, 0).toFixed(0) + 'km') : 'OK');
    for (const p of r.points) {
      const l = full[full.length - 1];
      if (l && Math.abs(l[0] - p[0]) < 1e-6 && Math.abs(l[1] - p[1]) < 1e-6) continue;
      full.push(p);
    }
  }
}
console.log('高德腿数:', legs, '| 未补段:', unresolved.length, unresolved.reduce((s, x) => s + x.km, 0).toFixed(0) + 'km');
for (const u of unresolved) console.log('  未补', u.km, 'km', u.from.map((x) => x.toFixed(3)), '→', u.to.map((x) => x.toFixed(3)));

// 渲染
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const p of full) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
minX -= (maxX - minX) * 0.04; maxX += (maxX - minX) * 0.04; minY -= (maxY - minY) * 0.04; maxY += (maxY - minY) * 0.04;
const spanX = maxX - minX, spanY = maxY - minY, W = 1500;
const raster = new Raster(W, Math.max(64, Math.round(W * spanY / spanX)), [6, 10, 18]);
const px = (x) => ((x - minX) / spanX) * raster.w, py = (y) => raster.h - ((y - minY) / spanY) * raster.h;
raster.polyline(full.map((p) => [px(p[0]), py(p[1])]), hexToRgb('#4d9fff'), 0.95, 0.2);
const png = raster.toRgb(2, 1.0);
writeFileSync(OUT, encodePng(png.width, png.height, png.rgb));
console.log(ref, '→', OUT, '| pts', full.length);
