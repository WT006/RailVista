// 单条国道：本地关系装配，报告分量 / 残余缺口
// 用法: node scripts/build-from-local.mjs G219
import { loadRoadRelationLocal } from './lib/road-local.mjs';
import { assembleFromRelation } from './lib/road-from-relation.mjs';

const ref = process.argv[2];
if (!ref) { console.error('用法: node scripts/build-from-local.mjs G219'); process.exit(1); }

const t0 = Date.now();
const rel = loadRoadRelationLocal(ref);
if (!rel) { console.error('本地无该国道关系:', ref); process.exit(2); }
console.log(`成员 ${rel.members.length} · 几何 ${rel.wayGeom.size} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const r = assembleFromRelation(ref, rel);
console.log('\n=== 本地关系装配结果 ===');
console.log('分量数:', r.components.length, '| 已绘里程:', r.totalDrawnKm, 'km');
console.log('残余缺口:', r.gaps.length, '处');
const big = r.gaps.filter((g) => g.gapKm > 1);
const gapKm = r.gaps.reduce((s, g) => s + g.gapKm, 0);
console.log('缺口 >1km:', big.length, '| 缺口里程合计:', gapKm.toFixed(0), 'km');
for (const g of big.slice(0, 60)) {
  console.log(`  #${g.between[0]}→#${g.between[1]}  ${g.gapKm} km  从[${g.from.map((x) => x.toFixed(3))}] 到[${g.to.map((x) => x.toFixed(3))}]`);
}
for (const [i, c] of r.components.entries()) {
  console.log(`  comp#${i} pts=${c.points.length} km=${(c.lengthM / 1000).toFixed(0)} wayIds=${(c.wayIds || []).length}`);
}
