#!/usr/bin/env node
// fix-builder-dedup.mjs —— 把 road-build.mjs 的旧版 dedupBacktrack（无闭环保护）替换为修复版
import fs from 'node:fs';

const p = 'scripts/lib/road-build.mjs';
let s = fs.readFileSync(p, 'utf8');

const start = s.indexOf('/**\n * 主链环修剪');
if (start < 0) { console.log('未找到函数头'); process.exit(1); }
const end = s.indexOf('export function gatherSurfaceWays', start);
if (end < 0) { console.log('未找到函数尾锚点'); process.exit(1); }

const fixed = `/**
 * 主链环修剪（闭环保护版）：回访已访问坐标（1e-4≈11m）形成 ≥minLoopKm 环段时，
 * 仅当"环中点距主干 <500m"（往返特征：原路返回）才剪；合法闭环（绕城/环线高速）环中点
 * 远离起点，保留不剪。
 */
export function dedupBacktrack(pts, minLoopKm = 15) {
  const havM = (a, b) => {
    const R = 6371000;
    const dLat = ((b[1] - a[1]) * Math.PI) / 180;
    const dLng = ((b[0] - a[0]) * Math.PI) / 180;
    const la1 = (a[1] * Math.PI) / 180;
    const la2 = (b[1] * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const seen = new Map();
  const outIdx = [];
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + havM(pts[i - 1], pts[i]) / 1000);
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const k = p[0].toFixed(4) + ',' + p[1].toFixed(4);
    const prevPos = seen.get(k);
    if (prevPos !== undefined && prevPos < outIdx.length - 1) {
      const startIdx = outIdx[prevPos];
      const endIdx = outIdx[outIdx.length - 1];
      const loopKm = cum[endIdx] - cum[startIdx];
      if (loopKm >= minLoopKm) {
        const midPos = Math.floor((prevPos + outIdx.length - 1) / 2);
        const mid = pts[outIdx[midPos]];
        let near = false;
        for (let t = 0; t <= prevPos && !near; t += 1) {
          if (havM(pts[outIdx[t]], mid) < 500) near = true;
        }
        if (near) outIdx.length = prevPos + 1;
      }
    }
    seen.set(k, outIdx.length);
    const lastPos = outIdx[outIdx.length - 1];
    if (lastPos !== undefined) {
      const last = pts[lastPos];
      if (Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    }
    outIdx.push(i);
  }
  return outIdx.map((i) => pts[i]);
}

`;

s = s.slice(0, start) + fixed + s.slice(end);
fs.writeFileSync(p, s);
console.log('OK dedupBacktrack 已替换为闭环保护版');
