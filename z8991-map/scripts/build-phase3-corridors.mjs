/**
 * 一键重建第三期精品走廊（八纵八横补网 + 宁杭等关键段）
 * node scripts/build-phase3-corridors.mjs
 * node scripts/build-phase3-corridors.mjs --download
 *
 * 源数据不足暂缓：包银（过短）、商合杭（几乎为空）、石太（几乎为空）、
 * 绥满/厦渝完整干线、沪汉蓉中段（合武/汉宜/渝利）
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = join(__dirname, 'extract-corridor-from-hsr.mjs');
const extra = process.argv.includes('--download') ? ['--download'] : [];

/** @type {[string, string, ...string[]][]} */
const jobs = [
  // 关键补网：济南→杭州缺的宁杭段（南京南→杭州东）
  ['宁杭高速线', 'ninghang', '--axis', 'ns'],
  // 京港通道相关
  ['合福高速线', 'hefu', '--axis', 'ns'],
  // 杭昌：东→西 = 杭州→南昌
  ['杭昌高速线', 'hangchang', '--axis', 'ew'],
  // 京昆通道：大西（大同→西安）+ 西成（西安→成都）
  ['大西高速线', 'daxi', '--axis', 'ns'],
  ['西成高铁|西安至成都专线客运专线', 'xicheng', '--axis', 'ns'],
  // 包（银）海相关：银西（银川→西安）、银兰（银川→兰州）
  ['银西高铁', 'yinxi', '--axis', 'ns'],
  ['银兰高速线|银兰高铁', 'yinlan', '--axis', 'ns'],
  // 广昆 / 贵广：贵阳→广州（ew 源为广州→贵阳，需 reverse）
  ['贵广高铁', 'guiguang', '--axis', 'ew', '--reverse'],
  ['贵南高铁', 'guinan', '--axis', 'ns'],
  // 南昆：东→西 = 南宁→昆明
  ['南昆高速铁路', 'nankun', '--axis', 'ew'],
  // 青银 / 陆桥相关
  ['郑太高铁', 'zhengtai', '--axis', 'ns', '--reverse'],
  // 日兰：东→西 = 日照→兰考
  ['日兰高速线|日兰高铁', 'rilan', '--axis', 'ew'],
];

for (const [name, id, ...flags] of jobs) {
  console.log('\n========', id, '========');
  const r = spawnSync(process.execPath, [script, name, id, ...flags, ...extra], {
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log('\nphase-3 corridors done');
spawnSync(process.execPath, [join(__dirname, 'seed-corridor-stations-geo.mjs')], {
  stdio: 'inherit',
});
console.log('stations-geo seeded');
