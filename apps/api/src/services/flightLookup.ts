/**
 * 航班查询：可插拔数据提供商 + 本地兜底。
 *
 * 在线提供商：AirLabs（https://airlabs.co）
 *   - 配置环境变量 AIRLABS_API_KEY 后启用。免费套餐可查航班时刻、登机口、航站楼等。
 *   - Schedules 接口仅覆盖未来约 10 小时；已完成航班走 Historical 接口。
 * 未配置 key 时返回本地结果：仅含航司等确定信息，起降地/时刻需用户在前端补选，
 * 并如实标注，绝不编造时刻。
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
} from '@railvista/shared';

const TIMEOUT_MS = 8000;

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
    note: '未配置航班数据服务（AIRLABS_API_KEY），无法自动获取起降机场与时刻，请在下方补选；机场英文名、里程、巡航高度将自动匹配。',
  };
}

export async function lookupFlight(flightNo: string, date: string): Promise<FlightLookup> {
  const flightIata = flightNo.trim().toUpperCase();
  if (!parseFlightIata(flightIata)) {
    return {
      source: 'local',
      flightNumber: flightIata,
      date,
      note: '航班号格式不正确，示例：CZ3467、CA4401、3U8633。',
    };
  }
  const online = await queryAirlabs(flightIata, date);
  return online ?? localResult(flightIata, date);
}
