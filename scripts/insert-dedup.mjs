#!/usr/bin/env node
// 一次性向 road-build.mjs 插入 dedupBacktrack 函数
import fs from 'node:fs';

const p = 'scripts/lib/road-build.mjs';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('dedupBacktrack')) { console.log('已存在，跳过'); process.exit(0); }

const fn = `/**
 * 主链环修剪：走线回到已访问坐标（1e-4≈11m 内）形成 ≥minLoopKm 的环段时，
 * 剪掉环段保留主干（OSM 里 G 级路的环状分支/双向绕圈被 trace 串成往返的形态）。
 */
export function dedupBacktrack(pts, minLoopKm = 15) {
  const seen = new Map();
  const out = [];
  for (const p of pts) {
    const k = p[0].toFixed(4) + ',' + p[1].toFixed(4);
    const prevIdx = seen.get(k);
    if (prevIdx !== undefined && prevIdx < out.length - 1) {
      let loopKm = 0;
      for (let t = prevIdx + 1; t < out.length; t += 1) {
        loopKm += Math.hypot((out[t][0] - out[t - 1][0]) * 93, (out[t][1] - out[t - 1][1]) * 111);
      }
      if (loopKm >= minLoopKm) out.length = prevIdx + 1;
    }
    seen.set(k, out.length);
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

`;

const anchor = 'export function gatherSurfaceWays';
if (!s.includes(anchor)) { console.log('anchor 未命中'); process.exit(1); }
s = s.replace(anchor, fn + anchor);
fs.writeFileSync(p, s);
console.log('OK dedupBacktrack 已插入');
