// 探针：全部关系成员（带 node id）→ assembleComponents 精确拓扑，报告分量
// 用法: node scripts/probe-topology.mjs G219
import { readProvOrder, PROV_TO_SLUG, openProviders, buildGlobalMembers } from './lib/road-build.mjs';
import { assembleComponents, haversineM } from './lib/road-assemble.mjs';

const ref = process.argv[2];
const ctrl = readProvOrder(ref);
const provSlugs = ctrl.provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);
const providers = openProviders(provSlugs);
let comps;
try {
  const members = buildGlobalMembers(ref);
  const ways = [];
  const seen = new Set();
  for (const m of members) {
    if (seen.has(m.id)) continue;
    const f = providers.fullOf(m.id);
    if (!f || f.points.length < 2) continue;
    seen.add(m.id);
    ways.push({
      id: m.id,
      nodeIds: f.nodeIds,
      lngs: f.points.map((p) => p[0]),
      lats: f.points.map((p) => p[1]),
      points: f.points,
    });
  }
  console.log('唯一成员 ways:', ways.length);
  const r = assembleComponents(ways, { minComponentM: 20 });
  comps = r.components;
  console.log('连通分量:', comps.length, '| totalM:', (r.totalM / 1000).toFixed(0), 'km | dupDropped:', r.duplicateDropped);
} finally {
  providers.close();
}

// 端点最近邻断点距离（全局，跨分量）
const eps = [];
for (const [ci, c] of comps.entries()) {
  eps.push({ ci, which: 0, p: c.points[0] });
  eps.push({ ci, which: 1, p: c.points[c.points.length - 1] });
}
const gaps = [];
for (const e of eps) {
  let best = Infinity, who = null;
  for (const o of eps) {
    if (o.ci === e.ci) continue;
    const d = haversineM(e.p[0], e.p[1], o.p[0], o.p[1]);
    if (d < best) { best = d; who = o; }
  }
  gaps.push({ ...e, best, who });
}
const dists = gaps.map((g) => g.best).sort((a, b) => a - b);
const buckets = [500, 1000, 2000, 5000, 10000, 30000, 100000];
console.log('\n端点最近邻距离分布:');
for (const b of buckets) console.log(`  ≤${b}m: ${dists.filter((d) => d <= b).length}`);
console.log('  >100km:', dists.filter((d) => d > 100000).length);
console.log('\n大断点(>3km)的端点:');
for (const g of gaps.filter((x) => x.best > 3000).sort((a, b) => a.best - b.best)) {
  console.log(`  comp${g.ci}.${g.which} [${g.p.map((x) => x.toFixed(3))}] → comp${g.who.ci}.${g.who.which} ${(g.best / 1000).toFixed(1)}km`);
}
