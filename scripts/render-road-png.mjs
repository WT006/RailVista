/**
 * 万里路书 · 单条公路几何目视检查（scripts/render-road-png.mjs）
 *
 * 把某个编号的几何渲染成 PNG：主链亮蓝、其余连通分量浅绿。
 * 长线是否正确（走向、起讫、是否断成两截）用眼睛看最快。
 *
 * 用法：node scripts/render-road-png.mjs G318 [out.png]
 */
/**
 * 目视检查：把指定编号公路的几何渲染成 PNG（主链亮色 + 其它分量暗色）
 * 用法：node tmp/render-road-png.mjs G318 [out.png]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Raster, encodePng, hexToRgb } from './lib/raster.mjs';

const KEY = process.argv[2] ?? 'G318';
const OUT = process.argv[3] ?? ('tmp/road-' + KEY.replace(/[^\w]/g, '_') + '.png');
const SS = 2;
const W = 1200;

const g = JSON.parse(readFileSync('data/roads/geom/' + KEY.replace(/[^\w:]/g, '_') + '.json', 'utf8'));
const chains = [[g.points, hexToRgb('#4d9fff'), 0.95], ...(g.segments ?? []).map((s) => [s, hexToRgb('#7ee0c0'), 0.55])];
let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const [c] of chains) for (const p of c) {
  if (p[0] < minLng) minLng = p[0];
  if (p[0] > maxLng) maxLng = p[0];
  if (p[1] < minLat) minLat = p[1];
  if (p[1] > maxLat) maxLat = p[1];
}
const padX = (maxLng - minLng) * 0.04 || 0.1;
const padY = (maxLat - minLat) * 0.04 || 0.1;
minLng -= padX; maxLng += padX; minLat -= padY; maxLat += padY;
const spanX = maxLng - minLng;
const spanY = maxLat - minLat;
const aspect = spanY / spanX;
const raster = new Raster(W * SS, Math.max(64, Math.round(W * aspect)) * SS, [6, 10, 18]);
const px = (lng) => ((lng - minLng) / spanX) * raster.w;
const py = (lat) => raster.h - ((lat - minLat) / spanY) * raster.h;

for (const [chain, color, alpha] of chains) {
  if (!chain || chain.length < 2) continue;
  const pts = chain.map((p) => [px(p[0]), py(p[1])]);
  raster.polyline(pts, color, alpha, alpha * 0.25);
}
const { width, height, rgb } = raster.toRgb(SS, 1.0);
writeFileSync(OUT, encodePng(width, height, rgb));
console.log(KEY, '→', OUT, width + 'x' + height,
  '| 分量', chains.length, '| 总里程', g.totalKm + 'km', '官方', g.officialKm, '| 精度', g.precision,
  '| 主链点', g.points.length, '| 段数', (g.segments ?? []).length);