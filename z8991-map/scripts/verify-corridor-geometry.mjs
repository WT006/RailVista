/**
 * 走廊几何质量门禁：尖刺 / 折返 / 大跳 + stationsHint 投影距离。
 *   node scripts/verify-corridor-geometry.mjs
 *   node scripts/verify-corridor-geometry.mjs --strict   # medium 也失败；站距超标也失败
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, '../data/presets/corridors');
const geoPath = join(__dirname, '../data/stations-geo.json');
const strict = process.argv.includes('--strict');

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
  const end = { lng: railway.at(-1)[0], lat: railway.at(-1)[1] };
  const chord = haversine({ lng: railway[0][0], lat: railway[0][1] }, end) || 1;
  let maxProg = 0;
  let backtracks = 0;
  for (const p of railway) {
    const prog = 1 - haversine({ lng: p[0], lat: p[1] }, end) / chord;
    if (prog < maxProg - 0.01) backtracks += 1;
    maxProg = Math.max(maxProg, prog);
  }
  let tier = 'ok';
  if (sharpTurns >= 30 || backtracks >= 40 || maxJump > 40) tier = 'heavy';
  else if (sharpTurns >= 8 || backtracks >= 10 || maxJump > 15) tier = 'medium';
  else if (sharpTurns >= 1 || backtracks >= 3 || maxJump > 10) tier = 'light';
  return { lengthKm, maxJump, sharpTurns, backtracks, tier };
}

function nearestDist(pt, railway) {
  let best = Infinity;
  for (const p of railway) {
    const d = haversine(pt, { lng: p[0], lat: p[1] });
    if (d < best) best = d;
  }
  return best;
}

function lookupStation(geo, name) {
  if (!name) return null;
  return geo[name] || geo[`${name}站`] || geo[name.replace(/站$/, '')] || null;
}

function stationStats(c, geo) {
  const hints = c.stationsHint || [];
  if (hints.length < 2 || !c.railway?.length) {
    return { ok: true, skip: true, reason: 'no-hints' };
  }
  const known = [];
  let miss = 0;
  for (const name of hints) {
    const s = lookupStation(geo, name);
    if (!s?.lng || !s?.lat) {
      miss += 1;
      continue;
    }
    known.push({ name, dist: nearestDist({ lng: s.lng, lat: s.lat }, c.railway) });
  }
  if (!known.length) return { ok: true, skip: true, reason: 'no-known-geo', miss };

  const from = lookupStation(geo, hints[0]);
  const to = lookupStation(geo, hints.at(-1));
  let odStart = null;
  let odEnd = null;
  if (from && to) {
    const s0 = { lng: c.railway[0][0], lat: c.railway[0][1] };
    const s1 = { lng: c.railway.at(-1)[0], lat: c.railway.at(-1)[1] };
    const d0 = haversine(s0, from);
    const d1 = haversine(s1, to);
    const d0r = haversine(s0, to);
    const d1r = haversine(s1, from);
    if (d0 + d1 <= d0r + d1r) {
      odStart = d0;
      odEnd = d1;
    } else {
      odStart = d0r;
      odEnd = d1r;
    }
  }

  const over2 = known.filter((x) => x.dist > 2).length;
  const over5 = known.filter((x) => x.dist > 5).length;
  const majorityBad = known.length >= 3 && over2 > known.length / 2;
  const odBad = (odStart != null && odStart > 5) || (odEnd != null && odEnd > 5);
  return {
    ok: !odBad && !majorityBad,
    skip: false,
    miss,
    known: known.length,
    over2,
    over5,
    odStart,
    odEnd,
    odBad,
    majorityBad,
    worst: known.slice().sort((a, b) => b.dist - a.dist).slice(0, 3),
  };
}

const geo = existsSync(geoPath) ? JSON.parse(readFileSync(geoPath, 'utf8')) : {};
const files = readdirSync(dir).filter(
  (f) => f.endsWith('.json') && !f.startsWith('_') && !f.includes('__'),
);
const counts = { ok: 0, light: 0, medium: 0, heavy: 0 };
const bad = [];
const stationFails = [];

for (const f of files) {
  const c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (!c.railway?.length) continue;
  const a = analyze(c.railway);
  counts[a.tier] += 1;
  const id = c.id || f.replace(/\.json$/, '');
  if (a.tier === 'heavy' || a.tier === 'medium') {
    bad.push({ id, ...a });
    console.log(
      `WARN ${id}: tier=${a.tier} sharp=${a.sharpTurns} bt=${a.backtracks} jump=${a.maxJump.toFixed(1)} km=${a.lengthKm.toFixed(0)}`,
    );
  }

  const st = stationStats(c, geo);
  if (!st.skip && !st.ok) {
    stationFails.push({ id, ...st });
    const od =
      st.odStart != null
        ? `od=${st.odStart.toFixed(1)}/${st.odEnd.toFixed(1)}`
        : 'od=?';
    console.log(
      `STATION ${id}: ${od} over2=${st.over2}/${st.known} over5=${st.over5} miss=${st.miss} worst=${st.worst
        .map((w) => `${w.name}:${w.dist.toFixed(1)}`)
        .join('|')}`,
    );
  }
}

console.log(
  `\nSUMMARY ok=${counts.ok} light=${counts.light} medium=${counts.medium} heavy=${counts.heavy} stationFail=${stationFails.length}`,
);

const failGeom = strict ? bad : bad.filter((x) => x.tier === 'heavy');
const failStation = strict ? stationFails : [];
if (failGeom.length || failStation.length) {
  console.log(
    `\nFAILED geom=${failGeom.length} (heavy${strict ? '+medium' : ''}) station=${failStation.length}`,
  );
  process.exit(1);
}
console.log('\nPASS');
process.exit(0);
