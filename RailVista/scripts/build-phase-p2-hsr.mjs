/**
 * P2/P3：从 hsr-rails 抽取源几何足够的城际（过 clean + verify --strict 才保留）。
 * 合杭→已有 shanghehang；鲁南→已有 rilan（仅映射，不重抽）。
 * 源空/过短（成雅/崇礼/川南/佛莞/广惠/哈佳/金建/龙漳/牡佳/南龙/武石 等）→ 不硬抽。
 *
 *   node scripts/build-phase-p2-hsr.mjs
 *   node scripts/build-phase-p2-hsr.mjs --only jingxiong,weilai
 */
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const extract = join(__dirname, 'extract-corridor-from-hsr.mjs');
const clean = join(__dirname, 'clean-corridors.mjs');
const verify = join(__dirname, 'verify-corridor-geometry.mjs');
const patchOd = join(__dirname, 'patch-corridor-od-approaches.mjs');
const seed = join(__dirname, '_seed-p2-stations.mjs');
const corrDir = join(root, 'data/presets/corridors');

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

/** @type {[string, string, ...string[]][]} */
const jobs = [
  // 广清：南→北 广州→清远
  ['广清城际线|广清城际铁路', 'guangqing', '--axis', 'ns', '--reverse'],
  // 广肇：东→西 广州南→肇庆
  ['广肇城际线', 'guangzhao', '--axis', 'ew'],
  // 京滨：西→东 北京→滨海
  ['京滨城际线', 'jingbin', '--axis', 'ew', '--reverse'],
  // 京唐：西→东 副中心→唐山
  ['京唐城际线', 'jingtang', '--axis', 'ew', '--reverse'],
  // 京雄：北→南 北京→雄安
  ['京雄城际线', 'jingxiong', '--axis', 'ns'],
  // 潍莱：仅潍莱段（不含莱荣）
  ['潍荣高速线潍莱段', 'weilai', '--axis', 'ew', '--reverse'],
  // 武冈：西→东 武汉→黄冈
  ['武冈城际线', 'wugang', '--axis', 'ew', '--reverse'],
  // 武咸：北→南 武汉→咸宁
  ['武咸城际铁路', 'wuxian', '--axis', 'ns'],
  // 武孝：南→北 汉口→孝感
  ['武孝城际铁路|武孝城际线', 'wuxiao', '--axis', 'ns', '--reverse'],
  // 郑机：北→南 郑州东→机场
  ['郑机城际线', 'zhengji', '--axis', 'ns'],
  // 穗深：北→南 广州→深圳机场（P3）
  ['穗深城际铁路', 'suishen', '--axis', 'ns'],
  // 广州东环：短线，试抽；过不了门禁则删除
  ['广州东环城际铁路', 'guangzhoudonghuan', '--axis', 'ns', '--reverse'],
];

function run(args) {
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  return r.status === 0;
}

const ok = [];
const fail = [];

for (const [name, id, ...flags] of jobs) {
  if (onlyArg && !onlyArg.has(id)) continue;
  console.log('\n======== extract', id, '========');
  if (!run([extract, name, id, ...flags])) {
    fail.push({ id, step: 'extract' });
    continue;
  }
  console.log('\n======== clean', id, '========');
  if (!run([clean, '--write', '--id', id])) {
    fail.push({ id, step: 'clean' });
    continue;
  }
  console.log('\n======== seed stations', id, '========');
  run([seed, '--only', id]);
  // OD 轻补（失败不阻断，靠 verify 决定去留）
  if (existsSync(patchOd)) {
    console.log('\n======== patch-od', id, '========');
    run([patchOd, '--id', id, '--write']);
  }
  console.log('\n======== verify --strict', id, '========');
  if (!run([verify, '--strict', '--id', id])) {
    const path = join(corrDir, `${id}.json`);
    if (existsSync(path)) {
      unlinkSync(path);
      console.log('REMOVED (verify fail):', id);
    }
    fail.push({ id, step: 'verify' });
    continue;
  }
  ok.push(id);
}

console.log('\nP2 HSR batch done');
console.log('ok:', ok.join(', ') || '(none)');
console.log('fail:', fail.length ? JSON.stringify(fail) : '(none)');
process.exit(fail.length ? 1 : 0);
