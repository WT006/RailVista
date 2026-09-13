/**
 * 风景线第四～七期走廊自检（端点里程、最短长度）
 * node scripts/verify-scenic-phases.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corridorsDir = join(__dirname, '../data/presets/corridors');

const EXPECT = {
  // phase4
  zhangjihuai: { minKm: 200, maxKm: 350 },
  lanxin: { minKm: 1500, maxKm: 3200 },
  xiashen: { minKm: 400, maxKm: 1000 },
  hamu: { minKm: 250, maxKm: 550 },
  chenggui: { minKm: 500, maxKm: 1000 },
  yugui: { minKm: 280, maxKm: 500 },
  hainandong: { minKm: 250, maxKm: 450 },
  // phase5
  heruo: { minKm: 700, maxKm: 1100 },
  baocheng: { minKm: 500, maxKm: 1200 },
  chengkun: { minKm: 800, maxKm: 1800 },
  nanjiang: { minKm: 1100, maxKm: 2200 },
  jitong: { minKm: 800, maxKm: 1400 },
  lari: { minKm: 140, maxKm: 400 },
  lanyu: { minKm: 450, maxKm: 1500 },
  // phase6
  hanghuang: { minKm: 200, maxKm: 320 },
  chihuang: { minKm: 90, maxKm: 180 },
  fuping: { minKm: 60, maxKm: 120 },
  chuanqing: { minKm: 250, maxKm: 450 },
  lalin: { minKm: 350, maxKm: 500 },
  dunge: { minKm: 450, maxKm: 700 },
  yiwan: { minKm: 280, maxKm: 420 },
  dunbai: { minKm: 90, maxKm: 160 },
  zhanghu: { minKm: 220, maxKm: 350 },
  jingzhang: { minKm: 130, maxKm: 220 },
  // phase7
  geku: { minKm: 800, maxKm: 1300 },
  yuli: { minKm: 200, maxKm: 320 },
  zhonglao: { minKm: 450, maxKm: 650 },
  hainanxi: { minKm: 250, maxKm: 420 },
  xiangqian: { minKm: 550, maxKm: 850 },
  linha: { minKm: 700, maxKm: 1100 },
  diandong: { minKm: 250, maxKm: 420 },
};

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

function lineKm(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) {
    s += haversine(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
  }
  return s;
}

let failures = 0;
for (const [id, exp] of Object.entries(EXPECT)) {
  const path = join(corridorsDir, `${id}.json`);
  if (!existsSync(path)) {
    console.error('MISSING', id);
    failures += 1;
    continue;
  }
  const c = JSON.parse(readFileSync(path, 'utf8'));
  const railway = c.railway || [];
  const km = lineKm(railway);
  const ok = railway.length >= 2 && km >= exp.minKm && km <= exp.maxKm;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'OK' : 'FAIL'} ${id}: pts=${railway.length} km=${km.toFixed(0)} source=${c.source}`,
  );
}

console.log(failures ? `\nFAILED ${failures}` : '\nALL PASS');
process.exit(failures ? 1 : 0);
