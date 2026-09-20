/**
 * Sprint 1: 宁蓉(沪蓉) + 成渝线 + 汉丹线 — OSM relation + Dijkstra
 *   node --max-old-space-size=8192 scripts/build-sprint1-ningrong-chengyu-handan.mjs
 *   node --max-old-space-size=8192 scripts/build-sprint1-ningrong-chengyu-handan.mjs --only chengyuxian,handan
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const osm = join(__dirname, 'build-corridor-from-osm-relation.mjs');
const clean = join(__dirname, 'clean-corridors.mjs');
const verify = join(__dirname, 'verify-corridor-geometry.mjs');
const approaches = join(__dirname, 'patch-corridor-od-approaches.mjs');

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

function run(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  return r.status === 0;
}

/**
 * [relationId, outId, ...flags]
 * 成渝/汉丹 = 普速；宁蓉 = 快速（沪蓉 OSM 名），勿套 hsr-rails 抽轨。
 */
const jobs = [
  // 成渝线 成都→重庆（普速，非成渝高铁）；via 压 U 形段
  [
    '1965907',
    'chengyuxian',
    '--name',
    '成渝线',
    '--from',
    '104.067789,30.699866',
    '--to',
    '106.527533,29.504507',
    '--via',
    '104.53,30.38;105.058,29.580;105.90,29.35',
    '--tol',
    '0.012',
    '--hint',
    '成都,简阳,资阳,资中,内江,隆昌,荣昌,永川,璧山,重庆',
  ],
  // 汉丹铁路 汉口→丹江口；via 防双线震荡与襄阳枢纽回折
  [
    '2201129',
    'handan',
    '--name',
    '汉丹线',
    '--from',
    '114.2494144,30.6216514',
    '--to',
    '111.513,32.540',
    '--via',
    '113.75,31.02;113.37,31.72;112.21,32.09;111.65,32.27',
    '--tol',
    '0.012',
    '--hint',
    '汉口,云梦,安陆,随州,襄阳,谷城,丹江口',
  ],
  // 宁蓉：全量 OSM relation Dijkstra 里程异常；改 stitch 既有段 + 西段 via-legs
  //   node scripts/build-ningrong-stitch.mjs
];

for (const job of jobs) {
  const id = job[1];
  if (onlyArg && !onlyArg.has(id)) continue;
  console.log('\n========', id, '========');
  if (!run(osm, job)) {
    console.error('FAIL extract', id);
    process.exitCode = 1;
    continue;
  }
  if (!run(clean, ['--write', '--id', id])) {
    console.error('FAIL clean', id);
    process.exitCode = 1;
    continue;
  }
  // OD approach patch（≤8km 缝）；失败不阻断，strict 再拦
  run(approaches, ['--write', '--id', id]);
  if (!run(verify, ['--strict', '--id', id])) {
    console.error('FAIL verify --strict', id);
    process.exitCode = 1;
    continue;
  }
  console.log('PASS', id);
}
