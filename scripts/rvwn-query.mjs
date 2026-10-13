/**
 * 万里路书 · rvwn 路网查询工具（scripts/rvwn-query.mjs）
 *
 * 用法：
 *   node scripts/rvwn-query.mjs xinjiang 80.0 41.6 80.6 42.7   # 列出 bbox 内的 way（id/ref/点数/端点）
 *   node scripts/rvwn-query.mjs xinjiang --ref G219             # 列出带该 ref 的 way 数量与端点
 */
import { join } from 'node:path';
import { openRvwn } from './lib/rvwn.mjs';

const slug = process.argv[2];
const reader = openRvwn(join('data', 'roads', 'net', slug + '.rvwn'));
const mode = process.argv[3];

function bboxOf(pts) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}

let n = 0;
if (mode === '--ref') {
  const ref = process.argv[4];
  let m = 0;
  for (const w of reader.iterateWays()) {
    if (!w.ref) continue;
    const parts = String(w.ref).split(/[;；,，]/);
    if (!parts.includes(ref)) continue;
    m += 1;
    if (m <= 25) {
      const g = reader.readWayNodes(reader.readWay(w.index));
      const pts = [];
      for (let i = 0; i < g.lngs.length; i += 1) pts.push([g.lngs[i], g.lats[i]]);
      const bb = bboxOf(pts);
      console.log(w.id, 'ref=' + w.ref, pts.length + '点', bb.map((v) => v.toFixed(3)).join(','));
    }
  }
  console.log('总匹配', m);
} else {
  const [x0, y0, x1, y1] = process.argv.slice(3, 7).map(Number);
  for (const w of reader.iterateWays()) {
    n += 1;
    const ww = reader.readWay(w.index);
    if (!ww) continue;
    const g = reader.readWayNodes(ww);
    const pts = [];
    for (let i = 0; i < g.lngs.length; i += 1) pts.push([g.lngs[i], g.lats[i]]);
    const bb = bboxOf(pts);
    const inside = bb[0] < x1 && bb[2] > x0 && bb[1] < y1 && bb[3] > y0;
    if (!inside) continue;
    console.log(w.id, 'ref=' + (w.ref || '-'), pts.length + '点', bb.map((v) => v.toFixed(4)).join(','), '|', pts[0].map((v) => v.toFixed(4)).join(',') , '→', pts[pts.length - 1].map((v) => v.toFixed(4)).join(','));
  }
  console.log('扫描', n, 'ways');
}
reader.close();
