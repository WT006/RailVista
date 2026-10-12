/**
 * 航班查询：可插拔数据提供商 + 本地兜底。
 *
 * 在线提供商优先级：FR24 → AirLabs → 本地兜底
 *   - FR24（FlightRadar24 公开 API，免费无需 key）：按航班号查动态，覆盖国际+国内
 *   - AirLabs（https://airlabs.co，需 AIRLABS_API_KEY）：时刻/登机口/航站楼
 *   - 本地兜底：仅含航司等确定信息，起降地/时刻需用户在前端补选
 *
 * FR24 数据源移植自 FlyClaw 项目（https://github.com/AI4MSE/FlyClaw），Apache-2.0。
 */
import {
  cruiseAltitudeM,
  flightDurationMinEst,
  getAirline,
  getAirport,
  haversineKm,
  parseFlightIata,
  type FlightEndpointInfo,
  type FlightLookup,
  type FlightSearchResult,
} from '@railvista/shared';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 8000;

// ── FR24 (FlightRadar24) ───────────────────────────────────────────────────
const FR24_API_BASE = 'https://api.flightradar24.com/common/v1';
const FR24_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Origin: 'https://www.flightradar24.com',
  Referer: 'https://www.flightradar24.com/',
  Accept: 'application/json',
};

interface FR24Flight {
  identification?: { number?: { default?: string } };
  airline?: { name?: string; code?: { iata?: string } };
  airport?: {
    origin?: { code?: { iata?: string }; position?: { region?: { city?: string } } };
    destination?: { code?: { iata?: string }; position?: { region?: { city?: string } } };
  };
  time?: {
    scheduled?: { departure?: number; arrival?: number };
    real?: { departure?: number; arrival?: number };
  };
  status?: { text?: string };
  aircraft?: { model?: { text?: string; code?: string } };
}

/** unix timestamp（秒）→ 当地 HH:MM，用机场经度估算时区偏移 */
function tsToLocalHHMM(ts: number | null | undefined, lng?: number): string | undefined {
  if (ts == null || !Number.isFinite(ts)) return undefined;
  const offset = lng != null ? Math.round(lng / 15) : 0;
  const d = new Date(ts * 1000 + offset * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** unix timestamp（秒）→ YYYY-MM-DD（UTC） */
function tsToDate(ts: number | null | undefined): string | undefined {
  if (ts == null || !Number.isFinite(ts)) return undefined;
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** 调 FR24 公开 API 按航班号查动态；查不到返回 null */
async function queryFr24(flightIata: string, date: string): Promise<FlightLookup | null> {
  const url = `${FR24_API_BASE}/flight/list.json?query=${encodeURIComponent(flightIata)}&fetchBy=flight&page=1&limit=25`;
  let raw: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: FR24_HEADERS,
    });
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }

  const items: FR24Flight[] =
    (raw as { result?: { response?: { data?: FR24Flight[] } } })?.result?.response?.data ?? [];
  if (!items.length) return null;

  const match =
    items.find((f) => tsToDate(f.time?.scheduled?.departure) === date) ??
    items.find((f) => tsToDate(f.time?.real?.departure) === date) ??
    items[0];
  if (!match) return null;

  const depIata = match.airport?.origin?.code?.iata ?? '';
  const arrIata = match.airport?.destination?.code?.iata ?? '';
  const ap = getAirport(depIata);
  const bp = getAirport(arrIata);
  const distanceKm = ap && bp ? Math.round(haversineKm(ap, bp)) : undefined;
  const durationMin = distanceKm ? flightDurationMinEst(distanceKm) : undefined;

  const dep: FlightEndpointInfo = {
    iata: depIata,
    scheduled: tsToLocalHHMM(match.time?.scheduled?.departure, ap?.lng),
    actual: tsToLocalHHMM(match.time?.real?.departure, ap?.lng),
  };
  const arr: FlightEndpointInfo = {
    iata: arrIata,
    scheduled: tsToLocalHHMM(match.time?.scheduled?.arrival, bp?.lng),
    actual: tsToLocalHHMM(match.time?.real?.arrival, bp?.lng),
  };

  return {
    source: 'fr24',
    flightNumber: match.identification?.number?.default ?? flightIata,
    airlineIata: match.airline?.code?.iata?.toUpperCase() || undefined,
    date,
    dep,
    arr,
    durationMin,
    distanceKm,
    cruiseAltitudeM: distanceKm ? cruiseAltitudeM(distanceKm) : undefined,
    status: match.status?.text,
  };
}

type RawFlight = Record<string, unknown>;

function hhmm(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  if (!m) return undefined;
  return `${m[4]}:${m[5]}`;
}

function dateOf(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

function endpoint(raw: RawFlight, side: 'dep' | 'arr'): FlightEndpointInfo {
  const ep: FlightEndpointInfo = {
    iata: String(raw[`${side}_iata`] ?? ''),
    icao: raw[`${side}_icao`] as string | undefined,
    terminal: raw[`${side}_terminal`] as string | undefined,
    gate: raw[`${side}_gate`] as string | undefined,
    scheduled: hhmm(raw[`${side}_time`]),
    actual: hhmm(raw[`${side}_actual`]) ?? hhmm(raw[`${side}_estimated`]),
  };
  return ep;
}

/** 调 AirLabs 并映射；查不到返回 null */
async function queryAirlabs(flightIata: string, date: string): Promise<FlightLookup | null> {
  const key = process.env.AIRLABS_API_KEY?.trim();
  if (!key) return null;

  const today = new Date().toISOString().slice(0, 10);
  const isPast = date < today;
  const base = isPast ? 'https://airlabs.co/api/v10/historical' : 'https://airlabs.co/api/v9/schedules';
  const url = `${base}?flight_iata=${encodeURIComponent(flightIata)}&api_key=${key}`;

  let raw: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'RailVista (flight-lookup)' },
    });
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }

  const list: RawFlight[] = Array.isArray((raw as { response?: RawFlight[] }).response)
    ? ((raw as { response: RawFlight[] }).response)
    : [];
  // 历史接口按日期过滤；计划接口取首条
  const match =
    list.find((f) => dateOf(f.dep_time) === date) ??
    list.find((f) => dateOf(f.dep_actual) === date) ??
    list[0];
  if (!match) return null;

  const dep = endpoint(match, 'dep');
  const arr = endpoint(match, 'arr');
  const ap = getAirport(dep.iata);
  const bp = getAirport(arr.iata);
  const distanceKm = ap && bp ? Math.round(haversineKm(ap, bp)) : undefined;
  const durationMin =
    typeof match.duration === 'number' && match.duration > 0
      ? match.duration
      : distanceKm
        ? flightDurationMinEst(distanceKm)
        : undefined;

  return {
    source: 'airlabs',
    flightNumber: flightIata,
    airlineIata: String(match.airline_iata ?? '').toUpperCase() || undefined,
    date,
    dep,
    arr,
    durationMin,
    distanceKm,
    cruiseAltitudeM: distanceKm ? cruiseAltitudeM(distanceKm) : undefined,
    status: match.status as string | undefined,
  };
}

/** 本地兜底：只给确定信息（航司），不编造起降地与时刻 */
function localResult(flightIata: string, date: string): FlightLookup {
  const parsed = parseFlightIata(flightIata);
  const airline = parsed ? getAirline(parsed.airlineIata) : undefined;
  return {
    source: 'local',
    flightNumber: flightIata.toUpperCase(),
    airlineIata: airline?.iata,
    date,
    note: '在线航班数据源暂不可用，请选择出发和到达机场，系统将自动通过飞猪源搜索该航班。',
  };
}

export async function lookupFlight(
  flightNo: string,
  date: string,
  from?: string,
  to?: string,
): Promise<FlightLookup> {
  const flightIata = flightNo.trim().toUpperCase();
  if (!parseFlightIata(flightIata)) {
    return {
      source: 'local',
      flightNumber: flightIata,
      date,
      note: '航班号格式不正确，示例：CZ3467、CA4401、3U8633。',
    };
  }
  // 查询链：FR24（免费无需key）→ AirLabs（需key）→ 飞猪按航线+航班号过滤 → 本地兜底
  const fr24 = await queryFr24(flightIata, date);
  if (fr24) return fr24;
  const online = await queryAirlabs(flightIata, date);
  if (online) return online;

  // 在线源均不可用时，若用户提供了起降机场，用飞猪按航线搜索并过滤航班号
  if (from && to) {
    const routeResults = await searchFlightsByRoute(from, to, date);
    const match = routeResults.find(
      (r) => r.flightNumber.toUpperCase() === flightIata,
    );
    if (match) {
      const ap = getAirport(match.depIata);
      const bp = getAirport(match.arrIata);
      const distanceKm = ap && bp ? Math.round(haversineKm(ap, bp)) : undefined;
      const durationMin = match.durationMin ?? (distanceKm ? flightDurationMinEst(distanceKm) : undefined);
      return {
        source: 'fr24',
        flightNumber: match.flightNumber,
        airlineIata: match.airlineIata,
        date,
        dep: { iata: match.depIata, scheduled: match.scheduledDeparture },
        arr: { iata: match.arrIata, scheduled: match.scheduledArrival },
        durationMin,
        distanceKm,
        cruiseAltitudeM: distanceKm ? cruiseAltitudeM(distanceKm) : undefined,
      };
    }
  }

  return localResult(flightIata, date);
}
// ── FlyClaw 子进程 ──────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const FLYCLAW_DIR = join(__dirname, '../../../../tools/flyclaw');
const FLYCLAW_SCRIPT = join(FLYCLAW_DIR, 'flyclaw.py');

/** 查找 Python 可执行文件 */
function findPython(): string {
  if (process.env.FLYCLAW_PYTHON) return process.env.FLYCLAW_PYTHON;
  const commonPaths = [
    'C:/Program Files/Python311/python.exe',
    'C:/Program Files/Python312/python.exe',
    'C:/Program Files/Python313/python.exe',
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) return p;
  }
  return 'python';
}

interface FlyClawRecord {
  flight_number?: string;
  airline?: string;
  origin_iata?: string;
  origin_city?: string;
  destination_iata?: string;
  destination_city?: string;
  scheduled_departure?: string;
  scheduled_arrival?: string;
  duration_minutes?: number;
  price?: number;
  currency?: string;
  stops?: number;
  cabin_class?: string;
  source?: string;
}

/** 从 ISO 时间字符串提取 HH:MM（兼容 YYYY-MM-DDTHH:MM / YYYY-MM-DD HH:MM / 纯 HH:MM） */
function extractHHMM(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /(\d{2}):(\d{2})/.exec(s);
  return m ? `${m[1]}:${m[2]}` : undefined;
}

/**
 * 通过 FlyClaw 子进程按航线搜索航班（飞猪源，不受 Cloudflare 拦截）。
 *
 * FlyClaw 项目：https://github.com/AI4MSE/FlyClaw（Apache-2.0）
 * 需要本地安装 Python 3.11+ 及 FlyClaw 依赖（requests/pyyaml/curl_cffi）。
 */
export async function searchFlightsByRoute(
  from: string,
  to: string,
  date: string,
): Promise<FlightSearchResult[]> {
  const python = findPython();
  const args = [
    FLYCLAW_SCRIPT,
    'search',
    '--from', from.toUpperCase(),
    '--to', to.toUpperCase(),
    '--date', date,
    '-o', 'json',
  ];

  return new Promise((resolve) => {
    execFile(python, args, {
      cwd: FLYCLAW_DIR,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    }, (err, stdout) => {
      if (err) {
        console.warn('[flyclaw] search failed:', err.message);
        resolve([]);
        return;
      }
      try {
        const raw = JSON.parse(stdout) as FlyClawRecord[];
        if (!Array.isArray(raw)) {
          resolve([]);
          return;
        }
        const results: FlightSearchResult[] = raw.map((r) => {
          // 数字开头航班号（3U/9C/8L…）不能用 /\d.*$/ 截前缀（会把 3U8633 截成空串），
          // 用 parseFlightIata 统一解析航司二字码
          const parsed = r.flight_number ? parseFlightIata(r.flight_number) : null;
          const airlineIata = parsed?.airlineIata;
          const airlineInfo = airlineIata ? getAirline(airlineIata) : undefined;
          return {
            flightNumber: r.flight_number ?? '',
            airlineName: airlineInfo?.name ?? r.airline,
            airlineIata,
            depIata: r.origin_iata ?? '',
            arrIata: r.destination_iata ?? '',
            depCity: r.origin_city,
            arrCity: r.destination_city,
            scheduledDeparture: extractHHMM(r.scheduled_departure),
            scheduledArrival: extractHHMM(r.scheduled_arrival),
            durationMin: r.duration_minutes,
            price: r.price,
            currency: r.currency,
            stops: r.stops,
            cabinClass: r.cabin_class,
            source: r.source ?? 'flyclaw',
          };
        }).filter((r) => r.flightNumber && r.depIata && r.arrIata);
        resolve(results);
      } catch {
        resolve([]);
      }
    });
  });
}
