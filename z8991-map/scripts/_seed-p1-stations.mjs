/**
 * Seed wiki-approx coords for P1 OD/hint stations missing from stations-geo.
 *   node scripts/_seed-p1-stations.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
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

/** wiki / OSM approx WGS84 — only used when missing; prefer project onto corridor if <25km */
const SEEDS = {
  珠海: { lng: 113.5092, lat: 22.2075, corridor: 'guangzhu' },
  珠海北: { lng: 113.507, lat: 22.316, corridor: 'guangzhu' },
  明珠: { lng: 113.532, lat: 22.252, corridor: 'guangzhu' },
  十堰东: { lng: 110.748, lat: 32.671, corridor: 'hanshi' },
  天门南: { lng: 113.45, lat: 30.55, corridor: 'hanshi' },
  丹江口: { lng: 111.48, lat: 32.54, corridor: 'hanshi' },
  珲春: { lng: 130.366, lat: 42.863, corridor: 'changhui' },
  吉林: { lng: 126.586, lat: 43.857, corridor: 'changhui' },
  延吉西: { lng: 129.423, lat: 42.907, corridor: 'changhui' },
  宋城路: { lng: 114.28, lat: 34.784, corridor: 'zhengkai' },
  绿博园: { lng: 113.91, lat: 34.77, corridor: 'zhengkai' },
  广州东: { lng: 113.3246, lat: 23.1502, corridor: 'guangshenchengji' },
  深圳: { lng: 114.1126, lat: 22.5318, corridor: 'guangshenchengji' },
  东莞: { lng: 113.87, lat: 23.04, corridor: 'guangshenchengji' },
  常平: { lng: 114.0, lat: 22.98, corridor: 'guangshenchengji' },
  樟木头: { lng: 114.09, lat: 22.82, corridor: 'guangshenchengji' },
  眉山东: { lng: 103.881, lat: 30.076, corridor: 'chengmianle' },
  峨眉山: { lng: 103.484, lat: 29.599, corridor: 'chengmianle' },
};

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const cache = new Map();
function loadCorr(id) {
  if (!cache.has(id)) {
    cache.set(id, JSON.parse(readFileSync(join(corrDir, `${id}.json`), 'utf8')));
  }
  return cache.get(id);
}

let added = 0;
for (const [name, seed] of Object.entries(SEEDS)) {
  if (geo[name]?.lng) {
    console.log('skip existing', name);
    continue;
  }
  let lng = seed.lng;
  let lat = seed.lat;
  let source = 'manual:wiki-approx';
  if (seed.corridor) {
    const c = loadCorr(seed.corridor);
    const proj = project(c.railway, seed.lng, seed.lat);
    if (proj.distKm < 25) {
      lng = proj.lng;
      lat = proj.lat;
      source = `corridor:${seed.corridor}`;
      console.log(
        'add',
        name,
        lng.toFixed(4),
        lat.toFixed(4),
        `proj ${proj.distKm.toFixed(1)}km from wiki`,
      );
    } else {
      console.log(
        'add',
        name,
        lng.toFixed(4),
        lat.toFixed(4),
        `wiki only (proj ${proj.distKm.toFixed(1)}km too far)`,
      );
    }
  } else {
    console.log('add', name, lng, lat);
  }
  geo[name] = { name, lng, lat, source };
  added += 1;
}

writeFileSync(geoPath, JSON.stringify(geo));
console.log('added', added);
