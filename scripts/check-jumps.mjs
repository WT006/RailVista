/**
 * 万里路书 · 几何跳变体检（scripts/check-jumps.mjs）
 *
 * 逐条扫描 data/roads/geom/*.json，找出相邻点之间「没有直连说明却出现大跳变」的位置——
 * 这类跳变在地图上就是一条横穿一切的直线（俗称「飞线」），必须清零。
 *
 * 用法：node scripts/check-jumps.mjs [toleranceKm]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { haversineM } from './lib/road-assemble.mjs';

const TOL_KM = Number(process.argv[2] || 20);
const DIR = join('data', 'roads', 'geom');
const rows = [];
for (const f of readdirSync(DIR).filter((x) => /^G\d{3}\.json$/.test(x)).sort()) {
  const g = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const p = g.points ?? [];
  let mx = 0, at = -1;
  const jumps = [];
  for (let i = 1; i < p.length; i += 1) {
    const d = haversineM(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) / 1000;
    if (d > TOL_KM) jumps.push({ i, km: Math.round(d * 100) / 100, at: p[i - 1].map((v) => (+v).toFixed(4)).join(',') });
    if (d > mx) { mx = d; at = i; }
  }
  const declared = (g.straightLinks ?? []).length;
  rows.push({ ref: g.ref ?? f.replace('.json', ''), pts: p.length, maxJump: Math.round(mx * 100) / 100, at, nJump: jumps.length, declared, jumps });
}
rows.sort((a, b) => b.maxJump - a.maxJump);
console.log('跳变最大的 20 条（阈值 ' + TOL_KM + 'km）:');
for (const r of rows.slice(0, 20)) {
  console.log(' ', r.ref, '最大跳变', r.maxJump + 'km', '| >阈跳变', r.nJump, '| 已声明直连', r.declared);
}
const bad = rows.filter((r) => r.nJump > r.declared);
console.log('\n未声明的飞线：', bad.length, '条');
for (const r of bad.slice(0, 20)) {
  console.log(' ', r.ref, r.jumps.slice(0, 5).map((j) => j.km + 'km@' + j.at).join(' | '));
}
writeFileSync('data/roads/reports/jump-check.csv',
  ['ref,pts,maxJumpKm,nJump,declared', ...rows.map((r) => [r.ref, r.pts, r.maxJump, r.nJump, r.declared].join(','))].join('\n'), 'utf8');
console.log('→ data/roads/reports/jump-check.csv');
