/**
 * 质量优先续批：stitch≤15km，verify --strict，禁大跨 densify，不覆盖枢纽锚
 *   node --max-old-space-size=8192 scripts/build-phase-p1-quality.mjs
 *   node --max-old-space-size=8192 scripts/build-phase-p1-quality.mjs --only hemao,jiajing
 */
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorridorFromGraph, haversine } from './lib/build-local-corridor-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
const geoPath = join(root, 'data/stations-geo.json');
const graphPath = join(root, 'data/rails/china-rail.graph');
const MAX_STITCH = 15;
const MAX_PATH_OD_RATIO = 1.4;

const PROTECTED = new Set([
  '南京',
  '西安',
  '重庆北',
  '北京',
  '北京南',
  '北京西',
  '上海',
  '上海虹桥',
  '杭州',
  '杭州东',
  '芜湖',
  '襄阳',
  '武汉',
  '汉口',
  '广州',
  '深圳',
  '成都',
  '昆明',
  '贵阳',
  '郑州东',
  '通辽',
]);

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0
    ? new Set(process.argv[i + 1].split(/[,，]/).map((s) => s.trim()).filter(Boolean))
    : null;
})();
const want = (id) => !onlyArg || onlyArg.has(id);

function run(args) {
  return (
    spawnSync(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
    }).status === 0
  );
}

function pathStats(coords) {
  let len = 0;
  let maxJ = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
    len += d;
    if (d > maxJ) maxJ = d;
  }
  const od = haversine(
    { lng: coords[0][0], lat: coords[0][1] },
    { lng: coords.at(-1)[0], lat: coords.at(-1)[1] },
  );
  return { len, od, maxJ, ratio: od > 1 ? len / od : 99 };
}

function densifyAny(id, maxKeep = 8) {
  const p = join(corrDir, `${id}.json`);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  const before = pathStats(c.railway);
  const out = [c.railway[0]];
  let added = 0;
  let maxFilled = 0;
  for (let i = 1; i < c.railway.length; i++) {
    const a = out.at(-1);
    const b = c.railway[i];
    const d = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    if (d > maxKeep) {
      maxFilled = Math.max(maxFilled, d);
      const n = Math.ceil(d / maxKeep);
      for (let k = 1; k < n; k++) {
        out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
        added += 1;
      }
    }
    out.push(b);
  }
  if (maxFilled > 20) {
    throw new Error(`refuse densify fill ${maxFilled.toFixed(1)}km >20`);
  }
  c.railway = out;
  c.note = `${c.note || ''} | densify>${maxKeep}km`.trim();
  writeFileSync(p, JSON.stringify(c));
  const after = pathStats(c.railway);
  console.log('densify', id, '+', added, 'ratio', after.ratio.toFixed(2), 'was', before.ratio.toFixed(2));
  if (after.ratio > MAX_PATH_OD_RATIO && after.od > 80) {
    throw new Error(`path/od ratio ${after.ratio.toFixed(2)} > ${MAX_PATH_OD_RATIO}`);
  }
}

function pipeline(id) {
  try {
    if (!run(['scripts/clean-corridors.mjs', '--write', '--id', id])) return false;
    densifyAny(id, 8);
    run(['scripts/clean-corridors.mjs', '--write', '--id', id]);
    run(['scripts/patch-corridor-od-approaches.mjs', '--write', '--id', id]);
    densifyAny(id, 8);
    if (!run(['scripts/verify-corridor-geometry.mjs', '--strict', '--id', id])) {
      throw new Error('verify fail');
    }
    const c = JSON.parse(readFileSync(join(corrDir, `${id}.json`), 'utf8'));
    const st = pathStats(c.railway);
    console.log('quality', id, 'pts', c.railway.length, 'len', st.len.toFixed(0), 'od', st.od.toFixed(0), 'ratio', st.ratio.toFixed(2), 'maxJ', st.maxJ.toFixed(1));
    if (st.maxJ > 8.5) throw new Error(`maxJump ${st.maxJ.toFixed(1)} after densify`);
    if (st.ratio > MAX_PATH_OD_RATIO && st.od > 80) throw new Error(`ratio ${st.ratio.toFixed(2)}`);
    return true;
  } catch (e) {
    console.error('pipeline reject', id, e.message || e);
    const p = join(corrDir, `${id}.json`);
    if (existsSync(p)) unlinkSync(p);
    return false;
  }
}

function buildOd(g, from, to, tol) {
  return buildCorridorFromGraph(g, {
    from,
    to,
    connectTol: tol,
    noPrefer: true,
    log: (...a) => console.log(...a),
  });
}

function buildVia(full, nameRe, hubs, { fullEnds = true } = {}) {
  const g = {
    ...full,
    ways: (full.ways || []).filter((w) => nameRe.test(String(w.name || ''))),
  };
  console.log('ways', g.ways.length, String(nameRe));
  if (g.ways.length < 5) throw new Error('too few ways');
  const parts = [];
  for (let i = 0; i < hubs.length - 1; i++) {
    const endLeg = i === 0 || i === hubs.length - 2;
    let r;
    try {
      r = buildOd(
        endLeg && fullEnds ? full : g,
        { lng: hubs[i][0], lat: hubs[i][1] },
        { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
        endLeg ? 0.18 : 0.2,
      );
    } catch {
      if (!fullEnds) throw new Error(`leg ${i} failed`);
      r = buildOd(
        full,
        { lng: hubs[i][0], lat: hubs[i][1] },
        { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
        0.25,
      );
    }
    parts.push(r.coords);
  }
  const all = [];
  for (const coords of parts) {
    if (!coords?.length) throw new Error('empty part');
    if (!all.length) {
      all.push(...coords);
      continue;
    }
    const gap = haversine(
      { lng: all.at(-1)[0], lat: all.at(-1)[1] },
      { lng: coords[0][0], lat: coords[0][1] },
    );
    console.log('stitch gap km', gap.toFixed(2));
    if (gap > MAX_STITCH) throw new Error(`stitch ${gap.toFixed(1)} > ${MAX_STITCH}`);
    all.push(...coords.slice(1));
  }
  return all;
}

function pinOd(geo, fromName, toName, coords, id) {
  const s = coords[0];
  const e = coords.at(-1);
  for (const [name, pt] of [
    [fromName, s],
    [toName, e],
  ]) {
    if (PROTECTED.has(name) && geo[name]?.lng) {
      const d = haversine(geo[name], { lng: pt[0], lat: pt[1] });
      console.log('protected', name, 'dist to end', d.toFixed(1));
      if (d > 5) throw new Error(`protected ${name} ${d.toFixed(1)}km from corridor — refuse overwrite`);
      continue;
    }
    geo[name] = { lng: pt[0], lat: pt[1], source: `corridor:${id}` };
  }
}

console.log('loading graph…');
const full = JSON.parse(readFileSync(graphPath, 'utf8'));
const geo = JSON.parse(readFileSync(geoPath, 'utf8'));

const jobs = [
  {
    id: 'hemao',
    name: '河茂线',
    re: /^河茂线$/,
    hint: ['河唇', '茂名'],
    hubs: [
      [110.35, 21.55],
      [110.6, 21.6],
      [110.92, 21.66],
    ],
  },
  {
    id: 'jiajing',
    name: '嘉镜线',
    re: /^嘉镜线$/,
    hint: ['嘉峪关', '镜铁山'],
    hubs: [
      [98.25, 39.8],
      [97.9, 39.5],
      [97.7, 39.25],
    ],
  },
  {
    id: 'kuibei',
    name: '奎北铁路',
    re: /^奎北线$/,
    hint: ['奎屯', '北屯市'],
    hubs: [
      [84.9, 44.42],
      [86.0, 45.5],
      [87.5, 46.5],
      [87.82, 47.35],
    ],
  },
  {
    id: 'beia',
    name: '北阿铁路',
    re: /^北阿线$/,
    hint: ['北屯市', '阿勒泰'],
    hubs: [
      [87.82, 47.35],
      [88.0, 47.6],
      [88.12, 47.85],
    ],
  },
  {
    id: 'zhangquan',
    name: '漳泉肖线',
    re: /^漳泉线$/,
    hint: ['漳平', '泉州'],
    hubs: [
      [117.42, 25.29],
      [118.0, 25.1],
      [118.6, 24.9],
    ],
  },
  {
    id: 'meishan',
    name: '广梅汕线',
    re: /^梅汕线$/,
    hint: ['梅州', '汕头'],
    hubs: [
      [116.12, 24.3],
      [116.4, 23.8],
      [116.68, 23.35],
    ],
  },
  {
    id: 'houyue',
    name: '侯月线',
    re: /^侯月线$/,
    hint: ['侯马', '月山'],
    hubs: [
      [111.37, 35.62],
      [111.8, 35.45],
      [112.3, 35.3],
      [112.7, 35.25],
      [113.05, 35.2],
    ],
  },
  {
    id: 'ganwu',
    name: '干武线',
    re: /^干武线$/,
    hint: ['干塘', '武威'],
    hubs: [
      [105.0, 37.45],
      [104.3, 37.6],
      [103.5, 37.8],
      [102.63, 37.93],
    ],
  },
  {
    id: 'huainan',
    name: '淮南线',
    re: /^淮南线$/,
    hint: ['芜湖', '淮南'],
    hubs: [
      [117.9594, 31.0987],
      [117.7, 31.5],
      [117.4, 31.9],
      [117.2, 32.3],
      [117.02, 32.63],
    ],
  },
  {
    id: 'meiji',
    name: '梅集线',
    re: /^梅集线$/,
    hint: ['梅河口', '集安'],
    hubs: [
      [125.68, 42.53],
      [125.9, 41.9],
      [126.05, 41.5],
      [126.18, 41.12],
    ],
  },
  {
    id: 'fengfu',
    name: '峰福线',
    re: /^峰福线$/,
    hint: ['横峰', '福州'],
    hubs: [
      [117.6, 28.4],
      [118.0, 27.8],
      [118.4, 27.0],
      [118.8, 26.4],
      [119.3, 26.08],
    ],
  },
  {
    id: 'neiliu',
    name: '内六线',
    re: /^内六线$/,
    hint: ['内江', '六盘水'],
    hubs: [
      [105.05, 29.58],
      [104.7, 28.8],
      [104.4, 28.0],
      [104.5, 27.2],
      [104.85, 26.6],
    ],
  },
  {
    id: 'lizhan',
    name: '黎湛线',
    re: /^黎湛线$/,
    hint: ['黎塘', '湛江'],
    hubs: [
      [109.22, 23.2],
      [109.6, 22.7],
      [110.0, 22.2],
      [110.2, 21.7],
      [110.403, 21.19],
    ],
  },
  {
    id: 'xiping',
    name: '西平线',
    re: /^西平线$/,
    hint: ['西安', '平凉'],
    hubs: [
      [108.9578972, 34.2799595],
      [108.3, 34.7],
      [107.6, 35.1],
      [107.0, 35.4],
      [106.68, 35.54],
    ],
  },
];

const ok = [];
const fail = [];

for (const job of jobs) {
  if (!want(job.id)) continue;
  console.log('\n########', job.id, '########');
  try {
    const coords = buildVia(full, job.re, job.hubs);
    const st0 = pathStats(coords);
    console.log('raw', 'pts', coords.length, 'len', st0.len.toFixed(0), 'od', st0.od.toFixed(0), 'ratio', st0.ratio.toFixed(2), 'maxJ', st0.maxJ.toFixed(1));
    if (st0.maxJ > 40) throw new Error(`raw maxJump ${st0.maxJ.toFixed(1)} too large before densify`);
    pinOd(geo, job.hint[0], job.hint[1], coords, job.id);
    writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
    writeFileSync(
      join(corrDir, `${job.id}.json`),
      JSON.stringify({
        id: job.id,
        name: job.name,
        source: 'local-rail-graph-named',
        sourceNames: [job.name],
        stationsHint: job.hint,
        railway: coords,
        note: `name-filter ${job.name} | quality stitch≤${MAX_STITCH}km`,
      }),
    );
    if (pipeline(job.id)) ok.push(job.id);
    else fail.push(job.id);
  } catch (e) {
    console.error(job.id, e.message || e);
    const p = join(corrDir, `${job.id}.json`);
    if (existsSync(p)) unlinkSync(p);
    fail.push(job.id);
  }
}

console.log('\nOK', ok.join(', ') || '(none)');
console.log('FAIL', fail.join(', ') || '(none)');
process.exit(fail.length ? 1 : 0);
