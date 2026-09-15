import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BATCH_META = path.join(ROOT, 'data/presets/_scenic-wikidata-batches.json');
const OUT_PATH = path.join(ROOT, 'data/presets/_scenic-wikidata-truths.json');

function parseWktPoint(wkt) {
  const m = /^Point\(([-\d.]+)\s+([-\d.]+)\)$/i.exec(String(wkt).trim());
  if (!m) return null;
  return { lng: Number(m[1]), lat: Number(m[2]) };
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pickBest(candidates, spot) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  return candidates.reduce((best, c) => {
    const d = haversineKm(spot, c);
    if (!best || d < best.dist) return { ...c, dist: d };
    return best;
  }, null);
}

const { spots, batches } = JSON.parse(fs.readFileSync(BATCH_META, 'utf8'));
/** @type {Map<string, Array<{ wikidataId: string, lng: number, lat: number }>>} */
const labelResults = new Map();

for (let i = 0; i < batches.length; i++) {
  const smallFile = path.join(ROOT, `data/presets/_scenic-wikidata-small-${i}.json`);
  const legacyFile = path.join(ROOT, `data/presets/_scenic-wikidata-batch-${i}.json`);
  const batchFile = fs.existsSync(smallFile) ? smallFile : legacyFile;
  if (!fs.existsSync(batchFile)) {
    console.error(`Missing batch result: ${batchFile}`);
    process.exit(1);
  }
  const json = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
  for (const b of json.results?.bindings ?? []) {
    const label = b.label?.value;
    const item = b.item?.value;
    const coord = b.coord?.value;
    if (!label || !item || !coord) continue;
    const pt = parseWktPoint(coord);
    if (!pt) continue;
    const wikidataId = item.replace(/^http:\/\/www\.wikidata\.org\/entity\//, '');
    if (!labelResults.has(label)) labelResults.set(label, []);
    labelResults.get(label).push({ wikidataId, lng: pt.lng, lat: pt.lat });
  }
}

const items = spots.map((s) => {
  const candidates = labelResults.get(s.queryName) ?? [];
  const best = pickBest(candidates, { lng: s.lng, lat: s.lat });
  if (!best) {
    return {
      spotId: s.spotId,
      spotName: s.spotName,
      queryName: s.queryName,
      wikidataId: null,
    };
  }
  const distKmFromSpot = haversineKm({ lng: s.lng, lat: s.lat }, best);
  return {
    spotId: s.spotId,
    spotName: s.spotName,
    queryName: s.queryName,
    wikidataId: best.wikidataId,
    lng: best.lng,
    lat: best.lat,
    distKmFromSpot: Math.round(distKmFromSpot * 1000) / 1000,
  };
});

fs.writeFileSync(
  OUT_PATH,
  JSON.stringify({ updated: '2026-09-14', items }, null, 2) + '\n',
  'utf8',
);

const found = items.filter((x) => x.wikidataId);
const notFound = items.filter((x) => !x.wikidataId);
const top30 = [...found]
  .sort((a, b) => (b.distKmFromSpot ?? 0) - (a.distKmFromSpot ?? 0))
  .slice(0, 30)
  .map((x) => {
    const spot = spots.find((s) => s.spotId === x.spotId);
    return {
      spotId: x.spotId,
      spotName: x.spotName,
      distKm: x.distKmFromSpot,
      oldCoords: spot ? { lng: spot.lng, lat: spot.lat } : null,
      newCoords: { lng: x.lng, lat: x.lat },
      wikidataId: x.wikidataId,
    };
  });

console.log('=== SUMMARY ===');
console.log(`Total spots: ${items.length}`);
console.log(`Found: ${found.length}`);
console.log(`Not found: ${notFound.length}`);
console.log('\nTop 30 largest |distKmFromSpot|:');
for (const r of top30) {
  console.log(
    `  ${r.spotId} | ${r.spotName} | ${r.distKm} km | old (${r.oldCoords?.lng}, ${r.oldCoords?.lat}) -> new (${r.newCoords.lng}, ${r.newCoords.lat}) [${r.wikidataId}]`,
  );
}
if (notFound.length) {
  console.log('\nNot found:');
  for (const x of notFound) {
    console.log(`  ${x.spotId} | ${x.spotName} | query: ${x.queryName}`);
  }
}
