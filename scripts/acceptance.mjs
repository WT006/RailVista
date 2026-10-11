#!/usr/bin/env node
// 全量验收：几何体检（跳跃/折返）+ 残留统计 + 重点线路 SVG
import fs from 'node:fs';

const GEOM = 'data/roads/geom';
const files = fs.readdirSync(GEOM).filter((f) => /^G\d+\.json$/.test(f) && !f.includes('preview'));

let natDone = 0, natAll = 0, exDone = 0, exAll = 0;
let totalJumps = 0, badFiles = [];
let totalGap = 0, totalGapKm = 0;
let precDist = {};
const classStat = { national: {}, expressway: {} };

for (const f of files) {
  const g = JSON.parse(fs.readFileSync(`${GEOM}/${f}`, 'utf8'));
  const chains = [g.points, ...(g.segments || [])].map((c) => (Array.isArray(c) ? c : (c && c.points) || [])).filter((c) => c.length >= 2);
  let jumps = 0, maxJ = 0;
  for (const pts of chains) {
    for (let i = 1; i < pts.length; i += 1) {
      const a = Array.isArray(pts[i - 1]) ? pts[i - 1] : [pts[i - 1].lng, pts[i - 1].lat];
      const b = Array.isArray(pts[i]) ? pts[i] : [pts[i].lng, pts[i].lat];
      const d = Math.hypot((b[0] - a[0]) * 93, (b[1] - a[1]) * 111);
      if (d > 30) jumps += 1;
      if (d > maxJ) maxJ = d;
    }
  }
  totalJumps += jumps;
  if (jumps > 0 || maxJ > 100) badFiles.push(`${g.ref}: ${jumps}跳/max${maxJ.toFixed(0)}km`);
  const done = g.componentCount === 1 && !(g.segments || []).length;
  const cls = g.class || 'national';
  const st = classStat[cls];
  st.all = (st.all || 0) + 1;
  if (done) st.done = (st.done || 0) + 1;
  if (cls === 'national') { natAll += 1; if (done) natDone += 1; }
  else { exAll += 1; if (done) exDone += 1; }
  precDist[g.precision || 'C'] = (precDist[g.precision || 'C'] || 0) + 1;
  for (const gp of g.gapAnnotations || []) { totalGap += 1; totalGapKm += gp.gapKm || 0; }
}

console.log('== 全量验收 ==');
console.log(`国道: ${natDone}/${natAll} (${(natDone / natAll * 100).toFixed(1)}%)`);
console.log(`高速: ${exDone}/${exAll} (${(exDone / exAll * 100).toFixed(1)}%)`);
console.log(`precision 分布: ${JSON.stringify(precDist)}`);
console.log(`残余缺口: ${totalGap} 处 · 合计 ${Math.round(totalGapKm)}km`);
console.log(`>30km 跳跃总数: ${totalJumps} ${totalJumps === 0 ? '✓ 全部几何干净' : '✗'}`);
if (badFiles.length) console.log('跳跃异常: ' + badFiles.join('  '));

// 重点线路 SVG（用户点名）
for (const ref of ['G219', 'G318']) {
  const g = JSON.parse(fs.readFileSync(`${GEOM}/${ref}.json`, 'utf8'));
  const chains = [g.points, ...(g.segments || [])].map((c) => (Array.isArray(c) ? c : (c && c.points) || [])).filter((c) => c.length >= 2);
  const all = chains.flat();
  const xs = all.map((p) => (Array.isArray(p) ? p[0] : p.lng));
  const ys = all.map((p) => (Array.isArray(p) ? p[1] : p.lat));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 900, H = 900, PAD = 20;
  const fx = (v) => PAD + ((v - x0) / (x1 - x0)) * (W - 2 * PAD);
  const fy = (v) => H - PAD - ((v - y0) / (y1 - y0)) * (H - 2 * PAD);
  const colors = ['#4ec9b0', '#dcdcaa', '#c586c0'];
  const body = chains.map((pts, i) => {
    const P = pts.map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]));
    return `<path d="M${P.map((p) => fx(p[0]).toFixed(1) + ',' + fy(p[1]).toFixed(1)).join('L')}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="1.6"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#111"/>${body}<text x="12" y="24" fill="#fff" font-size="16">${ref} · ${chains.length}组件 · ${Math.round(g.totalKm)}km</text></svg>`;
  fs.writeFileSync(`${GEOM}/${ref}-accept.svg`, svg);
  console.log(`${ref}: ${chains.length}组件 · ${Math.round(g.totalKm)}km → ${ref}-accept.svg`);
}
