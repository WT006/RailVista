import type { TrainProfile } from './trainProfile.js';

/** 区间运动学反演结果 */
export interface SegProfile {
  /** 巡航速度 (m/s) */
  v: number;
  /** 加速段距离 (m) */
  sAcc: number;
  /** 减速段距离 (m) */
  sDec: number;
  /** 加速段时间 (s) */
  tAcc: number;
  /** 减速段时间 (s) */
  tDec: number;
  /** 是否降级（匀速） */
  degraded: boolean;
  /** 告警信息 */
  warning?: string;
  /** 区间冗余 slack (s)，vCap 钳制时 > 0 */
  slack: number;
  /** 实际总运行时间 (s)，vCap 钳制时可能 > dT */
  totalTime: number;
}

/**
 * 区间运动学反演：已知 ΔS（里程）和 ΔT（图定运行时分），反推巡航速度。
 *
 * 梯形速度曲线：T(v) = ΔS/v + β·v，其中 β = (1/a⁺ + 1/a⁻)/2。
 * 解 β·v² − ΔT·v + ΔS = 0，取物理小根 v = (ΔT − √D)/(2β)。
 * v > vCap 时以 vCap 重算并记入 slack。
 * D < 0 时图定快于技术极限，降级为匀速 + 告警。
 */
export function solveSegment(dS: number, dT: number, prof: TrainProfile): SegProfile {
  if (dS <= 0 || dT <= 0) {
    return { v: 0, sAcc: 0, sDec: 0, tAcc: 0, tDec: 0, degraded: true, warning: '区间里程或时间为零', slack: 0, totalTime: 0 };
  }

  const beta = (1 / prof.aAcc + 1 / prof.aDec) / 2;
  const disc = dT * dT - 4 * beta * dS;

  if (disc < 0) {
    const v = dS / dT;
    return { v, sAcc: 0, sDec: 0, tAcc: 0, tDec: 0, degraded: true, warning: '判别式负，图定快于技术极限', slack: 0, totalTime: dT };
  }

  let v = (dT - Math.sqrt(disc)) / (2 * beta);
  let slack = 0;

  if (v > prof.vCap) {
    v = prof.vCap;
    const tAtVcap = dS / v + beta * v;
    slack = Math.max(0, dT - tAtVcap);
  }

  return buildTrapezoid(dS, dT, v, prof, slack);
}

function buildTrapezoid(dS: number, dT: number, v: number, prof: TrainProfile, slack: number): SegProfile {
  const sAcc = (v * v) / (2 * prof.aAcc);
  const sDec = (v * v) / (2 * prof.aDec);
  const tAcc = v / prof.aAcc;
  const tDec = v / prof.aDec;

  if (sAcc + sDec > dS) {
    const beta = (1 / prof.aAcc + 1 / prof.aDec) / 2;
    const vMax = Math.sqrt(dS / beta);
    const sAcc2 = (vMax * vMax) / (2 * prof.aAcc);
    const sDec2 = (vMax * vMax) / (2 * prof.aDec);
    const tAcc2 = vMax / prof.aAcc;
    const tDec2 = vMax / prof.aDec;
    const totalTime2 = tAcc2 + tDec2;
    return { v: vMax, sAcc: sAcc2, sDec: sDec2, tAcc: tAcc2, tDec: tDec2, degraded: false, slack, totalTime: totalTime2 };
  }

  const cruiseDist = dS - sAcc - sDec;
  const totalTime = tAcc + cruiseDist / v + tDec;
  return { v, sAcc, sDec, tAcc, tDec, degraded: false, slack, totalTime };
}

/**
 * 区间内时间-里程正函数 τ(x)（从 D_k 起算，里程偏移 x ∈ [0, ΔS]）。
 * 单调、连续、τ(0)=0、τ(ΔS)=ΔT。
 */
export function tauAt(seg: SegProfile, dS: number, dT: number, prof: TrainProfile, x: number): number {
  if (seg.degraded) return seg.v > 0 ? x / seg.v : 0;
  if (x <= 0) return 0;
  if (x >= dS) return seg.totalTime;
  if (x <= seg.sAcc) return Math.sqrt((2 * x) / prof.aAcc);
  if (x >= dS - seg.sDec) return seg.totalTime - Math.sqrt((2 * (dS - x)) / prof.aDec);
  return seg.tAcc + (x - seg.sAcc) / seg.v;
}

/**
 * τ 的逆函数：给定耗时 t，求里程偏移 x。
 * tauInverse(tauAt(x)) = x（容差 1m）。
 */
export function tauInverse(seg: SegProfile, dS: number, dT: number, prof: TrainProfile, t: number): number {
  if (seg.degraded) return seg.v > 0 ? t * seg.v : 0;
  const totalT = seg.totalTime;
  if (t <= 0) return 0;
  if (t >= totalT) return dS;
  const tCruise = totalT - seg.tAcc - seg.tDec;
  if (t <= seg.tAcc) {
    return 0.5 * prof.aAcc * t * t;
  }
  if (t >= seg.tAcc + tCruise) {
    return dS - 0.5 * prof.aDec * (totalT - t) * (totalT - t);
  }
  return seg.sAcc + seg.v * (t - seg.tAcc);
}

/** 区间内里程 x 处的瞬时速度 (m/s) */
export function speedAt(seg: SegProfile, dS: number, dT: number, prof: TrainProfile, x: number): number {
  if (seg.degraded) return seg.v;
  if (x <= 0 || x >= dS) return 0;
  if (x <= seg.sAcc) return Math.sqrt(2 * prof.aAcc * x);
  if (x >= dS - seg.sDec) return Math.sqrt(2 * prof.aDec * (dS - x));
  return seg.v;
}

/**
 * 技术最小运行时分 T_min（跑 v_cap 或三角形峰值）。
 * 若 ΔS ≥ β·v_cap²: T_min = ΔS/v_cap + β·v_cap
 * 否则: T_min = 2·sqrt(ΔS·β)
 */
export function minSegmentTime(dS: number, prof: TrainProfile): number {
  if (dS <= 0) return 0;
  const beta = (1 / prof.aAcc + 1 / prof.aDec) / 2;
  if (dS >= beta * prof.vCap * prof.vCap) {
    return dS / prof.vCap + beta * prof.vCap;
  }
  return 2 * Math.sqrt(dS * beta);
}