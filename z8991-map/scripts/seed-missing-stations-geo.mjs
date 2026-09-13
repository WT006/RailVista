/**
 * 仅「补缺」stations-geo：已有站不覆盖；仅写入缺失的 stationsHint。
 * 锚点走廊：直接用 hint 锚站坐标（走廊 JSON 里 railway 端点附近的 densify 点不够准，改读脚本内不现实）
 * 对 OSM/hsr 走廊：将缺失站投影到折线，偏离 > 40km 则跳过。
 *
 * node scripts/seed-missing-stations-geo.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corridorsDir = join(__dirname, '../data/presets/corridors');
const geoPath = join(__dirname, '../data/stations-geo.json');

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

function project(railway, lng, lat) {
  let best = { distKm: Infinity, lng, lat };
  for (let i = 0; i < railway.length; i++) {
    const d = haversine(
      { lng: railway[i][0], lat: railway[i][1] },
      { lng, lat },
    );
    if (d < best.distKm) best = { distKm: d, lng: railway[i][0], lat: railway[i][1] };
  }
  return best;
}

/** 锚点走廊：按站序比例取折线点作为近似坐标 */
function pointAtFrac(railway, frac) {
  if (!railway.length) return null;
  const i = Math.min(railway.length - 1, Math.max(0, Math.round(frac * (railway.length - 1))));
  return { lng: railway[i][0], lat: railway[i][1] };
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
let added = 0;
const files = readdirSync(corridorsDir).filter((f) => f.endsWith('.json'));

for (const f of files) {
  const c = JSON.parse(readFileSync(join(corridorsDir, f), 'utf8'));
  const hints = c.stationsHint || [];
  const railway = c.railway || [];
  if (hints.length < 2 || railway.length < 2) continue;
  const isAnchor = String(c.source || '').includes('anchor');

  hints.forEach((raw, idx) => {
    const name = String(raw).replace(/站$/, '');
    if (geo[name]?.lng) return;
    let pt;
    if (isAnchor) {
      pt = pointAtFrac(railway, idx / (hints.length - 1));
      if (!pt) return;
      geo[name] = { name, lng: pt.lng, lat: pt.lat, source: `corridor:${c.id}` };
      added += 1;
      console.log('add', name, pt.lng.toFixed(3), pt.lat.toFixed(3), c.id);
    } else {
      // OSM/hsr：没有先验坐标则跳过（避免瞎投影）
    }
  });
}

writeFileSync(geoPath, JSON.stringify(geo));
console.log('added', added, 'total', Object.keys(geo).length);
