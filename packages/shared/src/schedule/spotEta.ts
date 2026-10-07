import type { ScenicSpot, SpotEta } from '../types.js';
import type { TrainProfile } from './trainProfile.js';
import type { ScheduleCurve } from './scheduleCurve.js';
import type { DelayField } from './delayField.js';
import { deltaAt } from './delayField.js';

/** 融合状态（Phase 2 卡尔曼输出，Phase 1 可用简化版） */
export interface FusionState {
  /** 当前里程 (m) */
  s: number;
  /** 当前速度 (m/s) */
  v: number;
  /** 当前时刻 (ms) */
  t: number;
  /** 无 GPS 时长 (s) */
  gapSec: number;
  /** 依据来源 */
  basis: 'schedule' | 'gps' | 'calibrated' | 'mixed';
}

/** 双通道外推时间常数 τ ≈ 25min = 0.42h */
const TAU_H = 0.42;

/**
 * 置信半宽合成：σ² = σ_plan² + σ_geo_t² + σ_gap²
 * - σ_plan = σ_0 + γ·√(|ΔT_plan|)（图定不可信度，随时间增长）
 * - σ_geo_t = σ_geo / v（几何误差折合时间，分钟）
 * - σ_gap = 无GPS时长 × 0.15（隧道惩罚，分钟）
 */
export function computeSigma(params: {
  prof: TrainProfile;
  dTPlanH: number;
  geoSigma: number;
  v: number;
  gapSec: number;
}): number {
  const { prof, dTPlanH, geoSigma, v, gapSec } = params;
  const sigmaPlan = prof.sigma0 + prof.gamma * Math.sqrt(Math.max(dTPlanH, 0));
  const sigmaGeoT = geoSigma / Math.max(v, 5) / 60;
  const sigmaGap = (gapSec / 60) * 0.15;
  return Math.sqrt(sigmaPlan ** 2 + sigmaGeoT ** 2 + sigmaGap ** 2);
}

/** 置信度分档：σ ≤ 3 → high、3 < σ ≤ 10 → mid、> 10 → low */
export function confidenceBand(sigmaMin: number): 'high' | 'mid' | 'low' {
  if (sigmaMin <= 3) return 'high';
  if (sigmaMin <= 10) return 'mid';
  return 'low';
}

/**
 * 景点 ETA 预估。
 * Phase 1：图定输出（δ=0，etaIso = etaPlanIso）。
 * Phase 2：接入双通道外推（延误场 + 实测速度）。
 */
export function estimateSpotEtas(params: {
  curve: ScheduleCurve;
  spots: ScenicSpot[];
  now: number;
  fusion?: FusionState;
  prof: TrainProfile;
  geoSigma: number;
  delays?: DelayField;
  /** 发车时刻相对图定基准的整体偏移（用户改发车时间时传入），ETA 随之平移 */
  shiftMs?: number;
}): SpotEta[] {
  const { curve, spots, now, fusion, prof, geoSigma, delays, shiftMs = 0 } = params;

  return spots.map((spot) => {
    const km = (spot.progressKm ?? 0) * 1000;
    const tPlan = curve.timeAtKm(km) + shiftMs;

    const etaPlanIso = new Date(tPlan).toISOString();

    const fusionS = fusion?.s ?? 0;
    const fusionT = fusion?.t ?? now;
    const dTPlanH = Math.abs(tPlan - fusionT) / 3_600_000;

    let etaMs = tPlan;
    if (fusion && delays && delays.anchors.length > 0) {
      const dField = deltaAt(delays, km, curve, prof, now);
      const tSpeed = fusionT + ((km - fusion.s) / Math.max(fusion.v, 1)) * 1000;
      const dSpeed = tSpeed - tPlan;
      const w = Math.exp(-dTPlanH / TAU_H);
      etaMs = tPlan + (w * dSpeed + (1 - w) * dField);
    } else if (fusion) {
      const tSpeed = fusionT + ((km - fusion.s) / Math.max(fusion.v, 1)) * 1000;
      const dSpeed = tSpeed - tPlan;
      const w = Math.exp(-dTPlanH / TAU_H);
      etaMs = tPlan + w * dSpeed;
    }

    const etaIso = new Date(etaMs).toISOString();
    const sigmaMin = computeSigma({
      prof,
      dTPlanH,
      geoSigma,
      v: fusion?.v ?? prof.vCap,
      gapSec: fusion?.gapSec ?? 0,
    });

    const confidence = confidenceBand(sigmaMin);
    const passed = km < fusionS;
    const basis = fusion?.basis ?? 'schedule';
    const night = spot.nightOnly ?? false;

    return {
      spotId: String(spot.id),
      km,
      etaPlanIso,
      etaIso,
      sigmaMin: Math.round(sigmaMin * 10) / 10,
      confidence,
      basis,
      passed,
      night,
    };
  });
}