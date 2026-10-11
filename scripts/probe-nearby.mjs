// 在缺口所在省片里，找 ref/name 含目标编号但可能未被关系收录的 way，判断能否真实链穿缺口
// 用法: node scripts/probe-nearby.mjs G219 11
import { openRvwn } from './lib/rvwn.mjs';
import { PROVINCE_BBOXES } from './lib/province-bbox.mjs';
import { haversineM } from './lib/road-assemble.mjs';
import { readProvOrder, PROV_TO_SLUG } from './lib/road-build.mjs';

const ref = process.argv[2], gi = Number(process.argv[3]);
const num = ref.replace(/\D/g, '');
const ctrl = readProvOrder(ref);
// 重建缺口坐标：直接复用 probe-gap 的构建较重，这里从 controls 无法得到；改为内联构建
const { buildGlobalMembers, openProviders } = await import('./lib/road-build.mjs');
const { buildGraph, buildTraceStream, stitchGapsWithComponents, streamToItems } = await import('./lib/road-trace.mjs');
const { assembleComponents } = await import('./lib/road-assemble.mjs');
const first = ctrl.controls[0], last = ctrl.controls[ctrl.controls.length - 1];
const provSlugs = ctrl.provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);
const providers = openProviders(provSlugs);
let gap;
try {
  const members = buildGlobalMembers(ref);
  const ways = []; const seen = new Set();
  for (const m of members) {
    if (seen.has(m.id)) continue;
    const f = providers.fullOf(m.id);
    if (!f || f.points.length < 2) continue;
    seen.add(m.id);
    ways.push({ id: m.id, nodeIds: f.nodeIds, lngs: f.points.map((p) => p[0]), lats: f.points.map((p) => p[1]), points: f.points });
  }
  const r = assembleComponents(ways, { minComponentM: 20 });
  const graph = buildGraph(r.components);
  let stream = buildTraceStream(graph, ctrl.controls);
  stream = stitchGapsWithComponents(stream, graph, r.components);
  gap = streamToItems(stream, graph).filter((x) => x.fill).map((x) => x.fill)[gi];
} finally { providers.close(); }

console.log('缺口 #' + gi, gap.from.map((x) => x.toFixed(3)), '→', gap.to.map((x) => x.toFixed(3)));
// 找省片
const mid = [(gap.from[0] + gap.to[0]) / 2, (gap.from[1] + gap.to[1]) / 2];
const prov = PROVINCE_BBOXES.find((b) => mid[0] >= b.bbox[1] && mid[0] <= b.bbox[3] && mid[1] >= b.bbox[0] && mid[1] <= b.bbox[2]);
const slug = PROV_TO_SLUG[prov.name];
console.log('省片:', prov.name, slug);

const rv = openRvwn('data/roads/net/' + slug + '.rvwn');
try {
  let candidates = 0;
  for (const w of rv.iterateWays()) {
    if (!(w.ref.includes(num) || w.name.includes(num))) continue;
    const nd = rv.readWayNodes(w);
    const pts = [];
    for (let i = 0; i < nd.lngs.length; i += 1) pts.push([nd.lngs[i], nd.lats[i]]);
    const dA = Math.min(...pts.map((p) => haversineM(gap.from[0], gap.from[1], p[0], p[1])));
    const dB = Math.min(...pts.map((p) => haversineM(gap.to[0], gap.to[1], p[0], p[1])));
    if (dA < 30000 || dB < 30000) {
      candidates += 1;
      console.log('way', w.id, 'ref', JSON.stringify(w.ref), 'name', JSON.stringify(w.name), 'hw', JSON.stringify(w.highway),
        'len', (w.lenM / 1000).toFixed(1), '| 距起', (dA / 1000).toFixed(1), '距讫', (dB / 1000).toFixed(1));
    }
  }
  console.log('候选 way 数:', candidates);
} finally { rv.close(); }
