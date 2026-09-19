/**
 * Seed wiki-approx OD/hint stations for P2/P3 corridors after extract.
 *   node scripts/_seed-p2-stations.mjs
 *   node scripts/_seed-p2-stations.mjs --only jingxiong,weilai
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const geoPath = join(__dirname, '../data/stations-geo.json');
const corrDir = join(__dirname, '../data/presets/corridors');

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0
    ? new Set(
        process.argv[i + 1]
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
})();

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

/** wiki / OSM approx WGS84 — project onto corridor if <25km */
const SEEDS = {
  花都: { lng: 113.21, lat: 23.392, corridor: 'guangqing' },
  狮岭: { lng: 113.155, lat: 23.46, corridor: 'guangqing' },
  银盏: { lng: 113.08, lat: 23.58, corridor: 'guangqing' },
  清城: { lng: 113.05, lat: 23.72, corridor: 'guangqing' },
  顺德北: { lng: 113.12, lat: 22.9, corridor: 'guangzhao' },
  三水北: { lng: 112.9, lat: 23.2, corridor: 'guangzhao' },
  肇庆东: { lng: 112.55, lat: 23.1, corridor: 'guangzhao' },
  亦庄: { lng: 116.507, lat: 39.795, corridor: 'jingbin' },
  永乐: { lng: 116.78, lat: 39.72, corridor: 'jingbin' },
  宝坻南: { lng: 117.3, lat: 39.68, corridor: 'jingbin' },
  北辰: { lng: 117.2, lat: 39.22, corridor: 'jingbin' },
  滨海西: { lng: 117.61, lat: 39.08, corridor: 'jingbin' },
  北京城市副中心: { lng: 116.72, lat: 39.902, corridor: 'jingtang' },
  燕郊: { lng: 116.82, lat: 39.95, corridor: 'jingtang' },
  大厂: { lng: 116.98, lat: 39.88, corridor: 'jingtang' },
  香河: { lng: 117.0, lat: 39.76, corridor: 'jingtang' },
  玉田南: { lng: 117.74, lat: 39.82, corridor: 'jingtang' },
  唐山西: { lng: 118.05, lat: 39.65, corridor: 'jingtang' },
  北京大兴: { lng: 116.34, lat: 39.67, corridor: 'jingxiong' },
  大兴机场: { lng: 116.41, lat: 39.51, corridor: 'jingxiong' },
  固安东: { lng: 116.3, lat: 39.4, corridor: 'jingxiong' },
  霸州北: { lng: 116.4, lat: 39.15, corridor: 'jingxiong' },
  雄安: { lng: 116.0, lat: 39.0, corridor: 'jingxiong' },
  昌邑: { lng: 119.4, lat: 36.86, corridor: 'weilai' },
  平度西: { lng: 119.85, lat: 36.82, corridor: 'weilai' },
  葛店南: { lng: 114.65, lat: 30.53, corridor: 'wugang' },
  华容南: { lng: 114.78, lat: 30.5, corridor: 'wugang' },
  黄冈东: { lng: 114.92, lat: 30.45, corridor: 'wugang' },
  汤逊湖: { lng: 114.35, lat: 30.42, corridor: 'wuxian' },
  纸坊东: { lng: 114.35, lat: 30.35, corridor: 'wuxian' },
  贺胜桥东: { lng: 114.35, lat: 30.1, corridor: 'wuxian' },
  咸宁东: { lng: 114.35, lat: 29.9, corridor: 'wuxian' },
  咸宁南: { lng: 114.32, lat: 29.84, corridor: 'wuxian' },
  天河机场: { lng: 114.21, lat: 30.77, corridor: 'wuxiao' },
  毛陈: { lng: 114.05, lat: 30.9, corridor: 'wuxiao' },
  孟庄: { lng: 113.82, lat: 34.65, corridor: 'zhengji' },
  新塘: { lng: 113.61, lat: 23.13, corridor: 'suishen' },
  东莞西: { lng: 113.7, lat: 23.05, corridor: 'suishen' },
  虎门东: { lng: 113.72, lat: 22.85, corridor: 'suishen' },
  深圳机场北: { lng: 113.82, lat: 22.65, corridor: 'suishen' },
  深圳机场: { lng: 113.81, lat: 22.62, corridor: 'suishen' },
  番禺: { lng: 113.36, lat: 22.94, corridor: 'guangzhoudonghuan' },
  广州长隆: { lng: 113.33, lat: 23.0, corridor: 'guangzhoudonghuan' },
  白云机场北: { lng: 113.3, lat: 23.39, corridor: 'guangzhoudonghuan' },
};

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const cache = new Map();
function loadCorr(id) {
  if (!cache.has(id)) {
    const p = join(corrDir, `${id}.json`);
    if (!existsSync(p)) return null;
    cache.set(id, JSON.parse(readFileSync(p, 'utf8')));
  }
  return cache.get(id);
}

let added = 0;
let updated = 0;
for (const [name, seed] of Object.entries(SEEDS)) {
  if (onlyArg && seed.corridor && !onlyArg.has(seed.corridor)) continue;
  const c = seed.corridor ? loadCorr(seed.corridor) : null;
  if (seed.corridor && !c?.railway?.length) {
    console.log('skip no-corridor', name, seed.corridor);
    continue;
  }
  let lng = seed.lng;
  let lat = seed.lat;
  let source = 'manual:wiki-approx';
  let distKm = null;
  if (c?.railway?.length) {
    const proj = project(c.railway, seed.lng, seed.lat);
    distKm = proj.distKm;
    if (proj.distKm < 25) {
      lng = proj.lng;
      lat = proj.lat;
      source = `corridor:${seed.corridor}`;
    } else {
      console.log('WARN far', name, proj.distKm.toFixed(1), 'km — keep wiki, no snap');
    }
  }
  if (geo[name]?.lng) {
    // only overwrite soft wiki seeds or empty; never clobber manual/timetable
    const src = String(geo[name].source || '');
    if (!src.includes('corridor:') && !src.startsWith('manual:wiki')) {
      console.log('keep existing', name, src);
      continue;
    }
    geo[name] = { lng, lat, source };
    updated += 1;
    console.log('update', name, source, distKm != null ? `${distKm.toFixed(1)}km` : '');
  } else {
    geo[name] = { lng, lat, source };
    added += 1;
    console.log('add', name, source, distKm != null ? `${distKm.toFixed(1)}km` : '');
  }
}

writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
console.log('done added', added, 'updated', updated);
