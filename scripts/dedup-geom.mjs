#!/usr/bin/env node
// dedup-geom.mjs —— 全量 geom 后处理：剪掉主链/组件内的往返环（回访已访问坐标 ≥minLoopKm）
// 免重建、免高德 QPS。重算 cumKm/totalKm/drawnKm，平移修正 gapAnnotations.atKm。
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data/roads/geom';
const MIN_LOOP_KM = Number(process.env.LOOP_TRIM_KM || 15);

function havM(a, b) {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function chainKmOf(pts) {
  let km = 0;
  for (let i = 1; i < pts.length; i += 1) km += havM(pts[i - 1], pts[i]) / 1000;
  return km;
}

// 返回 { idx: 保留点的原始索引, cuts: [{cutStartKm, cutKm, removed}] }
// 规则：回访已访问坐标（1e-4≈11m）形成 ≥minLoopKm 环段时，仅当"环中点距主干 <500m"
//（往返特征：原路返回）才剪；合法闭环（绕城高速）环中点远离起点，保留。
function dedupBacktrack(pts, minLoopKm) {
  const seen = new Map();
  const outIdx = [];
  const cuts = [];
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
        if (near) {
          cuts.push({ cutStartKm: cum[startIdx], cutKm: loopKm, removed: outIdx.length - 1 - prevPos });
          outIdx.length = prevPos + 1;
        }
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
  return { idx: outIdx, cuts };
}

const pickIdx = (pts, idx) => idx.map((i) => pts[i]);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const report = [];
for (const f of files) {
  const fp = path.join(DIR, f);
  const g = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let changed = false;

  // 主链
  const pts = (g.points || []).map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]));
  if (pts.length >= 2) {
    const r = dedupBacktrack(pts, MIN_LOOP_KM);
    if (r.idx.length !== pts.length) {
      changed = true;
      report.push({ ref: g.ref || f.replace('.json', ''), chain: true, removed: pts.length - r.idx.length, km: r.cuts.reduce((s, c) => s + c.cutKm, 0) });
      // 平移修正 gapAnnotations
      for (const c of r.cuts) {
        for (const ga of g.gapAnnotations || []) {
          if (ga.atKm > c.cutStartKm) ga.atKm = Math.round((ga.atKm - c.cutKm) * 10) / 10;
        }
      }
      g.points = pickIdx(pts, r.idx);
    }
  }

  // segments
  if (Array.isArray(g.segments) && g.segments.length) {
    const segs = g.segments.map((sg) => {
      const sPts = (Array.isArray(sg) ? sg : sg.points || []).map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]));
      if (sPts.length < 2) return { sg, sPts };
      const r = dedupBacktrack(sPts, MIN_LOOP_KM);
      if (r.idx.length !== sPts.length) {
        changed = true;
        report.push({ ref: g.ref || f.replace('.json', ''), chain: false, removed: sPts.length - r.idx.length, km: r.cuts.reduce((s, c) => s + c.cutKm, 0) });
      }
      return { sg, sPts: pickIdx(sPts, r.idx) };
    });
    g.segments = segs.map(({ sg, sPts }) => (Array.isArray(sg) ? sPts : { ...sg, points: sPts }));
  }

  if (!changed) continue;

  // 重算里程
  const chainKm = chainKmOf(g.points);
  const segKm = (g.segments || []).reduce((s, sg) => s + chainKmOf(Array.isArray(sg) ? sg : sg.points || []), 0);
  const cum = [0];
  for (let i = 1; i < g.points.length; i += 1) cum.push(Math.round((cum[i - 1] + havM(g.points[i - 1], g.points[i]) / 1000) * 10) / 10);
  g.cumKm = cum;
  g.totalKm = Math.round(chainKm * 10) / 10;
  g.drawnKm = Math.round((chainKm + segKm) * 10) / 10;
  g.dedupTrimmed = true;
  fs.writeFileSync(fp, JSON.stringify(g));
}

console.log('扫描文件数:', files.length, '· 修剪数:', report.length);
for (const r of report) console.log(`  ${r.ref} ${r.chain ? '主链' : '组件'} 剪${r.removed}点 ${r.km.toFixed(1)}km`);
