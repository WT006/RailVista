#!/usr/bin/env node
// s-spot.mjs —— S 线修复抽查 SVG：主链绿、segments 黄
import fs from 'node:fs';

const GEOM = 'data/roads/geom';
const refs = process.argv.slice(2).length ? process.argv.slice(2) : ['青海_S101', '青海_S102', '四川_S211', '西藏_S301', '江苏_S238', '江西_S308', '湖南_S228', '云南_S308'];
for (const ref of refs) {
  const fp = `${GEOM}/${ref}.json`;
  if (!fs.existsSync(fp)) { console.log(ref, '不存在'); continue; }
  const g = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const main = g.points.map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]));
  const segs = (g.segments || []).map((c) => c.map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]))).filter((c) => c.length >= 2);
  const all = [main, ...segs].flat();
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 900, H = 900, PAD = 20;
  const fx = (v) => PAD + ((v - x0) / (x1 - x0)) * (W - 2 * PAD);
  const fy = (v) => H - PAD - ((v - y0) / (y1 - y0)) * (H - 2 * PAD);
  const dMain = `M${main.map((p) => fx(p[0]).toFixed(1) + ',' + fy(p[1]).toFixed(1)).join('L')}`;
  const segPaths = segs.map((c) => `<path d="M${c.map((p) => fx(p[0]).toFixed(1) + ',' + fy(p[1]).toFixed(1)).join('L')}" fill="none" stroke="#dcdcaa" stroke-width="1.2"/>`).join('');
  const fMark = g.officialSegmentMissing ? ' ⚠官方段缺失' : g.reuseSplit ? ' ✓官方锚定拆分' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#111"/>`
    + `<path d="${dMain}" fill="none" stroke="#4ec9b0" stroke-width="1.8"/>${segPaths}`
    + `<text x="12" y="24" fill="#fff" font-size="16">${ref} 主链 ${Math.round(g.totalKm)}km (official ${g.officialKm || '-'}) · 其余段 ${segs.length} 条${fMark}</text></svg>`;
  fs.writeFileSync(`${GEOM}/${ref}-spot.svg`, svg);
  console.log(`${ref}: 主链 ${Math.round(g.totalKm)}km · segs ${segs.length} → ${ref}-spot.svg`);
}
