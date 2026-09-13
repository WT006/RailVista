/**
 * 从已有走廊按 OD 切片写新走廊（精确轨升级用）
 * node scripts/slice-corridor-by-od.mjs <srcId> <outId> --name 名 --from lng,lat --to lng,lat --hint a,b
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcId = process.argv[2];
const outId = process.argv[3];
function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
function parseLL(s) {
  const [lng, lat] = s.split(',').map(Number);
  return { lng, lat };
}
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
function nearest(railway, p) {
  let best = { i: 0, d: Infinity };
  for (let i = 0; i < railway.length; i++) {
    const d = haversine({ lng: railway[i][0], lat: railway[i][1] }, p);
    if (d < best.d) best = { i, d };
  }
  return best;
}

const src = JSON.parse(
  readFileSync(join(__dirname, '../data/presets/corridors', `${srcId}.json`), 'utf8'),
);
const from = parseLL(arg('--from'));
const to = parseLL(arg('--to'));
const name = arg('--name') || outId;
const hint = (arg('--hint') || '')
  .split(/[,，]/)
  .map((s) => s.trim())
  .filter(Boolean);
const a = nearest(src.railway, from);
const b = nearest(src.railway, to);
if (a.d > 40 || b.d > 40) {
  console.error('OD too far from polyline', a, b);
  process.exit(1);
}
let lo = Math.min(a.i, b.i);
let hi = Math.max(a.i, b.i);
let railway = src.railway.slice(lo, hi + 1);
if (a.i > b.i) railway = [...railway].reverse();
let km = 0;
for (let i = 1; i < railway.length; i++) {
  km += haversine(
    { lng: railway[i - 1][0], lat: railway[i - 1][1] },
    { lng: railway[i][0], lat: railway[i][1] },
  );
}
const meta = {
  id: outId,
  name,
  source: src.source,
  sourceNames: src.sourceNames || [src.name],
  note: `sliced from ${srcId}; fromDist=${a.d.toFixed(1)}km toDist=${b.d.toFixed(1)}km`,
  stationsHint: hint.length ? hint : [name],
  railway,
};
writeFileSync(join(__dirname, '../data/presets/corridors', `${outId}.json`), JSON.stringify(meta));
console.log('written', outId, 'pts', railway.length, 'km', km.toFixed(1), 'OD dist', a.d.toFixed(1), b.d.toFixed(1));
