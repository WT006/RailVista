/**
 * Densify a single corridor's jumps.
 *   node scripts/_densify-one.mjs <id> [--write] [--max 8]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
const wantWrite = process.argv.includes('--write');
const maxJumpKeep = (() => {
  const i = process.argv.indexOf('--max');
  return i >= 0 ? Number(process.argv[i + 1]) : 8;
})();

if (!id) {
  console.error('usage: node scripts/_densify-one.mjs <id> [--write] [--max 8]');
  process.exit(1);
}

const path = join(__dirname, '../data/presets/corridors', `${id}.json`);
if (!existsSync(path)) {
  console.error('missing', path);
  process.exit(1);
}

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

function maxJump(coords) {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
    if (d > m) m = d;
  }
  return m;
}

function densify(coords, maxJumpKm, stepKm = 6) {
  const out = [coords[0]];
  let filled = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = out.at(-1);
    const b = coords[i];
    const d = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    if (d > maxJumpKm) {
      const n = Math.ceil(d / stepKm);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push([
          Number((a[0] + (b[0] - a[0]) * t).toFixed(6)),
          Number((a[1] + (b[1] - a[1]) * t).toFixed(6)),
        ]);
        filled += 1;
      }
    }
    out.push(b);
  }
  return { railway: out, filled };
}

const c = JSON.parse(readFileSync(path, 'utf8'));
const before = maxJump(c.railway);
const { railway, filled } = densify(c.railway, maxJumpKeep, 6);
const after = maxJump(railway);
console.log(`${id}: jump ${before.toFixed(1)}→${after.toFixed(1)} +${filled}pts`);
if (wantWrite) {
  c.railway = railway;
  const note = String(c.note || '');
  if (!note.includes('explicit gap densify')) {
    c.note = `${note} | explicit gap densify (source jump)`.trim().replace(/^\| /, '');
  }
  writeFileSync(path, JSON.stringify(c));
  console.log('written', path);
}
