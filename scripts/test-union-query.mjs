// 逐端点验证并集 way 查询（定位是语法问题还是端点数据不一致）
import { findRouteRelation, rawPost } from './lib/road-relation.mjs';
import { OVERPASS_ENDPOINTS } from './lib/overpass.mjs';

const ref = process.argv[2] || 'G219';
const meta = await findRouteRelation(ref);

// 从各端点取前 3 成员，再在同一端点查几何
for (const ep of OVERPASS_ENDPOINTS) {
  try {
    const els = await rawPost(ep, `[out:json][timeout:60];rel(${meta.id});out body;`, 60);
    const rel = els.find((e) => e.type === 'relation' && e.id === meta.id);
    if (!rel) { console.log(ep, '无关系'); continue; }
    const members = rel.members.filter((m) => m.type === 'way').slice(0, 3);
    const q = '[out:json][timeout:60];(' + members.map((m) => `way(${m.ref});`).join('') + ');out geom;';
    const out = await rawPost(ep, q, 60);
    const ways = out.filter((e) => e.type === 'way');
    console.log(ep, '成员', members.map((m) => m.ref), '-> ways', ways.length,
      ways.map((w) => `${w.id}:${w.geometry?.length}`));
  } catch (e) {
    console.log(ep, 'FAIL', e.message);
  }
}
