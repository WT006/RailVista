import type { RailwayPoint, Stop } from '../types.js';
import { projectToRailway } from './progress.js';

/** 铁路折线几何来源，决定里程误差 σ_geo */
export type RailwaySource = 'precise' | 'corridor' | 'local' | 'soft' | 'station';

/** 里程轴构建结果 */
export interface MileageAxisResult {
  /** 各站里程坐标（m），单调不减，首=0 末=L */
  stationKm: number[];
  /** 各站投影垂距（m），用于权重与质量评估 */
  distKm: number[];
  /** 保序回归权重 = 1/(垂距+200m) */
  weights: number[];
  /** 降级标记 */
  degradation: 'none' | 'all_missing' | 'zero_length' | 'severe_disorder';
}

/**
 * PAVA（Pool Adjacent Violators Algorithm）保序回归。
 * 给定 values 和 weights，求单调不减序列，最小化加权平方误差 Σ w_i (y_i - x_i)²。
 * 时间复杂度 O(n)。
 */
export function isotonicRegression(values: number[], weights: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [values[0]];

  interface Pool {
    sumWV: number;
    sumW: number;
    size: number;
  }
  const pools: Pool[] = [];

  for (let i = 0; i < n; i++) {
    const w = weights[i] > 0 ? weights[i] : 1;
    const v = Number.isFinite(values[i]) ? values[i] : 0;
    pools.push({ sumWV: w * v, sumW: w, size: 1 });

    while (pools.length >= 2) {
      const prev = pools[pools.length - 2];
      const curr = pools[pools.length - 1];
      const prevVal = prev.sumWV / prev.sumW;
      const currVal = curr.sumWV / curr.sumW;
      if (currVal < prevVal) {
        prev.sumWV += curr.sumWV;
        prev.sumW += curr.sumW;
        prev.size += curr.size;
        pools.pop();
      } else {
        break;
      }
    }
  }

  const result: number[] = new Array(n);
  let idx = 0;
  for (const pool of pools) {
    const val = pool.sumWV / pool.sumW;
    for (let j = 0; j < pool.size; j++) {
      result[idx++] = val;
    }
  }
  return result;
}

/**
 * 获取站的图定绝对时刻（ms），用于缺失坐标按时间比例插值。
 * 优先 arrive，其次 depart，再次 at。
 */
function stopTimeMs(stop: Stop): number | null {
  const iso = stop.arrive || stop.depart || stop.at || stop.arriveTime || stop.departTime;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * 缺失坐标（NaN）按图定时间比例插值补齐。
 * 对于缺失的站 i，找到前后非缺失的站 a、b，按时间比例插值：
 * raw[i] = raw[a] + (raw[b] - raw[a]) * (t_i - t_a) / (t_b - t_a)
 */
export function fillByTimeInterpolation(raw: number[], stops: Stop[]): void {
  const n = raw.length;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(raw[i])) continue;

    let prev = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (Number.isFinite(raw[j])) {
        prev = j;
        break;
      }
    }
    let next = -1;
    for (let j = i + 1; j < n; j++) {
      if (Number.isFinite(raw[j])) {
        next = j;
        break;
      }
    }

    if (prev >= 0 && next >= 0) {
      const tPrev = stopTimeMs(stops[prev]);
      const tCurr = stopTimeMs(stops[i]);
      const tNext = stopTimeMs(stops[next]);
      if (tPrev != null && tCurr != null && tNext != null && tNext !== tPrev) {
        raw[i] = raw[prev] + (raw[next] - raw[prev]) * ((tCurr - tPrev) / (tNext - tPrev));
      } else {
        raw[i] = raw[prev] + (raw[next] - raw[prev]) * ((i - prev) / (next - prev));
      }
    } else if (prev >= 0) {
      raw[i] = raw[prev];
    } else if (next >= 0) {
      raw[i] = raw[next];
    } else {
      raw[i] = 0;
    }
  }
}

/**
 * 零长区间保护：若相邻里程差 < minM，强制拉开到 minM 并等比压缩后续区间。
 * 保持总里程守恒（末站里程不变）。
 */
export function enforceMinSegment(mono: number[], minM = 200): number[] {
  const n = mono.length;
  if (n < 2) return mono.slice();
  const result = mono.slice();
  const totalL = result[n - 1] - result[0];
  if (totalL <= 0) return result;

  for (let i = 1; i < n; i++) {
    const gap = result[i] - result[i - 1];
    if (gap < minM) {
      const oldI = result[i];
      const newI = result[i - 1] + minM;
      const deficit = minM - gap;
      const remaining = result[n - 1] - oldI;
      if (remaining > deficit) {
        const scale = (remaining - deficit) / remaining;
        for (let j = i + 1; j < n; j++) {
          result[j] = newI + (result[j] - oldI) * scale;
        }
      }
      result[i] = newI;
    }
  }
  return result;
}

/**
 * 几何质量分级 → 里程误差 σ_geo（m）。
 * - precise/corridor: 150m
 * - local: 300m
 * - soft: 500m
 * - station: 0.12 × ΔS（弦长低估山区曲线约 10~30%）
 */
export function geoSigmaFor(source: RailwaySource, dS: number): number {
  switch (source) {
    case 'precise':
    case 'corridor':
      return 150;
    case 'local':
      return 300;
    case 'soft':
      return 500;
    case 'station':
      return 0.12 * dS;
    default:
      return 300;
  }
}

/**
 * 构建统一里程轴：站点投影 → 里程坐标 → 缺失补齐 → PAVA 保序回归 → 端点硬钉 → 零长区间保护。
 *
 * 所有时间计算都在一维里程轴上做，这是 ETA 算法的基础。
 * 修正 P0-1：用里程进度替代站序进度（Z8991 格尔木 0.143 → 0.443）。
 */
export function buildMileageAxis(params: {
  stops: Stop[];
  path: RailwayPoint[];
  lengthKm: number;
  railwaySource?: RailwaySource;
}): MileageAxisResult {
  const { stops, path, lengthKm } = params;
  const L = lengthKm * 1000;
  const n = stops.length;

  if (n === 0) {
    return { stationKm: [], distKm: [], weights: [], degradation: 'all_missing' };
  }
  if (L <= 0 || path.length < 2) {
    const uniform = stops.map((_, i) => (n <= 1 ? 0 : (i / (n - 1)) * L));
    return { stationKm: uniform, distKm: stops.map(() => 0), weights: stops.map(() => 1), degradation: 'zero_length' };
  }

  const coordsAvailable = stops.some((s) => s.lng != null && s.lat != null);
  if (!coordsAvailable) {
    const uniform = stops.map((_, i) => (n <= 1 ? 0 : (i / (n - 1)) * L));
    return { stationKm: uniform, distKm: stops.map(() => 0), weights: stops.map(() => 1), degradation: 'all_missing' };
  }

  const raw: number[] = new Array(n);
  const distKm: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const s = stops[i];
    if (i === 0) {
      raw[i] = 0;
      distKm[i] = 0;
      continue;
    }
    if (i === n - 1) {
      raw[i] = L;
      distKm[i] = 0;
      continue;
    }
    if (s.lng == null || s.lat == null) {
      raw[i] = NaN;
      distKm[i] = NaN;
      continue;
    }
    const p = projectToRailway(path, lengthKm, s.lng, s.lat);
    raw[i] = p.progress * L;
    distKm[i] = p.distKm * 1000;
  }

  fillByTimeInterpolation(raw, stops);

  const weights = distKm.map((d) => 1 / ((Number.isFinite(d) ? d : 1000) + 200));

  let mono = isotonicRegression(raw, weights);

  mono[0] = 0;
  mono[n - 1] = L;

  mono = enforceMinSegment(mono, 200);

  let disorderCount = 0;
  for (let i = 1; i < n; i++) {
    if (mono[i] < mono[i - 1] - 1) disorderCount++;
  }
  const degradation = disorderCount > n * 0.3 ? 'severe_disorder' : 'none';

  return { stationKm: mono, distKm, weights, degradation };
}