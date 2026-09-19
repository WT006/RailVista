/**
 * 银兰走廊南端补丁：源 GeoJSON 中银兰末端距徐兰/兰州西约 36km，
 * 用「银兰末端 → 折线桥 → 徐兰进兰州西」替换秦王川以南的缺口/飞线。
 *
 *   node scripts/patch-yinlan-lanzhou-bridge.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const yinlanPath = join(root, 'data/presets/corridors/yinlan.json');
const hsrPath = join(root, 'data/presets/corridors/_hsr-rails.geojson');
const geoPath = join(root, 'data/stations-geo.json');

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

function densify(a, b, stepKm = 2) {
  const from = { lng: a[0], lat: a[1] };
  const to = { lng: b[0], lat: b[1] };
  const d = haversine(from, to);
  const n = Math.max(1, Math.ceil(d / stepKm));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([
      Number((from.lng + (to.lng - from.lng) * t).toFixed(6)),
      Number((from.lat + (to.lat - from.lat) * t).toFixed(6)),
    ]);
  }
  return out;
}

function projectProgress(railway, lng, lat) {
  let best = { i: 0, d: Infinity, along: 0 };
  let along = 0;
  for (let i = 0; i < railway.length; i++) {
    if (i > 0) {
      along += haversine(
        { lng: railway[i - 1][0], lat: railway[i - 1][1] },
        { lng: railway[i][0], lat: railway[i][1] },
      );
    }
    const d = haversine({ lng, lat }, { lng: railway[i][0], lat: railway[i][1] });
    if (d < best.d) best = { i, d, along };
  }
  return best;
}

function orderChain(pts, start, end) {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const len2 = dx * dx + dy * dy || 1;
  return pts
    .map((p) => {
      const t = ((p.lng - start.lng) * dx + (p.lat - start.lat) * dy) / len2;
      return { p, t };
    })
    .filter((x) => x.t >= -0.02 && x.t <= 1.05)
    .sort((a, b) => a.t - b.t)
    .map((x) => x.p);
}

if (!existsSync(yinlanPath) || !existsSync(hsrPath)) {
  console.error('missing yinlan.json or _hsr-rails.geojson');
  process.exit(1);
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const q = geo['秦王川'];
const l = geo['兰州西'];
if (!q?.lng || !l?.lng) {
  console.error('stations-geo missing 秦王川/兰州西');
  process.exit(1);
}

const yinlan = JSON.parse(readFileSync(yinlanPath, 'utf8'));
const railway = yinlan.railway || [];
const cut = projectProgress(railway, q.lng, q.lat);
if (cut.d > 5) {
  console.error(`秦王川 not near corridor (d=${cut.d.toFixed(1)}km)`);
  process.exit(1);
}

const fc = JSON.parse(readFileSync(hsrPath, 'utf8'));
const yin = [];
const xu = [];
for (const f of fc.features) {
  const n = f.properties?.name || '';
  const coords = f.geometry?.coordinates;
  if (!coords || f.geometry.type !== 'LineString') continue;
  if (n.includes('银兰')) for (const c of coords) yin.push({ lng: c[0], lat: c[1] });
  if (n.includes('徐兰')) for (const c of coords) xu.push({ lng: c[0], lat: c[1] });
}

const qPt = { lng: q.lng, lat: q.lat };
const lPt = { lng: l.lng, lat: l.lat };
let tip = null;
let tipD = Infinity;
for (const p of yin) {
  const d = haversine(p, lPt);
  if (d < tipD) {
    tipD = d;
    tip = p;
  }
}
const yinNear = yin.filter((p) => haversine(p, qPt) < 80);
const xuNear = xu.filter((p) => haversine(p, lPt) < 80);
let bridge = null;
let bridgeXu = null;
let bridgeD = Infinity;
for (const p of yinNear) {
  for (const x of xuNear) {
    const d = haversine(p, x);
    if (d < bridgeD) {
      bridgeD = d;
      bridge = p;
      bridgeXu = x;
    }
  }
}

const yinPath = orderChain(yinNear, qPt, tip);
const xuPath = orderChain(xuNear, bridgeXu, lPt);
const south = [[Number(q.lng.toFixed(6)), Number(q.lat.toFixed(6))]];
for (const p of yinPath) {
  const pt = [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))];
  const last = south.at(-1);
  if (haversine({ lng: last[0], lat: last[1] }, { lng: pt[0], lat: pt[1] }) < 0.2) continue;
  south.push(pt);
}
if (haversine({ lng: south.at(-1)[0], lat: south.at(-1)[1] }, bridge) > 0.3) {
  south.push([Number(bridge.lng.toFixed(6)), Number(bridge.lat.toFixed(6))]);
}
for (const pt of densify([bridge.lng, bridge.lat], [bridgeXu.lng, bridgeXu.lat], 2).slice(1)) {
  south.push(pt);
}
for (const p of xuPath) {
  const pt = [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))];
  const last = south.at(-1);
  if (haversine({ lng: last[0], lat: last[1] }, { lng: pt[0], lat: pt[1] }) < 0.2) continue;
  south.push(pt);
}
if (haversine({ lng: south.at(-1)[0], lat: south.at(-1)[1] }, lPt) > 0.2) {
  south.push([Number(l.lng.toFixed(6)), Number(l.lat.toFixed(6))]);
}

const head = railway.slice(0, cut.i + 1);
const merged = head.concat(south.slice(1));
yinlan.railway = merged;
yinlan.source = `${yinlan.source || 'hsr'}+lanzhou-bridge`;
yinlan.note =
  '秦王川以南源数据银兰与徐兰间断约36km，走廊内用折线桥接至兰州西';
if (!yinlan.sourceNames?.includes('徐兰高速线')) {
  yinlan.sourceNames = [...(yinlan.sourceNames || []), '徐兰高速线'];
}

writeFileSync(yinlanPath, JSON.stringify(yinlan));
console.log(
  `patched yinlan: cut@${cut.i} (d=${cut.d.toFixed(1)}) bridgeGap=${bridgeD.toFixed(1)}km pts=${merged.length}`,
);
