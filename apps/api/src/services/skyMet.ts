/**
 * 天象观景 · 逐时气象采样（云量分层/湿度/露点/风/零度层高度）
 *
 * 数据源：Open-Meteo（字段最全：低/中/高云量是霞光、云海指数的关键输入）。
 * 免费档仅限非商用；公开商用须 Open-Meteo 付费或改接其它合规源，且 UI 须 CC BY 署名。
 * 按 ~0.25° 网格 + 小时序列缓存，同格邻近事件共享请求。
 */
import type { SkyMetSample } from '@railvista/shared';
import { cache } from './cache.js';
import { envInt, fetchWithTimeout } from './http.js';

export type SkyMetQuery = {
  pointId: string;
  lng: number;
  lat: number;
  atIso: string;
};

type MetHour = {
  atMs: number;
  sample: SkyMetSample;
};

type MetBundle = {
  hours: MetHour[];
};

const CACHE_TTL_SEC = envInt('SKY_MET_CACHE_TTL_SEC', 1800);
const MAX_BATCH = 80;
const GRID = 0.25;

function gridKey(lat: number, lng: number): string {
  const gLat = Math.round(lat / GRID) * GRID;
  const gLng = Math.round(lng / GRID) * GRID;
  return `${gLat.toFixed(2)},${gLng.toFixed(2)}`;
}

function roundCoord(n: number): number {
  return Math.round(n * 100) / 100;
}

async function fetchOpenMeteoMet(lat: number, lng: number, hoursNeeded: number): Promise<MetBundle> {
  const days = Math.min(16, Math.max(1, Math.ceil(hoursNeeded / 24) + 1));
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${roundCoord(lat)}` +
    `&longitude=${roundCoord(lng)}` +
    `&hourly=temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,` +
    `cloud_cover_low,cloud_cover_mid,cloud_cover_high,cloud_cover,visibility,` +
    `precipitation_probability,freezing_level_height` +
    `&timezone=Asia%2FShanghai&forecast_days=${days}&past_days=2`;
  const res = await fetchWithTimeout(url, {}, { timeoutMs: 6000, label: 'Open-Meteo·met' });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = (await res.json()) as {
    hourly?: {
      time?: string[];
      temperature_2m?: Array<number | null>;
      dew_point_2m?: Array<number | null>;
      relative_humidity_2m?: Array<number | null>;
      wind_speed_10m?: Array<number | null>;
      cloud_cover_low?: Array<number | null>;
      cloud_cover_mid?: Array<number | null>;
      cloud_cover_high?: Array<number | null>;
      cloud_cover?: Array<number | null>;
      visibility?: Array<number | null>;
      precipitation_probability?: Array<number | null>;
      freezing_level_height?: Array<number | null>;
    };
  };
  const times = json.hourly?.time || [];
  const hours: MetHour[] = [];
  const pct = (v: number | null | undefined): number | undefined =>
    typeof v === 'number' ? Math.max(0, Math.min(1, v / 100)) : undefined;
  for (let i = 0; i < times.length; i += 1) {
    const atMs = Date.parse(times[i]!);
    if (!Number.isFinite(atMs)) continue;
    const visM = json.hourly?.visibility?.[i];
    hours.push({
      atMs,
      sample: {
        atIso: new Date(atMs).toISOString(),
        tempC: typeof json.hourly?.temperature_2m?.[i] === 'number' ? (json.hourly!.temperature_2m![i] as number) : undefined,
        dewPointC: typeof json.hourly?.dew_point_2m?.[i] === 'number' ? (json.hourly!.dew_point_2m![i] as number) : undefined,
        humidity: pct(json.hourly?.relative_humidity_2m?.[i]),
        windSpeedMs: typeof json.hourly?.wind_speed_10m?.[i] === 'number' ? (json.hourly!.wind_speed_10m![i] as number) / 3.6 : undefined,
        cloudLow: pct(json.hourly?.cloud_cover_low?.[i]),
        cloudMid: pct(json.hourly?.cloud_cover_mid?.[i]),
        cloudHigh: pct(json.hourly?.cloud_cover_high?.[i]),
        totalCloud: pct(json.hourly?.cloud_cover?.[i]),
        visibilityKm: typeof visM === 'number' ? visM / 1000 : undefined,
        precipProb: pct(json.hourly?.precipitation_probability?.[i]),
        freezingLevelM:
          typeof json.hourly?.freezing_level_height?.[i] === 'number'
            ? (json.hourly!.freezing_level_height![i] as number)
            : undefined,
      },
    });
  }
  return { hours };
}

async function loadMet(lat: number, lng: number, hoursNeeded: number): Promise<MetBundle> {
  const cacheId = `sky:met:${gridKey(lat, lng)}:${Math.ceil(hoursNeeded / 24)}`;
  const hit = cache.get<MetBundle>(cacheId);
  if (hit) return hit;
  const bundle = await fetchOpenMeteoMet(lat, lng, hoursNeeded);
  cache.set(cacheId, bundle, CACHE_TTL_SEC);
  return bundle;
}

function nearestSample(hours: MetHour[], atMs: number): SkyMetSample | undefined {
  let best: MetHour | undefined;
  let bestD = Infinity;
  for (const h of hours) {
    const d = Math.abs(h.atMs - atMs);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  // 邻近 2.5 小时外视为无采样（超出逐时预报可用范围）
  return bestD <= 2.5 * 3_600_000 ? best?.sample : undefined;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.min(limit, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/** 批量查询天象事件时刻的逐时气象采样 */
export async function querySkyMet(queries: SkyMetQuery[]): Promise<{
  items: Array<{ pointId: string; met?: SkyMetSample }>;
  source: 'open-meteo';
}> {
  const list = queries.slice(0, MAX_BATCH).filter((q) => {
    return (
      q.pointId &&
      Number.isFinite(q.lng) &&
      Number.isFinite(q.lat) &&
      q.atIso &&
      Number.isFinite(Date.parse(q.atIso))
    );
  });

  const now = Date.now();
  let maxHours = 24;
  for (const q of list) {
    const t = Date.parse(q.atIso);
    maxHours = Math.max(maxHours, Math.abs(t - now) / 3_600_000 + 2);
  }

  const items = await mapPool(list, 4, async (q) => {
    try {
      const bundle = await loadMet(q.lat, q.lng, maxHours);
      return { pointId: q.pointId, met: nearestSample(bundle.hours, Date.parse(q.atIso)) };
    } catch {
      return { pointId: q.pointId };
    }
  });

  return { items, source: 'open-meteo' };
}
