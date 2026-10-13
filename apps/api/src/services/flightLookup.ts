/**
 * 航班查询：仅走 FlyClaw + 本地兜底。
 *
 * - 按航班号：FlyClaw `query`（Python 聚合 FR24 等）
 * - 按航线：FlyClaw `search`（飞猪等，含价格）
 * - 本地兜底：仅航司等确定信息，起降/时刻由用户补选
 *
 * FlyClaw：https://github.com/AI4MSE/FlyClaw（Apache-2.0），本地目录 tools/flyclaw。
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

const FLYCLAW_TIMEOUT_MS = 35_000;

function dateOf(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
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
    note: '在线航班数据暂不可用。请手动选择出发/到达机场，并按需补填时刻。',
  };
}

function lookupFromRouteMatch(match: FlightSearchResult, date: string): FlightLookup {
  const ap = getAirport(match.depIata);
  const bp = getAirport(match.arrIata);
  const distanceKm = ap && bp ? Math.round(haversineKm(ap, bp)) : undefined;
  const durationMin =
    match.durationMin ?? (distanceKm ? flightDurationMinEst(distanceKm) : undefined);
  return {
    source: 'flyclaw',
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

  const viaFlyClaw = await queryFlyClawByFlight(flightIata, date);
  if (viaFlyClaw) return viaFlyClaw;

  // 若已知 OD：航线搜再按航班号过滤
  if (from && to) {
    const routeResults = await searchFlightsByRoute(from, to, date);
    const match = routeResults.find((r) => r.flightNumber.toUpperCase() === flightIata);
    if (match) return lookupFromRouteMatch(match, date);
  }

  return localResult(flightIata, date);
}

// ── FlyClaw 子进程 ──────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const FLYCLAW_DIR = join(__dirname, '../../../../tools/flyclaw');
const FLYCLAW_SCRIPT = join(FLYCLAW_DIR, 'flyclaw.py');

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
  actual_departure?: string | null;
  actual_arrival?: string | null;
  duration_minutes?: number;
  price?: number;
  currency?: string;
  stops?: number;
  cabin_class?: string;
  status?: string;
  source?: string;
}

function extractHHMM(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  const m = /(\d{2}):(\d{2})/.exec(s);
  return m ? `${m[1]}:${m[2]}` : undefined;
}

/** ISO 时刻 → 机场当地 HH:MM（用经度粗估时区；无坐标则原样抽 HH:MM） */
function isoToLocalHHMM(iso: string | undefined | null, lng?: number): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return extractHHMM(iso);
  const offsetH = lng != null ? Math.round(lng / 15) : 0;
  const d = new Date(t + offsetH * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** 跑 FlyClaw CLI，解析 stdout JSON 数组；失败返回 [] */
function runFlyClaw(args: string[]): Promise<FlyClawRecord[]> {
  const python = findPython();
  return new Promise((resolve) => {
    execFile(
      python,
      [FLYCLAW_SCRIPT, ...args],
      {
        cwd: FLYCLAW_DIR,
        timeout: FLYCLAW_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      },
      (err, stdout) => {
        if (err) {
          console.warn('[flyclaw]', args[0], 'failed:', err.message);
          resolve([]);
          return;
        }
        try {
          const raw = JSON.parse(stdout) as unknown;
          resolve(Array.isArray(raw) ? (raw as FlyClawRecord[]) : []);
        } catch {
          console.warn('[flyclaw]', args[0], 'invalid JSON stdout');
          resolve([]);
        }
      },
    );
  });
}

function recordToLookup(
  r: FlyClawRecord,
  flightIata: string,
  date: string,
  opts?: { approximateSchedule?: boolean },
): FlightLookup | null {
  const depIata = (r.origin_iata ?? '').toUpperCase();
  const arrIata = (r.destination_iata ?? '').toUpperCase();
  if (!depIata || !arrIata) return null;

  const parsed = r.flight_number ? parseFlightIata(r.flight_number) : parseFlightIata(flightIata);
  const ap = getAirport(depIata);
  const bp = getAirport(arrIata);
  const distanceKm = ap && bp ? Math.round(haversineKm(ap, bp)) : undefined;
  const durationMin =
    r.duration_minutes && r.duration_minutes > 0
      ? r.duration_minutes
      : distanceKm
        ? flightDurationMinEst(distanceKm)
        : undefined;

  const dep: FlightEndpointInfo = {
    iata: depIata,
    scheduled: isoToLocalHHMM(r.scheduled_departure, ap?.lng),
    actual: isoToLocalHHMM(r.actual_departure, ap?.lng),
  };
  const arr: FlightEndpointInfo = {
    iata: arrIata,
    scheduled: isoToLocalHHMM(r.scheduled_arrival, bp?.lng),
    actual: isoToLocalHHMM(r.actual_arrival, bp?.lng),
  };

  return {
    source: 'flyclaw',
    flightNumber: (r.flight_number ?? flightIata).toUpperCase(),
    airlineIata: parsed?.airlineIata,
    date,
    dep,
    arr,
    durationMin,
    distanceKm,
    cruiseAltitudeM: distanceKm ? cruiseAltitudeM(distanceKm) : undefined,
    status: r.status || undefined,
    note: opts?.approximateSchedule
      ? '未找到该出发日的计划班次，已填入同航班最近一班的起降与时刻供参考，可自行修改。'
      : undefined,
  };
}

/**
 * 按航班号查：一次 FlyClaw（仅 FR24、无价格中继），本地按日期筛选。
 * 避免「带日期空结果再查一遍」的双倍耗时。
 */
async function queryFlyClawByFlight(
  flightIata: string,
  date: string,
): Promise<FlightLookup | null> {
  const records = await runFlyClaw([
    'query',
    '--flight',
    flightIata,
    '--fr24-only',
    '--no-relay',
    '-o',
    'json',
  ]);
  if (!records.length) return null;

  const exact = records.find((r) => dateOf(r.scheduled_departure) === date);
  if (exact) return recordToLookup(exact, flightIata, date);
  return recordToLookup(records[0], flightIata, date, { approximateSchedule: true });
}

/**
 * 通过 FlyClaw 按航线搜索（飞猪等）。
 * 需要本地 Python 3.11+ 及 tools/flyclaw/requirements.txt。
 */
export async function searchFlightsByRoute(
  from: string,
  to: string,
  date: string,
): Promise<FlightSearchResult[]> {
  const raw = await runFlyClaw([
    'search',
    '--from',
    from.toUpperCase(),
    '--to',
    to.toUpperCase(),
    '--date',
    date,
    '-o',
    'json',
  ]);

  return raw
    .map((r) => {
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
      } satisfies FlightSearchResult;
    })
    .filter((r) => r.flightNumber && r.depIata && r.arrIata);
}
