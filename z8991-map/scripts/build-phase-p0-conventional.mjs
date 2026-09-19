/**
 * P0 普速干线：本地 china-rail.graph 批量建走廊
 *   node --max-old-space-size=8192 scripts/build-phase-p0-conventional.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const build = join(__dirname, 'build-corridor-from-local-graph.mjs');
const clean = join(__dirname, 'clean-corridors.mjs');
const densify = join(__dirname, 'densify-corridor-jumps.mjs');
const verify = join(__dirname, 'verify-corridor-geometry.mjs');

const jobs = [
  // 已有：baolan / binzhou / jinghuxian / jinghaxian
  [
    'jingguangxian',
    '--name',
    '京广线',
    '--from',
    '116.4210134,39.9011168',
    '--to',
    '113.2644,23.1492',
    '--rail',
    '--hint',
    '北京,石家庄,郑州,武汉,长沙,广州',
    '--tol',
    '0.12',
  ],
  [
    'jingjiu',
    '--name',
    '京九线',
    '--from',
    '116.3151056,39.8935411',
    '--to',
    '114.1144127,22.604916',
    '--rail',
    '--hint',
    '北京西,衡水,商丘,南昌,赣州,深圳东',
    '--tol',
    '0.12',
  ],
  [
    'hukunxian',
    '--name',
    '沪昆线',
    '--from',
    '121.455,31.25',
    '--to',
    '102.720287,25.018662',
    '--rail',
    '--hint',
    '上海,杭州,南昌,长沙,贵阳,昆明',
    '--tol',
    '0.12',
  ],
  [
    'jiaoliu',
    '--name',
    '焦柳线',
    '--from',
    '113.2287096,35.2225958',
    '--to',
    '109.3836447,24.3105077',
    '--rail',
    '--hint',
    '焦作,洛阳,襄阳,怀化,柳州',
    '--tol',
    '0.12',
  ],
  [
    'hutong',
    '--name',
    '沪通铁路',
    '--from',
    '121.455,31.25',
    '--to',
    '120.757454,32.098285',
    '--rail',
    '--hint',
    '上海,太仓,南通',
    '--tol',
    '0.1',
  ],
];

const ok = [];
const fail = [];

for (const job of jobs) {
  const id = job[0];
  console.log('\n===', id, '===');
  const r = spawnSync(process.execPath, [build, ...job], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) {
    fail.push(id);
    const p = join(root, 'data/presets/corridors', `${id}.json`);
    if (existsSync(p)) unlinkSync(p);
    continue;
  }
  spawnSync(process.execPath, [clean, '--write', '--fill-jumps', '--id', id], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  spawnSync(process.execPath, [densify, '--write', '--max', '8'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  const v = spawnSync(process.execPath, [verify, '--strict', id], {
    cwd: root,
    encoding: 'utf8',
  });
  const out = (v.stdout || '') + (v.stderr || '');
  const heavy = new RegExp(`WARN ${id}: tier=heavy`).test(out);
  const medium = new RegExp(`WARN ${id}: tier=medium`).test(out);
  if (heavy || medium) {
    console.warn('REJECT', id, heavy ? 'heavy' : 'medium');
    fail.push(id);
    const p = join(root, 'data/presets/corridors', `${id}.json`);
    if (existsSync(p)) unlinkSync(p);
  } else {
    ok.push(id);
  }
}

console.log('\nOK', ok.join(', ') || '(none)');
console.log('FAIL', fail.join(', ') || '(none)');
