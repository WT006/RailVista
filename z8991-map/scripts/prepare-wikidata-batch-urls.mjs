import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/presets/_scenic-wikidata-batches.json'), 'utf8'),
);
const BATCH_SIZE = Number(process.env.WIKIDATA_BATCH_SIZE ?? 10);
const labels = meta.labels;
const batches = [];
for (let i = 0; i < labels.length; i += BATCH_SIZE) {
  batches.push(labels.slice(i, i + BATCH_SIZE));
}
fs.writeFileSync(
  path.join(ROOT, 'data/presets/_scenic-wikidata-batches.json'),
  JSON.stringify({ spots: meta.spots, labels, batches }, null, 2),
);

function buildSparql(labels) {
  const values = labels
    .map((l) => `"${l.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@zh`)
    .join(' ');
  return `SELECT ?item ?label ?coord WHERE { VALUES ?label { ${values} } ?item rdfs:label ?label . ?item wdt:P625 ?coord . }`;
}

for (let i = 0; i < batches.length; i++) {
  const url =
    'https://query.wikidata.org/sparql?format=json&query=' +
    encodeURIComponent(buildSparql(batches[i]));
  fs.writeFileSync(path.join(ROOT, `data/presets/_scenic-wikidata-small-${i}.url.txt`), url);
  console.log(`batch ${i}: ${batches[i].length} labels, url length ${url.length}`);
}
