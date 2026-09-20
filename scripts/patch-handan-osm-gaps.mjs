/**
 * Patch handan: splice OSM way geometries into source jumps (>12km).
 * Uses relation 2201129 members so we stay on 汉丹主轨，禁止直线 densify.
 *
 *   node scripts/patch-handan-osm-gaps.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrPath = join(root, 'data/presets/corridors/handan.json');
const REL = 2201129;
const JUMP_KM = 12;

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

console.log('GET relation', REL);
const json = await (
  await fetch(`https://www.openstreetmap.org/api/0.6/relation/${REL}/full.json`, {
    headers: { 'User-Agent': 'RailVista/1.0 handan-gap-patch' },
    signal: AbortSignal.timeout(180000),
  })
).json();

const nodes = new Map();
const wayPts = [];
for (const el of json.elements || []) {
  if (el.type === 'node') nodes.set(el.id, { lng: el.lon, lat: el.lat });
}
for (const el of json.elements || []) {
  if (el.type !== 'way' || !el.nodes?.length) continue;
  const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean);
  if (pts.length >= 2) wayPts.push(pts);
}

const corr = JSON.parse(readFileSync(corrPath, 'utf8'));
let line = corr.railway.map((c) => ({ lng: c[0], lat: c[1] }));

function bestBridge(a, b) {
  let best = null;
  for (const pts of wayPts) {
    // find closest indices on this way to a and b
    let i0 = 0;
    let i1 = 0;
    let d0 = Infinity;
    let d1 = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const da = haversine(pts[i], a);
      const db = haversine(pts[i], b);
      if (da < d0) {
        d0 = da;
        i0 = i;
      }
      if (db < d1) {
        d1 = db;
        i1 = i;
      }
    }
    if (d0 > 5 || d1 > 5) continue; // must snap near both gap ends
    if (i0 === i1) continue;
    const lo = Math.min(i0, i1);
    const hi = Math.max(i0, i1);
    if (hi - lo < 2) continue;
    let seg = pts.slice(lo, hi + 1);
    if (i0 > i1) seg = [...seg].reverse();
    let km = 0;
    for (let i = 1; i < seg.length; i++) km += haversine(seg[i - 1], seg[i]);
    const od = haversine(a, b);
    if (km < od * 0.5 || km > od * 3.0) continue;
    const snap = d0 + d1;
    if (!best || snap < best.snap - 0.2 || (Math.abs(snap - best.snap) <= 0.2 && Math.abs(km - od) < Math.abs(best.km - od))) {
      best = { seg, km, d0, d1, snap };
    }
  }
  return best;
}

let patched = 0;
for (let pass = 0; pass < 20; pass++) {
  let hit = false;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const gap = haversine(a, b);
    if (gap < JUMP_KM) continue;
    const bridge = bestBridge(a, b);
    if (!bridge || bridge.seg.length < 3) {
      console.warn('no OSM bridge for gap', gap.toFixed(1), 'at', a, '→', b);
      continue;
    }
    console.log(
      `bridge gap ${gap.toFixed(1)}km → OSM ${bridge.km.toFixed(1)}km snap ${bridge.d0.toFixed(2)}/${bridge.d1.toFixed(2)} pts=${bridge.seg.length}`,
    );
    // replace the jump edge with bridge interior (keep a, drop duplicate ends)
    const mid = bridge.seg.slice(1, -1);
    line = [...line.slice(0, i), ...mid, ...line.slice(i)];
    patched += 1;
    hit = true;
    break;
  }
  if (!hit) break;
}

// simplify lightly
const out = [line[0]];
for (let i = 1; i < line.length; i++) {
  if (haversine(out.at(-1), line[i]) >= 0.4) out.push(line[i]);
}
if (dist(out.at(-1), line.at(-1)) > 0.0001) out.push(line.at(-1));

corr.railway = out.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
corr.source = 'osm-bbox+relation-gap-splice';
corr.osmRelation = REL;
const note = String(corr.note || '');
if (!note.includes('handan OSM gap splice')) {
  corr.note = `${note} | handan OSM gap splice n=${patched}`.trim().replace(/^\| /, '');
}
writeFileSync(corrPath, JSON.stringify(corr));
console.log('written', corrPath, 'pts', corr.railway.length, 'patched', patched);
