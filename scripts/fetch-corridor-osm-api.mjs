/**
 * 用 OSM 官方 API 拉取 relation 全量几何（不依赖 Overpass）
 * node scripts/fetch-corridor-osm-api.mjs 356778 jinghu
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const relationId = process.argv[2] || '356778';
const outName = process.argv[3] || 'jinghu';

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

const url = `https://www.openstreetmap.org/api/0.6/relation/${relationId}/full.json`;
console.log('GET', url);
const res = await fetch(url, {
  headers: { 'User-Agent': 'RailVista/0.1 corridor builder' },
  signal: AbortSignal.timeout(180000),
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const json = await res.json();

const nodes = new Map();
const ways = new Map();
let rel = null;
for (const el of json.elements || []) {
  if (el.type === 'node') nodes.set(el.id, { lng: el.lon, lat: el.lat });
  if (el.type === 'way') ways.set(el.id, el);
  if (el.type === 'relation' && String(el.id) === String(relationId)) rel = el;
}
if (!rel) throw new Error('relation missing');
console.log('name', rel.tags?.['name:zh'] || rel.tags?.name);
console.log('nodes', nodes.size, 'ways', ways.size, 'members', rel.members?.length);

let line = [];
for (const m of rel.members || []) {
  if (m.type !== 'way') continue;
  const way = ways.get(m.ref);
  if (!way?.nodes?.length) continue;
  const pts = way.nodes
    .map((id) => nodes.get(id))
    .filter(Boolean);
  if (pts.length < 2) continue;
  const ordered = m.role === 'backward' ? [...pts].reverse() : pts;
  if (!line.length) {
    line = [...ordered];
    continue;
  }
  const tail = line[line.length - 1];
  const head = ordered[0];
  const end = ordered[ordered.length - 1];
  if (dist(tail, head) <= dist(tail, end)) line.push(...ordered.slice(1));
  else line.push(...[...ordered].reverse().slice(1));
}

console.log('stitched', line.length);
const simplified = [line[0]];
for (let i = 1; i < line.length; i += 1) {
  if (haversine(simplified[simplified.length - 1], line[i]) >= 0.45) {
    simplified.push(line[i]);
  }
}
if (dist(simplified[simplified.length - 1], line[line.length - 1]) > 0.0001) {
  simplified.push(line[line.length - 1]);
}
const coords = simplified.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
console.log('simplified', coords.length, coords[0], '->', coords.at(-1));

const stationsHint = [
  '北京南', '天津南', '沧州西', '德州东', '济南西', '泰安', '曲阜东', '滕州东',
  '枣庄', '徐州东', '宿州东', '蚌埠南', '定远', '滁州', '南京南', '镇江南',
  '丹阳北', '常州北', '无锡东', '苏州北', '昆山南', '上海虹桥',
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
