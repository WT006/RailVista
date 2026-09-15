import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'RailVistaScenicCalibrate/1.0 (scenic spot coordinate calibration)';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/sparql-results+json',
        },
        timeout: 120000,
        family: 4,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          resolve(data);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const start = Number(process.argv[2] ?? 0);
const end = Number(process.argv[3] ?? 9);
const delay = Number(process.argv[4] ?? 1200);

for (let i = start; i <= end; i++) {
  const urlFile = path.join(ROOT, `data/presets/_scenic-wikidata-batch-${i}.url.txt`);
  const outFile = path.join(ROOT, `data/presets/_scenic-wikidata-batch-${i}.json`);
  const url = fs.readFileSync(urlFile, 'utf8').trim();
  console.log(`Fetching batch ${i}...`);
  try {
    const body = await fetchUrl(url);
    JSON.parse(body);
    fs.writeFileSync(outFile, body, 'utf8');
    console.log(`  saved ${outFile} (${body.length} bytes)`);
  } catch (err) {
    console.error(`Batch ${i} failed:`, err.message);
    process.exit(1);
  }
  if (i < end) await sleep(delay);
}
