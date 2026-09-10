/**
 * Phase 2 corridor self-check: endpoints, backtrack spikes, stationsHint in geo, full-OD slice.
 * node scripts/verify-phase2-corridors.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corridorsDir = join(root, 'data/presets/corridors');
const geoPath = join(root, 'data/stations-geo.json');

const PHASE2 = [
  'qingrong',
  'xulian',
  'yantong',
  'huhang',
  'hangtai',
  'hangwen',
  'fuxia',
  'guangshengang',
  'huningyanjiang',
  'zhengyu',
  'chengyu',
];

/** Expected OD endpoints [fromApprox, toApprox] for smoke */
const EXPECT = {
  qingrong: { from: [120.33, 36.34], to: [122.40, 37.14], minKm: 200 },
  xulian: { from: [117.30, 34.25], to: [119.16, 34.61], minKm: 150 },
  yantong: { from: [120.18, 33.37], to: [120.76, 32.10], minKm: 120 },
  huhang: { from: [121.36, 31.10], to: [120.21, 30.29], minKm: 150 },
  hangtai: { from: [120.52, 30.10], to: [121.32, 28.49], minKm: 180 },
  hangwen: { from: [119.76, 29.85], to: [120.68, 28.07], minKm: 200 },
  fuxia: { from: [119.39, 25.99], to: [117.77, 24.48], minKm: 220 },
  guangshengang: { from: [113.27, 22.99], to: [114.16, 22.30], minKm: 100 },
  huningyanjiang: { from: [121.23, 31.50], to: [118.81, 31.98], minKm: 200 },
  zhengyu: { from: [113.77, 34.76], to: [106.57, 29.62], minKm: 800 },
  chengyu: { from: [104.12, 30.59], to: [106.46, 29.56], minKm: 250 },
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

/** Count points that retreat >4% progress toward dest */
function backtrackCount(coords) {
  if (coords.length < 3) return 0;
  const start = { lng: coords[0][0], lat: coords[0][1] };
  const dest = { lng: coords.at(-1)[0], lat: coords.at(-1)[1] };
  const startToDest = haversine(start, dest) || 1;
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

for (const id of PHASE2) {
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
  const exp = EXPECT[id];
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
  const missingHints = hints.filter((h) => {
    const n = String(h).replace(/站$/, '');
    return !geo[n]?.lng;
  });
  const firstHint = String(hints[0] || '').replace(/站$/, '');
  const lastHint = String(hints.at(-1) || '').replace(/站$/, '');

  const okStart = startD < 30;
  const okEnd = endD < 30;
  const okKm = km >= exp.minKm;
  const okBt = bt < railway.length * 0.08;
  const okHints = missingHints.length === 0;
  const okHintEnds = !!geo[firstHint] && !!geo[lastHint];

  const status =
    okStart && okEnd && okKm && okBt && okHints && okHintEnds ? 'OK' : 'FAIL';
  if (status === 'FAIL') failures += 1;

  console.log(
    `${status} ${id}: pts=${railway.length} km=${km.toFixed(0)} ` +
      `startD=${startD.toFixed(1)} endD=${endD.toFixed(1)} backtrack=${bt} ` +
      `hintsMissing=${missingHints.length ? missingHints.join(',') : 0}`,
  );
}

console.log(failures ? `\nFAILED ${failures}` : '\nALL PASS');
process.exit(failures ? 1 : 0);
