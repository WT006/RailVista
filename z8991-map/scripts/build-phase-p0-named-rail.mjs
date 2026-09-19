/**
 * P0 普速：名称过滤本地 rail-graph → clean → densify → verify --strict
 *   node --max-old-space-size=8192 scripts/build-phase-p0-named-rail.mjs
 *   node --max-old-space-size=8192 scripts/build-phase-p0-named-rail.mjs --only longhai,lanqing
 */
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const build = join(__dirname, 'build-corridor-from-named-rail.mjs');
const clean = join(__dirname, 'clean-corridors.mjs');
const verify = join(__dirname, 'verify-corridor-geometry.mjs');
const approaches = join(__dirname, 'patch-corridor-od-approaches.mjs');
const corrDir = join(root, 'data/presets/corridors');
const geoPath = join(root, 'data/stations-geo.json');

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0
    ? new Set(process.argv[i + 1].split(/[,，]/).map((s) => s.trim()).filter(Boolean))
    : null;
})();

function run(args) {
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  return r.status === 0;
}

function densifyAny(id, maxKeep = 8) {
  const p = join(corrDir, `${id}.json`);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  function hv(a, b) {
    const R = 6371;
    const t = Math.PI / 180;
    const dLat = (b[1] - a[1]) * t;
    const dLng = (b[0] - a[0]) * t;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const out = [c.railway[0]];
  let added = 0;
  for (let i = 1; i < c.railway.length; i++) {
    const a = out.at(-1);
    const b = c.railway[i];
    const d = hv(a, b);
    if (d > maxKeep) {
      const n = Math.ceil(d / maxKeep);
      for (let k = 1; k < n; k++) {
        out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
        added += 1;
      }
    }
    out.push(b);
  }
  c.railway = out;
  c.note = `${c.note || ''} | densify>${maxKeep}km`.trim();
  writeFileSync(p, JSON.stringify(c));
  console.log('densify', id, '+', added);
}

function ensureStations(entries) {
  const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
  let n = 0;
  for (const [name, ll] of Object.entries(entries)) {
    if (!geo[name]?.lng) {
      geo[name] = { lng: ll[0], lat: ll[1], source: 'manual:wiki-approx' };
      n += 1;
    }
  }
  writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
  if (n) console.log('seeded stations', n);
}

ensureStations({
  连云港: [118.776316, 34.521284],
  兰州: [103.8485056, 36.034178],
  兰州西: [103.749037, 36.067145],
  西宁: [101.814362, 36.620233],
  乌鲁木齐: [87.5249702, 43.8379242],
  南京: [118.792, 32.087],
  南通: [120.757454, 32.098285],
  河口南: [103.55, 36.12],
});

/** [outId, ...flags] */
const jobs = [
  [
    'longhai',
    '--name',
    '陇海线',
    '--name-re',
    '^陇海线$',
    '--from',
    '118.776316,34.521284',
    '--to',
    '103.8485056,36.034178',
    '--tol',
    '0.1',
    '--hint',
    '连云港,兰州',
  ],
  [
    'lanxinxian',
    '--name',
    '兰新线',
    '--name-re',
    '^兰新线$',
    '--from',
    '103.8485056,36.034178',
    '--to',
    '87.5249702,43.8379242',
    '--tol',
    '0.12',
    '--hint',
    '兰州,乌鲁木齐',
  ],
  [
    'lanqing',
    '--name',
    '兰青铁路',
    '--name-re',
    '兰青',
    '--from',
    '103.749037,36.067145',
    '--to',
    '101.814362,36.620233',
    '--tol',
    '0.1',
    '--hint',
    '兰州西,西宁',
  ],
  [
    'ningqi',
    '--name',
    '宁启铁路',
    '--name-re',
    '宁启',
    '--from',
    '118.792,32.087',
    '--to',
    '120.757454,32.098285',
    '--tol',
    '0.1',
    '--hint',
    '南京,南通',
  ],
];

const ok = [];
const fail = [];

for (const job of jobs) {
  const id = job[0];
  if (onlyArg && !onlyArg.has(id)) continue;
  console.log('\n########', id, '########');
  if (!run([build, ...job])) {
    fail.push({ id, step: 'build' });
    continue;
  }
  if (!run([clean, '--write', '--id', id])) {
    fail.push({ id, step: 'clean' });
    continue;
  }
  densifyAny(id, 8);
  run([clean, '--write', '--id', id]);
  run([approaches, '--write', '--id', id]);
  densifyAny(id, 8);
  if (!run([verify, '--strict', '--id', id])) {
    const p = join(corrDir, `${id}.json`);
    if (existsSync(p)) unlinkSync(p);
    console.log('REMOVED', id);
    fail.push({ id, step: 'verify' });
    continue;
  }
  ok.push(id);
}

console.log('\nOK', ok.join(', ') || '(none)');
console.log('FAIL', JSON.stringify(fail));
process.exit(fail.length ? 1 : 0);
