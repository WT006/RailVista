/**
 * 太阳位置 / 晨昏蒙影（旅途天象算法 · 天文层）
 *
 * 采用 NOAA 太阳位置近似算法（误差 ≲ 0.3°），对「日出日落时刻 + 车窗左右侧」
 * 判定完全够用，且纯计算、无网络依赖，可在 web / api 两侧同构运行。
 *
 * 天光分档（莉景天气口径）：
 *   金色时刻 = 太阳高度 -4° ~ +6°
 *   蓝色时刻 = 太阳高度 -6° ~ -4°
 *   朝霞/晚霞窗口 = 太阳高度 -6° ~ +2°（核心峰值在 -3° 附近）
 */

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;
/** J2000.0 = 2000-01-01T12:00:00Z */
const J2000_MS = 946_728_000_000;

/** 太阳中心几何高度角 = -0.833° 时为日出/日落（含折射与半径修正） */
export const SUN_RISE_ALT_DEG = -0.833;
/** 蓝色时刻下界 / 金-蓝分界 */
export const BLUE_HOUR_ALT_DEG = -6;
export const GOLDEN_BLUE_ALT_DEG = -4;
/** 金色时刻上界 */
export const GOLDEN_HOUR_ALT_DEG = 6;
/** 霞光窗口上界（日出/日落后太阳仍照亮高云） */
export const GLOW_ALT_DEG = 2;
/** 民用晨昏蒙影 */
export const CIVIL_TWILIGHT_ALT_DEG = -6;
export const NAUTICAL_TWILIGHT_ALT_DEG = -12;
export const ASTRONOMICAL_TWILIGHT_ALT_DEG = -18;

export interface AltAz {
  /** 地平高度角（度） */
  altitudeDeg: number;
  /** 方位角（度，正北 0，顺时针） */
  azimuthDeg: number;
}

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function daysSinceJ2000(ms: number): number {
  return (ms - J2000_MS) / DAY_MS;
}

/** 赤道坐标（RA/Dec，度） */
export interface Equatorial {
  raDeg: number;
  decDeg: number;
}

/** 太阳视赤经/赤纬 */
export function sunEquatorial(ms: number): Equatorial {
  const d = daysSinceJ2000(ms);
  const meanLon = norm360(280.46 + 0.9856474 * d);
  const meanAnomaly = norm360(357.528 + 0.9856003 * d) * DEG;
  const eclLon = (meanLon + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * d) * DEG;
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(eclLon));
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon));
  return { raDeg: ra / DEG, decDeg: dec / DEG };
}

/** 赤道坐标 → 地平坐标（方位角自北起顺时针） */
export function equatorialToHorizontal(lng: number, lat: number, ms: number, eq: Equatorial): AltAz {
  const d = daysSinceJ2000(ms);
  // 格林尼治平恒星时（度）
  const gmst = norm360(280.46061837 + 360.98564736629 * d);
  const hourAngle = (norm360(gmst + lng - eq.raDeg) + 180) * DEG - Math.PI;
  const phi = lat * DEG;
  const dec = eq.decDeg * DEG;
  const sinAlt =
    Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(hourAngle);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az =
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi),
    ) + Math.PI;
  return { altitudeDeg: alt / DEG, azimuthDeg: norm360(az / DEG) };
}

/** 太阳地平坐标 */
export function sunPosition(lng: number, lat: number, ms: number): AltAz {
  return equatorialToHorizontal(lng, lat, ms, sunEquatorial(ms));
}

/**
 * 在 [fromMs, toMs] 内查找高度角上行/下行穿越 targetAlt 的时刻（二分精化）。
 * stepMs 越小越不易漏掉短窗，10 分钟对晨昏阶段足够。
 */
export function findAltitudeCrossings(
  altitudeAt: (ms: number) => number,
  fromMs: number,
  toMs: number,
  targetAltDeg: number,
  stepMs = 10 * 60_000,
): { riseMs: number | null; setMs: number | null } {
  let riseMs: number | null = null;
  let setMs: number | null = null;
  let prevT = fromMs;
  let prevD = altitudeAt(prevT) - targetAltDeg;
  for (let t = fromMs + stepMs; t <= toMs; t += stepMs) {
    const d = altitudeAt(t) - targetAltDeg;
    if (prevD < 0 && d >= 0 && riseMs == null) {
      riseMs = bisect(altitudeAt, prevT, t, targetAltDeg);
    } else if (prevD > 0 && d <= 0 && setMs == null) {
      setMs = bisect(altitudeAt, prevT, t, targetAltDeg);
    }
    prevT = t;
    prevD = d;
  }
  return { riseMs, setMs };
}

function bisect(
  altitudeAt: (ms: number) => number,
  a: number,
  b: number,
  target: number,
  iterations = 24,
): number {
  let lo = a;
  let hi = b;
  for (let i = 0; i < iterations; i += 1) {
    const mid = (lo + hi) / 2;
    const d = altitudeAt(mid) - target;
    if (d === 0) return mid;
    if ((altitudeAt(lo) - target <= 0 && d > 0) || (altitudeAt(lo) - target > 0 && d <= 0)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return (lo + hi) / 2;
}

/** 单日太阳阶段（绝对 ms；极昼极夜时对应项为 null） */
export interface SunPhases {
  /** 天文晨光始 */
  astroDawnMs: number | null;
  nautDawnMs: number | null;
  civilDawnMs: number | null;
  /** 蓝色时刻（晨）-6° → -4° */
  blueMorningFromMs: number | null;
  blueMorningToMs: number | null;
  /** 金色时刻（晨）-4° → +6° */
  goldenMorningFromMs: number | null;
  goldenMorningToMs: number | null;
  /** 日出 */
  sunriseMs: number | null;
  /** 日落 */
  sunsetMs: number | null;
  goldenEveningFromMs: number | null;
  goldenEveningToMs: number | null;
  blueEveningFromMs: number | null;
  blueEveningToMs: number | null;
  civilDuskMs: number | null;
  nautDuskMs: number | null;
  astroDuskMs: number | null;
}

const PHASE_CACHE = new Map<string, SunPhases>();

/**
 * 计算给定坐标「当地日」的太阳阶段。dayStartMs 为该日 00:00（任意时区的绝对时刻均可，
 * 窗口会覆盖其后 24h）。
 */
export function getSunPhases(lng: number, lat: number, dayStartMs: number): SunPhases {
  const key = `${Math.round(lng * 20) / 20},${Math.round(lat * 20) / 20},${Math.round(dayStartMs / 60000)}`;
  const hit = PHASE_CACHE.get(key);
  if (hit) return hit;

  const from = dayStartMs;
  const to = dayStartMs + DAY_MS;
  const altAt = (ms: number) => sunPosition(lng, lat, ms).altitudeDeg;
  const cross = (target: number) => findAltitudeCrossings(altAt, from, to, target);

  const rise0833 = cross(SUN_RISE_ALT_DEG);
  const civil = cross(CIVIL_TWILIGHT_ALT_DEG);
  const naut = cross(NAUTICAL_TWILIGHT_ALT_DEG);
  const astro = cross(ASTRONOMICAL_TWILIGHT_ALT_DEG);
  const goldenBlue = cross(GOLDEN_BLUE_ALT_DEG);
  const golden = cross(GOLDEN_HOUR_ALT_DEG);

  const result: SunPhases = {
    astroDawnMs: astro.riseMs,
    nautDawnMs: naut.riseMs,
    civilDawnMs: civil.riseMs,
    blueMorningFromMs: civil.riseMs,
    blueMorningToMs: goldenBlue.riseMs,
    goldenMorningFromMs: goldenBlue.riseMs,
    goldenMorningToMs: golden.riseMs,
    sunriseMs: rise0833.riseMs,
    sunsetMs: rise0833.setMs,
    goldenEveningFromMs: golden.setMs,
    goldenEveningToMs: goldenBlue.setMs,
    blueEveningFromMs: goldenBlue.setMs,
    blueEveningToMs: civil.setMs,
    civilDuskMs: civil.setMs,
    nautDuskMs: naut.setMs,
    astroDuskMs: astro.setMs,
  };
  if (PHASE_CACHE.size > 400) {
    const first = PHASE_CACHE.keys().next().value;
    if (first) PHASE_CACHE.delete(first);
  }
  PHASE_CACHE.set(key, result);
  return result;
}

/** 清除太阳阶段缓存（测试用） */
export function clearSunPhaseCache(): void {
  PHASE_CACHE.clear();
}
