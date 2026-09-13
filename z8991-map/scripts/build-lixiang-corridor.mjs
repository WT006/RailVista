/**
 * 构建丽香 + 昆丽（滇藏南段）走廊，共享枢纽「丽江」，供 C118 路网拼接。
 * node scripts/build-lixiang-corridor.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function simplify(line, minKm = 0.4) {
  if (!line.length) return [];
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    if (haversine(out[out.length - 1], line[i]) >= minKm) out.push(line[i]);
  }
  const last = line[line.length - 1];
  if (dist(out[out.length - 1], last) > 0.0001) out.push(last);
  return out;
}

function densify(anchors, stepKm = 1.5) {
  const out = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const d = haversine(a, b);
    const n = Math.max(1, Math.ceil(d / stepKm));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t });
    }
  }
  out.push(anchors[anchors.length - 1]);
  return out;
}

function mergeSeeds(line, seeds) {
  let out = [...line];
  for (const seed of seeds) {
    const pts = seed.points;
    if (pts.length < 2) continue;
    const d0 = out.map((p, i) => ({ i, d: dist(p, pts[0]) }));
    const d1 = out.map((p, i) => ({ i, d: dist(p, pts[pts.length - 1]) }));
    d0.sort((a, b) => a.d - b.d);
    d1.sort((a, b) => a.d - b.d);
    let i0 = d0[0].i;
    let i1 = d1[0].i;
    let ordered = pts;
    if (i0 > i1) {
      [i0, i1] = [i1, i0];
      ordered = [...pts].reverse();
    }
    if (i1 - i0 < 1) continue;
    out = [...out.slice(0, i0), ...ordered, ...out.slice(i1 + 1)];
  }
  return out;
}

function toCoords(line) {
  return simplify(line).map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
}

function lengthKm(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) {
    s += haversine(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
  }
  return s;
}

async function fetchWayFull(id) {
  const url = `https://www.openstreetmap.org/api/0.6/way/${id}/full.json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'RailVista/0.1 lixiang corridor' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`way ${id} HTTP ${res.status}`);
  const json = await res.json();
  const nodes = new Map();
  let way = null;
  for (const el of json.elements || []) {
    if (el.type === 'node') nodes.set(el.id, { lng: el.lon, lat: el.lat });
    if (el.type === 'way' && el.id === id) way = el;
  }
  if (!way?.nodes?.length) return [];
  return way.nodes.map((nid) => nodes.get(nid)).filter(Boolean);
}

const SEED_WAYS = [657658722, 906760771, 1082341431];

/** 昆明→丽江（广大/大丽客车径路近似锚点） */
const KUNMING_LIJIANG = [
  { name: '昆明', lng: 102.720287, lat: 25.0186616 },
  { name: '广通北', lng: 101.78, lat: 25.2 },
  { name: '楚雄', lng: 101.546, lat: 25.032 },
  { name: '南华', lng: 101.274, lat: 25.193 },
  { name: '祥云', lng: 100.554, lat: 25.484 },
  { name: '大理', lng: 100.297, lat: 25.591 },
  { name: '鹤庆', lng: 100.176, lat: 26.56 },
  { name: '丽江', lng: 100.2512118, lat: 26.8143271 },
];

/** 丽江→香格里拉（丽香） */
const LIJIANG_SHANGRI = [
  { name: '丽江', lng: 100.2512118, lat: 26.8143271 },
  { name: '拉市海', lng: 100.18, lat: 26.9 },
  { name: '新尚', lng: 100.12, lat: 27.05 },
  { name: '虎跳峡', lng: 100.09, lat: 27.18 },
  { name: '螺丝湾', lng: 100.02, lat: 27.32 },
  { name: '花椒坡', lng: 99.96, lat: 27.4 },
  { name: '万拉木', lng: 99.92, lat: 27.45 },
  { name: '塘布', lng: 99.87, lat: 27.52 },
  { name: '小中甸', lng: 99.81346, lat: 27.56238 },
  { name: '鲁吉', lng: 99.76, lat: 27.65 },
  { name: '居都谷', lng: 99.72, lat: 27.73 },
  { name: '香格里拉', lng: 99.6885399, lat: 27.8133154 },
];

console.log('fetch OSM seed ways…');
const seeds = [];
for (const id of SEED_WAYS) {
  try {
    const points = await fetchWayFull(id);
    if (points.length >= 2) {
      seeds.push({ id, points });
      console.log('seed', id, points.length);
    }
    await new Promise((r) => setTimeout(r, 300));
  } catch (e) {
    console.warn('seed fail', id, e.message || e);
  }
}

function buildCorridor({ id, name, sourceNames, anchors, note, applySeeds }) {
  let line = densify(anchors, 1.5);
  if (applySeeds) line = mergeSeeds(line, seeds);
  if (dist(line[0], anchors[0]) > dist(line[line.length - 1], anchors[0])) {
    line = [...line].reverse();
  }
  const railway = toCoords(line);
  return {
    id,
    name,
    source: applySeeds ? 'osm+anchors' : 'anchors',
    sourceNames,
    note,
    stationsHint: anchors.map((a) => a.name),
    railway,
  };
}

const lixiang = buildCorridor({
  id: 'lixiang',
  name: '丽香铁路',
  sourceNames: ['丽香铁路', '滇藏铁路丽香段', '滇藏铁路', '滇藏线'],
  anchors: LIJIANG_SHANGRI,
  note: '丽江→香格里拉；锚点稠密折线 + OSM 隧道/桥梁几何',
  applySeeds: true,
});

const kunli = buildCorridor({
  id: 'kunli',
  name: '滇藏铁路大丽段',
  sourceNames: ['滇藏铁路', '大丽铁路', '广大铁路'],
  anchors: KUNMING_LIJIANG,
  note: '昆明→丽江；客车径路锚点稠密折线，与丽香共享枢纽丽江供路网拼接',
  applySeeds: false,
});

const outDir = join(__dirname, '../data/presets/corridors');
mkdirSync(outDir, { recursive: true });
for (const c of [lixiang, kunli]) {
  const p = join(outDir, `${c.id}.json`);
  writeFileSync(p, JSON.stringify(c));
  console.log(
    'written',
    c.id,
    'pts',
    c.railway.length,
    'km≈',
    lengthKm(c.railway).toFixed(1),
    c.railway[0],
    '->',
    c.railway.at(-1),
  );
}

// seed stations-geo for missing anchors
const geoPath = join(__dirname, '../data/stations-geo.json');
const { readFileSync } = await import('node:fs');
const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
for (const a of [...KUNMING_LIJIANG, ...LIJIANG_SHANGRI]) {
  const prev = geo[a.name];
  if (prev?.source?.startsWith('corridor:') || prev?.source === 'manual:wiki') continue;
  if (prev && Math.hypot(prev.lng - a.lng, prev.lat - a.lat) < 0.02) continue;
  geo[a.name] = { name: a.name, lng: a.lng, lat: a.lat, source: 'corridor:lixiang' };
}
writeFileSync(geoPath, JSON.stringify(geo));
console.log('stations-geo updated');
