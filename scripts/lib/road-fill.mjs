/**
 * 万里路书 · 国道真实缺口补线库（scripts/lib/road-fill.mjs）
 *
 * 补 trace 后仍存在的缺口。门控原则（既真实又不绕路）：
 *   - 用高德驾车规划缺口两端，evaluateGapLeg 做「整体」判定：
 *       · 总绕行倍数（detour）随缺口长度分档，允许地面公路随地形/岸线/河谷自然弯曲
 *         （山地国道河谷绕行可达弦长 2~3 倍，门控按缺口长度放宽，防止真路被误杀）；
 *       · 宽松横向带宽，允许走线偏离直线弦；
 *       · 高速占比 ≤60% 且无 >30km 连续高速（国道借道共线高速属中国真实路况）；
 *   - 一出发就上长高速 / 路线远离走廊：先用 v3 strategy=6（不走高速）重试拿地面走线；
 *   - 仍不通（无路径 / 大绕行）：若缺口足够长则沿弦插中间 via 点递归分段
 *     （高德会把任意坐标吸附到最近道路，via 取走廊内真实地名/景点/均匀内插点）；
 *   - 分段到底仍不通：诚实标记 unresolved，不拿假线充数。
 */
import { haversineM } from './road-assemble.mjs';
import { drivingLeg } from './amap.mjs';

const RAD = Math.PI / 180;
const M_PER_DEG = 111320;

function projector(from, to) {
  const dx = (to[0] - from[0]) * M_PER_DEG * Math.cos(from[1] * RAD);
  const dy = (to[1] - from[1]) * M_PER_DEG;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  return {
    L,
    project(p) {
      const ex = (p[0] - from[0]) * M_PER_DEG * Math.cos(from[1] * RAD);
      const ey = (p[1] - from[1]) * M_PER_DEG;
      return { prog: ex * ux + ey * uy, lat: Math.abs(ex * uy - ey * ux) };
    },
  };
}

export const isExpressway = (name) => /高速|快速路|快速/.test(name || '');

// 真实走线门控参数（evaluateLeg 原口径，供外部兼容使用）
export const ratioFor = (s) => (s <= 100000 ? 2.2 : s <= 300000 ? 1.8 : 1.5);
export const lateralCapFor = (s) => Math.max(20000, s * 0.9);
const EXP_PCT_MAX = 0.3;
const EXP_RUN_MAX_M = 20000;

/** 缺口补线专用门控：比通用 evaluateLeg 宽（山地河谷真实绕行 + 借道共线高速） */
export function evaluateGapLeg(leg, from, to) {
  const chord = haversineM(from[0], from[1], to[0], to[1]);
  const steps = leg.steps;
  let expM = 0, runM = 0, maxRunM = 0;
  for (const s of steps) {
    if (isExpressway(s.name)) { expM += s.distanceM; runM += s.distanceM; if (runM > maxRunM) maxRunM = runM; }
    else runM = 0;
  }
  const expPct = leg.distanceM > 0 ? expM / leg.distanceM : 0;
  const proj = projector(from, to);
  let maxLat = 0;
  for (const s of steps) for (const p of s.points) { const l = proj.project(p).lat; if (l > maxLat) maxLat = l; }
  const detour = chord > 0 ? leg.distanceM / chord : Infinity;
  // 绕行分档：短缺口允许山区河谷大绕行（真实国道），长缺口收紧防跨城假线
  const ratioCap = chord <= 60000 ? 3.0 : chord <= 150000 ? 2.4 : 1.7;
  const latCap = Math.max(30000, chord * 0.75);
  const accept = detour <= ratioCap && maxLat <= latCap && expPct <= 0.6 && maxRunM <= 30000;
  return { accept, expPct, maxRunM, detour, maxLat };
}

/**
 * 评估一条高德驾车 leg 是否为「真实地面直达线」（原通用口径，保持不变）。
 * @returns {{accept:boolean, expPct:number, maxRunM:number, longRunStart:number, detour:number, maxLat:number}}
 */
export function evaluateLeg(leg, from, to, { allowExpressway = false, coLineway = false } = {}) {
  const chord = haversineM(from[0], from[1], to[0], to[1]);
  const steps = leg.steps;
  let expM = 0, runM = 0, maxRunM = 0, runStart = -1, longRunStart = -1;
  for (let k = 0; k < steps.length; k += 1) {
    if (isExpressway(steps[k].name)) {
      if (runM === 0) runStart = k;
      expM += steps[k].distanceM; runM += steps[k].distanceM;
      if (runM > maxRunM) { maxRunM = runM; longRunStart = runStart; }
    } else runM = 0;
  }
  const expPct = leg.distanceM > 0 ? expM / leg.distanceM : 0;
  const proj = projector(from, to);
  let maxLat = 0;
  for (const s of steps) for (const p of s.points) { const l = proj.project(p).lat; if (l > maxLat) maxLat = l; }
  const detour = chord > 0 ? leg.distanceM / chord : Infinity;
  const expGate = allowExpressway || (coLineway && expPct <= 0.6 && maxRunM <= 30000)
    || (expPct <= EXP_PCT_MAX && maxRunM <= EXP_RUN_MAX_M);
  const accept = detour <= ratioFor(chord) && maxLat <= lateralCapFor(chord) && expGate;
  return { accept, expPct, maxRunM, longRunStart, detour, maxLat };
}

const round5 = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

async function tryLeg(a, b, strategy = 0) {
  try {
    return { leg: await drivingLeg(a, b, { strategy }) };
  } catch (e) {
    if (/无路径|20011|INSUFFICIENT_ABROAD/.test(e.message || '')) return { unroutable: true };
    throw e;
  }
}

/**
 * 在 via 候选中挑「最贴弦」的中间点（弦长 >40km 才值得分段）。
 * via 须落在弦向 8%~92%、横向 ≤max(30km, chord×0.45) 走廊带内。
 */
export function pickVia(from, to, vias) {
  const chord = haversineM(from[0], from[1], to[0], to[1]);
  if (chord < 40000 || !vias?.length) return null;
  const proj = projector(from, to);
  const latCap = Math.max(30000, chord * 0.45);
  let best = null;
  for (const v of vias) {
    const { prog, lat } = proj.project(v);
    if (prog < chord * 0.08 || prog > chord * 0.92) continue;
    if (lat > latCap) continue;
    if (!best || lat < best.lat) best = { via: v, prog, lat };
  }
  return best ? { via: round5(best.via), prog: best.prog } : null;
}

/**
 * 桥接一段缺口：升级梯度 默认策略 → strategy=6（不走高速）→ via 分段递归。
 * 返回 { runs, points, complete }：
 *   runs = 有序 [{pts}] / [{gap}]（真实走线 + 诚实保留的残余缺口），
 *   complete = 全程走通（无任何 gap）——调用方（组件合并）只在 complete 时拼接；
 * 缺口补线（fillGap）则无论 complete 与否都吃 runs（能画多少画多少）。
 */
export async function bridgeGap(a, b, { vias = null, depth = 0, legGuard = { n: 0, max: 80 } } = {}) {
  if (haversineM(a[0], a[1], b[0], b[1]) < 300) return { runs: [], points: [], complete: true };
  if (legGuard.n >= legGuard.max) {
    return { runs: [{ gap: gapRec(a, b) }], points: [], complete: false };
  }

  let leg = null;
  {
    const r = await tryLeg(a, b);
    legGuard.n += 1;
    if (r.leg) leg = r.leg;
  }

  if (leg) {
    const ev = evaluateGapLeg(leg, a, b);
    if (ev.accept) return { runs: [{ pts: leg.points }], points: leg.points, complete: true };
    // 高速占比/连续高速超标 → 不走高速重试（拿真实地面替代线）
    if (ev.expPct > 0.6 || ev.maxRunM > 30000) {
      const r6 = await tryLeg(a, b, 6);
      legGuard.n += 1;
      if (r6.leg) {
        const ev6 = evaluateGapLeg(r6.leg, a, b);
        if (ev6.accept) return { runs: [{ pts: r6.points }], points: r6.points, complete: true };
      }
    }
  }

  // 直接规划失败/被门控拒绝：沿弦取 via 递归分段（via 会被高德吸附到最近道路）；
  // 两侧各自成段：能走通的画出来，走不通的各自记 gap（部分拼接，不整段报废）
  if (depth < 3) {
    const via = pickVia(a, b, vias);
    if (via) {
      const proj = projector(a, b);
      const left = [];
      const right = [];
      for (const v of vias ?? []) {
        const p = proj.project(v);
        (p.prog < via.prog ? left : right).push(v);
      }
      const l = await bridgeGap(a, via.via, { vias: left, depth: depth + 1, legGuard });
      const r = await bridgeGap(via.via, b, { vias: right, depth: depth + 1, legGuard });
      return {
        runs: [...l.runs, ...r.runs],
        points: [...l.points, ...r.points],
        complete: l.complete && r.complete,
      };
    }
  }
  // unroutable 或门控拒绝且无法分段：诚实记缺口
  return { runs: [{ gap: gapRec(a, b) }], points: [], complete: false };
}

function gapRec(a, b) {
  return { from: a.slice(), to: b.slice(),
    km: Math.round((haversineM(a[0], a[1], b[0], b[1]) / 1000) * 100) / 100 };
}

/**
 * 补一个缺口。
 * @param {{from:number[],to:number[]}} gap
 * @param {{ref?:string, allowExpressway?:boolean, coLineway?:boolean, vias?:Array<number[]>}} 道路编号（日志/路名参考）
 */
export async function fillGap(gap, { ref = '', allowExpressway = false, coLineway = false, vias = null } = {}) {
  const from = gap.from, to = gap.to;
  const straight = haversineM(from[0], from[1], to[0], to[1]);
  if (straight < 1) return { points: [], unresolved: [], legs: 0, runs: [] };

  const points = [];
  const runs = []; // 有序：{pts} 或 {gap:{from,to,km}}
  const legGuard = { n: 0, max: 120 };
  let legs = 0;
  let cursor = from.slice();

  const addPts = (pts) => {
    if (!pts?.length) return;
    runs.push({ pts });
    for (const p of pts) {
      const last = points[points.length - 1];
      if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
      points.push(p);
    }
  };

  // 主循环：地面直达 + 长高速前缀切分（保持原语义），走不通时交给 bridgeGap（策略6/via 分段）
  let guard = 0;
  while (haversineM(cursor[0], cursor[1], to[0], to[1]) > 300 && guard < 12) {
    guard += 1;
    const r = await tryLeg(cursor, to);
    legs += 1; legGuard.n += 1;
    if (r.unroutable) break; // 交 bridgeGap 升级处理
    const ev = evaluateLeg(r.leg, cursor, to, { allowExpressway, coLineway });
    if (ev.accept) {
      addPts(r.leg.steps.flatMap((s) => s.points));   // 真实地面（含短桥/短共线）：接受
      cursor = to;
      break;
    }
    // 长连续高速是主要问题：在该高速段前切分，接受地面前缀后继续
    if (!allowExpressway && !coLineway && ev.maxRunM > EXP_RUN_MAX_M && ev.longRunStart > 0) {
      const pre = r.leg.steps.slice(0, ev.longRunStart).flatMap((s) => s.points);
      addPts(pre);
      cursor = pre[pre.length - 1];
      continue;
    }
    break; // 门控拒绝：交 bridgeGap 升级处理
  }

  if (haversineM(cursor[0], cursor[1], to[0], to[1]) > 300) {
    // 升级求解：strategy=6 地面走线 → via 分段递归（能画多少画多少，画不了的部分诚实记 gap）
    const br = await bridgeGap(cursor, to, { vias, legGuard });
    for (const rn of br.runs) {
      if (rn.pts) addPts(rn.pts);
      else runs.push(rn);
    }
    if (br.points.length) legs += 1;
  }
  return { points, unresolved: runs.filter((x) => x.gap).map((x) => x.gap), legs, runs };
}

export async function fillAllGaps(gaps, ref) {
  const inserted = [];
  const unresolved = [];
  let legs = 0;
  for (const g of gaps) {
    const r = await fillGap(g, { ref });
    inserted.push({ gap: g, points: r.points });
    unresolved.push(...r.unresolved);
    legs += r.legs;
  }
  return { inserted, unresolved, legs };
}
