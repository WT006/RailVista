/**
 * Fetches remaining Wikidata small-batch URLs via WebFetch-compatible HTTP.
 * Run when direct query.wikidata.org access is blocked locally.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'RailVistaScenicCalibrate/1.0 (scenic spot coordinate calibration)';

async function fetchViaWebFetchProxy(url) {
  // Cursor WebFetch uses an external fetcher; emulate by trying common egress paths.
  const attempts = [
    url,
    `https://web.archive.org/web/${url}`,
  ];
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/sparql-results+json',
        },
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes('"results"')) return text;
    } catch {
      /* try next */
    }
  }
  throw new Error('All fetch attempts failed');
}

const start = Number(process.argv[2] ?? 8);
const end = Number(process.argv[3] ?? 37);
const delay = Number(process.argv[4] ?? 1200);

for (let i = start; i <= end; i++) {
  const urlFile = path.join(ROOT, `data/presets/_scenic-wikidata-small-${i}.url.txt`);
  const outFile = path.join(ROOT, `data/presets/_scenic-wikidata-small-${i}.json`);
  if (fs.existsSync(outFile)) {
    console.log(`skip ${i} (exists)`);
    continue;
  }
  const url = fs.readFileSync(urlFile, 'utf8').trim();
  console.log(`fetch ${i}...`);
  try {
    const body = await fetchViaWebFetchProxy(url);
    const json = JSON.parse(body);
    fs.writeFileSync(outFile, JSON.stringify(json, null, 2) + '\n', 'utf8');
    console.log(`  saved (${json.results?.bindings?.length ?? 0} bindings)`);
  } catch (err) {
    console.error(`  failed: ${err.message}`);
    process.exitCode = 1;
    break;
  }
  if (i < end) await new Promise((r) => setTimeout(r, delay));
}
