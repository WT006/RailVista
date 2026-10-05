/**
 * 景点 ETA 天气：优先和风（QWeather），未配置 Key 时回退 Open-Meteo（便于本地开发）。
 * 按 ~0.1° 网格缓存小时序列，邻近景点共享请求。
 */
import {
  computeViewHint,
  formatSpotWeatherLabel,
  pickHourlyNearest,
  type SpotWeather,
  type SpotWeatherSource,
} from '@railvista/shared';
import { cache } from './cache.js';
import { envInt, fetchWithTimeout } from './http.js';

export type SpotWeatherQuery = {
  spotId: string;
  lng: number;
  lat: number;
  atIso: string;
  visibility?: string;
};

type HourSample = {
  atMs: number;
  atIso: string;
  cond: string;
  icon: string;
  tempC: number;
  visKm: number | null;
  cloud: number | null;
  precipProb: number | null;
};

type HourlyBundle = {
  source: SpotWeatherSource;
  hours: HourSample[];
};

const CACHE_TTL_SEC = envInt('WEATHER_CACHE_TTL_SEC', 1800);
const MAX_BATCH = 40;
const GRID = 0.1;

function providerPref(): 'auto' | 'qweather' | 'open-meteo' {
  const raw = String(process.env.WEATHER_PROVIDER || 'auto').trim().toLowerCase();
  if (raw === 'qweather' || raw === 'open-meteo') return raw;
  return 'auto';
}

function qweatherConfigured(): boolean {
  return Boolean(process.env.QWEATHER_API_KEY?.trim() && process.env.QWEATHER_API_HOST?.trim());
}

function gridKey(lat: number, lng: number): string {
  const gLat = Math.round(lat / GRID) * GRID;
  const gLng = Math.round(lng / GRID) * GRID;
  return `${gLat.toFixed(1)},${gLng.toFixed(1)}`;
}

function roundCoord(n: number): number {
  return Math.round(n * 100) / 100;
}

function wmoText(code: number): string {
  const map: Record<number, string> = {
    0: '晴',
    1: '晴间多云',
    2: '多云',
    3: '阴',
    45: '雾',
    48: '雾凇',
    51: '小毛毛雨',
    53: '毛毛雨',
    55: '大毛毛雨',
    56: '冻毛毛雨',
    57: '强冻毛毛雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    66: '冻雨',
    67: '强冻雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    77: '雪粒',
    80: '小阵雨',
    81: '阵雨',
    82: '强阵雨',
    85: '小阵雪',
    86: '阵雪',
    95: '雷阵雨',
    96: '雷阵雨伴冰雹',
    99: '强雷阵雨伴冰雹',
  };
  return map[code] ?? `天气码${code}`;
}

async function fetchOpenMeteo(lat: number, lng: number, hoursNeeded: number): Promise<HourlyBundle> {
  const days = Math.min(16, Math.max(1, Math.ceil(hoursNeeded / 24) + 1));
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${roundCoord(lat)}` +
    `&longitude=${roundCoord(lng)}` +
    `&hourly=temperature_2m,weather_code,visibility,cloud_cover,precipitation_probability` +
    `&timezone=Asia%2FShanghai&forecast_days=${days}`;
  const res = await fetchWithTimeout(url, {}, { timeoutMs: 6000, label: 'Open-Meteo' });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = (await res.json()) as {
    hourly?: {
      time?: string[];
      temperature_2m?: Array<number | null>;
      weather_code?: Array<number | null>;
      visibility?: Array<number | null>;
      cloud_cover?: Array<number | null>;
      precipitation_probability?: Array<number | null>;
    };
  };
  const t = json.hourly?.time || [];
  const hours: HourSample[] = [];
  for (let i = 0; i < t.length; i += 1) {
    const iso = t[i]!;
    const atMs = Date.parse(iso);
    if (!Number.isFinite(atMs)) continue;
    const code = Number(json.hourly?.weather_code?.[i] ?? NaN);
    const visM = json.hourly?.visibility?.[i];
    const cloudPct = json.hourly?.cloud_cover?.[i];
    const precipPct = json.hourly?.precipitation_probability?.[i];
    const temp = json.hourly?.temperature_2m?.[i];
    hours.push({
      atMs,
      atIso: new Date(atMs).toISOString(),
      cond: Number.isFinite(code) ? wmoText(code) : '未知',
      icon: Number.isFinite(code) ? String(code) : '',
      tempC: typeof temp === 'number' ? temp : NaN,
      visKm: typeof visM === 'number' ? visM / 1000 : null,
      cloud: typeof cloudPct === 'number' ? cloudPct / 100 : null,
      precipProb: typeof precipPct === 'number' ? precipPct / 100 : null,
    });
  }
  return { source: 'open-meteo', hours };
}

async function fetchQWeather(lat: number, lng: number, hoursNeeded: number): Promise<HourlyBundle> {
  const host = String(process.env.QWEATHER_API_HOST).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const key = String(process.env.QWEATHER_API_KEY).trim();
  const hours = Math.min(240, Math.max(24, Math.ceil(hoursNeeded) + 2));
  const url =
    `https://${host}/weather/v1/hourly/${roundCoord(lat)}/${roundCoord(lng)}` +
    `?hours=${hours}&lang=zh&localTime=false`;
  const res = await fetchWithTimeout(
    url,
    { headers: { 'X-QW-Api-Key': key, Accept: 'application/json' } },
    { timeoutMs: 6000, label: '和风天气' },
  );
  if (!res.ok) throw new Error(`QWeather HTTP ${res.status}`);
  const json = (await res.json()) as {
    hours?: Array<{
      forecastTime?: string;
      condition?: { text?: string; code?: string };
      temperature?: { value?: number };
      visibility?: { value?: number; unit?: string };
      cloudCover?: number;
      precipitation?: { probability?: number };
    }>;
    error?: { detail?: string };
  };
  if (!json.hours?.length) {
    throw new Error(json.error?.detail || 'QWeather empty hours');
  }
  const samples: HourSample[] = [];
  for (const h of json.hours) {
    const atMs = Date.parse(h.forecastTime || '');
    if (!Number.isFinite(atMs)) continue;
    let visKm: number | null = null;
    if (typeof h.visibility?.value === 'number') {
      const unit = (h.visibility.unit || 'm').toLowerCase();
      visKm = unit.includes('km') ? h.visibility.value : h.visibility.value / 1000;
    }
    samples.push({
      atMs,
      atIso: new Date(atMs).toISOString(),
      cond: h.condition?.text || '未知',
      icon: h.condition?.code || '',
      tempC: typeof h.temperature?.value === 'number' ? h.temperature.value : NaN,
      visKm,
      cloud: typeof h.cloudCover === 'number' ? h.cloudCover : null,
      precipProb: typeof h.precipitation?.probability === 'number' ? h.precipitation.probability : null,
    });
  }
  return { source: 'qweather', hours: samples };
}

async function loadHourly(lat: number, lng: number, hoursNeeded: number): Promise<HourlyBundle> {
  const pref = providerPref();
  const useQw = pref === 'qweather' || (pref === 'auto' && qweatherConfigured());
  const cacheId = `wx:h:${useQw ? 'qw' : 'om'}:${gridKey(lat, lng)}:${Math.ceil(hoursNeeded / 24)}`;
  const hit = cache.get<HourlyBundle>(cacheId);
  if (hit) return hit;

  let bundle: HourlyBundle;
  if (useQw) {
    try {
      bundle = await fetchQWeather(lat, lng, hoursNeeded);
    } catch (e) {
      if (pref === 'qweather') throw e;
      console.warn('[weather] QWeather failed, fallback Open-Meteo', (e as Error)?.message);
      bundle = await fetchOpenMeteo(lat, lng, hoursNeeded);
    }
  } else {
    bundle = await fetchOpenMeteo(lat, lng, hoursNeeded);
  }
  cache.set(cacheId, bundle, CACHE_TTL_SEC);
  return bundle;
}

function sampleToWeather(
  q: SpotWeatherQuery,
  sample: HourSample | null,
  source: SpotWeatherSource,
  reason?: string,
): SpotWeather {
  if (!sample) {
    return { spotId: q.spotId, queried: false, source: 'none', reason: reason || 'no_hour' };
  }
  const viewHint = computeViewHint({
    cond: sample.cond,
    icon: sample.icon,
    visKm: sample.visKm,
    cloud: sample.cloud,
    precipProb: sample.precipProb,
    visibility: q.visibility,
  });
  const base: SpotWeather = {
    spotId: q.spotId,
    queried: true,
    atIso: sample.atIso,
    cond: sample.cond,
    icon: sample.icon,
    tempC: Number.isFinite(sample.tempC) ? sample.tempC : undefined,
    visKm: sample.visKm ?? undefined,
    cloud: sample.cloud ?? undefined,
    precipProb: sample.precipProb ?? undefined,
    viewHint,
    source,
  };
  base.label = formatSpotWeatherLabel(base, q.visibility);
  return base;
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

/** 批量查询景点 ETA 天气；未配置和风时自动走 Open-Meteo */
export async function querySpotWeathers(queries: SpotWeatherQuery[]): Promise<{
  items: SpotWeather[];
  provider: SpotWeatherSource | 'auto';
  configured: { qweather: boolean };
}> {
  const list = queries.slice(0, MAX_BATCH).filter((q) => {
    return (
      q.spotId &&
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
    if (t > now) maxHours = Math.max(maxHours, (t - now) / 3_600_000);
  }
  maxHours = Math.min(240, Math.ceil(maxHours) + 2);

  const items = await mapPool(list, 4, async (q) => {
    try {
      const bundle = await loadHourly(q.lat, q.lng, maxHours);
      const hit = pickHourlyNearest(
        bundle.hours.map((h) => ({ ...h, atMs: h.atMs })),
        q.atIso,
      );
      if (!hit) {
        return sampleToWeather(q, null, 'none', 'eta_out_of_forecast');
      }
      return sampleToWeather(q, hit, bundle.source);
    } catch (e) {
      return {
        spotId: q.spotId,
        queried: false,
        source: 'none' as const,
        reason: (e as Error)?.message || 'fetch_failed',
      };
    }
  });

  // 保持与输入顺序对应：被过滤掉的返回未查询
  const byId = new Map(items.map((w) => [w.spotId, w]));
  const ordered = queries.slice(0, MAX_BATCH).map(
    (q) =>
      byId.get(q.spotId) ||
      ({ spotId: q.spotId, queried: false, source: 'none', reason: 'invalid' } satisfies SpotWeather),
  );

  const pref = providerPref();
  const active: SpotWeatherSource | 'auto' =
    pref === 'open-meteo'
      ? 'open-meteo'
      : pref === 'qweather'
        ? 'qweather'
        : qweatherConfigured()
          ? 'qweather'
          : 'open-meteo';

  return {
    items: ordered,
    provider: active,
    configured: { qweather: qweatherConfigured() },
  };
}
