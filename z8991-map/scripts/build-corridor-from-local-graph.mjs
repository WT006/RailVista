/**
 * 从本地 china-hsr.graph（或 china-rail.graph）按 OD 拼走廊。
 *   node scripts/build-corridor-from-local-graph.mjs <outId> --name 名 --from lng,lat --to lng,lat [--hint a,b] [--rail]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorridorFromGraph } from './lib/build-local-corridor-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outId = process.argv[2];
if (!outId) {
  console.error('usage: node scripts/build-corridor-from-local-graph.mjs <outId> --from lng,lat --to lng,lat ...');
  process.exit(1);
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
function has(flag) {
  return process.argv.includes(flag);
}
function parseLL(s) {
  const [lng, lat] = String(s || '').split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error(`bad ll ${s}`);
  return { lng, lat };
}

const displayName = arg('--name') || outId;
const from = parseLL(arg('--from'));
const to = parseLL(arg('--to'));
const hint = (arg('--hint') || '')
  .split(/[,，]/)
  .map((s) => s.trim())
  .filter(Boolean);
const useRail = has('--rail');
const graphPath = join(
  root,
  useRail ? 'data/rails/china-rail.graph' : 'data/rails/china-hsr.graph',
);
const CONNECT_TOL = Number(arg('--tol') || 0.05);
const bridgeArg = arg('--bridge');
const noPrefer = has('--no-prefer');
const preferName = arg('--prefer');

if (!existsSync(graphPath)) {
  console.error('missing graph', graphPath);
  process.exit(1);
}
const g = JSON.parse(readFileSync(graphPath, 'utf8'));

let result;
try {
  result = buildCorridorFromGraph(g, {
    from,
    to,
    connectTol: CONNECT_TOL,
    bridgeMax: bridgeArg != null ? Number(bridgeArg) : undefined,
    noPrefer,
    preferName: preferName || undefined,
    log: (...a) => console.log(...a),
  });
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(1);
}

const { coords, km, method, preferred, dijkstraKm } = result;
console.log(
  'simplified',
  coords.length,
  'km',
  km.toFixed(1),
  'start',
  coords[0],
  'end',
  coords.at(-1),
  method,
  dijkstraKm ? dijkstraKm.toFixed(1) : '',
);

const outDir = join(root, 'data/presets/corridors');
mkdirSync(outDir, { recursive: true });
const meta = {
  id: outId,
  name: displayName,
  source: useRail ? 'local-rail-graph' : 'local-hsr-graph',
  sourceNames: preferred ? [preferred, displayName] : [displayName],
  stationsHint: hint,
  railway: coords,
  note: [preferred ? `prefer:${preferred}` : null, method === 'greedy' ? 'greedy-stitch' : null]
    .filter(Boolean)
    .join(' | ') || undefined,
};
writeFileSync(join(outDir, `${outId}.json`), JSON.stringify(meta));
console.log('written', outId, `${(Buffer.byteLength(JSON.stringify(meta)) / 1024).toFixed(1)} KB`);
