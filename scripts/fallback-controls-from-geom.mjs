#!/usr/bin/env node
// 为无 plan controls 的绕城/联络线高速生成控制点：从 geom 现有几何沿里程均匀采样。
// 控制点全部取自该路自身真实 way 节点，Dijkstra 沿其走线不会引入外来几何。
import fs from 'node:fs';

const GEOM_DIR = 'data/roads/geom';
const CTRL_DIR = 'data/cache/amap/controls';
const N_CTRL = 16;

const refs = process.argv.slice(2);
const list = refs.length
  ? refs
  : fs.readdirSync(GEOM_DIR)
      .filter((f) => /^G\d+\.json$/.test(f))
      .map((f) => JSON.parse(fs.readFileSync(`${GEOM_DIR}/${f}`, 'utf8')))
      .filter((g) => g.class === 'expressway' && !(g.componentCount === 1 && !(g.segments || []).length))
      .map((g) => g.ref)
      .filter((ref) => !fs.existsSync(`${CTRL_DIR}/${ref}.json`));

let done = 0, skipped = 0;
for (const ref of list) {
  const p = `${GEOM_DIR}/${ref}.json`;
  if (!fs.existsSync(p)) { console.log(`  跳过 ${ref}（无geom）`); skipped++; continue; }
  const g = JSON.parse(fs.readFileSync(p, 'utf8'));
  const chains = [g.points, ...(g.segments || [])]
    .map((c) => (Array.isArray(c) ? c : (c && c.points) || []))
    .map((c) => (Array.isArray(c) ? c.map((pt) => (Array.isArray(pt) ? { lng: pt[0], lat: pt[1] } : pt)) : []))
    .filter((c) => c.length >= 2 && typeof c[0].lng === 'number');
  if (!chains.length) { console.log(`  跳过 ${ref}（无几何）`); skipped++; continue; }

  // 先算每条链里程，按占比分配采样数（总计约 N_CTRL）
  const chainsCum = chains.map((chain) => {
    const cum = [0];
    for (let i = 1; i < chain.length; i++) {
      const dx = chain[i].lng - chain[i - 1].lng, dy = chain[i].lat - chain[i - 1].lat;
      cum.push(cum[i - 1] + Math.hypot(dx * 93, dy * 111));
    }
    return cum;
  });
  const grandTotal = chainsCum.reduce((s, cum) => s + cum[cum.length - 1], 0);
  const controls = [];
  chains.forEach((chain, ci) => {
    const cum = chainsCum[ci];
    const total = cum[cum.length - 1];
    const n = Math.max(4, Math.round((N_CTRL * total) / grandTotal));
    const idxs = new Set();
    for (let k = 0; k <= n; k++) {
      const target = (total * k) / n;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; cum[mid] < target ? (lo = mid + 1) : (hi = mid); }
      idxs.add(Math.min(lo, chain.length - 1));
    }
    for (const i of idxs) controls.push({ name: `P${controls.length + 1}`, lng: chain[i].lng, lat: chain[i].lat, province: (g.provinces || [])[0] || '', district: '' });
  });

  const provOrder = (g.provinces || []).slice();
  fs.writeFileSync(`${CTRL_DIR}/${ref}.json`, JSON.stringify({ ref, controls, provOrder }, null, 1));
  done++;
  console.log(`  ${ref}: ${controls.length} 控制点 · provOrder=${provOrder.join('，')}`);
}
console.log(`完成 ${done} · 跳过 ${skipped}`);
