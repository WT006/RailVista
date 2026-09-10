/**
 * 一键重建第一期精品走廊（需已有 _hsr-rails.geojson，或加 --download）
 * node scripts/build-phase1-corridors.mjs
 * node scripts/build-phase1-corridors.mjs --download
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = join(__dirname, 'extract-corridor-from-hsr.mjs');
const extra = process.argv.includes('--download') ? ['--download'] : [];

const jobs = [
  ['京沪高铁', 'jinghu', '--axis', 'ns'],
  ['京广高速线', 'jingguang', '--axis', 'ns'],
  ['沪昆高速线|沪昆高速铁路', 'hukun', '--axis', 'ew'],
  ['徐兰高速线', 'xulan', '--axis', 'ew'],
  ['京哈高速线', 'jingha', '--axis', 'ns', '--reverse'],
  ['沈大高速线', 'haida', '--axis', 'ns'],
];

for (const [name, id, ...flags] of jobs) {
  console.log('\n========', id, '========');
  const r = spawnSync(process.execPath, [script, name, id, ...flags, ...extra], {
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
console.log('\nphase-1 corridors done');
spawnSync(process.execPath, [join(__dirname, 'seed-corridor-stations-geo.mjs')], {
  stdio: 'inherit',
});
console.log('stations-geo seeded');
