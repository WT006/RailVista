/**
 * Fill corridor jumps using local china-rail.graph (no Overpass).
 *   node --max-old-space-size=8192 scripts/fill-corridor-local-gaps.mjs <id> [--min 12] [--prefer 线名]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorridorFromGraph, haversine } from './lib/build-local-corridor-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const id = process.argv[2];
if (!id) {
  console.error('usage: node scripts/fill-corridor-local-gaps.mjs <id> [--min 12] [--prefer name]');
  process.exit(1);
}
function arg(f) {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : null;
}
const minJump = Number(arg('--min') || 12);
const prefer = arg('--prefer') || null;
const corrPath = join(root, 'data/presets/corridors', `${id}.json`);
const graphPath = join(root, 'data/rails/china-rail.graph');
if (!existsSync(corrPath) || !existsSync(graphPath)) {
  console.error('missing corridor or graph');
  process.exit(1);
}

console.log('loading graph…');
const g = JSON.parse(readFileSync(graphPath, 'utf8'));
const corr = JSON.parse(readFileSync(corrPath, 'utf8'));
let line = corr.railway.map((c) => [Number(c[0]), Number(c[1])]);
let patched = 0;

for (let pass = 0; pass < 25; pass++) {
  let hit = false;
  for (let i = 1; i < line.length; i++) {
    const a = { lng: line[i - 1][0], lat: line[i - 1][1] };
    const b = { lng: line[i][0], lat: line[i][1] };
    const gap = haversine(a, b);
    if (gap < minJump) continue;
    try {
      const r = buildCorridorFromGraph(g, {
        from: a,
        to: b,
        connectTol: 0.15,
        preferName: prefer || undefined,
        log: () => {},
      });
      if (!r?.coords?.length || r.coords.length < 3) {
        console.warn('miss', gap.toFixed(1), line[i - 1], '→', line[i]);
        continue;
      }
      if (r.km > gap * 2.5 || r.km < gap * 0.6) {
        console.warn('bad len', gap.toFixed(1), '→', r.km.toFixed(1), r.preferred || r.method);
        continue;
      }
      // reject if bridge itself still has a jump >= original gap
      let bridgeMax = 0;
      for (let k = 1; k < r.coords.length; k++) {
        bridgeMax = Math.max(
          bridgeMax,
          haversine(
            { lng: r.coords[k - 1][0], lat: r.coords[k - 1][1] },
            { lng: r.coords[k][0], lat: r.coords[k][1] },
          ),
        );
      }
      if (bridgeMax >= gap - 0.5) {
        console.warn('bridge still gappy', gap.toFixed(1), 'bridgeMax', bridgeMax.toFixed(1));
        continue;
      }
      console.log(`fill ${gap.toFixed(1)} → ${r.km.toFixed(1)} pts=${r.coords.length} ${r.preferred || r.method}`);
      line = [...line.slice(0, i), ...r.coords.slice(1, -1), ...line.slice(i)];
      patched += 1;
      hit = true;
      break;
    } catch (e) {
      console.warn('err', gap.toFixed(1), String(e?.message || e));
    }
  }
  if (!hit) break;
}

const out = [line[0]];
for (let i = 1; i < line.length; i++) {
  if (haversine({ lng: out.at(-1)[0], lat: out.at(-1)[1] }, { lng: line[i][0], lat: line[i][1] }) >= 0.4) {
    out.push(line[i]);
  }
}
out.push(line.at(-1));
corr.railway = out.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]);
corr.note = `${corr.note || ''} | local-gap-fill n=${patched}`.trim();
writeFileSync(corrPath, JSON.stringify(corr));
console.log('done', id, 'patched', patched, 'pts', corr.railway.length);
