import type { GpsSample, RailwayPoint } from '../types.js';
import type { TrainProfile } from './trainProfile.js';
import type { ScheduleCurve } from './scheduleCurve.js';
import { projectToRailway } from './progress.js';

/** 卡尔曼融合内部状态（含协方差矩阵） */
export interface FusionStateInternal {
  /** 里程 (m) */
  s: number;
  /** 速度 (m/s) */
  v: number;
  /** 时刻 (ms) */
  t: number;
  /** 协方差矩阵 2×2 */
  P: number[][];
  /** 无 GPS 时长 (s) */
  gapSec: number;
  /** 依据来源 */
  basis: 'schedule' | 'gps' | 'calibrated' | 'mixed';
  /** 上一帧里程（单调约束） */
  lastS: number;
}

/** 初始化融合状态 */
export function createFusionState(params: { s0: number; v0: number; t0: number }): FusionStateInternal {
  return {
    s: params.s0,
    v: params.v0,
    t: params.t0,
    P: [[100, 0], [0, 10]],
    gapSec: 0,
    basis: 'schedule',
    lastS: params.s0,
  };
}

function matMul(a: number[][], b: number[][]): number[][] {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
  ];
}

function matTranspose(a: number[][]): number[][] {
  return [[a[0][0], a[1][0]], [a[0][1], a[1][1]]];
}

function matAdd(a: number[][], b: number[][]): number[][] {
  return [[a[0][0] + b[0][0], a[0][1] + b[0][1]], [a[1][0] + b[1][0], a[1][1] + b[1][1]]];
}

/**
 * 卡尔曼预测步：s⁻ = s + v·Δt，v⁻ = v + κ·(v_plan − v)·Δt，P⁻ = F·P·Fᵀ + Q。
 * 无 GPS 时 q 放大 3~5 倍，κ 提高至 0.15。
 */
export function predict(
  state: FusionStateInternal,
  dt: number,
  curve: ScheduleCurve,
  prof: TrainProfile,
  hasGps: boolean,
): FusionStateInternal {
  const kappa = hasGps ? 0.05 : 0.15;
  const vPlan = curve.speedAtKm(state.s);

  const sPred = state.s + state.v * dt;
  const vPred = state.v + kappa * (vPlan - state.v) * dt;

  const F = [[1, dt], [0, 1]];
  const qBase = 0.15 * 0.15;
  const q = hasGps ? qBase : qBase * 4;
  const Q = [
    [(q * dt * dt * dt * dt) / 4, (q * dt * dt * dt) / 2],
    [(q * dt * dt * dt) / 2, q * dt * dt],
  ];
  const PPred = matAdd(matMul(matMul(F, state.P), matTranspose(F)), Q);

  return {
    ...state,
    s: sPred,
    v: vPred,
    P: PPred,
    gapSec: hasGps ? 0 : state.gapSec + dt,
  };
}

/**
 * 卡尔曼更新步：K = P⁻·Hᵀ/(H·P⁻·Hᵀ+R)，x = x⁻ + K·(z−H·x⁻)，P = (I−K·H)·P⁻。
 * 含单调约束 s = max(s, s_prev)。
 */
export function update(
  state: FusionStateInternal,
  z: number,
  R: number,
  prof: TrainProfile,
): FusionStateInternal {
  const P = state.P;
  const S = P[0][0] + R;
  const K0 = P[0][0] / S;
  const K1 = P[1][0] / S;

  const innovation = z - state.s;
  const sNew = state.s + K0 * innovation;
  const vNew = state.v + K1 * innovation;

  const PNew = [
    [(1 - K0) * P[0][0], (1 - K0) * P[0][1]],
    [P[1][0] - K1 * P[0][0], P[1][1] - K1 * P[0][1]],
  ];

  const sFinal = Math.max(sNew, state.lastS);

  return {
    ...state,
    s: sFinal,
    v: Math.min(Math.max(vNew, 0), prof.vCap * 1.3),
    P: PNew,
    lastS: sFinal,
    basis: state.basis === 'schedule' ? 'gps' : 'mixed',
  };
}

/** 观测方差 R = σ_acc² + σ_geo²，σ_acc = max(accuracy_m, 15) */
export function observationVariance(accuracy: number, geoSigma: number): number {
  const sigmaAcc = Math.max(accuracy, 15);
  return sigmaAcc * sigmaAcc + geoSigma * geoSigma;
}

/**
 * 三重野值门：垂距门 + 新息门 + 物理门。
 * 返回 { pass, soft, reason }：pass=通过，soft=软拒绝（R×=10 后再更新），hard=丢弃。
 */
export function passGates(params: {
  gps: GpsSample;
  state: FusionStateInternal;
  path: RailwayPoint[];
  lengthKm: number;
  prof: TrainProfile;
  source?: string;
  lastS: number;
  dt: number;
}): { pass: boolean; soft: boolean; reason: string; z?: number; R?: number } {
  const { gps, state, path, lengthKm, prof, source, lastS, dt } = params;

  const proj = projectToRailway(path, lengthKm, gps.lng, gps.lat);
  const accM = Math.max(gps.accuracy, 1);

  let distGateM = Math.min(Math.max(3 * accM + 500, 800), 5000);
  if (source === 'station') distGateM *= 1.5;
  if (proj.distKm * 1000 > distGateM) {
    return { pass: false, soft: false, reason: '垂距超限' };
  }

  const z = proj.progress * lengthKm * 1000;
  const R = observationVariance(gps.accuracy, 300);

  const innov = Math.abs(z - state.s);
  const gate = 3 * Math.sqrt(state.P[0][0] + R);
  if (innov > gate) {
    return { pass: false, soft: true, reason: '新息超限', z, R: R * 10 };
  }

  if (dt > 0) {
    const impliedV = (z - lastS) / dt;
    if (impliedV < 0 || impliedV > 1.3 * prof.vCap) {
      return { pass: false, soft: false, reason: '物理速度超限' };
    }
  }

  return { pass: true, soft: false, reason: '通过', z, R };
}