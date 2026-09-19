/**
 * 用本地 china-hsr.graph 桥接走廊折线中的大跳断口。
 *   node scripts/bridge-corridor-gaps-local.mjs --id anjiu --max 8
 *   node scripts/bridge-corridor-gaps-local.mjs --id anjiu,changgan,ganshen --write
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
const graphPath = join(root, 'data/rails/china-hsr.graph');

const wantWrite = process.argv.includes('--write');
const maxJump = (() => {
  const i = process.argv.indexOf('--max');
  return i >= 0 ? Number(process.argv[i + 1]) : 8;
})();
const ids = (() => {
  const i = process.argv.indexOf('--id');
  if (i < 0) return [];
  return process.argv[i + 1]
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
})();
if (!ids.length) {
  console.error('usage: node scripts/bridge-corridor-gaps-local.mjs --id a,b --write');
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
function dist(a, b) {
  return Math.hypot(a.lng - b.lng, a.lat - b.lat);
}

/** Minimal local stitch between two points using graph ways near chord */
function loadWays() {
  const g = JSON.parse(readFileSync(graphPath, 'utf8'));
  return (g.ways || [])
    .map((w, i) => {
      const points = (w.points || [])
        .map((p) =>
          Array.isArray(p) ? { lng: p[0], lat: p[1] } : { lng: p.lng, lat: p.lat },
        )
        .filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat));
      if (points.length < 2) return null;
      let minLng = Infinity,
        minLat = Infinity,
        maxLng = -Infinity,
        maxLat = -Infinity;
      for (const p of points) {
        minLng = Math.min(minLng, p.lng);
        minLat = Math.min(minLat, p.lat);
        maxLng = Math.max(maxLng, p.lng);
        maxLat = Math.max(maxLat, p.lat);
      }
      return { id: w.id ?? i, name: w.name, points, bbox: { minLng, minLat, maxLng, maxLat } };
    })
    .filter(Boolean);
}

function chordDistKm(p, a, b) {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy || 1e-12;
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return haversine(p, { lng: a.lng + dx * t, lat: a.lat + dy * t });
}

function stitchGap(from, to, allWays) {
  const odKm = haversine(from, to) || 1;
  const maxLat = Math.min(40, Math.max(8, odKm * 0.12));
  const pad = Math.max(0.08, Math.min(0.35, odKm / 500));
  const minLng = Math.min(from.lng, to.lng) - pad;
  const maxLng = Math.max(from.lng, to.lng) + pad;
  const minLat = Math.min(from.lat, to.lat) - pad;
  const maxLatB = Math.max(from.lat, to.lat) + pad;
  const pool = allWays.filter((w) => {
    if (w.bbox.maxLng < minLng || w.bbox.minLng > maxLng) return false;
    if (w.bbox.maxLat < minLat || w.bbox.minLat > maxLatB) return false;
    const mid = w.points[Math.floor(w.points.length / 2)];
    return chordDistKm(mid, from, to) <= maxLat;
  });
  if (pool.length < 1) return null;

  // Greedy: start near from, always pick next segment that advances toward to
  const segs = pool.map((w) => ({ pts: w.points, used: false }));
  let startIdx = -1,
    startRev = false,
    bestD = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const d0 = dist(from, s.pts[0]);
    const d1 = dist(from, s.pts.at(-1));
    if (d0 < bestD) {
      bestD = d0;
      startIdx = i;
      startRev = false;
    }
    if (d1 < bestD) {
      bestD = d1;
      startIdx = i;
      startRev = true;
    }
  }
  if (startIdx < 0 || bestD > 0.35) return null;

  let line = startRev ? [...segs[startIdx].pts].reverse() : [...segs[startIdx].pts];
  segs[startIdx].used = true;
  const bridgeMax = odKm > 50 ? 1.2 : 0.6;
  for (let guard = 0; guard < 4000; guard++) {
    const tail = line.at(-1);
    if (haversine(tail, to) < 1.5) break;
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].used) continue;
      for (const rev of [false, true]) {
        const pts = rev ? [...segs[i].pts].reverse() : segs[i].pts;
        const dJoin = dist(tail, pts[0]);
        if (dJoin > bridgeMax) continue;
        const tip = pts.at(-1);
        const gain = haversine(tail, to) - haversine(tip, to);
        if (gain < -2) continue;
        const score = dJoin * 100 - gain * 10 + chordDistKm(tip, from, to);
        if (!best || score < best.score) best = { i, pts, score };
      }
    }
    if (!best) break;
    segs[best.i].used = true;
    line = line.concat(best.pts.slice(1));
  }
  if (haversine(line.at(-1), to) > 8) return null;
  // snap ends
  if (dist(line[0], from) > 0.0005) line = [from, ...line];
  if (dist(line.at(-1), to) > 0.0005) line = [...line, to];
  return line;
}

function densifyLinear(a, b, stepKm = 6) {
  const d = haversine(a, b);
  const n = Math.max(2, Math.ceil(d / stepKm));
  const out = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    out.push({
      lng: a.lng + (b.lng - a.lng) * t,
      lat: a.lat + (b.lat - a.lat) * t,
    });
  }
  return out;
}

if (!existsSync(graphPath)) {
  console.error('missing', graphPath);
  process.exit(1);
}
const allWays = loadWays();
console.log('hsr ways', allWays.length);

for (const id of ids) {
  const path = join(corrDir, `${id}.json`);
  if (!existsSync(path)) {
    console.warn('skip missing', id);
    continue;
  }
  const c = JSON.parse(readFileSync(path, 'utf8'));
  const railway = c.railway.map(([lng, lat]) => ({ lng, lat }));
  const out = [railway[0]];
  let bridged = 0;
  let densified = 0;
  for (let i = 1; i < railway.length; i++) {
    const a = out.at(-1);
    const b = railway[i];
    const d = haversine(a, b);
    if (d <= maxJump) {
      out.push(b);
      continue;
    }
    console.log(`  ${id} gap ${d.toFixed(1)}km @${i - 1}→${i}`);
    const pathPts = stitchGap(a, b, allWays);
    if (pathPts && pathPts.length >= 2) {
      // drop first (already have a), keep rest
      for (let j = 1; j < pathPts.length; j++) out.push(pathPts[j]);
      // ensure land on b
      if (dist(out.at(-1), b) > 0.001) out.push(b);
      bridged += 1;
      console.log(`    bridged local pts=${pathPts.length}`);
    } else {
      const mid = densifyLinear(a, b, 6);
      out.push(...mid, b);
      densified += 1;
      console.log(`    densify linear +${mid.length}`);
    }
  }
  // metrics
  let maxJ = 0,
    km = 0;
  for (let i = 1; i < out.length; i++) {
    const d = haversine(out[i - 1], out[i]);
    km += d;
    if (d > maxJ) maxJ = d;
  }
  console.log(
    `${wantWrite ? 'WRITE' : 'DRY'} ${id}: pts ${railway.length}→${out.length} km=${km.toFixed(1)} maxJump=${maxJ.toFixed(1)} bridge=${bridged} densify=${densified}`,
  );
  if (wantWrite) {
    c.railway = out.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
    const note = String(c.note || '');
    const tag = `local-gap-bridge b=${bridged} d=${densified}`;
    if (!note.includes('local-gap-bridge')) c.note = `${note} | ${tag}`.trim();
    writeFileSync(path, JSON.stringify(c));
  }
}
