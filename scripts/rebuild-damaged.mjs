#!/usr/bin/env node
// rebuild-damaged.mjs —— 批量重建被环修剪误伤的 geom 文件
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const damage = JSON.parse(fs.readFileSync('scripts/damage-list.json', 'utf8'));
const provFiles = damage.filter((f) => !f.startsWith('G'));
const gLoop = ['G93', 'G94', 'G1001', 'G2501', 'G3002', 'G4001', 'G4202', 'G5001', 'G9902', 'G9903', 'G9911'];
const gThrough = ['G220', 'G228']; // national 构建器
const gExpThrough = ['G59']; // expressway 构建器

const run = (cmd, args) => {
  try {
    const out = execFileSync('node', [cmd, ...args], { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
    return out;
  } catch (e) {
    return 'ERR ' + String(e.message).slice(0, 200);
  }
};

const check = (f) => {
  try {
    const g = JSON.parse(fs.readFileSync('data/roads/geom/' + f, 'utf8'));
    return `pts=${g.points.length} total=${g.totalKm}`;
  } catch { return 'MISSING'; }
};

console.log('=== 省道/县乡道 rebuild:', provFiles.length, '===');
for (const f of provFiles) {
  const key = f.replace('.json', '').replace('_', ':');
  run('scripts/build-road-geom.mjs', ['--key', key]);
  console.log(' ', key, '=>', check(f));
}

console.log('=== 环线高速 rebuild:', gLoop.length, '===');
for (const ref of gLoop) {
  run('scripts/build-road-geom.mjs', ['--key', ref]);
  console.log(' ', ref, '=>', check(ref + '.json'));
}

console.log('=== 国道 through rebuild ===');
for (const ref of gThrough) {
  const out = run('scripts/build-national-through.mjs', [ref]);
  console.log(' ', ref, '=>', check(ref + '.json'), (out.match(/贯通|缺口|组件/g) || []).slice(0, 3).join(' '));
}
for (const ref of gExpThrough) {
  const out = run('scripts/build-expressway-through.mjs', [ref]);
  console.log(' ', ref, '=>', check(ref + '.json'));
}
console.log('DONE');
