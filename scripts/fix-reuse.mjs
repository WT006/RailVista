#!/usr/bin/env node
// fix-reuse.mjs v2 —— 省道编号重用修复：官方起讫锚定 + 分量内切割
// 双端锚定（分量头尾接近 F/T 且走廊拟合）→ 官方段
// 单端锚定（仅一端接近）→ 沿链切 official*1.35 km，尾接近 T 才接受
// 切剩部分与未匹配分量全部保留在 segments（不丢真实道路）
import fs from 'node:fs';

const SEED = JSON.parse(fs.readFileSync('data/roads/authoritative/provincial.json', 'utf8')).roads;
const ALL_TARGETS = ['四川_S303', '甘肃_S301', '青海_S102', '四川_S217', '河北_S272', '青海_S202', '西藏_S301', '云南_S308', '四川_S211', '青海_S101', '新疆_S101', '湖南_S228'];
const TARGETS = process.env.FIX_ONLY ? process.env.FIX_ONLY.split(',') : ALL_TARGETS;

function havKm(a, b) {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function chainKm(c) {
  let km = 0;
  for (let j = 1; j < c.length; j += 1) km += havKm(c[j - 1], c[j]);
  return km;
}
function ptSegDistKm(p, A, B) {
  const kx = 111.32 * Math.cos((((A[1] + B[1]) / 2) * Math.PI) / 180);
  const ax = A[0] * kx, ay = A[1] * 111.32;
  const bx = B[0] * kx, by = B[1] * 111.32;
  const px = p[0] * kx, py = p[1] * 111.32;
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function corridorFit(c, F, T, width = 30) {
  if (c.length < 2) return 0;
  let inside = 0;
  for (const p of c) if (ptSegDistKm(p, F, T) <= width) inside += 1;
  return inside / c.length;
}
// 从分量中提取官方段
function extractOfficial(c, F, T, officialKm) {
  let iF = -1, iT = -1, dF = Infinity, dT = Infinity;
  c.forEach((p, i) => {
    const a = havKm(p, F); if (a < dF) { dF = a; iF = i; }
    const b = havKm(p, T); if (b < dT) { dT = b; iT = i; }
  });
  const MAXK = officialKm * 2.2 + 20;
  if (dF < 25 && dT < 25 && iF !== iT) {
    const lo = Math.min(iF, iT), hi = Math.max(iF, iT);
    const sub = c.slice(lo, hi + 1);
    if (sub.length >= 2) {
      const km = chainKm(sub);
      if (km <= MAXK && corridorFit(sub, F, T) > 0.55) return { sub, mode: 'dual' };
    }
    return null;
  }
  if (dF < 25 || dT < 25) {
    const fromF = dF < 25;
    let iA = fromF ? iF : iT;
    const dir = iA >= c.length - 1 ? -1 : 1;
    const targetKm = officialKm * 1.35;
    const sub = [c[iA]];
    let km = 0;
    for (let step = 1; step < c.length; step += 1) {
      const i = dir === 1 ? iA + step : iA - step;
      if (i < 0 || i >= c.length) break;
      const p = c[i];
      km += havKm(sub[sub.length - 1], p);
      sub.push(p);
      if (km >= targetKm) break;
    }
    if (sub.length >= 2 && corridorFit(sub, F, T) > 0.5) {
      const tail = sub[sub.length - 1];
      const tailToT = Math.min(havKm(tail, T), havKm(tail, F));
      if (km <= targetKm + 40 && tailToT < Math.max(60, officialKm * 0.3)) return { sub, mode: 'single' };
    }
    return null;
  }
  return null;
}

const report = [];
for (const fname of TARGETS) {
  const fp = 'data/roads/geom/' + fname + '.json';
  if (!fs.existsSync(fp)) { report.push({ f: fname, issue: 'no-file' }); continue; }
  const g = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const prov = fname.split('_')[0];
  const seed = SEED.find((r) => r.province === prov && r.ref === g.ref);
  if (!seed) { report.push({ f: fname, issue: 'no-seed' }); continue; }
  const F = JSON.parse(fs.readFileSync('data/cache/amap/geocode/' + prov + seed.fromPlace + '.json', 'utf8'));
  const T = JSON.parse(fs.readFileSync('data/cache/amap/geocode/' + prov + seed.toPlace + '.json', 'utf8'));
  const Fp = [F.lng, F.lat], Tp = [T.lng, T.lat];
  const comps = [g.points, ...g.segments].map((c) => c.map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]))).filter((c) => c.length >= 2);
  const subs = [];
  const leftovers = [];
  for (const c of comps) {
    const r = extractOfficial(c, Fp, Tp, seed.officialLengthKm);
    if (r) {
      subs.push(r);
      // 切剩：子链在原分量中的区间之外的部分
      const s0 = c.findIndex((p) => p === r.sub[0]);
      const s1 = c.findIndex((p) => p === r.sub[r.sub.length - 1]);
      const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
      if (lo > 0) leftovers.push(c.slice(0, lo + 1));
      if (hi < c.length - 1) leftovers.push(c.slice(hi));
    } else {
      leftovers.push(c);
    }
  }
  if (!subs.length) {
    g.officialSegmentMissing = true;
    fs.writeFileSync(fp, JSON.stringify(g));
    report.push({ f: fname, issue: 'official-segment-missing', comps: comps.length, total: Math.round(g.totalKm || 0) });
    console.log(`${fname}: 官方段(${seed.fromPlace}->${seed.toPlace} ${seed.officialLengthKm}km)在 OSM ref 数据中未找到，保留现状并标记`);
    continue;
  }
  // 主链排序：从靠 F 的链起，按端点衔接贪心
  const ordered = [...subs.map((s) => s.sub)];
  ordered.sort((a, b) => (havKm(a[0], Fp) + havKm(a[a.length - 1], Tp)) - (havKm(b[0], Fp) + havKm(b[b.length - 1], Tp)));
  // 统一方向：头朝 F
  for (const c of ordered) {
    if (havKm(c[0], Tp) + havKm(c[c.length - 1], Fp) < havKm(c[0], Fp) + havKm(c[c.length - 1], Tp)) c.reverse();
  }
  const chain = ordered.flat();
  const mainKm = chainKm(chain);
  const restComps = leftovers.filter((c) => c.length >= 2);
  const restKm = restComps.reduce((acc, c) => acc + chainKm(c), 0);
  // gapAnnotations：主链内分量接缝
  const gaps = [];
  let atKm = 0;
  for (let oi = 0; oi < ordered.length; oi += 1) {
    const c = ordered[oi];
    for (let j = 1; j < c.length; j += 1) atKm += havKm(c[j - 1], c[j]);
    if (oi + 1 < ordered.length) {
      const gap = havKm(c[c.length - 1], ordered[oi + 1][0]);
      atKm += gap;
      if (gap > 0.05) gaps.push({ atKm: Math.round(atKm * 10) / 10, gapKm: Math.round(gap * 10) / 10, fromSeg: oi, toSeg: oi + 1, status: 'normal' });
    }
  }
  g.points = chain;
  g.segments = restComps;
  g.gapAnnotations = gaps;
  g.totalKm = Math.round(mainKm * 10) / 10;
  g.drawnKm = Math.round((mainKm + restKm) * 10) / 10;
  g.officialKm = seed.officialLengthKm;
  g.lengthDeviation = Math.round(((mainKm - seed.officialLengthKm) / seed.officialLengthKm) * 1000) / 10;
  g.componentCount = 1 + restComps.length;
  g.reuseSplit = true;
  g.reuseKm = Math.round(restKm * 10) / 10;
  g.reuseMode = subs.map((s) => s.mode).join('+');
  delete g.officialSegmentMissing;
  fs.writeFileSync(fp, JSON.stringify(g));
  console.log(`${fname}: 官方主链 ${Math.round(mainKm)}km (official ${seed.officialLengthKm}, ${subs.length} 段 ${g.reuseMode}) · 其余 ${restComps.length} 分量 ${Math.round(restKm)}km 留 segments`);
  report.push({ f: fname, mainKm: Math.round(mainKm), official: seed.officialLengthKm, reuse: restComps.length, reuseKm: Math.round(restKm) });
}
fs.writeFileSync('scripts/fix-reuse-report.json', JSON.stringify(report, null, 1));
console.log('DONE');
