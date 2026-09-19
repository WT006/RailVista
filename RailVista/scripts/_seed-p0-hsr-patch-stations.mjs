/**
 * Seed OD stations for P0 HSR patch batch (weiyan/hangyong/heining/hewu).
 *   node scripts/_seed-p0-hsr-patch-stations.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const geoPath = join(__dirname, '../data/stations-geo.json');
const corrDir = join(__dirname, '../data/presets/corridors');

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function project(railway, lng, lat) {
  let best = { distKm: Infinity, lng, lat };
  for (const p of railway) {
    const d = haversine({ lng: p[0], lat: p[1] }, { lng, lat });
    if (d < best.distKm) best = { distKm: d, lng: p[0], lat: p[1] };
  }
  return best;
}

const SEEDS = {
  潍坊北: { lng: 119.189424, lat: 36.795689, corridor: 'weiyan' },
  烟台: { lng: 121.39, lat: 37.48, corridor: 'weiyan' },
  杭州东: { lng: 120.21233, lat: 30.289012, corridor: 'hangyong' },
  宁波: { lng: 121.5326567, lat: 29.8646327, corridor: 'hangyong' },
  合肥南: { lng: 117.316, lat: 31.798, corridor: 'heining' },
  南京南: { lng: 118.7987, lat: 31.9689, corridor: 'heining' },
  汉口: { lng: 114.252891, lat: 30.62326, corridor: 'hewu' },
};

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
let added = 0;
let updated = 0;

for (const [name, seed] of Object.entries(SEEDS)) {
  const corrPath = join(corrDir, `${seed.corridor}.json`);
  if (!existsSync(corrPath)) {
    console.log('skip no corridor', name, seed.corridor);
    continue;
  }
  const c = JSON.parse(readFileSync(corrPath, 'utf8'));
  const proj = project(c.railway, seed.lng, seed.lat);
  let lng = seed.lng;
  let lat = seed.lat;
  let source = 'manual:wiki-approx';
  if (proj.distKm < 25) {
    lng = proj.lng;
    lat = proj.lat;
    source = `corridor:${seed.corridor}`;
  }
  if (geo[name]?.lng) {
    const src = String(geo[name].source || '');
    if (src.includes('corridor:') || src.startsWith('manual:wiki')) {
      geo[name] = { lng, lat, source };
      updated += 1;
      console.log('update', name, source, `${proj.distKm.toFixed(1)}km`);
    } else {
      console.log('keep', name, src);
    }
  } else {
    geo[name] = { lng, lat, source };
    added += 1;
    console.log('add', name, source, `${proj.distKm.toFixed(1)}km`);
  }
}

writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
console.log('done added', added, 'updated', updated, 'keys', Object.keys(geo).length);
