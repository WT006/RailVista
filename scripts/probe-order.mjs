// 探针：某省某国道，省内成员在关系数组中的真实顺序与坐标
// 用法: node scripts/probe-order.mjs xinjiang G219
import { readRelIndex } from './lib/road-local.mjs';
import { openProvGeom } from './lib/road-local.mjs';

const slug = process.argv[2], ref = process.argv[3];
const rel = readRelIndex(slug)[ref] || [];
const prov = openProvGeom(slug);
const kept = [];
for (const m of rel) if (prov.has(m.id)) kept.push(m);
console.log(`关系成员 ${rel.length}，省内有几何 ${kept.length}`);
function firstOf(id) { const g = prov.geomOf(id); return g ? g[0] : null; }
function lastOf(id) { const g = prov.geomOf(id); return g ? g[g.length - 1] : null; }
const show = (arr, label) => {
  console.log('--- ' + label + ' ---');
  for (const m of arr) {
    const a = firstOf(m.id), b = lastOf(m.id);
    console.log(`id=${m.id} start[${a ? a.map((x) => x.toFixed(3)) : '-'}] end[${b ? b.map((x) => x.toFixed(3)) : '-'}]`);
  }
};
show(kept.slice(0, 12), '省内顺序 前12');
show(kept.slice(-8), '省内顺序 后8');
prov.close();
