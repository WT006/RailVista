/**
 * 连镇北端：OSM relation 起点距连云港 ~45km，补到连云港。
 *   node scripts/patch-lianzhen-lianyungang-approach.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrPath = join(root, 'data/presets/corridors/lianzhen.json');
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

function densify(a, b, stepKm = 2.5) {
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
  for (const m of [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ]) {
    try {
      const res = await fetch(m, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RailVista/0.1 lianzhen-patch',
        },
        signal: AbortSignal.timeout(150000),
      });
      if (!res.ok) continue;
      return await res.json();
    } catch (e) {
      console.warn('overpass fail', e.message);
    }
  }
  return null;
}

function buildPath(ways, origin, dest, softKm = 15) {
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
  const oK = add(origin);
  const dK = add(dest);
  link(origin, s.v);
  link(dest, t.v);
  if (s.d > softKm || t.d > softKm) {
    return { ok: false, reason: `snap ${s.d.toFixed(1)}/${t.d.toFixed(1)}` };
  }
  const dist = new Map([[oK, 0]]);
  const prev = new Map();
  const pq = [[0, oK]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [cd, u] = pq.shift();
    if (cd > (dist.get(u) ?? 1e9) + 1e-9) continue;
    if (u === dK) break;
    for (const e of adj.get(u) || []) {
      const nd = cd + e.d;
      if (nd < (dist.get(e.to) ?? 1e9)) {
        dist.set(e.to, nd);
        prev.set(e.to, u);
        pq.push([nd, e.to]);
      }
    }
  }
  if (!dist.has(dK)) return { ok: false, reason: 'no path' };
  const path = [];
  let cur = dK;
  while (cur !== undefined) {
    path.push(nodes.get(cur));
    cur = prev.get(cur);
  }
  path.reverse();
  return { ok: true, path, km: dist.get(dK) };
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const st = geo['连云港'];
const c = JSON.parse(readFileSync(corrPath, 'utf8'));
const tip = { lng: c.railway[0][0], lat: c.railway[0][1] };
const gap = haversine(st, tip);
if (gap < 0.5) {
  console.log('skip already close', gap.toFixed(2));
  process.exit(0);
}

const pad = 0.45;
const json = await fetchWaysBbox(
  Math.min(st.lng, tip.lng) - pad,
  Math.min(st.lat, tip.lat) - pad,
  Math.max(st.lng, tip.lng) + pad,
  Math.max(st.lat, tip.lat) + pad,
);

let pathPts = null;
let mode = '';
let km = gap;
if (json?.elements?.length) {
  const ways = [];
  for (const el of json.elements) {
    if (el.type !== 'way' || !el.geometry?.length) continue;
    ways.push(el.geometry.map((g) => ({ lng: g.lon, lat: g.lat })));
  }
  console.log('overpass ways', ways.length);
  const r = buildPath(ways, st, tip, 15);
  if (r?.ok) {
    pathPts = r.path;
    km = r.km;
    mode = 'overpass-dijkstra';
    console.log('path', km.toFixed(2), mode);
  } else console.warn('path fail', r?.reason);
}

if (!pathPts) {
  pathPts = densify(st, tip, 2.5);
  mode = 'explicit densify bridge (source OD gap)';
  console.log('fallback densify', gap.toFixed(2));
}

const rest = pathPts.at(-1) && haversine(pathPts.at(-1), tip) < 0.08 ? pathPts.slice(0, -1) : pathPts;
const rail = c.railway.map(([lng, lat]) => ({ lng, lat }));
const merged = [...rest, ...rail];
const out = [merged[0]];
for (const p of merged.slice(1)) {
  if (haversine(out.at(-1), p) >= 0.3) out.push(p);
}
if (haversine(out[0], st) > 0.05) out.unshift({ lng: st.lng, lat: st.lat });

c.railway = out.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
c.note = `${String(c.note || '')} | OD 连云港→tip ${km.toFixed(1)}km (${mode})`.trim();
writeFileSync(corrPath, JSON.stringify(c));
console.log('written', c.railway.length, 'startDist', haversine(out[0], st).toFixed(3));
