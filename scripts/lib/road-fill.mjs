/**
 * 万里路书 · 国道真实缺口补线库（scripts/lib/road-fill.mjs）
 *
 * 补 trace 后仍存在的缺口。门控原则（既真实又不绕路）：
 *   - 用高德驾车规划缺口两端，evaluateLeg 做「整体」判定：
 *       · 总绕行倍数（detour）随缺口长度分档，允许地面公路随地形/岸线/河谷自然弯曲；
 *       · 宽松横向带宽，允许走线偏离直线弦；
 *       · 高速占比 ≤30% 且无 >20km 连续高速（短过江/跨海桥、口岸短共线属国道真实走线）；
 *   - 长连续高速绕行：在该高速段前切分，只接受地面前缀，再从前缀末继续规划；
 *   - 一出发就上长高速 / 只能跨城大绕行 / 无路径或涉境外：诚实标记 unresolved，不拿假线充数。
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

// 真实走线门控参数
export const ratioFor = (s) => (s <= 100000 ? 2.2 : s <= 300000 ? 1.8 : 1.5);
export const lateralCapFor = (s) => Math.max(20000, s * 0.9);
const EXP_PCT_MAX = 0.3;
const EXP_RUN_MAX_M = 20000;

/**
 * 评估一条高德驾车 leg 是否为「真实地面直达线」。
 * @returns {{accept:boolean, expPct:number, maxRunM:number, longRunStart:number, detour:number, maxLat:number}}
 */
export function evaluateLeg(leg, from, to) {
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
  const accept = detour <= ratioFor(chord) && maxLat <= lateralCapFor(chord)
    && expPct <= EXP_PCT_MAX && maxRunM <= EXP_RUN_MAX_M;
  return { accept, expPct, maxRunM, longRunStart, detour, maxLat };
}

/**
 * 补一个缺口。
 * @param {{from:number[],to:number[]}} gap
 * @param {{ref:string}} 道路编号（用于日志/路名参考）
 */
export async function fillGap(gap, { ref = '' } = {}) {
  const from = gap.from, to = gap.to;
  const straight = haversineM(from[0], from[1], to[0], to[1]);
  if (straight < 1) return { points: [], unresolved: [], legs: 0, runs: [] };

  const points = [];
  const unresolved = [];
  const runs = []; // 有序：{pts} 或 {gap:{from,to,km}}
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
  const addGap = (a, b) => {
    const gapRec = { from: a.slice(), to: b.slice(),
      km: Math.round((haversineM(a[0], a[1], b[0], b[1]) / 1000) * 100) / 100 };
    unresolved.push(gapRec);
    runs.push({ gap: gapRec });
  };
  // 规划一条 leg；「无法规划」类错误（无路径 / 涉及境外[20011]）降级为 unroutable，其余（key/配额）照常抛出
  async function tryLeg(a, b) {
    try { return await drivingLeg(a, b); }
    catch (e) {
      if (/无路径|20011|INSUFFICIENT_ABROAD/.test(e.message || '')) return { unroutable: true };
      throw e;
    }
  }

  let guard = 0;
  while (haversineM(cursor[0], cursor[1], to[0], to[1]) > 300 && guard < 12) {
    guard += 1;
    const leg = await tryLeg(cursor, to);
    legs += 1;
    if (leg.unroutable) { addGap(cursor, to); cursor = to; break; }  // 无法规划：整段诚实保留
    const ev = evaluateLeg(leg, cursor, to);
    if (ev.accept) {
      addPts(leg.steps.flatMap((s) => s.points));   // 真实地面（含短桥/短共线）：接受
      cursor = to;
      break;
    }
    // 长连续高速是主要问题：在该高速段前切分，接受地面前缀后继续
    if (ev.maxRunM > EXP_RUN_MAX_M && ev.longRunStart > 0) {
      const pre = leg.steps.slice(0, ev.longRunStart).flatMap((s) => s.points);
      addPts(pre);
      cursor = pre[pre.length - 1];
      continue;
    }
    // 否则：一出发就上长高速，或只能跨城大绕行/远离走廊 → 地面直达线不存在，诚实整段判未解决
    addGap(cursor, to);
    cursor = to;
    break;
  }
  if (haversineM(cursor[0], cursor[1], to[0], to[1]) > 300) addGap(cursor, to);
  return { points, unresolved, legs, runs };
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
