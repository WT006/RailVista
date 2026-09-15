import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = Number(process.argv[2]);
const jsonPath = process.argv[3];
const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const out = path.join(ROOT, `data/presets/_scenic-wikidata-small-${index}.json`);
fs.writeFileSync(out, JSON.stringify(json, null, 2) + '\n', 'utf8');
console.log(`saved ${out} (${json.results?.bindings?.length ?? 0} bindings)`);
