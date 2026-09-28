/**
 * 整趟拟合质量门禁（S1）：拦截"绕开经停站却标记全精确"的伪整趟折线。
 * 纯几何函数，不依赖 corridors / localRails，可独立单测。
 */
import {
  buildRailwayMetrics,
  haversineKm,
  projectToRailway,
  type RailwayPoint,
} from '@railvista/shared';

export type LngLat = { lng: number; lat: number };

export type WholeTripGateStage =
  | 'disabled'
  | 'bad_input'
  | 'stop_coverage'
  | 'length_ratio'
  | 'progress_monotonic';

export type WholeTripGateResult = {
  ok: boolean;
  stage?: WholeTripGateStage;
  detail?: string;
};

export type WholeTripGateOptions = {
  trainCode?: string;
};

const LENGTH_RATIO_MAX = 2.0;
const PROGRESS_TOLERANCE = 0.05;
const DEFAULT_STOP_TOL_BASE_KM = 10;

export function wholeTripStopToleranceKm(stopLineKm: number): number {
  const env = process.env.WHOLETRIP_STOP_TOL_KM;
  if (env != null && env.trim() !== '') {
    const v = Number(env);
    if (Number.isFinite(v)) return v;
  }
  return Math.max(DEFAULT_STOP_TOL_BASE_KM, stopLineKm * 0.02);
}

export function validateWholeTripPath(
  wholePath: LngLat[],
  stops: LngLat[],
  opts?: WholeTripGateOptions,
): WholeTripGateResult {
  void opts;
  const env = process.env.WHOLETRIP_STOP_TOL_KM;
  if (env != null && env.trim() !== '' && Number(env) === 0) {
    return { ok: false, stage: 'disabled', detail: 'WHOLETRIP_STOP_TOL_KM=0' };
  }

  if (!wholePath || wholePath.length < 2 || !stops || stops.length < 2) {
    return { ok: false, stage: 'bad_input', detail: 'path/stops too short' };
  }
  for (const p of wholePath) {
    if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) {
      return { ok: false, stage: 'bad_input', detail: 'non-finite coord in wholePath' };
    }
  }

  const whole = buildRailwayMetrics(wholePath.map((p) => [p.lng, p.lat] as [number, number]));
  const wholePathPoints: RailwayPoint[] = whole.path;
  const wholeLenKm = whole.lengthKm;

  const stopLineCoords = stops.map((s) => [s.lng, s.lat] as [number, number]);
  const stopLine = buildRailwayMetrics(stopLineCoords);
  const stopLineKm = stopLine.lengthKm;

  // ① 中间站覆盖：每个有坐标经停站（除首末）到整趟折线最小投影距离 ≤ 阈值
  const tolKm = wholeTripStopToleranceKm(stopLineKm);
  const projections: Array<{ name?: string; distKm: number; progress: number }> = [];
  for (let i = 1; i < stops.length - 1; i++) {
    const s = stops[i];
    if (!Number.isFinite(s.lng) || !Number.isFinite(s.lat)) continue;
    const proj = projectToRailway(wholePathPoints, wholeLenKm, s.lng, s.lat);
    projections.push({ distKm: proj.distKm, progress: proj.progress });
    if (proj.distKm > tolKm) {
      return {
        ok: false,
        stage: 'stop_coverage',
        detail: `stop ${i} off path ${proj.distKm.toFixed(1)}km > tol ${tolKm.toFixed(1)}km`,
      };
    }
  }

  // ② 长度比：整趟折线总里程 / 站序折线总里程 ≤ 2.0
  if (stopLineKm > 0 && wholeLenKm / stopLineKm > LENGTH_RATIO_MAX) {
    return {
      ok: false,
      stage: 'length_ratio',
      detail: `whole ${wholeLenKm.toFixed(0)}km / stopline ${stopLineKm.toFixed(0)}km > ${LENGTH_RATIO_MAX}`,
    };
  }

  // ③ 进度单调：各经停站沿折线投影进度随站序非递减（容差 0.05）
  let lastProgress = 0;
  for (const proj of projections) {
    if (proj.progress + PROGRESS_TOLERANCE < lastProgress) {
      return {
        ok: false,
        stage: 'progress_monotonic',
        detail: `progress regression ${(proj.progress).toFixed(3)} < prev ${(lastProgress).toFixed(3)}`,
      };
    }
    lastProgress = Math.max(lastProgress, proj.progress);
  }

  return { ok: true };
}

export function wholeTripStopOffPathDiag(
  wholePath: LngLat[],
  stop: LngLat,
): { distKm: number; progress: number } | null {
  if (!wholePath || wholePath.length < 2 || !Number.isFinite(stop.lng) || !Number.isFinite(stop.lat)) {
    return null;
  }
  const whole = buildRailwayMetrics(wholePath.map((p) => [p.lng, p.lat] as [number, number]));
  const proj = projectToRailway(whole.path, whole.lengthKm, stop.lng, stop.lat);
  return { distKm: proj.distKm, progress: proj.progress };
}

export function polylineLengthKm(points: LngLat[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += haversineKm(points[i - 1], points[i]);
  }
  return km;
}