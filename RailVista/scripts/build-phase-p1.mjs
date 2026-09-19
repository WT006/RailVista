/**
 * P1-A remainder + P1-B: stitch / local-graph builds.
 *   node scripts/build-phase-p1.mjs
 *   node scripts/build-phase-p1.mjs --only chengmianle,ningan,hanshi
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
mkdirSync(corrDir, { recursive: true });

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0
    ? new Set(
        process.argv[i + 1]
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
})();

function want(id) {
  return !onlyArg || onlyArg.has(id);
}

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function nearestIdx(rail, lng, lat) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < rail.length; i++) {
    const d = Math.hypot(rail[i][0] - lng, rail[i][1] - lat);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return { i: bi, d: bd };
}

function run(cmd, args) {
  console.log('\n>', cmd, args.join(' '));
  const r = spawnSync(process.execPath, [cmd, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  return r.status === 0;
}

const localGraph = join(__dirname, 'build-corridor-from-local-graph.mjs');
const clean = join(__dirname, 'clean-corridors.mjs');
const densify = join(__dirname, '_densify-one.mjs');
const ok = [];
const fail = [];

/** 成绵乐：西成江油→成都东 + 成贵成都东→乐山（文档工程名；几何与西成/成贵共线） */
function buildChengmianle() {
  const xicheng = JSON.parse(readFileSync(join(corrDir, 'xicheng.json'), 'utf8'));
  const chenggui = JSON.parse(readFileSync(join(corrDir, 'chenggui.json'), 'utf8'));
  const jy = nearestIdx(xicheng.railway, 105.068676, 31.982891);
  const cdX = nearestIdx(xicheng.railway, 104.120906, 30.59167);
  const cdC = nearestIdx(chenggui.railway, 104.120906, 30.59167);
  const ls = nearestIdx(chenggui.railway, 103.705986, 29.546472);
  // 峨眉山站 wiki 近似
  const emei = nearestIdx(chenggui.railway, 103.484, 29.599);
  console.log('snap', { jy, cdX, cdC, ls, emei });

  let north = xicheng.railway.slice(Math.min(jy.i, cdX.i), Math.max(jy.i, cdX.i) + 1);
  if (jy.i > cdX.i) north = [...north].reverse();

  // prefer 乐山 if 峨眉山 snap is far (>0.05 deg ~5km)
  const southEnd = emei.d < 0.05 ? emei : ls;
  let south = chenggui.railway.slice(
    Math.min(cdC.i, southEnd.i),
    Math.max(cdC.i, southEnd.i) + 1,
  );
  if (cdC.i > southEnd.i) south = [...south].reverse();

  // stitch at Chengdu East (drop duplicate first point of south)
  const railway = [...north];
  const southTail = south.slice(1);
  if (southTail.length && railway.length) {
    const gap = haversine(railway.at(-1), southTail[0]);
    console.log('join gap km', gap.toFixed(2));
  }
  railway.push(...southTail);

  const meta = {
    id: 'chengmianle',
    name: '成绵乐城际',
    source: 'slice:xicheng+chenggui',
    sourceNames: ['西成高铁', '成贵高铁', '成绵乐城际铁路'],
    note: '文档成绵乐=西成江成段+成贵成乐段（及峨眉支线若可吸附）；禁止再从残缺 hsr 名硬抽',
    stationsHint: [
      '江油',
      '绵阳',
      '德阳',
      '广汉北',
      '成都东',
      '双流机场',
      '眉山东',
      '乐山',
      '峨眉山',
    ],
    railway,
  };
  writeFileSync(join(corrDir, 'chengmianle.json'), JSON.stringify(meta));
  console.log('written chengmianle', railway.length, 'pts');
  return true;
}

const jobs = [];

if (want('chengmianle')) {
  jobs.push({
    id: 'chengmianle',
    run: () => buildChengmianle(),
  });
}

if (want('ningan')) {
  jobs.push({
    id: 'ningan',
    run: () => {
      // 宁安：hsr 图无完整「宁安」名，按 via 站分段（南京南→芜湖→铜陵北→池州→安庆）
      const vias = [
        '118.7987,31.9689',
        '117.959369,31.098699',
        '117.998248,31.037307',
        '117.49,30.66',
        '117.0600515,30.5515037',
      ];
      const tmp = [];
      for (let i = 0; i < vias.length - 1; i++) {
        const tid = `ningan__leg${i}`;
        tmp.push(tid);
        const okLeg = run(localGraph, [
          tid,
          '--name',
          `宁安城际-leg${i}`,
          '--from',
          vias[i],
          '--to',
          vias[i + 1],
          '--tol',
          '0.12',
          '--hint',
          'a,b',
        ]);
        if (!okLeg) return false;
      }
      const rails = [];
      for (const tid of tmp) {
        const c = JSON.parse(readFileSync(join(corrDir, `${tid}.json`), 'utf8'));
        if (!rails.length) rails.push(...c.railway);
        else rails.push(...c.railway.slice(1));
      }
      writeFileSync(
        join(corrDir, 'ningan.json'),
        JSON.stringify({
          id: 'ningan',
          name: '宁安城际',
          source: 'local-hsr-graph-legs',
          sourceNames: ['宁安城际', '宁安客运专线'],
          stationsHint: ['南京南', '芜湖', '铜陵北', '池州', '安庆'],
          railway: rails,
          note: 'via legs on local hsr graph (named 宁安 stub empty)',
        }),
      );
      for (const tid of tmp) {
        try {
          unlinkSync(join(corrDir, `${tid}.json`));
        } catch {
          /* ignore */
        }
      }
      return true;
    },
  });
}

if (want('hanshi')) {
  jobs.push({
    id: 'hanshi',
    run: () =>
      // already extracted; just clean/densify later
      existsSync(join(corrDir, 'hanshi.json')),
  });
}

if (want('jiaojikezhuan')) {
  jobs.push({
    id: 'jiaojikezhuan',
    run: () =>
      run(localGraph, [
        'jiaojikezhuan',
        '--name',
        '胶济客运专线',
        '--rail',
        '--from',
        '116.9851524,36.6708478', // 济南
        '--to',
        '120.329167,36.335764', // 青岛
        '--tol',
        '0.1',
        '--hint',
        '济南,淄博,潍坊,高密,胶州,青岛',
      ]),
  });
}

if (want('guangshenchengji')) {
  jobs.push({
    id: 'guangshenchengji',
    run: () => {
      // 广深城际 ≠ 广深港：走 china-rail「广深线」，分段降低 Dijkstra 失败率
      const vias = [
        '113.325,23.151', // 广州东
        '113.87,23.04', // 东莞附近
        '114.09,22.82', // 樟木头附近
        '114.117,22.532', // 深圳
      ];
      const tmp = [];
      for (let i = 0; i < vias.length - 1; i++) {
        const tid = `guangshenchengji__leg${i}`;
        tmp.push(tid);
        const okLeg = run(localGraph, [
          tid,
          '--name',
          `广深城际铁路-leg${i}`,
          '--rail',
          '--from',
          vias[i],
          '--to',
          vias[i + 1],
          '--tol',
          '0.12',
          '--hint',
          'a,b',
        ]);
        if (!okLeg) return false;
      }
      const rails = [];
      for (const tid of tmp) {
        const c = JSON.parse(readFileSync(join(corrDir, `${tid}.json`), 'utf8'));
        if (!rails.length) rails.push(...c.railway);
        else rails.push(...c.railway.slice(1));
      }
      writeFileSync(
        join(corrDir, 'guangshenchengji.json'),
        JSON.stringify({
          id: 'guangshenchengji',
          name: '广深城际铁路',
          source: 'local-rail-graph-legs',
          sourceNames: ['广深线', '广深城际铁路'],
          stationsHint: ['广州东', '东莞', '常平', '樟木头', '深圳'],
          railway: rails,
          note: 'prefer 广深线 via legs; NOT guangshengang',
        }),
      );
      for (const tid of tmp) {
        try {
          unlinkSync(join(corrDir, `${tid}.json`));
        } catch {
          /* ignore */
        }
      }
      return true;
    },
  });
}

for (const job of jobs) {
  console.log('\n========', job.id, '========');
  try {
    const good = job.run();
    if (!good) {
      fail.push({ id: job.id, step: 'build' });
      continue;
    }
    if (!run(clean, ['--write', '--id', job.id])) {
      fail.push({ id: job.id, step: 'clean' });
      continue;
    }
    // densify if still jumpy
    run(densify, [job.id, '--max', '8', '--write']);
    ok.push(job.id);
  } catch (e) {
    console.error(e);
    fail.push({ id: job.id, step: 'exception', err: String(e.message || e) });
  }
}

console.log('\nP1 build done');
console.log('ok:', ok.join(', ') || '(none)');
console.log('fail:', fail.length ? JSON.stringify(fail) : '(none)');
process.exit(fail.length ? 1 : 0);
