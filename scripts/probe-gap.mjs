// 列出所有待补缺口坐标；若给 probeIndex，则对该缺口直接拉高德并打印每个 step 路名/里程
// 用法: node scripts/probe-gap.mjs G219 [probeIndex]
import { readProvOrder, PROV_TO_SLUG, openProviders, gatherWays } from './lib/road-build.mjs';
import { buildGraph, buildTraceStream, stitchGapsWithComponents, streamToItems } from './lib/road-trace.mjs';
import { assembleComponents, haversineM } from './lib/road-assemble.mjs';
import { drivingLeg } from './lib/amap.mjs';

const ref = process.argv[2], probe = process.argv[3] !== undefined ? Number(process.argv[3]) : -1;
const ctrl = readProvOrder(ref);
const provSlugs = ctrl.provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);
const providers = openProviders(provSlugs);
let fills = [];
try {
  const ways = gatherWays(ref, providers);
  const r = assembleComponents(ways, { minComponentM: 20 });
  const graph = buildGraph(r.components);
  let stream = buildTraceStream(graph, ctrl.controls);
  stream = stitchGapsWithComponents(stream, graph, r.components);
  fills = streamToItems(stream, graph).filter((x) => x.fill).map((x) => x.fill);
} finally {
  providers.close();
}

fills.forEach((f, i) => {
  const km = f.gapKm ?? Math.round((haversineM(f.from[0], f.from[1], f.to[0], f.to[1]) / 1000) * 100) / 100;
  console.log('#' + i, km + 'km', f.from.map((x) => x.toFixed(3)).join(','), '→', f.to.map((x) => x.toFixed(3)).join(','));
});

if (probe >= 0) {
  const f = fills[probe];
  console.log('\n=== 直接高德腿 #' + probe, '===');
  const leg = await drivingLeg(f.from, f.to);
  console.log('总里程', (leg.distanceM / 1000).toFixed(2), 'km steps', leg.steps.length);
  leg.steps.forEach((s, i) => console.log(i, (s.distanceM / 1000).toFixed(2) + 'km', JSON.stringify(s.name), 'pts', s.points.length));
}
