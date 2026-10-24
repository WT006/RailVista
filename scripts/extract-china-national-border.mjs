/**
 * 合并省级面 → 国土外轮廓（国界/海岸线），写入 china-admin-boundaries.json。
 * 省界顶点往往对不齐，不能靠「边出现次数」抵消；用 polygon-clipping union。
 *
 * 用法：
 *   node scripts/extract-china-national-border.mjs
 *   node scripts/extract-china-national-border.mjs --from "d:/edge/中国_省.geojson"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import polygonClipping from 'polygon-clipping';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'apps/web/public/geo/china-admin-boundaries.json');

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const fromPath =
  fromIdx >= 0 && args[fromIdx + 1]
    ? args[fromIdx + 1]
    : outPath;

const ROUND = 1e5;
const roundN = (n) => Math.round(n * ROUND) / ROUND;
function roundCoords(c) {
  if (typeof c[0] === 'number') return [roundN(c[0]), roundN(c[1])];
  return c.map(roundCoords);
}

const src = JSON.parse(fs.readFileSync(fromPath, 'utf8'));

const provinces = [];
const legacyBorders = [];
const unionParts = [];

for (const f of src.features) {
  const name = f.properties?.name || '';
  const kind = f.properties?.kind;
  if (kind === 'national') continue;
  if (kind === 'border' || name === '境界线') {
    legacyBorders.push({
      type: 'Feature',
      properties: { name: name || '境界线', kind: 'national' },
      geometry: {
        type: f.geometry.type,
        coordinates: roundCoords(f.geometry.coordinates),
      },
    });
    continue;
  }
  if (f.geometry?.type !== 'Polygon' && f.geometry?.type !== 'MultiPolygon') continue;

  const coords = roundCoords(f.geometry.coordinates);
  provinces.push({
    type: 'Feature',
    properties: { name, kind: 'province' },
    geometry: { type: f.geometry.type, coordinates: coords },
  });

  // polygon-clipping: Polygon = ring[]；MultiPolygon = Polygon[]
  if (f.geometry.type === 'Polygon') unionParts.push(coords);
  else for (const poly of coords) unionParts.push(poly);
}

console.log('union input polygons:', unionParts.length);
const dissolved = polygonClipping.union(unionParts[0], ...unionParts.slice(1));
console.log('dissolved MultiPolygon parts:', dissolved.length);

/** MultiPolygon rings → MultiLineString（外环 + 岛；洞一般是内陆湖，不入国界） */
const lines = [];
for (const polygon of dissolved) {
  const outer = polygon[0];
  if (outer && outer.length >= 2) lines.push(outer);
  // 洞不画进国界（鄱阳湖等）；南海诸岛是独立 MultiPolygon part，已在外环
}

const national = {
  type: 'Feature',
  properties: { name: '国界', kind: 'national' },
  geometry: { type: 'MultiLineString', coordinates: lines },
};

const out = {
  type: 'FeatureCollection',
  features: [...provinces, national, ...legacyBorders],
};

fs.writeFileSync(outPath, JSON.stringify(out));
console.log(
  JSON.stringify(
    {
      from: fromPath,
      out: outPath,
      bytes: fs.statSync(outPath).size,
      provinces: provinces.length,
      nationalLineParts: lines.length,
      nationalPts: lines.reduce((s, l) => s + l.length, 0),
      legacyBorderSegs: legacyBorders.length,
      kinds: out.features.reduce((a, f) => {
        a[f.properties.kind] = (a[f.properties.kind] || 0) + 1;
        return a;
      }, {}),
    },
    null,
    2,
  ),
);
