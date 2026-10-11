// 装配并直接渲染 PNG（不写 geom），用于目视当前走线质量
// 用法: node scripts/render-assembled.mjs G219 out.png
import { writeFileSync } from 'node:fs';
import { readProvOrder, PROV_TO_SLUG, openProviders, assembleLocal } from './lib/road-build.mjs';
import { Raster, encodePng, hexToRgb } from './lib/raster.mjs';

const ref = process.argv[2], OUT = process.argv[3] || ('tmp/assembled-' + ref + '.png');
const ctrl = readProvOrder(ref);
const first = ctrl.controls[0], last = ctrl.controls[ctrl.controls.length - 1];
const provSlugs = ctrl.provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);
const providers = openProviders(provSlugs);
let r;
try { r = assembleLocal(ref, providers, [first.lng, first.lat], [last.lng, last.lat], ctrl.controls); }
finally { providers.close(); }

const pts = r.points;
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const p of pts) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
minX -= (maxX - minX) * 0.04; maxX += (maxX - minX) * 0.04;
minY -= (maxY - minY) * 0.04; maxY += (maxY - minY) * 0.04;
const spanX = maxX - minX, spanY = maxY - minY;
const W = 1400;
const raster = new Raster(W, Math.max(64, Math.round(W * spanY / spanX)), [6, 10, 18]);
const px = (x) => ((x - minX) / spanX) * raster.w;
const py = (y) => raster.h - ((y - minY) / spanY) * raster.h;
raster.polyline(pts.map((p) => [px(p[0]), py(p[1])]), hexToRgb('#4d9fff'), 0.95, 0.2);
const { width, height, rgb } = raster.toRgb(2, 1.0);
writeFileSync(OUT, encodePng(width, height, rgb));
console.log(ref, '→', OUT, width + 'x' + height, '| pts', pts.length, '| 已绘', r.drawnKm.toFixed(0), '| gaps', r.gaps.length);
