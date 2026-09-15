/**
 * Build Wikidata coordinate lookup for scenic spot Chinese names.
 * Output: data/presets/_scenic-wikidata-truths.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SPOTS_PATH = path.join(ROOT, 'data/presets/scenic-spots.json');
const OUT_PATH = path.join(ROOT, 'data/presets/_scenic-wikidata-truths.json');
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'RailVistaScenicCalibrate/1.0 (scenic spot coordinate calibration)';
const BATCH_SIZE = 40;
const BATCH_DELAY_MS = 1200;

/** @param {string} name */
function deriveQueryName(name) {
  let q = name.trim();
  q = q.replace(/（[^）]*）/g, '');
  q = q.replace(/方向（远眺）$/, '').replace(/方向$/, '').replace(/远眺$/, '');
  q = q.trim();
  return q || name.trim();
}

/** @param {{ lng: number, lat: number }} a @param {{ lng: number, lat: number }} b */
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

/** @param {string} wkt e.g. "Point(100.5 36.9)" */
function parseWktPoint(wkt) {
  const m = /^Point\(([-\d.]+)\s+([-\d.]+)\)$/i.exec(wkt.trim());
  if (!m) return null;
  return { lng: Number(m[1]), lat: Number(m[2]) };
}

/** @param {string[]} labels */
function buildSparql(labels) {
  const values = labels
    .map((l) => `"${l.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@zh`)
    .join(' ');
  return `
SELECT ?item ?label ?coord WHERE {
  VALUES ?label { ${values} }
  ?item rdfs:label ?label .
  ?item wdt:P625 ?coord .
}
`.trim();
}

/** @param {string} query */
async function runSparql(query) {
  const url = `${SPARQL_URL}?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SPARQL ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** @param {string[]} labels */
async function queryBatch(labels) {
  const query = buildSparql(labels);
  const json = await runSparql(query);
  /** @type {Map<string, Array<{ wikidataId: string, lng: number, lat: number }>>} */
  const byLabel = new Map();
  for (const b of json.results?.bindings ?? []) {
    const label = b.label?.value;
    const item = b.item?.value;
    const coord = b.coord?.value;
    if (!label || !item || !coord) continue;
    const pt = parseWktPoint(coord);
    if (!pt) continue;
    const wikidataId = item.replace(/^http:\/\/www\.wikidata\.org\/entity\//, '');
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push({ wikidataId, lng: pt.lng, lat: pt.lat });
  }
  return byLabel;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {Array<{ wikidataId: string, lng: number, lat: number }>} candidates @param {{ lng: number, lat: number }} spot */
function pickBest(candidates, spot) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  return candidates.reduce((best, c) => {
    const d = haversineKm(spot, c);
    if (!best || d < best.dist) return { ...c, dist: d };
    return best;
  }, /** @type {null | ({ wikidataId: string, lng: number, lat: number } & { dist: number })} */ (null));
}

async function main() {
  const preset = JSON.parse(fs.readFileSync(SPOTS_PATH, 'utf8'));
  const spots = preset.spots ?? [];
  const prepared = spots.map((s) => ({
    spotId: s.id,
    spotName: s.name,
    queryName: deriveQueryName(s.name),
    lng: s.lng,
    lat: s.lat,
  }));

  const uniqueLabels = [...new Set(prepared.map((s) => s.queryName))];
  console.log(`Spots: ${prepared.length}, unique query labels: ${uniqueLabels.length}`);

  /** @type {Map<string, Array<{ wikidataId: string, lng: number, lat: number }>>} */
  const labelResults = new Map();

  for (let i = 0; i < uniqueLabels.length; i += BATCH_SIZE) {
    const batch = uniqueLabels.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniqueLabels.length / BATCH_SIZE);
    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} labels)...`);
    try {
      const batchMap = await queryBatch(batch);
      for (const [label, hits] of batchMap) {
        labelResults.set(label, hits);
      }
    } catch (err) {
      console.error(`Batch ${batchNum} failed:`, err.message);
      throw err;
    }
    if (i + BATCH_SIZE < uniqueLabels.length) await sleep(BATCH_DELAY_MS);
  }

  const items = prepared.map((s) => {
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

  const out = {
    updated: '2026-09-14',
    items,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');

  const found = items.filter((x) => x.wikidataId);
  const notFound = items.filter((x) => !x.wikidataId);
  const top30 = [...found]
    .sort((a, b) => (b.distKmFromSpot ?? 0) - (a.distKmFromSpot ?? 0))
    .slice(0, 30)
    .map((x) => {
      const spot = prepared.find((s) => s.spotId === x.spotId);
      return {
        spotId: x.spotId,
        spotName: x.spotName,
        distKm: x.distKmFromSpot,
        oldCoords: spot ? { lng: spot.lng, lat: spot.lat } : null,
        newCoords: { lng: x.lng, lat: x.lat },
        wikidataId: x.wikidataId,
      };
    });

  console.log('\n=== SUMMARY ===');
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
    console.log('\nNot found (first 20):');
    for (const x of notFound.slice(0, 20)) {
      console.log(`  ${x.spotId} | ${x.spotName} | query: ${x.queryName}`);
    }
    if (notFound.length > 20) console.log(`  ... and ${notFound.length - 20} more`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
