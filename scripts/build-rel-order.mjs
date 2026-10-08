/**
 * 万里路书 · 国道路线 relation 成员顺序边生成（scripts/build-rel-order.mjs）
 *
 *   data/cache/osm/{prov}-latest.osm.pbf  →  data/roads/rel-order/{prov}.bin
 *
 * 只扫一遍 route relation，把"国道路线（national/expressway）"的相邻 member way
 * （沿 relation 顺序）逐对落盘，供 build-road-geom 里做"关系顺序桥接"：
 * 国道的 ref 断档大量落在 1.5~50km 量级，靠共享 node + 1.5km 缝合够不到，
 * 而 route relation 的成员顺序是 OSM 编辑者明确标注的路线走向，可安全用于连接。
 *
 * 文件格式：扁平 Float64Array，每两个 double 为一对相邻 way id（a 在前 b 在后）。
 *
 * 用法：node scripts/build-rel-order.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRelations } from './lib/osm-pbf.mjs';
import { normalizeRefs, classifyRef } from './lib/road-ref.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PBF_DIR = join(ROOT, 'data/cache/osm');
const OUT_DIR = join(ROOT, 'data/roads/rel-order');

const files = readdirSync(PBF_DIR).filter((f) => f.endsWith('.osm.pbf')).sort();
if (!files.length) {
  console.error('未找到 PBF 文件，请先运行 node scripts/fetch-china-pbf.mjs --all');
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

let totalEdges = 0;
let totalRelations = 0;
for (const f of files) {
  const slug = f.replace('-latest.osm.pbf', '');
  const relEdges = [];
  let rels = 0;
  await scanRelations(join(PBF_DIR, f), (r) => {
    const nrefs = normalizeRefs(r.ref);
    if (!nrefs.length) return;
    const isG = nrefs.some((nr) => {
      const c = classifyRef(nr);
      return c === 'national' || c === 'expressway';
    });
    if (!isG) return;
    rels += 1;
    for (let i = 0; i < r.wayIds.length - 1; i += 1) relEdges.push(r.wayIds[i], r.wayIds[i + 1]);
  });
  if (relEdges.length) {
    const buf = Buffer.allocUnsafe(relEdges.length * 8);
    for (let i = 0; i < relEdges.length; i += 1) buf.writeDoubleLE(relEdges[i], i * 8);
    writeFileSync(join(OUT_DIR, slug + '.bin'), buf);
  }
  totalEdges += relEdges.length / 2;
  totalRelations += rels;
  console.log('  ' + slug.padEnd(16) + ' 关系 ' + String(rels).padStart(4) + ' · 顺序边 ' + String(relEdges.length / 2).padStart(7));
}
console.log('总计 ' + totalRelations + ' 条国道路线关系 · ' + totalEdges + ' 条顺序边 → ' + OUT_DIR);