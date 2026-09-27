import type { LngLat } from '../types.js';

/** 日出日落结果 */
export interface SolarTimes {
  /** 日出时刻 (ms) */
  sunriseMs: number;
  /** 日落时刻 (ms) */
  sunsetMs: number;
}

/** 日出日落缓存（按日期+坐标网格键） */
const cache = new Map<string, SolarTimes>();

/**
 * 计算指定坐标与日期的日出日落时刻（标准太阳位置算法）。
 * 纬度 lat、经度 lng（度），date 为本地日期。
 * 返回日出日落绝对时刻（ms）。
 */
export function computeSolarTimes(lng: number, lat: number, date: Date): SolarTimes {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const N = Math.floor(
    275 * month / 9 - 30 + day + (month <= 2 ? 0 : Math.floor(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0) - 2),
  );

  const declination = 23.45 * Math.sin(rad * (360 * (284 + N) / 365));

  const latRad = lat * rad;
  const declRad = declination * rad;

  const cosH = -Math.tan(latRad) * Math.tan(declRad);

  if (cosH > 1) {
    const polarMs = new Date(year, date.getMonth(), day, 12, 0, 0).getTime();
    return { sunriseMs: polarMs, sunsetMs: polarMs };
  }
  if (cosH < -1) {
    const polarMs = new Date(year, date.getMonth(), day, 0, 0, 0).getTime();
    return { sunriseMs: polarMs, sunsetMs: polarMs + 86400000 };
  }

  const H = Math.acos(cosH) * deg;

  const solarNoonUtcH = 12 - lng / 15;
  const sunriseUtcH = solarNoonUtcH - H / 15;
  const sunsetUtcH = solarNoonUtcH + H / 15;

  const baseMs = Date.UTC(year, date.getMonth(), day, 0, 0, 0);

  return {
    sunriseMs: baseMs + sunriseUtcH * 3_600_000,
    sunsetMs: baseMs + sunsetUtcH * 3_600_000,
  };
}

/** 缓存键：按 0.1° 网格 + 日期 */
function cacheKey(lng: number, lat: number, date: Date): string {
  const lngGrid = Math.round(lng * 10) / 10;
  const latGrid = Math.round(lat * 10) / 10;
  return `${lngGrid},${latGrid},${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * 获取日出日落（带缓存）。
 */
export function getSolarTimes(lng: number, lat: number, date: Date): SolarTimes {
  const key = cacheKey(lng, lat, date);
  const cached = cache.get(key);
  if (cached) return cached;
  const result = computeSolarTimes(lng, lat, date);
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, result);
  return result;
}

/**
 * 判定给定时刻在给定坐标是否为夜间（spec §5.5.1.6）。
 * 夜间 = ETA 落在当地日落后日出前。
 * 查询失败时回退 nightOnly 静态标记（spec §5.5.3.3）。
 */
export function isNightAt(params: {
  lng: number;
  lat: number;
  isoTime: string | number | Date;
  nightOnly?: boolean;
}): boolean {
  const { lng, lat, nightOnly } = params;

  try {
    const time = params.isoTime instanceof Date ? params.isoTime : new Date(params.isoTime);
    const tMs = time.getTime();

    if (!Number.isFinite(tMs) || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      return nightOnly ?? false;
    }

    const solar = getSolarTimes(lng, lat, time);

    if (solar.sunriseMs === solar.sunsetMs) {
      return nightOnly ?? false;
    }

    return tMs < solar.sunriseMs || tMs >= solar.sunsetMs;
  } catch {
    return nightOnly ?? false;
  }
}

/** 清除缓存（测试用） */
export function clearSolarCache(): void {
  cache.clear();
}