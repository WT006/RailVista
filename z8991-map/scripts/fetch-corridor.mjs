/**
 * 从 OSM relation 拉取精品铁路线（与 Z8991 同级）
 * node scripts/fetch-corridor.mjs 356778 jinghu
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const relationId = process.argv[2] || '356778';
const outName = process.argv[3] || 'jinghu';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

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

async function overpass(query) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      console.log('POST', url);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'RailVista/0.1 corridor builder',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.warn(url, e.message || e);
    }
  }
  throw lastErr;
}

const query = `
[out:json][timeout:180];
relation(${relationId});
out body;
>;
out geom;
`.trim();

const json = await overpass(query);
const rel = (json.elements || []).find((e) => e.type === 'relation');
const waysById = new Map();
for (const el of json.elements || []) {
  if (el.type === 'way' && el.geometry?.length >= 2) {
    waysById.set(el.id, el.geometry.map((g) => ({ lng: g.lon, lat: g.lat })));
  }
}
if (!rel) throw new Error('relation not found');
console.log('relation', rel.tags?.name || rel.tags?.['name:zh'], 'members', rel.members?.length);
console.log('ways with geom', waysById.size);

let line = [];
for (const m of rel.members || []) {
  if (m.type !== 'way') continue;
  const pts = waysById.get(m.ref);
  if (!pts?.length) continue;
  const forward = m.role !== 'backward';
  const ordered = forward ? pts : [...pts].reverse();
  if (!line.length) {
    line = [...ordered];
    continue;
  }
  const tail = line[line.length - 1];
  const head = ordered[0];
  const end = ordered[ordered.length - 1];
  if (dist(tail, head) <= dist(tail, end)) {
    line.push(...ordered.slice(1));
  } else {
    line.push(...[...ordered].reverse().slice(1));
  }
}

console.log('stitched', line.length);
// simplify like Z8991
const out = [line[0]];
for (let i = 1; i < line.length; i += 1) {
  if (haversine(out[out.length - 1], line[i]) >= 0.45) out.push(line[i]);
}
if (dist(out[out.length - 1], line[line.length - 1]) > 0.0001) {
  out.push(line[line.length - 1]);
}
const coords = out.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
console.log('simplified', coords.length, 'start', coords[0], 'end', coords.at(-1));

const stationsHint = [
  '北京南',
  '天津南',
  '沧州西',
  '德州东',
  '济南西',
  '泰安',
  '曲阜东',
  '滕州东',
  '枣庄',
  '徐州东',
  '宿州东',
  '蚌埠南',
  '定远',
  '滁州',
  '南京南',
  '镇江南',
  '丹阳北',
  '常州北',
  '无锡东',
  '苏州北',
  '昆山南',
  '上海虹桥',
];

const outDir = join(__dirname, '../data/presets/corridors');
mkdirSync(outDir, { recursive: true });
const meta = {
  id: outName,
  name: rel.tags?.['name:zh'] || rel.tags?.name || outName,
  osmRelation: Number(relationId),
  source: 'osm',
  stationsHint,
  railway: coords,
};
const path = join(outDir, `${outName}.json`);
writeFileSync(path, JSON.stringify(meta));
console.log('written', path, `${(Buffer.byteLength(JSON.stringify(meta)) / 1024).toFixed(1)} KB`);
