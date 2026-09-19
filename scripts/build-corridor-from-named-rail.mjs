/**
 * 从本地 china-rail.graph 按名称过滤后 Dijkstra（比全图 prefer 更干净）。
 *   node scripts/build-corridor-from-named-rail.mjs <outId> --name 陇海线 --name-re 陇海线 --from lng,lat --to lng,lat --hint a,b
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorridorFromGraph } from './lib/build-local-corridor-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outId = process.argv[2];
if (!outId) {
  console.error('usage: node scripts/build-corridor-from-named-rail.mjs <outId> --name-re ... --from ... --to ...');
  process.exit(1);
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
function parseLL(s) {
  const [lng, lat] = String(s || '').split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error(`bad ll ${s}`);
  return { lng, lat };
}

const displayName = arg('--name') || outId;
const nameRe = new RegExp(arg('--name-re') || displayName);
const from = parseLL(arg('--from'));
const to = parseLL(arg('--to'));
const hint = (arg('--hint') || '')
  .split(/[,，]/)
  .map((s) => s.trim())
  .filter(Boolean);
const tol = Number(arg('--tol') || 0.08);
const useHsr = process.argv.includes('--hsr');
const graphPath = join(
  root,
  useHsr ? 'data/rails/china-hsr.graph' : 'data/rails/china-rail.graph',
);
if (!existsSync(graphPath)) {
  console.error('missing', graphPath);
  process.exit(1);
}

console.log('loading', graphPath);
const full = JSON.parse(readFileSync(graphPath, 'utf8'));
const ways = (full.ways || []).filter((w) => nameRe.test(String(w.name || '')));
console.log('matched ways', ways.length, 'pattern', nameRe);
if (ways.length < 5) {
  console.error('too few named ways');
  process.exit(1);
}

const g = { ...full, ways };
const result = buildCorridorFromGraph(g, {
  from,
  to,
  connectTol: tol,
  noPrefer: true,
  log: (...a) => console.log(...a),
});

const outDir = join(root, 'data/presets/corridors');
mkdirSync(outDir, { recursive: true });
const meta = {
  id: outId,
  name: displayName,
  source: useHsr ? 'local-hsr-graph-named' : 'local-rail-graph-named',
  sourceNames: [displayName, String(nameRe)],
  stationsHint: hint,
  railway: result.coords,
  note: `name-filter ${nameRe}; ${result.method} ${result.km.toFixed(0)}km`,
};
writeFileSync(join(outDir, `${outId}.json`), JSON.stringify(meta));
console.log(
  'written',
  outId,
  'pts',
  result.coords.length,
  'km',
  result.km.toFixed(1),
  result.method,
);
