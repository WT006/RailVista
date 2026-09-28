import type { Stop } from '../types.js';
import type { TrainProfile } from './trainProfile.js';
import { solveSegment, tauAt, tauInverse, speedAt, minSegmentTime, type SegProfile } from './kinematics.js';

/** 图定里程-时间曲线 */
export interface ScheduleCurve {
  /** 里程 (m) → 图定绝对时刻 (ms) */
  timeAtKm(km: number): number;
  /** 图定绝对时刻 (ms) → 里程 (m) */
  kmAtTime(t: number): number;
  /** 里程 (m) → 图定瞬时速度 (m/s) */
  speedAtKm(km: number): number;
  /** 各区间冗余 slack (s) */
  segSlack: number[];
  /** 区间端点里程数组 (m) */
  stationKm: number[];
  /** 区间 SegProfile 数组 */
  segments: SegProfile[];
}

interface SegmentInfo {
  seg: SegProfile;
  dS: number;
  dT: number;
  departMs: number;
  arriveMs: number;
  kmStart: number;
  kmEnd: number;
}

function stopDepartMs(stop: Stop): number | null {
  const iso = stop.depart || stop.departTime || stop.at;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function stopArriveMs(stop: Stop): number | null {
  const iso = stop.arrive || stop.arriveTime || stop.at;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * 构建图定里程-时间曲线：逐区间 solveSegment，拼接为里程⇄时间双向函数。
 * 区间运行时分 ΔT_k = A_{k+1} − D_k（含跨天偏移后的绝对时刻差）。
 */
export function buildScheduleCurve(params: {
  stops: Stop[];
  stationKm: number[];
  prof: TrainProfile;
}): ScheduleCurve {
  const { stops, stationKm, prof } = params;
  const n = stops.length;
  const segments: SegmentInfo[] = [];

  for (let k = 0; k < n - 1; k++) {
    const dS = stationKm[k + 1] - stationKm[k];
    const departMs = stopDepartMs(stops[k]) ?? 0;
    const arriveMs = stopArriveMs(stops[k + 1]) ?? departMs + dS / Math.max(prof.vCap, 1);
    const dT = Math.max((arriveMs - departMs) / 1000, 1);

    const seg = solveSegment(dS, dT, prof);
    segments.push({
      seg,
      dS,
      dT,
      departMs,
      arriveMs,
      kmStart: stationKm[k],
      kmEnd: stationKm[k + 1],
    });
  }

  const segSlack = segments.map((s) => {
    const tMin = minSegmentTime(s.dS, prof);
    return Math.max(0, s.dT - tMin);
  });

  function findSegmentByKm(km: number): SegmentInfo {
    for (let i = 0; i < segments.length; i++) {
      if (km <= segments[i].kmEnd || i === segments.length - 1) return segments[i];
    }
    return segments[segments.length - 1];
  }

  function findSegmentByTime(t: number): SegmentInfo {
    for (let i = 0; i < segments.length; i++) {
      if (t <= segments[i].arriveMs || i === segments.length - 1) return segments[i];
    }
    return segments[segments.length - 1];
  }

  function timeAtKm(km: number): number {
    if (segments.length === 0) return 0;
    const s = findSegmentByKm(km);
    const x = Math.max(0, Math.min(s.dS, km - s.kmStart));
    const tau = tauAt(s.seg, s.dS, s.dT, prof, x);
    return s.departMs + tau * 1000;
  }

  function kmAtTime(t: number): number {
    if (segments.length === 0) return 0;
    const s = findSegmentByTime(t);
    const dt = Math.max(0, Math.min(s.dT, (t - s.departMs) / 1000));
    const x = tauInverse(s.seg, s.dS, s.dT, prof, dt);
    return s.kmStart + x;
  }

  function speedAtKmFn(km: number): number {
    if (segments.length === 0) return 0;
    const s = findSegmentByKm(km);
    const x = Math.max(0, Math.min(s.dS, km - s.kmStart));
    return speedAt(s.seg, s.dS, s.dT, prof, x);
  }

  return {
    timeAtKm,
    kmAtTime,
    speedAtKm: speedAtKmFn,
    segSlack,
    stationKm: stationKm.slice(),
    segments: segments.map((s) => s.seg),
  };
}