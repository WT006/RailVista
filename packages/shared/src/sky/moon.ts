/**
 * 月相 / 月球位置（旅途天象算法 · 天文层）
 *
 * 低精度 Meeus 简化级数（主要摄动项），月相龄以已知新月历元外推，
 * 误差对「满月窗口 / 月出月落 / 车窗左右侧」判定完全够用。
 */
import { daysSinceJ2000, equatorialToHorizontal, findAltitudeCrossings, type AltAz } from './sun.js';

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;
/** 朔望月（天） */
export const SYNODIC_MONTH_DAYS = 29.530588853;
/** 已知新月：2000-01-06T18:14:00Z */
const NEW_MOON_EPOCH_MS = 947_182_440_000;

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export interface MoonPhase {
  /** 月龄（天，0 = 新月） */
  ageDays: number;
  /** 亮度（0~1） */
  illumination: number;
  /** 是否盈月 */
  waxing: boolean;
  /** 中文月相名 */
  phaseName: string;
  /** 满月前后 ±1 天窗口（适合赏月/拍月亮） */
  isFullMoonWindow: boolean;
}

/** 月相龄（天） */
export function moonAge(ms: number): number {
  const days = (ms - NEW_MOON_EPOCH_MS) / DAY_MS;
  return ((days % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
}

export function moonPhase(ms: number): MoonPhase {
  const age = moonAge(ms);
  const illumination = (1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH_DAYS)) / 2;
  const waxing = age < SYNODIC_MONTH_DAYS / 2;
  const fullCenter = SYNODIC_MONTH_DAYS / 2;
  return {
    ageDays: Math.round(age * 10) / 10,
    illumination: Math.round(illumination * 100) / 100,
    waxing,
    phaseName: phaseNameOf(age),
    isFullMoonWindow: Math.abs(age - fullCenter) <= 1,
  };
}

function phaseNameOf(ageDays: number): string {
  // 八分相：各约 3.69 天
  const idx = Math.floor((ageDays / SYNODIC_MONTH_DAYS) * 8 + 0.5) % 8;
  return ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'][idx]!;
}

/** 月球视赤经/赤纬（度） */
export function moonEquatorial(ms: number): { raDeg: number; decDeg: number } {
  const d = daysSinceJ2000(ms);
  const Lp = norm360(218.316 + 13.176396 * d);
  const M = norm360(357.529 + 0.98560028 * d) * DEG;
  const Mp = norm360(134.963 + 13.064993 * d) * DEG;
  const D = norm360(297.850 + 12.190749 * d) * DEG;
  const F = norm360(93.272 + 13.229350 * d) * DEG;

  // 主要摄动项（误差 ~0.5°）
  const lon =
    Lp +
    6.289 * Math.sin(Mp) +
    1.274 * Math.sin(2 * D - Mp) +
    0.658 * Math.sin(2 * D) +
    0.214 * Math.sin(2 * Mp) -
    0.186 * Math.sin(M) -
    0.114 * Math.sin(2 * F);
  const lat =
    5.128 * Math.sin(F) +
    0.281 * Math.sin(Mp + F) +
    0.278 * Math.sin(Mp - F) +
    0.173 * Math.sin(2 * D - F);

  const lambda = norm360(lon) * DEG;
  const beta = lat * DEG;
  const obliquity = (23.439 - 0.0000004 * d) * DEG;

  const ra = Math.atan2(
    Math.sin(lambda) * Math.cos(obliquity) - Math.tan(beta) * Math.sin(obliquity),
    Math.cos(lambda),
  );
  const dec = Math.asin(
    Math.sin(beta) * Math.cos(obliquity) + Math.cos(beta) * Math.sin(obliquity) * Math.sin(lambda),
  );
  return { raDeg: norm360(ra / DEG), decDeg: dec / DEG };
}

/** 月球地平坐标 */
export function moonPosition(lng: number, lat: number, ms: number): AltAz {
  return equatorialToHorizontal(lng, lat, ms, moonEquatorial(ms));
}

export interface MoonRiseSet {
  moonriseMs: number | null;
  moonsetMs: number | null;
}

/** 月出 / 月落（窗口内首次，二分精化） */
export function getMoonRiseSet(lng: number, lat: number, fromMs: number, toMs: number): MoonRiseSet {
  const altAt = (ms: number) => moonPosition(lng, lat, ms).altitudeDeg;
  const { riseMs, setMs } = findAltitudeCrossings(altAt, fromMs, toMs, 0, 15 * 60_000);
  return { moonriseMs: riseMs, moonsetMs: setMs };
}
