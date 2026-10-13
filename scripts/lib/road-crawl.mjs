/**
 * 万里路书 · 国道走廊爬行器（scripts/lib/road-crawl.mjs）
 *
 * 目标：让高德「全程走国道」，而不是拿一条更快的替代路线充数。
 *
 * 三条硬规矩：
 *   1) 锚点必须来自官方控制点 / 已有真实几何——端点本身就在国道上，高德自然沿国道走；
 *   2) 同一段同时用多种驾车策略求解（速度优先 / 不走高速 / 距离优先 / 不收费 / 不走快速路），
 *      「按国道名覆盖率打分」择优——而不是无脑取第一条（那会拿到高速绕行线）；
 *      覆盖率证据来自 Amap step.road（如「219国道」「G219」）；隧道/桥梁等接续段按上下文归并；
 *   3) 逐段门控：贴弦横向带、绕行倍数、高速占比；国道证据充分（≥35% 里程命中本编号）时
 *      才放宽绕行倍数（山区河谷真实绕行），否则严格执行上限——拒绝跨城假线。
 *
 * 失败时沿弦二分递归（深度 2，即最多四分），仍不通则诚实返回 null，由调用方决定直连兜底。
 */
import { haversineM } from './road-assemble.mjs';
import { drivingLeg } from './amap.mjs';

/** 优先顺序：先要不走高速的地面线，其次默认/距离优先 */
export const STRATS = [6, 0, 2, 9, 3];

/** step 路名是否属于本国道编号 */
export function nameMatchesRef(name, num) {
  if (!name) return false;
  const n = String(name);
  if (n.includes(num + '国道')) return true;
  if (n.includes('国道' + num)) return true;
  if (new RegExp('^G0?' + num + '(?![0-9])').test(n)) return true;
  if (new RegExp('(^|[^0-9])' + num + '(?![0-9])').test(n) && /(国道|公路|线)/.test(n)) return true;
  return false;
}

const isExp = (name) => /高速|快速路|高架/.test(name || '');

/**
 * 统计一条 leg 的「国道证据」：命中里程（含隧道/桥梁等接续段归并）、高速里程、连续高速。
 */
export function legStats(leg, num) {
  const steps = leg.steps ?? [];
  const hit = steps.map((s) => nameMatchesRef(s.name, num));
  // 接续归并：被本编号路段夹在中间的短段（隧道/桥梁/无名接线）视为同路
  for (let i = 0; i < steps.length; i += 1) {
    if (hit[i] || isExp(steps[i].name)) continue;
    const prev = hit[i - 1], next = hit[i + 1];
    if ((prev || next) && (steps[i].distanceM || 0) <= 60000) hit[i] = true;
  }
  let natM = 0, expM = 0, runM = 0, maxRunM = 0;
  for (let i = 0; i < steps.length; i += 1) {
    if (hit[i]) natM += steps[i].distanceM || 0;
    if (isExp(steps[i].name)) {
      expM += steps[i].distanceM || 0; runM += steps[i].distanceM || 0;
      if (runM > maxRunM) maxRunM = runM;
    } else runM = 0;
  }
  const d = leg.distanceM || 1;
  return { natM, expM, maxRunM, natPct: natM / d, expPct: expM / d };
}

function projector(from, to) {
  const RAD = Math.PI / 180, M = 111320;
  const cosLat = Math.cos(((from[1] + to[1]) / 2) * RAD);
  const dx = (to[0] - from[0]) * M * cosLat, dy = (to[1] - from[1]) * M;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  return (p) => {
    const ex = (p[0] - from[0]) * M * cosLat, ey = (p[1] - from[1]) * M;
    return { prog: ex * ux + ey * uy, lat: Math.abs(ex * uy - ey * ux) };
  };
}

/** 绕行上限：有国道证据时放宽（山区河谷/荒漠真实绕行），否则严格 */
function ratioCap(chord, natPct) {
  if (natPct >= 0.35) return 3.4;   // 明确走在本编号上：允许大幅自然弯曲
  if (natPct >= 0.22) return 2.6;   // 有相当比例本编号：放宽
  if (chord <= 30000) return 3.0;
  if (chord <= 80000) return 2.2;
  if (chord <= 150000) return 1.8;
  return 1.5;
}

/**
 * 求解一段：多策略并发择优（按国道覆盖率）。
 * @returns {{points:number[][], distanceM:number, natPct:number, detour:number, strategy:number}|null}
 */
export async function bestLeg(a, b, num, { strats = STRATS, legGuard } = {}) {
  const chord = haversineM(a[0], a[1], b[0], b[1]);
  if (chord < 200) return { points: [], distanceM: 0, natPct: 1, detour: 1, strategy: 0 };
  if (legGuard) {
    if (legGuard.n >= legGuard.max) return null;
  }
  const latCap = Math.max(25000, chord * 0.75);
  const project = projector(a, b);
  let best = null;
  const seen = new Set();
  for (const st of strats) {
    let leg;
    try {
      if (legGuard) legGuard.n += 1;
      leg = await drivingLeg(a, b, { strategy: st });
    } catch { continue; }
    if (!leg?.points?.length) continue;
    const sig = Math.round(leg.distanceM) + ':' + leg.points.length;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const s = legStats(leg, num);
    const detour = chord > 0 ? leg.distanceM / chord : Infinity;
    let maxLat = 0;
    for (const p of leg.points) { const l = project(p).lat; if (l > maxLat) maxLat = l; }
    const cap = ratioCap(chord, s.natPct);
    const runCap = Math.max(30000, chord * 0.06);   // 长距离缺口允许一段长共线高速
    // 两档门控：
    //   一档（严格）：高速占比/连续高速都很低——常规地面国道走线；
    //   二档（兜底）：长缺口（≥120km）里国道与高速共线是真实路况（荒漠/山区），
    //                 只要贴弦、绕行不离谱就先收下，避免退化成穿越大漠的直线假线。
    const ok1 = detour <= cap && maxLat <= latCap && s.expPct <= 0.45 && s.maxRunM <= runCap;
    const ok2 = !ok1 && chord >= 120000 && detour <= 1.7 && maxLat <= latCap && s.expPct <= 0.70;
    const ok = ok1 || ok2;
    if (process.env.LEG_DEBUG) {
      console.log(`    [leg s${st}] ${(leg.distanceM / 1000).toFixed(0)}km detour=${detour.toFixed(2)}/${cap} lat=${(maxLat / 1000).toFixed(0)}/${(latCap / 1000).toFixed(0)}km exp=${(s.expPct * 100).toFixed(0)}% run=${(s.maxRunM / 1000).toFixed(0)}/${(runCap / 1000).toFixed(0)}km nat=${(s.natPct * 100).toFixed(0)}% → ${ok ? (ok1 ? 'OK' : 'OK(兜底)') : 'REJECT'}`);
    }
    if (!ok) continue;
    // 打分：国道命中里程为主，高速/额外里程为罚；兜底档再扣一档分（有常规解时优先常规解）
    const score = s.natM - s.expM * 1.2 - Math.max(0, leg.distanceM - chord) * 0.30 - maxLat * 4 - (ok1 ? 0 : 60000);
    if (!best || score > best.score) {
      best = { points: leg.points.slice(), distanceM: leg.distanceM, natPct: s.natPct, detour, strategy: st, score, expPct: s.expPct, fallback: !ok1 };
    }
  }
  return best;
}

function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

/**
 * 爬一段（失败则二分）。返回 { points, legs } 或 null。
 * points 不含起点 a，含终点 b。
 */
export async function crawlHop(a, b, num, { depth = 0, legGuard } = {}) {
  const one = await bestLeg(a, b, num, { legGuard });
  if (one) return { points: one.points, legs: 1, info: one };
  const chord = haversineM(a[0], a[1], b[0], b[1]);
  if (depth < 2 && chord > 30000) {
    const m = mid(a, b);
    const l = await crawlHop(a, m, num, { depth: depth + 1, legGuard });
    if (!l) return null;
    const r = await crawlHop(m, b, num, { depth: depth + 1, legGuard });
    if (!r) return null;
    return { points: l.points.concat(r.points), legs: l.legs + r.legs };
  }
  return null;
}

const WALK_STEPS = [45000, 30000, 18000, 10000, 6000];

function lerpTo(a, b, stepM) {
  const d = haversineM(a[0], a[1], b[0], b[1]);
  if (d <= 1) return b.slice();
  const t = Math.min(1, stepM / d);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * 「一点一点往前挪」：从 from 沿弦向 to 逐段推进，每段只走 step（45/30/18/10/6km 逐级降级）。
 * 走不通就停在最后一个能走到的点——把直线兜底压到最短。
 * @returns {{points:number[][], cursor:number[], done:boolean}}  points 含起点 from
 */
export async function greedyWalk(from, to, num, { legGuard } = {}) {
  const out = [from.slice()];
  let cursor = from.slice();
  let guard = 0;
  for (;;) {
    if (guard >= 80) break;
    const remain = haversineM(cursor[0], cursor[1], to[0], to[1]);
    if (remain <= 1500) break;
    let advanced = false;
    for (const step of WALK_STEPS) {
      if (step > remain * 1.25) continue;
      const target = lerpTo(cursor, to, step);
      const r = await bestLeg(cursor, target, num, { legGuard });
      if (!r || !r.points.length) continue;
      const end = r.points[r.points.length - 1];
      const gain = remain - haversineM(end[0], end[1], to[0], to[1]);
      if (gain < step * 0.25) continue;      // 几乎没前进：避免原地打转
      for (const p of r.points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last[0] - p[0]) < 1e-7 && Math.abs(last[1] - p[1]) < 1e-7) continue;
        out.push(p);
      }
      cursor = end;
      advanced = true;
      break;
    }
    if (!advanced) break;
    guard += 1;
  }
  const done = haversineM(cursor[0], cursor[1], to[0], to[1]) <= 1500;
  return { points: out, cursor, done };
}

/**
 * 双向推进：从 a 往 b 走、同时从 b 往 a 走，最后只把两头都走不到的那一小段留作直连。
 * @returns {{points:number[][], restA:number[]|null, restB:number[]|null, complete:boolean}}
 */
export async function walkBoth(a, b, num, { legGuard } = {}) {
  const fw = await greedyWalk(a, b, num, { legGuard });
  if (fw.done) return { points: fw.points, restA: null, restB: null, complete: true };
  const bw = await greedyWalk(b, a, num, { legGuard });
  const bwPts = bw.points.slice().reverse();
  if (bw.done) return { points: bwPts, restA: null, restB: null, complete: true };
  const restM = haversineM(fw.cursor[0], fw.cursor[1], bw.cursor[0], bw.cursor[1]);
  const points = fw.points.concat(bwPts.slice(1));
  if (restM <= 1500) return { points, restA: null, restB: null, complete: true };
  return { points, restA: fw.cursor, restB: bw.cursor, complete: false };
}

/**
 * 沿锚点链爬行：a → anchors… → b。
 * 每段先「直接求解 + 二分」，仍不通则「一点一点往前挪」双向推进，残余区间上报调用方。
 * @returns {{ok:boolean, points:number[][], failedAt:number|null, legs:number, restA:number[]|null, restB:number[]|null}}
 *   points 为已走出的走线（含起点 a）；失败时 restA/restB 为残余未通区间（其余部分已尽力走通）。
 */
export async function crawlChain(a, b, anchors, num, { legGuard } = {}) {
  const chain = [a, ...anchors, b];
  const out = [a];
  let legs = 0;
  for (let i = 0; i < chain.length - 1; i += 1) {
    const p = chain[i], q = chain[i + 1];
    const r = await crawlHop(p, q, num, { legGuard });
    if (r) {
      for (const pt of r.points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last[0] - pt[0]) < 1e-7 && Math.abs(last[1] - pt[1]) < 1e-7) continue;
        out.push(pt);
      }
      legs += r.legs;
      continue;
    }
    // 直接/二分都不通 → 双向逐段推进（能走多少走多少）
    const w = await walkBoth(p, q, num, { legGuard });
    for (const pt of w.points.slice(1)) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[0] - pt[0]) < 1e-7 && Math.abs(last[1] - pt[1]) < 1e-7) continue;
      out.push(pt);
    }
    legs += 1;
    if (!w.complete) return { ok: false, points: out, failedAt: i, legs, restA: w.restA, restB: w.restB ?? q };
  }
  return { ok: true, points: out, failedAt: null, legs, restA: null, restB: null };
}
