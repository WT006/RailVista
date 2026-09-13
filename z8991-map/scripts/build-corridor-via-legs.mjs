/**
 * 多段 via 拼接：对每个 OD 段跑 bbox Dijkstra，再首尾相接
 * node scripts/build-corridor-via-legs.mjs <outId> --name 名 --hint a,b --legs "lng,lat;lng,lat;..."
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outId = process.argv[2];
function arg(f) {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : null;
}

const name = arg('--name') || outId;
const hint = (arg('--hint') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
const pad = arg('--pad') || '0.35';
const tol = arg('--tol') || '0.03';
const legs = (arg('--legs') || '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
if (legs.length < 2) {
  console.error('need --legs "lng,lat;lng,lat;..."');
  process.exit(1);
}

const bbox = join(__dirname, 'build-corridor-from-osm-bbox.mjs');
const tmpIds = [];
const all = [];

for (let i = 0; i < legs.length - 1; i++) {
  const tmpId = `${outId}__leg${i}`;
  tmpIds.push(tmpId);
  console.log('\n--- leg', i, legs[i], '->', legs[i + 1]);
  const r = spawnSync(
    process.execPath,
    [
      bbox,
      tmpId,
      '--name',
      `${name}-leg${i}`,
      '--from',
      legs[i],
      '--to',
      legs[i + 1],
      '--pad',
      pad,
      '--tol',
      tol,
      '--hint',
      'a,b',
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error('leg failed', i);
    process.exit(r.status || 1);
  }
  const c = JSON.parse(readFileSync(join(__dirname, '../data/presets/corridors', `${tmpId}.json`), 'utf8'));
  const pts = c.railway || [];
  if (!all.length) all.push(...pts);
  else all.push(...pts.slice(1));
}

const meta = {
  id: outId,
  name,
  source: 'osm-bbox',
  sourceNames: [name],
  note: `via-legs ${legs.length - 1} segments`,
  stationsHint: hint,
  railway: all,
};
writeFileSync(join(__dirname, '../data/presets/corridors', `${outId}.json`), JSON.stringify(meta));
for (const id of tmpIds) {
  const p = join(__dirname, '../data/presets/corridors', `${id}.json`);
  if (existsSync(p)) unlinkSync(p);
}
console.log('written', outId, 'pts', all.length);
