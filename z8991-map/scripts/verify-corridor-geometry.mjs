/**
 * 走廊几何质量门禁：尖刺 / 折返 / 大跳。
 *   node scripts/verify-corridor-geometry.mjs
 *   node scripts/verify-corridor-geometry.mjs --strict   # heavy 也失败
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, '../data/presets/corridors');
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
  const chord =
    haversine({ lng: railway[0][0], lat: railway[0][1] }, end) || 1;
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

const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const counts = { ok: 0, light: 0, medium: 0, heavy: 0 };
const bad = [];
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
}

console.log(
  `\nSUMMARY ok=${counts.ok} light=${counts.light} medium=${counts.medium} heavy=${counts.heavy}`,
);

const fail = strict
  ? bad
  : bad.filter((x) => x.tier === 'heavy');
if (fail.length) {
  console.log(`\nFAILED ${fail.length} (heavy${strict ? '+medium' : ''})`);
  process.exit(1);
}
console.log('\nPASS');
process.exit(0);
