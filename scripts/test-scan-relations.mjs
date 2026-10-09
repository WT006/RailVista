// 验证 scanRelations：列出某省 PBF 中国道路线关系
import { scanRelations } from './lib/osm-pbf.mjs';
import { normalizeRefs, classifyRef } from './lib/road-ref.mjs';

const slug = process.argv[2] || 'hainan';
const file = `data/cache/osm/${slug}-latest.osm.pbf`;
let n = 0;
await scanRelations(file, (r) => {
  const refs = normalizeRefs(r.tags.ref);
  if (!refs.length) return;
  const cls = refs.map((x) => classifyRef(x));
  if (!cls.some((c) => c === 'national' || c === 'expressway')) return;
  n += 1;
  console.log(`rel ${r.id} ref=${r.tags.ref} route=${r.tags.route} members=${r.members.length} ways=${r.wayIds.length} name=${r.tags.name ?? ''}`);
});
console.log('国/高速路线关系数:', n);
