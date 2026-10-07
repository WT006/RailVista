/**
 * 用省 bbox 反查 / 纠正公路景点的 province 字段（scripts/fill-spot-province.mjs）。
 *
 * 重叠框按面积最小归属（见 provinceOfPoint）：甘肃外扩框不再抢走青海湖、茶卡。
 *
 * 用法：
 *   node scripts/fill-spot-province.mjs           # 只补空 province
 *   node scripts/fill-spot-province.mjs --force    # 按坐标重算全部省名
 *   node scripts/fill-spot-province.mjs --dry
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provinceOfPoint } from './lib/province-bbox.mjs';

const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPOTS = join(R, 'data/roads/roadside-spots.json');
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

const file = JSON.parse(readFileSync(SPOTS, 'utf8'));
const spots = Array.isArray(file.spots) ? file.spots : [];

let filled = 0;
let reassigned = 0;
let unresolved = 0;
const unresolvedNames = [];
const moved = new Map();
for (const s of spots) {
  const next = provinceOfPoint(Number(s.lng), Number(s.lat), String(s.province ?? ''));
  if (!next) {
    if (!s.province) {
      unresolved += 1;
      if (unresolvedNames.length < 8) unresolvedNames.push(`${s.name}(${s.lng},${s.lat})`);
    }
    continue;
  }
  if (!s.province) {
    s.province = next;
    filled += 1;
    continue;
  }
  if (FORCE && s.province !== next) {
    const key = `${s.province}→${next}`;
    moved.set(key, (moved.get(key) || 0) + 1);
    s.province = next;
    reassigned += 1;
  }
}

console.log(
  `总 ${spots.length} 条 | 补空 ${filled} | 重算改挂 ${reassigned} | 仍无法判定 ${unresolved}`,
);
if (moved.size) {
  const top = [...moved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('改挂 TOP:', top.map(([k, v]) => `${k} ${v}`).join(' · '));
}
if (unresolvedNames.length) console.log('未判定样例:', unresolvedNames.join(', '));

if (!DRY) {
  file.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(SPOTS, JSON.stringify(file, null, 0), 'utf8');
  console.log('已写入', SPOTS);
}
