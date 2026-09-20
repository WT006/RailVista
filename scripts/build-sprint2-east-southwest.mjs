/**
 * Sprint 2: 宁芜 / 宣杭 / 淮南 / 黔桂 / 黎湛
 *   node --max-old-space-size=8192 scripts/build-sprint2-east-southwest.mjs
 *   node --max-old-space-size=8192 scripts/build-sprint2-east-southwest.mjs --only ningwu,xuanhang
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
    ? new Set(process.argv[i + 1].split(/[,，]/).map((s) => s.trim()).filter(Boolean))
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
 * 芜湖站 wiki 118.386, 31.350（已写入 stations-geo，勿再踩锚）
 * 宁芜 relation 兴卫村→火龙岗，需 OD approach 贴南京/芜湖
 */
const jobs = [
  [
    '1799881',
    'ningwu',
    '--name',
    '宁芜线',
    '--from',
    '118.792,32.087',
    '--to',
    '118.3860417,31.34975',
    '--via',
    '118.55,31.85;118.3,31.5',
    '--tol',
    '0.015',
    '--hint',
    '南京,马鞍山,芜湖',
  ],
  [
    '3046174',
    'xuanhang',
    '--name',
    '宣杭线',
    '--from',
    '118.758,30.945',
    '--to',
    '120.1783532,30.2459675',
    '--via',
    '119.2,30.7;119.6,30.5;120.0,30.35',
    '--tol',
    '0.015',
    '--hint',
    '宣城,长兴,杭州',
  ],
  // 黔桂 relation 龙里→柳州；贵阳→龙里另补 via-legs / approach
  [
    '3477112',
    'qiangui',
    '--name',
    '黔桂铁路',
    '--from',
    '106.67,26.58',
    '--to',
    '109.383645,24.310508',
    '--via',
    '107.0,26.2;107.518,26.259;108.066028,24.7',
    '--tol',
    '0.02',
    '--hint',
    '贵阳,都匀,金城江,柳州',
  ],
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
  run(approaches, ['--write', '--id', id]);
  if (!run(verify, ['--strict', '--id', id])) {
    console.error('FAIL verify --strict', id);
    process.exitCode = 1;
    continue;
  }
  console.log('PASS', id);
}
