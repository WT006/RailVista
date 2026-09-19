/**
 * 用本地 china-rail.graph 按 via 站分段拼走廊（同一进程只加载一次 graph）。
 *   node --max-old-space-size=8192 scripts/build-corridor-via-local-legs.mjs <outId> --name 名 --hint a,b --legs "lng,lat;..." [--tol 0.12]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorridorFromGraph, haversine } from './lib/build-local-corridor-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outId = process.argv[2];
function arg(f) {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : null;
}
if (!outId) {
  console.error('usage: node scripts/build-corridor-via-local-legs.mjs <outId> --name .. --legs ".."');
  process.exit(1);
}

const name = arg('--name') || outId;
const hint = (arg('--hint') || '')
  .split(/[,，]/)
  .map((s) => s.trim())
  .filter(Boolean);
const tol = Number(arg('--tol') || 0.12);
const legs = (arg('--legs') || '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
if (legs.length < 2) {
  console.error('need --legs "lng,lat;lng,lat;..."');
  process.exit(1);
}

const useHsr = process.argv.includes('--hsr');
const graphPath = join(
  root,
  useHsr ? 'data/rails/china-hsr.graph' : 'data/rails/china-rail.graph',
);
if (!existsSync(graphPath)) {
  console.error('missing graph', graphPath);
  process.exit(1);
}
console.log('loading graph once…', useHsr ? 'hsr' : 'rail');
const g = JSON.parse(readFileSync(graphPath, 'utf8'));
console.log('ways', (g.ways || []).length);

function parseLL(s) {
  const [lng, lat] = s.split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error(`bad ll ${s}`);
  return { lng, lat };
}

const all = [];
for (let i = 0; i < legs.length - 1; i++) {
  const from = parseLL(legs[i]);
  const to = parseLL(legs[i + 1]);
  console.log(`\n--- leg ${i} ${legs[i]} -> ${legs[i + 1]}`);
  let result;
  try {
    result = buildCorridorFromGraph(g, {
      from,
      to,
      connectTol: tol,
      log: (...a) => console.log(...a),
    });
  } catch (e) {
    console.error('leg failed', i, String(e?.message || e));
    process.exit(1);
  }
  const pts = result.coords;
  if (!pts.length) {
    console.error('empty leg', i);
    process.exit(1);
  }
  console.log(`leg ${i} pts=${pts.length} km=${result.km.toFixed(1)} ${result.method}`);
  if (all.length) {
    const gap = haversine(
      { lng: all.at(-1)[0], lat: all.at(-1)[1] },
      { lng: pts[0][0], lat: pts[0][1] },
    );
    if (gap > 25) {
      console.warn(`leg join gap ${gap.toFixed(1)}km — keep both (will densify later)`);
    }
    all.push(...pts.slice(1));
  } else {
    all.push(...pts);
  }
}

const corrDir = join(root, 'data/presets/corridors');
mkdirSync(corrDir, { recursive: true });

let km = 0;
for (let i = 1; i < all.length; i++) {
  km += haversine(
    { lng: all[i - 1][0], lat: all[i - 1][1] },
    { lng: all[i][0], lat: all[i][1] },
  );
}
const meta = {
  id: outId,
  name,
  source: useHsr ? 'local-hsr-graph-legs' : 'local-rail-graph-legs',
  sourceNames: [name],
  stationsHint: hint,
  railway: all,
  note: `via-legs n=${legs.length - 1} single-graph-load${useHsr ? ' hsr' : ''}`,
};
writeFileSync(join(corrDir, `${outId}.json`), JSON.stringify(meta));
console.log(`written ${outId} pts=${all.length} km=${km.toFixed(1)}`);
