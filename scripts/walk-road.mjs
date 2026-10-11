// 沿全局关系顺序 + 官方起终点锚定，装配单线并报告真实缺口（不补线）
// 用法: node scripts/walk-road.mjs G219
import { readProvOrder, PROV_TO_SLUG, openProviders, assembleLocal } from './lib/road-build.mjs';

const ref = process.argv[2];
if (!ref) { console.error('用法: node scripts/walk-road.mjs G219'); process.exit(1); }

const ctrl = readProvOrder(ref);
if (!ctrl) { console.error('缺控制点省序，请先 geocode-controls:', ref); process.exit(2); }
const first = ctrl.controls[0];
const last = ctrl.controls[ctrl.controls.length - 1];
const startCoord = [first.lng, first.lat];
const endCoord = [last.lng, last.lat];
console.log(`起 ${first.name}[${startCoord.map((x) => x.toFixed(3))}] → 终 ${last.name}[${endCoord.map((x) => x.toFixed(3))}]`);

const provSlugs = ctrl.provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);
const providers = openProviders(provSlugs);
let r;
try {
  r = assembleLocal(ref, providers, startCoord, endCoord, ctrl.controls);
} finally {
  providers.close();
}

console.log('\n=== 单线结果 ===');
console.log('点数:', r.points.length, '| 分量:', r.components, '| 已绘里程:', r.drawnKm.toFixed(0), 'km | 重复分量剔除:', r.dupDropped);
console.log('真实缺口:', r.gaps.length, '处');
const big = r.gaps.filter((g) => g.gapKm > 1);
const gapKm = r.gaps.reduce((s, g) => s + g.gapKm, 0);
console.log('缺口 >1km:', big.length, '| 缺口里程合计:', gapKm.toFixed(0), 'km');
for (const g of big) {
  console.log(`  ${g.gapKm} km  从[${g.from.map((x) => x.toFixed(3))}] 到[${g.to.map((x) => x.toFixed(3))}]`);
}
