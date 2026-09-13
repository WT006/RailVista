/**
 * 走廊折线清洗：去尖刺 / 折返 / 微点，并全库扫描分级。
 *
 *   node scripts/clean-corridors.mjs              # dry-run 报告
 *   node scripts/clean-corridors.mjs --write       # 写回改进的走廊
 *   node scripts/clean-corridors.mjs --write --id hanghuang
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, '../data/presets/corridors');
const wantWrite = process.argv.includes('--write');
const onlyId = (() => {
  const i = process.argv.indexOf('--id');
  return i >= 0 ? process.argv[i + 1] : null;
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

function turnDeg(a, b, c) {
  const ab = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
  const bc = haversine({ lng: b[0], lat: b[1] }, { lng: c[0], lat: c[1] });
  if (ab < 0.25 || bc < 0.25) return 0;
  const b1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const b2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let deg = Math.abs(b2 - b1) * (180 / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

function metrics(railway) {
  if (!railway || railway.length < 2) return null;
  let lengthKm = 0;
  let maxJump = 0;
  for (let i = 1; i < railway.length; i++) {
    const d = haversine(
      { lng: railway[i - 1][0], lat: railway[i - 1][1] },
      { lng: railway[i][0], lat: railway[i][1] },
    );
    lengthKm += d;
    if (d > maxJump) maxJump = d;
  }
  let sharpTurns = 0;
  let maxTurn = 0;
  for (let i = 1; i < railway.length - 1; i++) {
    const deg = turnDeg(railway[i - 1], railway[i], railway[i + 1]);
    if (deg > maxTurn) maxTurn = deg;
    if (deg >= 150) sharpTurns += 1;
  }
  const start = { lng: railway[0][0], lat: railway[0][1] };
  const end = { lng: railway.at(-1)[0], lat: railway.at(-1)[1] };
  const chord = haversine(start, end) || 1;
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
  return { pts: railway.length, lengthKm, maxJump, sharpTurns, maxTurn, backtracks, tier };
}

/** 删 ≥turnDeg 尖刺（短路绕行） */
function removeSpikes(coords, turnThreshold = 145) {
  let out = coords.map((c) => [...c]);
  for (let pass = 0; pass < 80; pass++) {
    let changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1];
      const b = out[i];
      const c = out[i + 1];
      const ab = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
      const bc = haversine({ lng: b[0], lat: b[1] }, { lng: c[0], lat: c[1] });
      const ac = haversine({ lng: a[0], lat: a[1] }, { lng: c[0], lat: c[1] });
      if (ab < 0.08 || bc < 0.08) continue;
      const deg = turnDeg(a, b, c);
      if (deg >= turnThreshold && ac < Math.max(ab, bc) * 1.08) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return out;
}

/** 相对终点单调前进，丢掉明显折返点（保留端点） */
function removeBacktracks(coords) {
  if (coords.length < 4) return coords;
  const end = { lng: coords.at(-1)[0], lat: coords.at(-1)[1] };
  const start = { lng: coords[0][0], lat: coords[0][1] };
  const startToDest = haversine(start, end) || 1;
  const cleaned = [coords[0]];
  let maxProg = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const prog = 1 - haversine({ lng: coords[i][0], lat: coords[i][1] }, end) / startToDest;
    if (prog >= maxProg - 0.006) {
      cleaned.push(coords[i]);
      maxProg = Math.max(maxProg, prog);
    }
  }
  cleaned.push(coords.at(-1));
  return cleaned.length >= 2 ? cleaned : coords;
}

function simplify(coords, minKm = 0.35) {
  if (coords.length < 3) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const p = out.at(-1);
    if (haversine({ lng: p[0], lat: p[1] }, { lng: coords[i][0], lat: coords[i][1] }) >= minKm) {
      out.push(coords[i]);
    }
  }
  out.push(coords.at(-1));
  return out;
}

/** 去掉横向凸出（V 形尖角，转角未必 ≥150°） */
function removeProtrusions(coords, minLatKm = 2.0, minDetourKm = 2.5) {
  let out = coords.map((c) => [...c]);
  for (let pass = 0; pass < 60; pass++) {
    let changed = false;
    for (let i = 2; i < out.length - 2; i++) {
      for (const w of [1, 2, 3, 4]) {
        if (i - w < 0 || i + w >= out.length) continue;
        const a = { lng: out[i - w][0], lat: out[i - w][1] };
        const b = { lng: out[i][0], lat: out[i][1] };
        const c = { lng: out[i + w][0], lat: out[i + w][1] };
        const ab = haversine(a, b);
        const bc = haversine(b, c);
        const ac = haversine(a, c) || 1e-6;
        const s = (ab + bc + ac) / 2;
        const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ac)));
        const latD = (2 * area) / ac;
        const detour = ab + bc - ac;
        if (latD >= minLatKm && detour >= minDetourKm) {
          out.splice(i, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
    if (!changed) break;
  }
  return out;
}

function fillJumps(coords, maxJumpKm = 12) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = out.at(-1);
    const b = coords[i];
    const d = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    if (d > maxJumpKm) {
      const n = Math.max(2, Math.ceil(d / 6));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push([
          Number((a[0] + (b[0] - a[0]) * t).toFixed(6)),
          Number((a[1] + (b[1] - a[1]) * t).toFixed(6)),
        ]);
      }
    }
    out.push(b);
  }
  return out;
}

function cleanRailway(railway) {
  let out = railway.map((c) => [Number(c[0]), Number(c[1])]);
  const before = metrics(out);
  out = removeSpikes(out, 145);
  out = removeProtrusions(out, 2.0, 2.5);
  out = removeBacktracks(out);
  out = removeSpikes(out, 150);
  out = removeProtrusions(out, 2.2, 3.0);
  out = simplify(out, 0.35);
  out = fillJumps(out, 15);
  out = simplify(out, 0.35);
  out = out.map((c) => [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))]);
  const after = metrics(out);
  // 清洗后若里程掉太多且折返未改善，拒绝；折返大幅下降时允许里程收缩（去掉折返虚增）
  const backtrackFixed =
    after && before && after.backtracks <= Math.max(3, before.backtracks * 0.35);
  const badShrink =
    after &&
    before &&
    after.lengthKm < before.lengthKm * 0.75 &&
    !backtrackFixed;
  const improved =
    after &&
    before &&
    !badShrink &&
    (after.sharpTurns < before.sharpTurns ||
      after.backtracks < before.backtracks ||
      (after.tier !== before.tier &&
        ['ok', 'light', 'medium', 'heavy'].indexOf(after.tier) <
          ['ok', 'light', 'medium', 'heavy'].indexOf(before.tier)));
  return { railway: out, before, after, improved, badShrink };
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const summary = { ok: 0, light: 0, medium: 0, heavy: 0, written: 0, skipped: 0, rejected: 0 };
const rows = [];

for (const f of files) {
  const path = join(dir, f);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const id = raw.id || f.replace(/\.json$/, '');
  if (onlyId && id !== onlyId) continue;
  if (!raw.railway?.length) continue;

  const result = cleanRailway(raw.railway);
  const { before, after, improved, badShrink } = result;
  rows.push({ id, before, after, improved, badShrink });
  summary[after.tier] = (summary[after.tier] || 0) + 1;

  if (wantWrite && improved && !badShrink) {
    raw.railway = result.railway;
    raw.note = `${raw.note || ''} | cleaned spikes/backtracks`.trim();
    writeFileSync(path, JSON.stringify(raw));
    summary.written += 1;
  } else if (wantWrite && badShrink) {
    summary.rejected += 1;
  } else if (wantWrite) {
    summary.skipped += 1;
  }
}

rows.sort(
  (a, b) =>
    (b.after?.sharpTurns || 0) - (a.after?.sharpTurns || 0) ||
    (b.after?.backtracks || 0) - (a.after?.backtracks || 0),
);

console.log(
  wantWrite ? 'MODE write' : 'MODE dry-run',
  onlyId ? `id=${onlyId}` : `n=${rows.length}`,
);
console.log(
  'after tiers:',
  `ok=${summary.ok} light=${summary.light} medium=${summary.medium} heavy=${summary.heavy}`,
);
if (wantWrite) {
  console.log(`written=${summary.written} skipped=${summary.skipped} rejectedShrink=${summary.rejected}`);
}

console.log('\n--- still heavy/medium (after clean) ---');
for (const r of rows.filter((x) => x.after?.tier === 'heavy' || x.after?.tier === 'medium')) {
  const b = r.before;
  const a = r.after;
  console.log(
    `${r.id.padEnd(16)} ${b.tier}->${a.tier} turn ${b.sharpTurns}->${a.sharpTurns} bt ${b.backtracks}->${a.backtracks} jump ${b.maxJump.toFixed(0)}->${a.maxJump.toFixed(0)}${r.improved ? ' *' : ''}${r.badShrink ? ' REJECT' : ''}`,
  );
}
