/**
 * Phase 3 corridor self-check
 * node scripts/verify-phase3-corridors.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corridorsDir = join(__dirname, '../data/presets/corridors');
const geoPath = join(__dirname, '../data/stations-geo.json');

const PHASE3 = {
  ninghang: { from: [118.84, 31.98], to: [120.20, 30.31], minKm: 200 },
  hefu: { from: [117.25, 32.07], to: [119.30, 26.12], minKm: 800 },
  hangchang: { from: [120.31, 30.12], to: [116.02, 28.63], minKm: 500 },
  daxi: { from: [113.15, 39.79], to: [108.93, 34.38], minKm: 700 },
  xicheng: { from: [108.93, 34.38], to: [104.14, 30.64], minKm: 550 },
  yinxi: { from: [106.25, 37.99], to: [108.76, 34.39], minKm: 450 },
  // 北端起河东机场，南端接到兰州西（源数据银兰末端距徐兰约 36km，走廊已桥接）
  yinlan: { from: [106.29, 38.10], to: [103.75, 36.07], minKm: 380 },
  guiguang: { from: [107.00, 26.47], to: [113.26, 23.00], minKm: 800 },
  guinan: { from: [106.98, 26.47], to: [108.39, 22.85], minKm: 400 },
  nankun: { from: [108.31, 22.83], to: [102.86, 24.87], minKm: 600 },
  zhengtai: { from: [113.60, 34.83], to: [112.66, 37.75], minKm: 350 },
  rilan: { from: [119.42, 35.39], to: [114.83, 34.77], minKm: 400 },
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

function backtrackCount(coords) {
  if (coords.length < 3) return 0;
  const dest = { lng: coords.at(-1)[0], lat: coords.at(-1)[1] };
  const startToDest = haversine({ lng: coords[0][0], lat: coords[0][1] }, dest) || 1;
  let maxProg = 0;
  let bad = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const prog = 1 - haversine({ lng: coords[i][0], lat: coords[i][1] }, dest) / startToDest;
    if (prog < maxProg - 0.004) bad += 1;
    maxProg = Math.max(maxProg, prog);
  }
  return bad;
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
let failures = 0;

for (const [id, exp] of Object.entries(PHASE3)) {
  const path = join(corridorsDir, `${id}.json`);
  if (!existsSync(path)) {
    console.error('MISSING', id);
    failures += 1;
    continue;
  }
  const c = JSON.parse(readFileSync(path, 'utf8'));
  const railway = c.railway || [];
  const hints = c.stationsHint || [];
  const km = lineKm(railway);
  const start = railway[0];
  const end = railway.at(-1);
  const startD = haversine(
    { lng: start[0], lat: start[1] },
    { lng: exp.from[0], lat: exp.from[1] },
  );
  const endD = haversine(
    { lng: end[0], lat: end[1] },
    { lng: exp.to[0], lat: exp.to[1] },
  );
  const bt = backtrackCount(railway);
  const missingHints = hints.filter((h) => !geo[String(h).replace(/站$/, '')]?.lng);
  const ok =
    startD < 30 &&
    endD < 30 &&
    km >= exp.minKm &&
    bt < railway.length * 0.08 &&
    missingHints.length === 0;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'OK' : 'FAIL'} ${id}: pts=${railway.length} km=${km.toFixed(0)} ` +
      `startD=${startD.toFixed(1)} endD=${endD.toFixed(1)} backtrack=${bt} ` +
      `hintsMissing=${missingHints.length || 0}`,
  );
}

console.log(failures ? `\nFAILED ${failures}` : '\nALL PASS');
process.exit(failures ? 1 : 0);
