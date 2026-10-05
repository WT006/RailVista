/**
 * 用省 bbox 反查补齐公路景点的 province 字段（scripts/fill-spot-province.mjs）。
 *
 * 背景：早期手工种子（source=hand-curated，411 条）没有 province 字段，
 * 地图上会聚成「未标注省份」的一个大块，点它也没法下钻。
 * OSM 抓取的 12126 条在 harvest 阶段已按分片写入省份，只有这批种子是缺口。
 * 这里用 scripts/lib/province-bbox.mjs 的 34 省 bbox 做点落省判定（纯几何、可复现）。
 *
 * 用法：node scripts/fill-spot-province.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVINCE_BBOXES } from './lib/province-bbox.mjs';

const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPOTS = join(R, 'data/roads/roadside-spots.json');
const DRY = process.argv.includes('--dry');

const file = JSON.parse(readFileSync(SPOTS, 'utf8'));
const spots = Array.isArray(file.spots) ? file.spots : [];

/** 点是否落在省 bbox 内；同一省可能多个框（按 PROVINCE_BBOXES 原顺序取首个命中） */
function provinceOf(lng, lat) {
  for (const p of PROVINCE_BBOXES) {
    const [s, w, n, e] = p.bbox;
    if (lat >= s && lat <= n && lng >= w && lng <= e) return p.name;
  }
  return '';
}

let filled = 0;
let unresolved = 0;
const unresolvedNames = [];
for (const s of spots) {
  if (s.province) continue;
  const p = provinceOf(Number(s.lng), Number(s.lat));
  if (p) {
    s.province = p;
    filled += 1;
  } else {
    unresolved += 1;
    if (unresolvedNames.length < 8) unresolvedNames.push(`${s.name}(${s.lng},${s.lat})`);
  }
}

console.log(`总 ${spots.length} 条 | 补齐省份 ${filled} | 仍无法判定 ${unresolved}`);
if (unresolvedNames.length) console.log('未判定样例:', unresolvedNames.join(', '));

if (!DRY) {
  file.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(SPOTS, JSON.stringify(file, null, 0), 'utf8');
  console.log('已写入', SPOTS);
}
