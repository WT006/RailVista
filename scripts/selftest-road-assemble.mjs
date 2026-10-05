/**
 * 万里路书 · 几何装配算法自检（scripts/selftest-road-assemble.mjs）
 *
 * 6 项合成用例：共享节点成链 / 不连通分段 / 十字路口直行优先 /
 * 平行对向车道去重 / 闭环 / 断点标注。
 *
 * 用法：node scripts/selftest-road-assemble.mjs   （退出码 0 = 全绿）
 */
import { assembleComponents, computeGaps, orderAndStitchAlongAxis } from './lib/road-assemble.mjs';
const mk = (id, ref, pts) => ({
  id, ref, name: 't', highway: 'primary', cls: 'G', flag: 0,
  nodeIds: Float64Array.from(pts.map((p) => p[2])),
  lngs: Float64Array.from(pts.map((p) => p[0])),
  lats: Float64Array.from(pts.map((p) => p[1])),
});
let pass = 0, fail = 0;
const eq = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' ' + extra); } };

// 1) 两段共享端点 → 一条分量
{
  const ways = [mk(1, 'G1', [[0,0,1],[0.01,0,2]]), mk(2, 'G1', [[0.01,0,2],[0.02,0,3]])];
  const r = assembleComponents(ways);
  eq('共享节点合成一条分量', r.components.length === 1 && r.components[0].wayCount === 2, JSON.stringify(r.components.map(c=>c.wayCount)));
}
// 2) 两段不共享节点 → 两条分量
{
  const ways = [mk(1, 'G1', [[0,0,1],[0.01,0,2]]), mk(2, 'G1', [[0.5,0,3],[0.51,0,4]])];
  const r = assembleComponents(ways);
  eq('不连通 → 两条分量', r.components.length === 2);
  eq('断点标注 1 条', computeGaps(r.components).length === 1);
}
// 3) 直行优先：在十字路口不拐弯
{
  const ways = [
    mk(1, 'G1', [[0,0,1],[0.01,0,2]]),          // 西→中
    mk(2, 'G1', [[0.01,0,2],[0.02,0,3]]),        // 中→东（直行）
    mk(3, 'G1', [[0.01,0,2],[0.01,0.01,4]]),     // 中→北（拐弯）
  ];
  const r = assembleComponents(ways);
  const c = r.components.sort((a,b)=>b.lengthM-a.lengthM)[0];
  const east = c.points[c.points.length-1][0] > 0.019;
  eq('十字路口直行优先（末端在东）', east, JSON.stringify(c.points[c.points.length-1]));
}
// 4) 平行重复（双向分隔道路）→ 只保留一条
{
  const a = mk(1, 'G1', [[0,0,1],[0.01,0,2],[0.02,0,3]]);
  const b = mk(2, 'G1', [[0.0002,0,4],[0.0102,0,5],[0.0202,0,6]]); // 约 22m 平行
  const r = assembleComponents([a, b]);
  eq('平行重复被剔除', r.components.length === 1 && r.duplicateDropped === 1, JSON.stringify({n:r.components.length,d:r.duplicateDropped}));
}
// 5) 闭环
{
  const ways = [mk(1,'G1',[[0,0,1],[0.01,0,2],[0.01,0.01,3],[0,0.01,4],[0,0,1]])];
  const r = assembleComponents(ways);
  eq('闭环保留为一条分量', r.components.length === 1 && r.components[0].lengthM > 4000, String(r.components[0]?.lengthM));
}
// 7) 按起讫轴定向：东段排在上海→聂拉木方向的前方
{
  const east = [[120, 31], [121, 31]];
  const west = [[86, 28], [87, 28]];
  const r = orderAndStitchAlongAxis([west, east], [121.5, 31.2], [86, 28], 8000);
  eq('轴向排序：靠近起点的分量在前', r.components[0].points[0][0] > 119, JSON.stringify(r.components[0].points[0]));
}
console.log('\n' + (fail ? 'FAIL ' + fail : 'PASS') + '（' + pass + ' 项通过）');
process.exit(fail ? 1 : 0);