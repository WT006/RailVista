import type { TrainProfile } from './trainProfile.js';
import type { ScheduleCurve } from './scheduleCurve.js';

/** 延误场锚点 */
export interface DelayAnchor {
  /** 里程 (m) */
  u: number;
  /** 延误 (s) */
  delta: number;
  /** 时刻 (ms) */
  t: number;
  /** 可信度 */
  credibility: 'high' | 'mid';
  /** 是否可恢复（非计划停车不可恢复） */
  recoverable: boolean;
}

/** 延误场 */
export interface DelayField {
  anchors: DelayAnchor[];
}

/** 初始化空延误场 */
export function createDelayField(): DelayField {
  return { anchors: [] };
}

/** 落锚点（按里程排序） */
export function addAnchor(field: DelayField, anchor: DelayAnchor): void {
  field.anchors.push(anchor);
  field.anchors.sort((a, b) => a.u - b.u);
}

/**
 * 剩余冗余 R(u→s) = Σ Slack_k（区间完全落在 [u,s] 内）。
 */
export function remainingSlack(curve: ScheduleCurve, u: number, s: number): number {
  if (s <= u) return 0;
  let total = 0;
  for (let k = 0; k < curve.stationKm.length - 1; k++) {
    const segStart = curve.stationKm[k];
    const segEnd = curve.stationKm[k + 1];
    if (segStart >= u && segEnd <= s) {
      total += curve.segSlack[k] || 0;
    }
  }
  return total;
}

/**
 * 延误场 δ(s)：
 * - 无锚点 → 0
 * - 锚点间线性插值
 * - 超出最后锚点外推 clamp(δ_u − R(u→s) + μ·ΔT_plan, δ_floor, δ_cap)
 * - 非计划停车锚点不参与恢复折扣
 */
export function deltaAt(
  field: DelayField,
  km: number,
  curve: ScheduleCurve,
  prof: TrainProfile,
  now: number,
): number {
  if (field.anchors.length === 0) return 0;

  const anchors = field.anchors;

  if (km <= anchors[0].u) return anchors[0].delta;

  if (km >= anchors[anchors.length - 1].u) {
    const last = anchors[anchors.length - 1];
    const tPlanSec = (curve.timeAtKm(km) - curve.timeAtKm(last.u)) / 1000;
    const dTPlanH = Math.abs(tPlanSec) / 3600;

    const recoverableSlack = last.recoverable ? remainingSlack(curve, last.u, km) : 0;
    const deltaRaw = last.delta - recoverableSlack + prof.mu * 60 * dTPlanH;

    const deltaFloor = prof.trainClass === 'G' || prof.trainClass === 'D' ? -300 : 0;
    const deltaCap = Math.min(last.delta + 0.5 * Math.abs(tPlanSec), 180 * 60);

    return Math.max(deltaFloor, Math.min(deltaRaw, deltaCap));
  }

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (km >= a.u && km <= b.u) {
      const range = b.u - a.u;
      if (range <= 0) return a.delta;
      const ratio = (km - a.u) / range;
      return a.delta + (b.delta - a.delta) * ratio;
    }
  }

  return 0;
}