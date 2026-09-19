/**
 * Verify only listed corridor ids (ignore old debt).
 *   node scripts/_verify-ids.mjs id1,id2,...
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ids = (process.argv[2] || '')
  .split(/[,，]/)
  .map((s) => s.trim())
  .filter(Boolean);
const geo = JSON.parse(readFileSync(join(__dirname, '../data/stations-geo.json'), 'utf8'));

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

function analyze(railway) {
  let lengthKm = 0;
  let maxJump = 0;
  let sharpTurns = 0;
  for (let i = 1; i < railway.length; i++) {
    const d = haversine(
      { lng: railway[i - 1][0], lat: railway[i - 1][1] },
      { lng: railway[i][0], lat: railway[i][1] },
    );
    lengthKm += d;
    if (d > maxJump) maxJump = d;
  }
  for (let i = 1; i < railway.length - 1; i++) {
    const a = railway[i - 1];
    const b = railway[i];
    const c = railway[i + 1];
    const ab = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    const bc = haversine({ lng: b[0], lat: b[1] }, { lng: c[0], lat: c[1] });
    if (ab < 0.25 || bc < 0.25) continue;
    let deg =
      Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) *
      (180 / Math.PI);
    if (deg > 180) deg = 360 - deg;
    if (deg >= 150) sharpTurns += 1;
  }
  let tier = 'ok';
  if (sharpTurns >= 30 || maxJump > 40) tier = 'heavy';
  else if (sharpTurns >= 8 || maxJump > 15) tier = 'medium';
  else if (sharpTurns >= 1 || maxJump > 10) tier = 'light';
  return { lengthKm, maxJump, sharpTurns, tier };
}

function nearestDist(pt, railway) {
  let best = Infinity;
  for (const p of railway) {
    const d = haversine(pt, { lng: p[0], lat: p[1] });
    if (d < best) best = d;
  }
  return best;
}

let fail = 0;
for (const id of ids) {
  const path = join(__dirname, '../data/presets/corridors', `${id}.json`);
  if (!existsSync(path)) {
    console.log('MISSING', id);
    fail += 1;
    continue;
  }
  const c = JSON.parse(readFileSync(path, 'utf8'));
  const a = analyze(c.railway);
  const hints = c.stationsHint || [];
  const known = [];
  for (const name of hints) {
    const s = geo[name];
    if (!s?.lng) continue;
    known.push({ name, dist: nearestDist({ lng: s.lng, lat: s.lat }, c.railway) });
  }
  const from = geo[hints[0]];
  const to = geo[hints.at(-1)];
  let od = '?';
  if (from && to) {
    const s0 = { lng: c.railway[0][0], lat: c.railway[0][1] };
    const s1 = { lng: c.railway.at(-1)[0], lat: c.railway.at(-1)[1] };
    const d0 = haversine(s0, from);
    const d1 = haversine(s1, to);
    const d0r = haversine(s0, to);
    const d1r = haversine(s1, from);
    od =
      d0 + d1 <= d0r + d1r
        ? `${d0.toFixed(1)}/${d1.toFixed(1)}`
        : `${d0r.toFixed(1)}/${d1r.toFixed(1)}`;
  }
  const over2 = known.filter((x) => x.dist > 2).length;
  const bad =
    a.tier === 'heavy' ||
    a.tier === 'medium' ||
    (from && to && (Number(od.split('/')[0]) > 5 || Number(od.split('/')[1]) > 5));
  if (bad) fail += 1;
  console.log(
    `${bad ? 'FAIL' : 'PASS'} ${id} tier=${a.tier} jump=${a.maxJump.toFixed(1)} sharp=${a.sharpTurns} km=${a.lengthKm.toFixed(0)} od=${od} over2=${over2}/${known.length}`,
  );
}
process.exit(fail ? 1 : 0);
