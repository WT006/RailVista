/**
 * 六省景点补全校验器（2026-10-05）：
 *   九项数据校验 + 十二项达标门禁。全部 PASS 退出 0，否则退出 1。
 * 用法：node scripts/verify-sixprov-fill.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scenic = JSON.parse(readFileSync(join(root, 'data/presets/scenic-spots.json'), 'utf8'));
const road = JSON.parse(readFileSync(join(root, 'data/roads/roadside-spots.json'), 'utf8'));
const suppExists = existsSync(join(root, 'data/presets/scenic-spots-supplement-20261005.json'));

const SIX = ['安徽', '湖北', '天津', '宁夏', '青海', '贵州'];
const RAIL_T = { 安徽: 10, 湖北: 12, 天津: 8, 宁夏: 8, 青海: 15, 贵州: 12 };
const ROAD_T = { 安徽: 50, 湖北: 50, 天津: 30, 宁夏: 40, 青海: 40, 贵州: 100 };

const checks = [];
const ok = (n, m = '') => checks.push({ n, pass: true, m });
const bad = (n, m) => checks.push({ n, pass: false, m });

const V3_CATS = new Set(['mountain', 'lake', 'gorge', 'grassland', 'desert', 'engineering']);
const ROAD_CATS = new Set([
  'nature.mountain', 'nature.lake', 'nature.river', 'nature.canyon', 'nature.forest', 'nature.grassland', 'nature.desert', 'nature.glacier',
  'engineering.bridge', 'engineering.tunnel', 'engineering.dam', 'engineering.pass', 'engineering.spiral-road', 'engineering.service-area',
  'culture.heritage', 'culture.ancient-town', 'culture.temple', 'culture.village', 'culture.ruin', 'culture.red',
  'viewpoint.landmark', 'viewpoint.observation-deck', 'viewpoint.scenic-byway', 'viewpoint.sunrise', 'experience.hot-spring',
]);
const VIS = new Set(['roadside', 'detour5', 'detour20', 'distant']);

const railSpots = scenic.spots;
const roadSpots = road.spots;

// —— 九项数据校验 ——
// C1 铁路主库结构
railSpots.length > 0 && railSpots.every(s => s.id && s.name && typeof s.lng === 'number' && typeof s.lat === 'number')
  ? ok('C1 铁路主库结构') : bad('C1 铁路主库结构', 'id/name/lng/lat 缺失');

// C2 铁路 category 禁止 other
const railOther = railSpots.filter(s => s.category && !V3_CATS.has(s.category) && s.tags?.includes('2026-10-scarce-prov'));
railOther.length === 0 ? ok('C2 铁路 category 非 other') : bad('C2 铁路 category 非 other', `${railOther.length} 条落入 other: ${railOther.slice(0, 3).map(s => s.id).join(',')}`);

// C3 铁路六省条目均有 province
const railNoProv = railSpots.filter(s => {
  const provInName = SIX.some(p => (s.tags || []).includes(p));
  return provInName && !s.province;
});
railNoProv.length === 0 ? ok('C3 铁路六省条目有 province') : bad('C3 铁路六省条目有 province', `${railNoProv.length} 条缺 province`);

// C4 铁路 supplement 文件存在
suppExists ? ok('C4 supplement 文件存在') : bad('C4 supplement 文件存在', 'scenic-spots-supplement-20261005.json 缺失');

// C5 公路主库结构
roadSpots.length > 0 && roadSpots.every(s => s.id && s.name && typeof s.lng === 'number' && typeof s.lat === 'number')
  ? ok('C5 公路主库结构') : bad('C5 公路主库结构', 'id/name/lng/lat 缺失');

// C6 公路 category 词表
const roadBadCat = roadSpots.filter(s => s.category && !ROAD_CATS.has(s.category));
roadBadCat.length === 0 ? ok('C6 公路 category 词表') : bad('C6 公路 category 词表', `${roadBadCat.length} 条非法: ${[...new Set(roadBadCat.map(s => s.category))].slice(0, 5).join(',')}`);

// C7 公路 visibility 词表
const roadBadVis = roadSpots.filter(s => s.visibility && !VIS.has(s.visibility));
roadBadVis.length === 0 ? ok('C7 公路 visibility 词表') : bad('C7 公路 visibility 词表', `${roadBadVis.length} 条非法: ${[...new Set(roadBadVis.map(s => s.visibility))].slice(0, 5).join(',')}`);

// C8 公路六省新条目有 intro
const roadNoIntro = roadSpots.filter(s => SIX.includes(s.province) && s.reviewedAt === '2026-10-05' && !s.intro);
roadNoIntro.length === 0 ? ok('C8 公路六省新条目有 intro') : bad('C8 公路六省新条目有 intro', `${roadNoIntro.length} 条缺 intro`);

// C9 公路本批次新条目 ID 唯一
const batchIds = roadSpots.filter(s => s.reviewedAt === '2026-10-05').map(s => s.id);
const batchIdSet = new Set();
const batchDupIds = new Set();
for (const id of batchIds) { if (batchIdSet.has(id)) batchDupIds.add(id); else batchIdSet.add(id); }
batchDupIds.size === 0 ? ok('C9 公路本批次 ID 唯一') : bad('C9 公路本批次 ID 唯一', `${batchDupIds.size} 个重复: ${[...batchDupIds].slice(0, 3).join(',')}`);

// —— 十二项达标门禁（铁路 6 + 公路 6）——
for (const p of SIX) {
  const railN = railSpots.filter(s => s.province === p).length;
  railN >= RAIL_T[p] ? ok(`G1 铁路 ${p} ≥ ${RAIL_T[p]}`, `${railN}`) : bad(`G1 铁路 ${p} ≥ ${RAIL_T[p]}`, `仅 ${railN}`);
}
for (const p of SIX) {
  const roadN = roadSpots.filter(s => s.province === p).length;
  roadN >= ROAD_T[p] ? ok(`G2 公路 ${p} ≥ ${ROAD_T[p]}`, `${roadN}`) : bad(`G2 公路 ${p} ≥ ${ROAD_T[p]}`, `仅 ${roadN}`);
}

// —— 汇总 ——
const passed = checks.filter(c => c.pass).length;
const failed = checks.filter(c => !c.pass).length;
for (const c of checks) {
  console.log(`${c.pass ? '✓' : '✗'} ${c.n}${c.m ? ' [' + c.m + ']' : ''}`);
}
console.log(`\n${passed} PASS / ${failed} FAIL / ${checks.length} TOTAL`);
process.exit(failed === 0 ? 0 : 1);