// 分阶段内存探针
import { readProvOrder, PROV_TO_SLUG, openProviders, buildGlobalMembers, orderComponentsByControls } from './lib/road-build.mjs';
import { assembleComponents } from './lib/road-assemble.mjs';

const ref = process.argv[2] || 'G219';
const ctrl = readProvOrder(ref);
const provSlugs = ctrl.provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);
const rss = (s) => { if (global.gc) global.gc(); console.log(s, (process.memoryUsage().rss / 1048576).toFixed(0) + 'MB'); };

const providers = openProviders(provSlugs);
rss('providers open');
const members = buildGlobalMembers(ref);
const ways = [];
const seen = new Set();
for (const m of members) {
  if (seen.has(m.id)) continue;
  const f = providers.fullOf(m.id);
  if (!f || f.points.length < 2) continue;
  seen.add(m.id);
  ways.push({ id: m.id, nodeIds: f.nodeIds, lngs: f.points.map((p) => p[0]), lats: f.points.map((p) => p[1]), points: f.points });
}
rss('ways built ' + ways.length);
const r = assembleComponents(ways, { minComponentM: 20 });
rss('assembled comps=' + r.components.length);
const ord = orderComponentsByControls(r.components, ctrl.controls);
rss('ordered pts=' + ord.points.length);
providers.close();
console.log('gaps', ord.gaps.length);
