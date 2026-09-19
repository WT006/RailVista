/**
 * P0 高铁补网：仅跑 hsr-rails 源几何足够的线（≥~100km）。
 * 源空/过短（石太、石济、合蚌、秦沈、渝万、潍烟不完整、杭甬/甬台温等无源）→ 见 docs/corridor-coverage-gap.md 暂缓，改走 OSM。
 *
 *   node scripts/build-phase-p0-hsr.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extract = join(__dirname, 'extract-corridor-from-hsr.mjs');
const clean = join(__dirname, 'clean-corridors.mjs');
const verify = join(__dirname, 'verify-corridor-geometry.mjs');

/** @type {[string, string, ...string[]][]} */
const jobs = [
  // 京津：默认 ew 东→西 = 滨海→北京；reverse → 北京南→天津/滨海
  ['京津城际线|京津城际延长线', 'jingjin', '--axis', 'ew', '--reverse'],
  // 沪宁：东→西 = 上海→南京
  ['沪宁城际线|沪宁城际铁路|沪宁城际虹桥联络线', 'huning', '--axis', 'ew'],
  // 沪苏湖：东→西 ≈ 上海→湖州
  ['沪苏湖高速铁路', 'husuhu', '--axis', 'ew'],
  // 济青：东→西 = 青岛→济南；reverse → 济南东→青岛
  ['济青高速线|济青高速铁路', 'jiqing', '--axis', 'ew', '--reverse'],
  // 常益长：东→西 = 长沙→常德；reverse → 常德→长沙
  ['常益长高速铁路', 'changyichang', '--axis', 'ew', '--reverse'],
  // 昌九：北→南 = 九江→南昌；reverse → 南昌→九江
  ['昌九城际线', 'changjiu', '--axis', 'ns', '--reverse'],
  // 盘营：北→南（辽中→营口方向，源较短）
  ['盘营高铁', 'panying', '--axis', 'ns'],
  // 津秦：东→西 = 秦皇岛→天津；reverse → 天津→秦皇岛
  ['津秦高速线|津秦城际联络线', 'jinqin', '--axis', 'ew', '--reverse'],
];

const ok = [];
const fail = [];

for (const [name, id, ...flags] of jobs) {
  console.log('\n======== extract', id, '========');
  const r = spawnSync(process.execPath, [extract, name, id, ...flags], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    fail.push({ id, step: 'extract', status: r.status });
    continue;
  }
  console.log('\n======== clean', id, '========');
  const c = spawnSync(process.execPath, [clean, '--write', '--id', id], {
    stdio: 'inherit',
  });
  if (c.status !== 0) {
    fail.push({ id, step: 'clean', status: c.status });
    continue;
  }
  ok.push(id);
}

console.log('\n======== verify --strict (new + all) ========');
const v = spawnSync(process.execPath, [verify, '--strict'], { stdio: 'inherit' });

console.log('\nP0 HSR batch done');
console.log('ok:', ok.join(', ') || '(none)');
console.log('fail:', fail.length ? JSON.stringify(fail) : '(none)');
console.log('verifyStatus:', v.status);
process.exit(fail.length || v.status ? 1 : 0);
