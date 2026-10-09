#!/usr/bin/env node
// 快速 SVG 预览：node scripts/quick-preview.mjs G0401 [G4201 ...]
import fs from 'node:fs';
for (const ref of process.argv.slice(2)) {
  const g = JSON.parse(fs.readFileSync(`data/roads/geom/${ref}.json`, 'utf8'));
  const chains = [g.points, ...(g.segments || [])].map((c) => (Array.isArray(c) ? c : (c && c.points) || []));
  const paths = [];
  let all = [];
  for (const chain of chains) {
    if (!Array.isArray(chain) || chain.length < 2) continue;
    const pts = chain.map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]));
    all = all.concat(pts);
    paths.push(pts);
  }
  if (!all.length) { console.log(ref, '无几何'); continue; }
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 800, H = 600, PAD = 20;
  const fx = (v) => PAD + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * PAD);
  const fy = (v) => H - PAD - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * PAD);
  const colors = ['#4ec9b0', '#dcdcaa', '#c586c0', '#9cdcfe', '#ce9178', '#569cd6'];
  const body = paths.map((pts, i) => {
    let jumps = 0, maxJ = 0;
    for (let k = 1; k < pts.length; k++) {
      const d = Math.hypot((pts[k][0] - pts[k - 1][0]) * 93, (pts[k][1] - pts[k - 1][1]) * 111);
      if (d > 30) jumps++;
      if (d > maxJ) maxJ = d;
    }
    console.log(`${ref} 组件${i}: ${pts.length}pts · >30km跳跃=${jumps} · 最大段距=${maxJ.toFixed(2)}km`);
    return `<path d="M${pts.map((p) => fx(p[0]).toFixed(1) + ',' + fy(p[1]).toFixed(1)).join('L')}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="2"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#111"/>${body}</svg>`;
  fs.writeFileSync(`data/roads/geom/${ref}-preview.svg`, svg);
  console.log(`${ref}: bbox ${x0.toFixed(2)},${y0.toFixed(2)}→${x1.toFixed(2)},${y1.toFixed(2)} · 组件${paths.length} · totalKm=${Math.round(g.totalKm)} → ${ref}-preview.svg`);
}
