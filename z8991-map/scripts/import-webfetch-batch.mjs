import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = Number(process.argv[2]);
const rawPath = process.argv[3];
if (!Number.isInteger(index) || !rawPath) {
  console.error('Usage: node import-webfetch-batch.mjs <index> <raw-markdown-file>');
  process.exit(1);
}

const raw = fs.readFileSync(rawPath, 'utf8');
const start = raw.indexOf('{');
const end = raw.lastIndexOf('}');
if (start < 0 || end < start) {
  console.error('No JSON object found in', rawPath);
  process.exit(1);
}
const json = JSON.parse(raw.slice(start, end + 1));
const outFile = path.join(ROOT, `data/presets/_scenic-wikidata-small-${index}.json`);
fs.writeFileSync(outFile, JSON.stringify(json, null, 2) + '\n', 'utf8');
console.log(`saved ${outFile} (${json.results?.bindings?.length ?? 0} bindings)`);
