/**
 * 一期收尾：对「仅因 maxJump>8 而 light」的走廊做显式断口加密并写 note。
 * 不静默冒充（note 标明）；有尖刺/折返的不在此处理。
 *
 *   node scripts/densify-corridor-jumps.mjs
 *   node scripts/densify-corridor-jumps.mjs --write
 *   node scripts/densify-corridor-jumps.mjs --write --max 8
 */
import { readFileSync, writeFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, '../data/presets/corridors');
const logPath = join(__dirname, '../docs/corridor-calibration-log.md');
const wantWrite = process.argv.includes('--write');
const maxJumpKeep = (() => {
  const i = process.argv.indexOf('--max');
  return i >= 0 ? Number(process.argv[i + 1]) : 8;
})();

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

function metrics(railway) {
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

function logRow(id, result) {
  if (!existsSync(logPath)) return;
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  appendFileSync(logPath, `| ${ts} | ${id} | densify-jumps | ${result} |\n`);
}

const files = readdirSync(dir).filter(
  (f) => f.endsWith('.json') && !f.startsWith('_') && !f.includes('__'),
);
let n = 0;
for (const f of files) {
  const path = join(dir, f);
  const c = JSON.parse(readFileSync(path, 'utf8'));
  if (!c.railway?.length) continue;
  const before = metrics(c.railway);
  // 只处理：无尖刺、折返很少、maxJump 超阈值
  if (before.sharpTurns > 0 || before.backtracks >= 3) continue;
  if (before.maxJump <= maxJumpKeep) continue;

  const { railway, filled } = densify(c.railway, maxJumpKeep, 6);
  const after = metrics(railway);
  const msg = `jump ${before.maxJump.toFixed(1)}→${after.maxJump.toFixed(1)} +${filled}pts ${before.tier}→${after.tier}`;
  console.log(`${wantWrite ? 'WRITE' : 'DRY'} ${c.id || f}: ${msg}`);
  if (wantWrite) {
    c.railway = railway;
    const note = String(c.note || '');
    if (!note.includes('explicit gap densify')) {
      c.note = `${note} | explicit gap densify (source jump)`.trim();
    }
    writeFileSync(path, JSON.stringify(c));
    logRow(c.id || f.replace(/\.json$/, ''), msg);
    n += 1;
  }
}
console.log(`\nMODE ${wantWrite ? 'write' : 'dry-run'} written=${n}`);
