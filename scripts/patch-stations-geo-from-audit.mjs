/**
 * 根据 audit-stations-geo + OSM/wiki 对照，批量纠正错位站。
 *   node scripts/patch-stations-geo-from-audit.mjs
 *   node scripts/patch-stations-geo-from-audit.mjs --write
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const geoPath = join(root, 'data/stations-geo.json');
const logPath = join(root, 'docs/corridor-calibration-log.md');
const wantWrite = process.argv.includes('--write');

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

/** 已核对：OSM Overpass 或 zh.wikipedia 坐标 */
const FIXES = [
  // 郑阜：走廊 seed 整段反序钉错公里
  { name: '许昌北', lng: 113.92425, lat: 34.144447, source: 'osm:audit', note: 'zhengfu reverse-seed' },
  { name: '鄢陵南', lng: 114.134064, lat: 34.065302, source: 'wiki', note: 'wiki 鄢陵站（旧称鄢陵南）' },
  { name: '扶沟南', lng: 114.381253, lat: 33.997681, source: 'osm:audit' },
  { name: '西华', lng: 114.604579, lat: 33.795177, source: 'osm:audit' },
  // 周口东 OSM≈已有，跳过
  { name: '项城', lng: 114.885201, lat: 33.413903, source: 'osm:audit' },
  { name: '沈丘北', lng: 115.1016, lat: 33.424626, source: 'osm:audit' },
  { name: '界首南', lng: 115.319756, lat: 33.224466, source: 'osm:audit' },
  { name: '临泉', lng: 115.372013, lat: 33.024398, source: 'osm:audit' },

  // 海南西环：棋子湾/金月湾 钉错公里
  { name: '棋子湾', lng: 108.8044167, lat: 19.3389778, source: 'wiki', note: 'hainanxi' },
  { name: '金月湾', lng: 108.7122333, lat: 18.7802889, source: 'wiki', note: 'hainanxi' },
  { name: '银滩', lng: 109.485214, lat: 19.792036, source: 'osm:audit', note: 'hainanxi' },

  // 同名/飞点
  { name: '山阴南', lng: 112.832057, lat: 39.491682, source: 'osm:audit', note: 'was Jiangxi flyer' },
  { name: '玉山南', lng: 118.2880639, lat: 28.6499917, source: 'wiki', note: '沪昆；was hangchang flyer' },
  { name: '海阳', lng: 121.2846167, lat: 36.1214278, source: 'wiki', note: '莱荣；was Qinhuangdao homonym' },
  { name: '鹤壁', lng: 114.26732889, lat: 35.76007389, source: 'wiki', note: '京广；was zhengtai flyer' },

  // 宣威北：非铁路客运站（yukun 错钉宜宾附近）→ 钉到宣威站附近并标注，避免地图飞点
  { name: '宣威北', lng: 104.1170833, lat: 26.2109722, source: 'wiki:宣威-approx', note: 'no such HSR; snap near 宣威' },
];

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const changes = [];

for (const f of FIXES) {
  const prev = geo[f.name];
  if (!prev?.lng) {
    console.log(`ADD ${f.name} ${f.lng},${f.lat}`);
    if (wantWrite) {
      geo[f.name] = {
        name: f.name,
        lng: Number(f.lng.toFixed(6)),
        lat: Number(f.lat.toFixed(6)),
        source: f.source,
      };
    }
    changes.push(`add ${f.name}`);
    continue;
  }
  const d = haversine(prev, f);
  if (d < 1.5) {
    console.log(`SKIP ${f.name} Δ=${d.toFixed(2)}km already close`);
    continue;
  }
  console.log(
    `${wantWrite ? 'FIX' : 'DRY'} ${f.name} Δ=${d.toFixed(1)}km ` +
      `(${prev.lng.toFixed(4)},${prev.lat.toFixed(4)})→(${f.lng.toFixed(4)},${f.lat.toFixed(4)}) ` +
      `[${prev.source || '?'}→${f.source}] ${f.note || ''}`,
  );
  changes.push(`${f.name} ${d.toFixed(1)}km`);
  if (wantWrite) {
    geo[f.name] = {
      name: f.name,
      lng: Number(f.lng.toFixed(6)),
      lat: Number(f.lat.toFixed(6)),
      source: f.source,
      telecode: prev.telecode,
    };
  }
}

if (wantWrite && changes.length) {
  writeFileSync(geoPath, JSON.stringify(geo, null, 0));
  if (existsSync(logPath)) {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    appendFileSync(
      logPath,
      `| ${ts} | stations-geo | audit-fix | ${changes.join('; ')} |\n`,
    );
  }
  console.log(`\nWRITE ok changes=${changes.length}`);
} else {
  console.log(`\nMODE dry-run wouldChange=${changes.length} (pass --write)`);
}
