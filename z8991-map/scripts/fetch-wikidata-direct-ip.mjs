import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'RailVistaScenicCalibrate/1.0 (scenic spot coordinate calibration)';

function fetchDirect(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '103.102.166.224',
        servername: 'query.wikidata.org',
        path: urlPath,
        headers: {
          Host: 'query.wikidata.org',
          'User-Agent': USER_AGENT,
          Accept: 'application/sparql-results+json',
        },
        timeout: 120000,
        rejectUnauthorized: true,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}`));
          else resolve(data);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const i = Number(process.argv[2] ?? 0);
const url = fs.readFileSync(
  path.join(ROOT, `data/presets/_scenic-wikidata-small-${i}.url.txt`),
  'utf8',
).trim();
const urlPath = url.replace('https://query.wikidata.org', '');
console.log('fetching batch', i, 'path len', urlPath.length);
const body = await fetchDirect(urlPath);
const json = JSON.parse(body);
const out = path.join(ROOT, `data/presets/_scenic-wikidata-small-${i}.json`);
fs.writeFileSync(out, JSON.stringify(json, null, 2) + '\n', 'utf8');
console.log('saved', json.results?.bindings?.length ?? 0, 'bindings');
