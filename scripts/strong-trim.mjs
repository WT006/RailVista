#!/usr/bin/env node
// strong-trim.mjs —— 对指定的"平行走廊蛇形"超长线做强剪（近邻阈值放宽到 3km）
// 用法: node scripts/strong-trim.mjs G317 G102 G208
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data/roads/geom';
const NEAR_M = Number(process.env.NEAR_M || 3000);
const MIN_LOOP_KM = Number(process.env.MIN_LOOP_KM || 15);
const refs = process.argv.slice(2);

function havM(a, b) {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const chainKmOf = (pts) => { let km = 0; for (let i = 1; i < pts.length; i += 1) km += havM(pts[i - 1], pts[i]) / 1000; return km; };

function strongDedup(pts) {
  const seen = new Map();
  const outIdx = [];
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + havM(pts[i - 1], pts[i]) / 1000);
  let cutKm = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const k = p[0].toFixed(4) + ',' + p[1].toFixed(4);
    const prevPos = seen.get(k);
    if (prevPos !== undefined && prevPos < outIdx.length - 1) {
      const startIdx = outIdx[prevPos];
      const endIdx = outIdx[outIdx.length - 1];
      const loopKm = cum[endIdx] - cum[startIdx];
      if (loopKm >= MIN_LOOP_KM) {
        const midPos = Math.floor((prevPos + outIdx.length - 1) / 2);
        const mid = pts[outIdx[midPos]];
        let near = false;
        for (let t = 0; t <= prevPos && !near; t += 1) {
          if (havM(pts[outIdx[t]], mid) < NEAR_M) near = true;
        }
        if (near) { cutKm += loopKm; outIdx.length = prevPos + 1; }
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
  return { idx: outIdx, cutKm };
}

for (const ref of refs) {
  const fp = path.join(DIR, ref + '.json');
  if (!fs.existsSync(fp)) { console.log(ref, '无文件'); continue; }
  const g = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const before = g.totalKm;

  const pts = g.points.map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]));
  const r = strongDedup(pts);
  if (r.idx.length !== pts.length) {
    for (const c of [{ cutStartKm: 0, cutKm: r.cutKm }]) {
      for (const ga of g.gapAnnotations || []) if (ga.atKm > c.cutStartKm) ga.atKm = Math.round((ga.atKm - c.cutKm) * 10) / 10;
    }
    g.points = r.idx.map((i) => pts[i]);
  }
  const segs = (g.segments || []).map((sg) => {
    const sPts = (Array.isArray(sg) ? sg : sg.points || []).map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]));
    if (sPts.length < 2) return sg;
    const rr = strongDedup(sPts);
    if (rr.idx.length === sPts.length) return sg;
    return Array.isArray(sg) ? rr.idx.map((i) => sPts[i]) : { ...sg, points: rr.idx.map((i) => sPts[i]) };
  });
  g.segments = segs;

  const chainKm = chainKmOf(g.points);
  const segKm = (g.segments || []).reduce((s, sg) => s + chainKmOf(Array.isArray(sg) ? sg : sg.points || []), 0);
  const cum = [0];
  for (let i = 1; i < g.points.length; i += 1) cum.push(Math.round((cum[i - 1] + havM(g.points[i - 1], g.points[i]) / 1000) * 10) / 10);
  g.cumKm = cum;
  g.totalKm = Math.round(chainKm * 10) / 10;
  g.drawnKm = Math.round((chainKm + segKm) * 10) / 10;
  g.strongTrimmed = true;
  fs.writeFileSync(fp, JSON.stringify(g));
  console.log(`${ref} 主链剪${r.cutKm.toFixed(0)}km · total ${before} → ${g.totalKm} (official ${g.officialKm || '-'}) pts=${g.points.length}`);
}
