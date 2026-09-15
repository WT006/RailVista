import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { labels } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/presets/_scenic-wikidata-batches.json'), 'utf8'),
);

function buildSparql(labelList) {
  const values = labelList
    .map((l) => `"${l.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@zh`)
    .join(' ');
  return `SELECT ?item ?label ?coord WHERE { VALUES ?label { ${values} } ?item rdfs:label ?label . ?item wdt:P625 ?coord . }`;
}

const url =
  'https://query.wikidata.org/sparql?format=json&query=' +
  encodeURIComponent(buildSparql(labels));
fs.writeFileSync(path.join(ROOT, 'data/presets/_scenic-wikidata-combined.url.txt'), url);
console.log('labels', labels.length, 'url length', url.length);
