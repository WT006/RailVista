// 为缺规划控制点的国道生成兜底控制点：
// 用省片 ref 标记 way 求组件，按最近端点链接排序，控制点 = 每个有序组件的端点（保证全部组件被锚定）。
// 用法: node scripts/fallback-controls.mjs G255
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openProviders, PROV_TO_SLUG } from './lib/road-build.mjs';
import { assembleComponents, haversineM } from './lib/road-assemble.mjs';

const ref = process.argv[2];
if (!ref) { console.error('用法: node scripts/fallback-controls.mjs G255'); process.exit(1); }

// 1) 找含该 ref 的省：先 rel-index，再扫 rvwn
const SLUG_TO_PROV = {};
for (const [prov, slug] of Object.entries(PROV_TO_SLUG)) SLUG_TO_PROV[slug] = prov;
let slugs = [];
for (const f of readdirSync('data/roads/rel-index')) {
  const slug = f.replace('.json', '');
  const idx = JSON.parse(readFileSync(join('data/roads/rel-index', f), 'utf8'));
  if (idx[ref]) slugs.push(slug);
}
if (!slugs.length) {
  const { openRvwn } = await import('./lib/rvwn.mjs');
  for (const slug of Object.values(PROV_TO_SLUG)) {
    const rv = openRvwn('data/roads/net/' + slug + '.rvwn');
    try {
      for (const w of rv.iterateWays()) {
        if (w.ref.split(/[;；,，]/).includes(ref)) { slugs.push(slug); break; }
      }
    } finally { rv.close(); }
  }
}
slugs = [...new Set(slugs)];
console.log('涉及省片:', slugs.join(','));
if (!slugs.length) { console.error('任何省片都无该 ref：' + ref); process.exit(2); }

// 2) ref 标记 way → 组件
const providers = openProviders(slugs);
let comps;
try {
  const ways = [];
  for (const id of providers.taggedIds(ref)) {
    const f = providers.fullOf(id);
    if (!f || f.points.length < 2) continue;
    ways.push({ id, nodeIds: f.nodeIds, points: f.points, lngs: f.points.map((p) => p[0]), lats: f.points.map((p) => p[1]) });
  }
  comps = assembleComponents(ways, { minComponentM: 20 }).components;
} finally { providers.close(); }
console.log('组件数:', comps.length);

// 3) 最近端点链接排序
const items = comps.map((c) => ({ points: c.points, used: false }));
// 起点：取“最西”的组件端点（方向不影响几何质量）
let startComp = items[0]; let startEnd = false; let extreme = Infinity;
for (const it of items) {
  for (const [end, e] of [[false, it.points[0]], [true, it.points[it.points.length - 1]]]) {
    if (e[0] < extreme) { extreme = e[0]; startComp = it; startEnd = end; }
  }
}
if (startEnd) startComp.points = [...startComp.points].reverse();
startComp.used = true;
const ordered = [startComp];
let cursor = startComp.points[startComp.points.length - 1];
for (;;) {
  let pick = null, useEnd = false, md = Infinity;
  for (const it of items) {
    if (it.used) continue;
    const d0 = haversineM(cursor[0], cursor[1], it.points[0][0], it.points[0][1]);
    const d1 = haversineM(cursor[0], cursor[1], it.points[it.points.length - 1][0], it.points[it.points.length - 1][1]);
    if (d0 < md) { md = d0; pick = it; useEnd = false; }
    if (d1 < md) { md = d1; pick = it; useEnd = true; }
  }
  if (!pick) break;
  if (useEnd) pick.points = [...pick.points].reverse();
  pick.used = true; ordered.push(pick); cursor = pick.points[pick.points.length - 1];
}

// 4) 控制点 = 每组件起点 + 最后组件终点
const controls = [];
for (const it of ordered) controls.push({ name: '', lng: it.points[0][0], lat: it.points[0][1], province: '', district: '' });
const lastIt = ordered[ordered.length - 1];
controls.push({ name: '', lng: lastIt.points[lastIt.points.length - 1][0], lat: lastIt.points[lastIt.points.length - 1][1], province: '', district: '' });
const provOrder = slugs.map((s) => SLUG_TO_PROV[s]);

const dir = join('data', 'cache', 'amap', 'controls');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, ref + '.json'), JSON.stringify({ ref, controls, provOrder, fallback: true }, null, 1));
console.log('→ controls/' + ref + '.json 控制点', controls.length, '省序', provOrder.join(','));
