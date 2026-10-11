#!/usr/bin/env node
// analyze-comps.mjs —— 分析省道分量分布：真断链（沿走廊间隙小）vs ref 重用混装（散布全省）
import fs from 'node:fs';

function havKm(a, b) {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const refs = process.argv.slice(2);
for (const ref of refs) {
  const f = 'data/roads/geom/' + ref.replace(':', '_') + '.json';
  const g = JSON.parse(fs.readFileSync(f, 'utf8'));
  const chains = [g.points, ...(g.segments || []).map((sg) => (Array.isArray(sg) ? sg : sg.points || []))]
    .map((c) => c.map((p) => (Array.isArray(p) ? p : [p.lng, p.lat])))
    .filter((c) => c.length >= 2);
  const info = chains.map((c, i) => {
    let km = 0;
    for (let t = 1; t < c.length; t += 1) km += havKm(c[t - 1], c[t]);
    return { i, km: Math.round(km), head: c[0], tail: c[c.length - 1] };
  }).sort((a, b) => b.km - a.km);
  console.log('===', ref, '分量数:', chains.length, 'official:', g.officialKm || '-');
  // 分量间最小距离矩阵（粗略：各分量尾点 vs 其他分量头点）
  for (const a of info.slice(0, 12)) {
    let best = Infinity, bestTo = -1;
    for (const b of info) {
      if (b.i === a.i) continue;
      const d = Math.min(havKm(a.tail, b.head), havKm(a.head, b.tail), havKm(a.tail, b.tail), havKm(a.head, b.head));
      if (d < best) { best = d; bestTo = b.i; }
    }
    console.log(`  #${a.i} ${a.km}km  最近邻: #${bestTo} 距${Math.round(best)}km  head=(${a.head[0].toFixed(1)},${a.head[1].toFixed(1)}) tail=(${a.tail[0].toFixed(1)},${a.tail[1].toFixed(1)})`);
  }
}
