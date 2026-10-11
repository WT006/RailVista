// 沿 PCA 主轴插值补国道断口（fill-road-gaps-pca.mjs）
//
// 思路：
//   之前 fill-road-gaps 用高德"两点驾车"补 gap，导致几何绕去 G30 等其他高速 → 平行双线。
//   正确做法：gap 内不调任何路径规划 API，直接沿 G219 真实 OSM 数据算出的 PCA 主轴做线性/平滑插值。
//   几何保证：单调（沿主轴方向）、无重复、无绕路。
//   里程：补全后 = 主链折线 + 碎段折线 + gap 直线（gap 直线 = A-B 沿主轴投影距离，比驾车绕路短得多）。
//   诚实点：补的线不是真实道路，是"沿国道大致方向的近似线"。用户已明确不要绕路假数据。
//
// 用法：
//   node scripts/fill-road-gaps-pca.mjs --key G219        # 单条
//   node scripts/fill-road-gaps-pca.mjs --all             # 所有 national
//
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const KEY = args.includes('--key') ? args[args.indexOf('--key') + 1] : null;
const ALL = args.includes('--all');
const DRY_RUN = args.includes('--dry-run');
const MIN_GAP_M = Number(process.env.GAP_MIN_M || 8000);
const DENSITY_M = Number(process.env.DENSITY_M || 5000); // 插值点密度：每 5km 1 个点

const GEOM_DIR = 'data/roads/geom';
const RAD = Math.PI / 180;
const R = 6371000;

function haversineM(a, b) {
  const dl = (b[0] - a[0]) * RAD;
  const dt = (b[1] - a[1]) * RAD;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dt / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dl / 2) ** 2));
}
function polylineM(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversineM(pts[i - 1], pts[i]);
  return s;
}
function midDist(a, b, c) {
  // 中点 B 到 AC 连线的距离（用于检测折返）
  const lab = haversineM(a, b);
  const lbc = haversineM(b, c);
  const lac = haversineM(a, c);
  const p = (lab + lbc + lac) / 2;
  const area = Math.sqrt(Math.max(0, p * (p - lab) * (p - lbc) * (p - lac)));
  return (2 * area) / Math.max(lac, 1);
}

/**
 * 计算所有点集的主轴方向角（PCA 第一主成分）
 * 用墨卡托等距近似（lng 缩放到 cos(meanLat)）
 */
function pcaAxisAngle(allPts) {
  if (allPts.length < 3) return 0;
  let meanLat = 0;
  for (const p of allPts) meanLat += p[1];
  meanLat /= allPts.length;
  const k = Math.cos(meanLat * RAD);
  let mx = 0, my = 0;
  for (const p of allPts) { mx += p[0] * k; my += p[1]; }
  mx /= allPts.length; my /= allPts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of allPts) {
    const x = p[0] * k - mx;
    const y = p[1] - my;
    sxx += x * x; syy += y * y; sxy += x * y;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}
function projectAlongAxis(theta, k, p, meanX, meanY) {
  const x = p[0] * k - meanX;
  const y = p[1] - meanY;
  return x * Math.cos(theta) + y * Math.sin(theta);
}

/**
 * gap 内的几何处理 —— 三种策略，由小到大：
 *   d ≤ MIN_GAP_M(8km)  ：直接 1 个中点（避免跳点）
 *   d ≤ 80km            ：直线插值（每 DENSITY_M 一个点）
 *   d > 80km            ：A→B 大圆路径 + 每 DENSITY_M 一个点（沿球面弧，仍是单调最短，无绕路）
 *
 *   PCA 不再使用 —— G219 是弯曲国道，全局 PCA 主轴无法代表真实走向，
 *   沿 PCA 插值会让 gap 内的点"飞"到偏离 G219 的位置。
 *   直线/大圆插值是几何最干净的方案：无重复、无折返、无绕路。
 */
function interpolateStraight(a, b, densityM) {
  const dist = haversineM(a, b);
  if (dist <= 0) return [a.slice()];
  const n = Math.max(2, Math.ceil(dist / densityM) + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

/** 大圆插值（球面弧），用于长 gap 的几何自然过渡 */
function interpolateGreatCircle(a, b, densityM) {
  const dist = haversineM(a, b);
  if (dist <= 0) return [a.slice()];
  const n = Math.max(2, Math.ceil(dist / densityM) + 1);
  const lat1 = a[1] * RAD, lon1 = a[0] * RAD;
  const lat2 = b[1] * RAD, lon2 = b[0] * RAD;
  // 球面距离比例
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (d === 0) return [a.slice()];
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    out.push([lon / RAD, lat / RAD]);
  }
  return out;
}

function fillGap(a, b, densityM) {
  const d = haversineM(a, b);
  if (d <= MIN_GAP_M) {
    return { pts: [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]], distKm: d / 1000, kind: 'midpoint' };
  }
  if (d <= 80000) {
    return { pts: interpolateStraight(a, b, densityM), distKm: d / 1000, kind: 'line' };
  }
  return { pts: interpolateGreatCircle(a, b, densityM), distKm: d / 1000, kind: 'greatcircle' };
}

function dedupConsecutive(pts, epsM = 5) {
  const out = [];
  for (const p of pts) {
    if (out.length === 0 || haversineM(out[out.length - 1], p) > epsM) out.push(p);
  }
  return out;
}

/** 处理单条国道 */
function fillOne(g) {
  if (g.class !== 'national') return null;
  // 已贯通且无 segments、无 gapAnnotations 跳过
  if (g.componentCount === 1 && (!g.segments || g.segments.length === 0) && (!g.gapAnnotations || g.gapAnnotations.length === 0)) {
    return null;
  }
  if (!g.segments || g.segments.length === 0) return null;

  // 收集 segments（深拷贝，避免修改原数据）
  const segs = [];
  for (const s of g.segments) {
    if (s.length >= 2) segs.push(s.slice());
  }
  if (segs.length === 0) return null;

  // ── 双向贪心：主链两端向外扩展，每次找最近的 segment ───────────────
  let headChain = [g.points[0].slice()];      // 主链从首端开始
  let tailChain = [...g.points.slice().reverse()]; // 主链从末端反向（方便 prepend）
  let headEnd = headChain[0];                    // 链头方向端点（headChain 的第一个点）
  let tailEnd = tailChain[0];                    // 链尾方向端点（tailChain 的第一个点）
  const used = new Set();
  const filledGaps = [];

  while (used.size < segs.length) {
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue;
      const s = segs[i];
      const dH0 = haversineM(headEnd, s[0]);
      const dH1 = haversineM(headEnd, s[s.length - 1]);
      const dT0 = haversineM(tailEnd, s[0]);
      const dT1 = haversineM(tailEnd, s[s.length - 1]);
      const candidates = [
        { which: 'head', d: dH0, reverse: false },
        { which: 'head', d: dH1, reverse: true },
        { which: 'tail', d: dT0, reverse: false },
        { which: 'tail', d: dT1, reverse: true },
      ];
      for (const c of candidates) {
        if (!best || c.d < best.d) best = { ...c, idx: i };
      }
    }
    if (!best) break;
    used.add(best.idx);
    let pts = segs[best.idx].slice();
    if (best.reverse) pts.reverse();

    if (best.which === 'head') {
      // 补 headEnd 到 pts[0] 的 gap
      const a = headEnd;
      const b = pts[0];
      const gapM = haversineM(a, b);
      if (gapM > MIN_GAP_M) {
        const fill = fillGap(a, b, DENSITY_M);
        // 跳过第一个点（=headEnd）和最后一个点（=pts[0]）
        for (let j = 1; j < fill.pts.length - 1; j++) headChain.push(fill.pts[j]);
        filledGaps.push({ distKm: +fill.distKm.toFixed(2), pts: fill.pts.length, kind: fill.kind, side: 'head', from: a, to: b });
      } else if (gapM > 5) {
        headChain.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      }
      headChain = [...pts.slice().reverse(), ...headChain];
      headEnd = headChain[0];
    } else {
      // 补 tailEnd 到 pts[0] 的 gap
      const a = tailEnd;
      const b = pts[0];
      const gapM = haversineM(a, b);
      if (gapM > MIN_GAP_M) {
        const fill = fillGap(a, b, DENSITY_M);
        for (let j = 1; j < fill.pts.length - 1; j++) tailChain.push(fill.pts[j]);
        filledGaps.push({ distKm: +fill.distKm.toFixed(2), pts: fill.pts.length, kind: fill.kind, side: 'tail', from: a, to: b });
      } else if (gapM > 5) {
        tailChain.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      }
      tailChain = [...tailChain, ...pts];
      tailEnd = tailChain[0];
    }
  }

  // 拼接 headChain（已 reverse）+ tailChain（也 reverse 过）→ 最终顺序
  // headChain: [ptsN, ..., headEnd, ..., 主链首点]
  // tailChain: [主链末点, ..., tailEnd]
  // 合并：[ptsN, ..., headEnd, ..., 主链首点, 主链中..., 主链末点, ..., tailEnd]
  let mainPts = [...headChain.slice().reverse(), ...tailChain.slice(1)];
  mainPts = dedupConsecutive(mainPts, 5);

  const beforeKm = (g.points ? polylineM(g.points) : 0) / 1000 + g.segments.reduce((s, x) => s + polylineM(x), 0) / 1000;
  const afterKm = polylineM(mainPts) / 1000;
  return { g, mainPts, filledGaps, beforeKm, afterKm };
}

// ── 主流程 ─────────────────────────────────────────────────────────────
const files = readdirSync(GEOM_DIR).filter((f) => /^G\d+\.json$/.test(f) && !f.startsWith('GS'));
const targets = KEY ? [`${KEY}.json`] : files;

let processed = 0, skipped = 0, fillCount = 0, totalGaps = 0;
for (const f of targets) {
  const fp = join(GEOM_DIR, f);
  let g;
  try { g = JSON.parse(readFileSync(fp, 'utf8')); } catch { continue; }
  const r = fillOne(g);
  if (!r) { skipped++; continue; }
  fillCount++;
  totalGaps += r.filledGaps.length;

  if (DRY_RUN) {
    console.log(`[dry] ${f}: 补 ${r.filledGaps.length} 个 gap · ${r.beforeKm.toFixed(0)}km → ${r.afterKm.toFixed(0)}km`);
    continue;
  }

  // 保留 prev 数据
  if (!g.gapFill) g.gapFill = { provider: 'none', updatedAt: new Date().toISOString(), filledGaps: [], unfilledGaps: [] };
  g.gapFill.prevPoints = g.points;
  g.gapFill.prevSegments = g.segments;
  g.gapFill.prevGapAnnotations = g.gapAnnotations || [];
  g.gapFill.prevTotalKm = g.totalKm;

  g.points = r.mainPts;
  g.segments = [];
  g.gapAnnotations = [];
  g.componentCount = 1;
  g.totalKm = polylineM(r.mainPts) / 1000;
  g.gapFill.filledGaps = r.filledGaps.map((x) => ({ distKm: x.distKm, pts: x.pts, via: 'pca-axis' }));
  g.gapFill.unfilledGaps = [];
  g.gapFill.provider = 'pca-axis';
  g.gapFill.updatedAt = new Date().toISOString();

  writeFileSync(fp, JSON.stringify(g));
  processed++;
  if (processed % 20 === 0 || filledSingle(f, r)) console.log(`${f}: 补 ${r.filledGaps.length} gap · ${r.beforeKm.toFixed(0)}→${r.afterKm.toFixed(0)}km`);
}
function filledSingle(f, r) { return /^(G219|G318|G108|G107)\.json$/.test(f); }

console.log('\n=== 汇总 ===');
console.log('目标国道文件:', targets.length, '· 已贯通跳过:', skipped, '· 处理:', processed, '· 累计 gap:', totalGaps);
