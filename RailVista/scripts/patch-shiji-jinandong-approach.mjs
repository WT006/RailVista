/**
 * 石济东端：OSM relation 止于济南西北空档，补到济南东。
 * 优先 Overpass bbox 轨网 Dijkstra；失败则显式 densify 桥接 + note。
 *
 *   node scripts/patch-shiji-jinandong-approach.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrPath = join(root, 'data/presets/corridors/shiji.json');
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
  const d = haversine(a, b);
  const n = Math.max(1, Math.ceil(d / stepKm));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({
      lng: a.lng + (b.lng - a.lng) * t,
      lat: a.lat + (b.lat - a.lat) * t,
    });
  }
  return out;
}

function keyOf(p) {
  return `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
}

async function fetchWaysBbox(minLng, minLat, maxLng, maxLat) {
  const q = `
[out:json][timeout:120];
(
  way["railway"="rail"](${minLat},${minLng},${maxLat},${maxLng});
  way["railway"="highspeed"](${minLat},${minLng},${maxLat},${maxLng});
);
out geom;
`;
  const mirrors = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];
  for (const m of mirrors) {
    try {
      const res = await fetch(m, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RailVista/0.1 shiji-patch',
        },
        signal: AbortSignal.timeout(150000),
      });
      if (!res.ok) {
        console.warn('overpass HTTP', res.status, m);
        continue;
      }
      return await res.json();
    } catch (e) {
      console.warn('overpass fail', m, e.message);
    }
  }
  return null;
}

function buildPath(ways, origin, dest, softKm = 12) {
  const nodes = new Map();
  const adj = new Map();
  const add = (p) => {
    const k = keyOf(p);
    if (!nodes.has(k)) nodes.set(k, { ...p });
    return k;
  };
  const link = (a, b) => {
    const d = haversine(a, b);
    if (!(d > 0) || d > 4) return;
    const ka = add(a);
    const kb = add(b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ to: kb, d });
    adj.get(kb).push({ to: ka, d });
  };
  for (const pts of ways) {
    for (let i = 1; i < pts.length; i++) link(pts[i - 1], pts[i]);
  }
  const arr = [...nodes.values()];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < Math.min(arr.length, i + 60); j++) {
      const d = haversine(arr[i], arr[j]);
      if (d > 0 && d <= 0.25) link(arr[i], arr[j]);
    }
  }
  const nearest = (p) => {
    let best = null;
    for (const [k, v] of nodes) {
      const d = haversine(p, v);
      if (!best || d < best.d) best = { k, d, v };
    }
    return best;
  };
  const s = nearest(origin);
  const t = nearest(dest);
  if (!s || !t) return null;
  const tipK = add(origin);
  const destK = add(dest);
  link(origin, s.v);
  link(dest, t.v);
  if (s.d > softKm || t.d > softKm) {
    return { ok: false, reason: `snap tip=${s.d.toFixed(1)} dest=${t.d.toFixed(1)}` };
  }
  const dist = new Map([[tipK, 0]]);
  const prev = new Map();
  const pq = [[0, tipK]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [cd, u] = pq.shift();
    if (cd > (dist.get(u) ?? 1e9) + 1e-9) continue;
    if (u === destK) break;
    for (const e of adj.get(u) || []) {
      const nd = cd + e.d;
      if (nd < (dist.get(e.to) ?? 1e9)) {
        dist.set(e.to, nd);
        prev.set(e.to, u);
        pq.push([nd, e.to]);
      }
    }
  }
  if (!dist.has(destK)) return { ok: false, reason: 'no path' };
  const path = [];
  let cur = destK;
  while (cur !== undefined) {
    path.push(nodes.get(cur));
    cur = prev.get(cur);
  }
  path.reverse();
  return { ok: true, path, km: dist.get(destK), snapTip: s.d, snapDest: t.d };
}

if (!existsSync(corrPath)) {
  console.error('missing shiji.json');
  process.exit(1);
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const jn = geo['济南东'];
if (!jn?.lng) {
  console.error('stations-geo missing 济南东');
  process.exit(1);
}

const c = JSON.parse(readFileSync(corrPath, 'utf8'));
const tip = { lng: c.railway.at(-1)[0], lat: c.railway.at(-1)[1] };
const gap0 = haversine(tip, jn);
if (gap0 < 0.5) {
  console.log(`[shiji] skip, end already ${gap0.toFixed(3)} km from 济南东`);
  process.exit(0);
}

const pad = 0.35;
const minLng = Math.min(tip.lng, jn.lng) - pad;
const maxLng = Math.max(tip.lng, jn.lng) + pad;
const minLat = Math.min(tip.lat, jn.lat) - pad;
const maxLat = Math.max(tip.lat, jn.lat) + pad;

console.log(`[shiji] tip→济南东 gap=${gap0.toFixed(2)}km, fetch overpass bbox...`);
const json = await fetchWaysBbox(minLng, minLat, maxLng, maxLat);
let pathPts = null;
let mode = '';
let pathKm = gap0;

if (json?.elements?.length) {
  const ways = [];
  for (const el of json.elements) {
    if (el.type !== 'way' || !el.geometry?.length) continue;
    ways.push(el.geometry.map((g) => ({ lng: g.lon, lat: g.lat })));
  }
  console.log(`[shiji] overpass ways=${ways.length}`);
  const r = buildPath(ways, tip, jn, 12);
  if (r?.ok) {
    pathPts = r.path;
    pathKm = r.km;
    mode = `overpass-dijkstra snap=${r.snapTip.toFixed(1)}/${r.snapDest.toFixed(1)}`;
    console.log(`[shiji] path ${pathKm.toFixed(2)}km via ${mode}`);
  } else {
    console.warn('[shiji] overpass path fail:', r?.reason || 'unknown');
  }
} else {
  console.warn('[shiji] overpass empty/fail');
}

if (!pathPts) {
  pathPts = densify(tip, jn, 2);
  mode = 'explicit densify bridge (source OD gap)';
  pathKm = gap0;
  console.log(`[shiji] fallback densify ${pathKm.toFixed(2)}km`);
}

const rail = c.railway.map(([lng, lat]) => ({ lng, lat }));
const rest =
  pathPts[0] && haversine(pathPts[0], rail.at(-1)) < 0.08 ? pathPts.slice(1) : pathPts;
const merged = [...rail, ...rest];
const out = [merged[0]];
for (const p of merged.slice(1)) {
  if (haversine(out.at(-1), p) >= 0.3) out.push(p);
}
if (haversine(out.at(-1), jn) > 0.05) out.push({ lng: jn.lng, lat: jn.lat });

c.railway = out.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
c.stationsHint = [
  '石家庄',
  '石家庄东',
  '藁城南',
  '辛集南',
  '衡水北',
  '景州',
  '德州东',
  '平原东',
  '禹城东',
  '齐河',
  '济南东',
];
const note = ` | OD tip→济南东 ${pathKm.toFixed(1)}km (${mode})`;
c.note = `${String(c.note || '').replace(/\s*\|\s*OD bridge[\s\S]*$/, '')}${note}`.trim();

writeFileSync(corrPath, JSON.stringify(c));
console.log(
  `[shiji] written pts=${c.railway.length} endDist=${haversine(out.at(-1), jn).toFixed(3)}km`,
);
