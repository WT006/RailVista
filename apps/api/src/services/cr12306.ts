import type { Stop, TrainSummary } from '@railvista/shared';
import { resolveTelecode } from './stationIndex.js';
import { enrichStopsCoords, loadStationsGeo } from './geocode.js';
import { envInt, fetchWithTimeout, HttpTimeoutError, withDeadline } from './http.js';
import { trainCache } from './trainCache.js';
import { countMissingCoords, fillLocalCoords, geoVersion } from './stopsLocalGeo.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const INIT_URL = 'https://kyfw.12306.cn/otn/leftTicket/init';

/** 首选路径 + 备用路径（备用并发择优，不再 5 条串行试） */
const QUERY_PRIMARY = '/otn/leftTicket/queryO';
const QUERY_FALLBACKS = ['/otn/leftTicket/queryG', '/otn/leftTicket/queryA'];

// ────────────────────────────── 配置 ──────────────────────────────

/** 会话复用时长（秒） */
function sessionTtlSec(): number {
  return envInt('TRAIN_SESSION_TTL_SEC', 1500);
}
/** 单条 12306 请求超时（毫秒） */
function httpTimeoutMs(): number {
  return envInt('TRAIN_HTTP_TIMEOUT_MS', 4000);
}
/** 经停坐标补全的最后期限（毫秒）：超时先返回时刻表，远程补点转后台 */
function stopsEnrichDeadlineMs(): number {
  return envInt('STOPS_ENRICH_DEADLINE_MS', 1500);
}
/** 失败负缓存时长（秒） */
function negativeTtlSec(): number {
  return envInt('NEG_CACHE_TTL_SEC', 30);
}
function swrEnabled(): boolean {
  const v = String(process.env.TRAIN_SWR ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}
/** 车次缓存 TTL：按出发日期远近分层 */
function trainsTtlSec(date: string): number {
  const override = Number(process.env.CACHE_TTL_TRAINS_SEC || 0);
  if (override > 0) return override;
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const diffMs = Date.parse(`${date}T00:00:00+08:00`) - Date.parse(`${today}T00:00:00+08:00`);
  const days = Math.round(diffMs / 86400_000);
  if (!Number.isFinite(days)) return 900;
  if (days <= 1) return 300;
  if (days <= 7) return 900;
  return 3600;
}
/** 经停缓存 TTL：坐标不全时缩短，便于尽快重试补齐 */
function stopsTtlSec(stops: Stop[]): number {
  const base = envInt('CACHE_TTL_STOPS_SEC', 10800);
  return countMissingCoords(stops) > 0 ? Math.min(base, 300) : base;
}

// ────────────────────────────── 可观测性 ──────────────────────────────

function logMetric(name: string, data: Record<string, unknown>): void {
  console.log(`[metric] ${name} ${JSON.stringify(data)}`);
}

// ────────────────────────────── 会话（复用 + in-flight 去重） ──────────────────────────────

let sessionCookie = '';
let sessionExpiresAt = 0;
let sessionInflight: Promise<void> | null = null;

function dropSession(): void {
  sessionCookie = '';
  sessionExpiresAt = 0;
}

function applyCookies(res: Response): void {
  const setCookie = res.headers.getSetCookie?.() || [];
  if (setCookie.length) {
    sessionCookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  } else {
    const raw = res.headers.get('set-cookie');
    if (raw) sessionCookie = raw.split(',').map((c) => c.split(';')[0].trim()).join('; ');
  }
  sessionExpiresAt = Date.now() + sessionTtlSec() * 1000;
}

async function ensureSession(force = false): Promise<void> {
  const now = Date.now();
  if (!force && sessionCookie && now < sessionExpiresAt) return;

  // 并发请求共享同一次建会话，避免 N 个请求各建一次
  if (sessionInflight) {
    await sessionInflight.catch(() => undefined);
    if (!force && sessionCookie && Date.now() < sessionExpiresAt) return;
  }

  const task = (async () => {
    const res = await fetchWithTimeout(
      INIT_URL,
      { headers: { 'User-Agent': UA, Referer: 'https://www.12306.cn/' }, redirect: 'manual' },
      { timeoutMs: httpTimeoutMs(), label: '12306 会话建立' },
    );
    applyCookies(res);
  })();

  sessionInflight = task;
  try {
    await task;
  } finally {
    if (sessionInflight === task) sessionInflight = null;
  }
}

function authHeaders(): Record<string, string> {
  return {
    'User-Agent': UA,
    Referer: 'https://kyfw.12306.cn/otn/leftTicket/init',
    Cookie: sessionCookie,
  };
}

// ────────────────────────────── 解析 ──────────────────────────────

let droppedRows = 0;

function parseDuration(raw: string): string {
  // 12306 duration often like "20:28" meaning hours:minutes
  return raw || '';
}

function enrichStopCoords(stop: Stop, geo: ReturnType<typeof loadStationsGeo>): Stop {
  const byName = geo[stop.name] || geo[stop.name.replace(/站$/, '')];
  if (byName) {
    return { ...stop, lng: byName.lng, lat: byName.lat, telecode: stop.telecode || byName.telecode };
  }
  if (stop.telecode && geo[stop.telecode]) {
    const g = geo[stop.telecode];
    return { ...stop, lng: g.lng, lat: g.lat, name: stop.name || g.name || stop.name };
  }
  return stop;
}

function parseTrainRow(raw: string, date: string): TrainSummary | null {
  const f = raw.split('|');
  // common leftTicket field indexes (community-known):
  // 2 secret, 3 train_no, 4 train_code, 6 from, 7 to, 8 start, 9 end,
  // 10 depart, 11 arrive, 12 duration, ...
  if (f.length < 30) {
    droppedRows += 1;
    return null;
  }
  const trainNo = f[2];
  const trainCode = f[3];
  const fromCode = f[6];
  const toCode = f[7];
  const departTime = f[8];
  const arriveTime = f[9];
  const duration = parseDuration(f[10]);
  if (!trainCode || !trainNo || !fromCode || !toCode) {
    droppedRows += 1;
    return null;
  }
  const fromSt = resolveTelecode(fromCode);
  const toSt = resolveTelecode(toCode);
  return {
    trainCode,
    trainNo,
    from: { name: fromSt?.name || fromCode, telecode: fromCode },
    to: { name: toSt?.name || toCode, telecode: toCode },
    departTime,
    arriveTime,
    duration,
    date,
  };
}

function attachAbsoluteTimes(stops: Stop[], date: string): Stop[] {
  let day = 0;
  let lastMin = -1;
  return stops.map((s, idx) => {
    const toIso = (hm: string | null, bumpIfBefore: boolean): string | null => {
      if (!hm || !/^\d{1,2}:\d{2}$/.test(hm)) return hm;
      const [h, m] = hm.split(':').map(Number);
      const mins = h * 60 + m;
      if (bumpIfBefore && lastMin >= 0 && mins < lastMin) day += 1;
      lastMin = mins;
      const d = new Date(`${date}T00:00:00+08:00`);
      d.setDate(d.getDate() + day);
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${y}-${mo}-${da}T${hm.padStart(5, '0')}:00+08:00`;
    };

    const arriveIso = toIso(s.arriveTime, idx > 0);
    const departIso = toIso(s.departTime, true);
    const at =
      s.type === 'depart'
        ? departIso || arriveIso
        : s.type === 'arrive'
          ? arriveIso || departIso
          : undefined;

    return {
      ...s,
      arriveTime: arriveIso,
      departTime: departIso,
      arrive: arriveIso || undefined,
      depart: departIso || undefined,
      at: at || undefined,
      dayOffset: day,
    };
  });
}

// ────────────────────────────── 数据源 ──────────────────────────────

export interface StopsQuery {
  trainNo: string;
  trainCode: string;
  from: string;
  to: string;
  date: string;
}

export interface TrainDataSource {
  searchTrains(from: string, to: string, date: string): Promise<TrainSummary[]>;
  getStops(query: StopsQuery): Promise<Stop[]>;
  /** 强制完整补全坐标（无最后期限），供「重新发车」/手动重试 */
  enrichStopsNow(query: StopsQuery): Promise<Stop[]>;
}

/** 缓存项对应的坐标库版本：坐标库一变，缓存自动失效（替代"每次都重跑 enrich"） */
const stopsGeoVersion = new Map<string, string>();
/** 后台补坐标去重 */
const enrichInflight = new Set<string>();

function settleEnrich(p: Promise<Stop[]>, cacheKey: string): void {
  if (enrichInflight.has(cacheKey)) return;
  enrichInflight.add(cacheKey);
  p.then((v) => {
    trainCache.set(cacheKey, v, stopsTtlSec(v));
    stopsGeoVersion.set(cacheKey, geoVersion());
    logMetric('stops.enrich.settled', { key: cacheKey, missing: countMissingCoords(v) });
  })
    .catch((e) => {
      console.warn('[cr12306] 后台补坐标失败', e instanceof Error ? e.message : e);
    })
    .finally(() => {
      enrichInflight.delete(cacheKey);
    });
}

export class Cr12306Source implements TrainDataSource {
  async searchTrains(from: string, to: string, date: string): Promise<TrainSummary[]> {
    const t0 = Date.now();
    const fromSt = resolveTelecode(from);
    const toSt = resolveTelecode(to);
    if (!fromSt || !toSt) throw Object.assign(new Error('车站无法识别'), { code: 'BAD_STATION' });

    const cacheKey = `trains:${fromSt.telecode}:${toSt.telecode}:${date}`;
    const trains = await trainCache.getOrLoad<TrainSummary[]>(
      cacheKey,
      trainsTtlSec(date),
      () => this.fetchTrains(fromSt.telecode, toSt.telecode, date),
      { staleWhileRevalidate: swrEnabled(), negativeTtlSec: negativeTtlSec() },
    );
    logMetric('trains.search', { key: cacheKey, ms: Date.now() - t0, count: trains.length });
    return trains;
  }

  /** 上游车次请求（含超时 + 并发择优） */
  private async fetchTrains(fromCode: string, toCode: string, date: string): Promise<TrainSummary[]> {
    const t0 = Date.now();
    await ensureSession();
    const params = new URLSearchParams({
      'leftTicketDTO.train_date': date,
      'leftTicketDTO.from_station': fromCode,
      'leftTicketDTO.to_station': toCode,
      purpose_codes: 'ADULT',
    });

    const { rows, path } = await probeQuery(params);
    if (!rows.length) {
      logMetric('trains.upstream', { path, ms: Date.now() - t0, rows: 0 });
      return [];
    }
    const trains = rows.map((r) => parseTrainRow(r, date)).filter((t): t is TrainSummary => !!t);
    logMetric('trains.upstream', {
      path,
      ms: Date.now() - t0,
      rows: rows.length,
      parsed: trains.length,
      dropped: droppedRows,
    });
    return trains;
  }

  async getStops(query: StopsQuery): Promise<Stop[]> {
    const t0 = Date.now();
    const fromSt = resolveTelecode(query.from);
    const toSt = resolveTelecode(query.to);
    if (!fromSt || !toSt) throw Object.assign(new Error('车站无法识别'), { code: 'BAD_STATION' });

    const cacheKey = `stops:${query.trainNo}:${query.date}:${fromSt.telecode}:${toSt.telecode}`;

    // ── 缓存命中且坐标齐全 → 直接返回，不再重跑 enrich（原实现每次都重跑） ──
    const cached = trainCache.getWithAge<Stop[]>(cacheKey);
    if (cached) {
      const missing = countMissingCoords(cached.value);
      const versionChanged = stopsGeoVersion.get(cacheKey) !== geoVersion();
      if (missing === 0 && !versionChanged) {
        logMetric('stops.cacheHit', { key: cacheKey, ms: Date.now() - t0, missing });
        return cached.value;
      }
      // 坐标有缺口或坐标库已更新：带最后期限补齐，超时先用旧值
      const p = enrichStopsCoords(cached.value, { trainCode: query.trainCode });
      settleEnrich(p, cacheKey);
      const r = await withDeadline(p, stopsEnrichDeadlineMs());
      logMetric('stops.cacheHitEnrich', {
        key: cacheKey,
        ms: Date.now() - t0,
        missing,
        timedOut: r.timedOut,
      });
      return r.value ?? cached.value;
    }

    // ── 冷启动：先拿时刻表，坐标补全带最后期限 ──
    let raw: Stop[];
    try {
      raw = await this.fetchStopsBase(query, fromSt.telecode, toSt.telecode);
    } catch (e) {
      const err = e as Error & { code?: string };
      trainCache.setNegative(
        cacheKey,
        { code: err.code || 'UPSTREAM_FAIL', message: err.message || '经停查询失败' },
        negativeTtlSec(),
      );
      throw e;
    }

    const p = enrichStopsCoords(raw, { trainCode: query.trainCode });
    settleEnrich(p, cacheKey);
    const r = await withDeadline(p, stopsEnrichDeadlineMs());

    // 超时降级：先用本地坐标库能填的填上，远程补点继续在后台跑并回写缓存
    const final = r.value ?? fillLocalCoords(raw).rows;
    trainCache.set(cacheKey, final, stopsTtlSec(final));
    stopsGeoVersion.set(cacheKey, geoVersion());
    logMetric('stops.fetch', {
      key: cacheKey,
      ms: Date.now() - t0,
      stops: final.length,
      missing: countMissingCoords(final),
      timedOut: r.timedOut,
    });
    return final;
  }

  /** 强制完整补坐标：忽略最后期限，等远程补点全部完成后再返回 */
  async enrichStopsNow(query: StopsQuery): Promise<Stop[]> {
    const t0 = Date.now();
    const fromSt = resolveTelecode(query.from);
    const toSt = resolveTelecode(query.to);
    if (!fromSt || !toSt) throw Object.assign(new Error('车站无法识别'), { code: 'BAD_STATION' });

    const cacheKey = `stops:${query.trainNo}:${query.date}:${fromSt.telecode}:${toSt.telecode}`;
    const cached = trainCache.getWithAge<Stop[]>(cacheKey);
    const base =
      cached?.value ?? (await this.fetchStopsBase(query, fromSt.telecode, toSt.telecode));
    const enriched = await enrichStopsCoords(base, { trainCode: query.trainCode });
    trainCache.set(cacheKey, enriched, stopsTtlSec(enriched));
    stopsGeoVersion.set(cacheKey, geoVersion());
    logMetric('stops.enrichNow', {
      key: cacheKey,
      ms: Date.now() - t0,
      missing: countMissingCoords(enriched),
    });
    return enriched;
  }

  /** 12306 经停查询（带超时） */
  private async fetchStopsBase(
    query: { trainNo: string; date: string },
    fromCode: string,
    toCode: string,
  ): Promise<Stop[]> {
    const t0 = Date.now();
    await ensureSession();
    const params = new URLSearchParams({
      train_no: query.trainNo,
      from_station_telecode: fromCode,
      to_station_telecode: toCode,
      depart_date: query.date,
    });
    const url = `https://kyfw.12306.cn/otn/czxx/queryByTrainNo?${params}`;
    const res = await fetchWithTimeout(
      url,
      { headers: authHeaders() },
      { timeoutMs: httpTimeoutMs(), label: '12306 经停查询' },
    );
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) dropSession();
      throw Object.assign(new Error(`经停查询失败 HTTP ${res.status}`), { code: 'UPSTREAM_FAIL' });
    }
    const body = await withDeadline(res.json() as Promise<unknown>, httpTimeoutMs());
    if (body.value == null) {
      throw Object.assign(new HttpTimeoutError('12306 经停查询', httpTimeoutMs()), {
        code: 'UPSTREAM_TIMEOUT',
      });
    }
    const json = body.value as {
      data?: {
        data?: Array<{
          station_name: string;
          arrive_time: string;
          start_time: string;
          stopover_time: string;
          station_no: string;
        }>;
      };
    };
    const rows = json.data?.data || [];
    const geo = loadStationsGeo();
    const stops: Stop[] = rows.map((r, idx) => {
      const arrive = r.arrive_time === '----' ? null : r.arrive_time;
      const depart = r.start_time === '----' ? null : r.start_time;
      let type: Stop['type'] = 'stop';
      if (idx === 0) type = 'depart';
      if (idx === rows.length - 1) type = 'arrive';
      return enrichStopCoords(
        {
          seq: Number(r.station_no) || idx + 1,
          name: r.station_name,
          arriveTime: arrive,
          departTime: depart,
          type,
        },
        geo,
      );
    });
    logMetric('stops.upstream', { ms: Date.now() - t0, stops: stops.length });
    return attachAbsoluteTimes(stops, query.date);
  }
}

// ────────────────────────────── 路径探测：并发择优 ──────────────────────────────

async function queryOnce(path: string, params: URLSearchParams): Promise<string[]> {
  const url = `https://kyfw.12306.cn${path}?${params}`;
  const res = await fetchWithTimeout(
    url,
    { headers: authHeaders() },
    { timeoutMs: httpTimeoutMs(), label: '12306 车次查询' },
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) dropSession();
    throw new Error(`HTTP ${res.status}`);
  }
  const body = await withDeadline(res.json() as Promise<unknown>, httpTimeoutMs());
  if (body.value == null) {
    throw Object.assign(new HttpTimeoutError('12306 车次查询', httpTimeoutMs()), {
      code: 'UPSTREAM_TIMEOUT',
    });
  }
  const json = body.value as { data?: { result?: string[] }; status?: boolean; c_url?: string };
  const rows = json.data?.result;
  if (!rows?.length) {
    // 空结果可能是合法的（该 OD 无直达车）；只有明确的重定向标记才视为失败
    if (json.status === false && json.c_url) throw new Error('12306 返回重定向标记');
    return [];
  }
  return rows;
}

async function probeQuery(params: URLSearchParams): Promise<{ rows: string[]; path: string }> {
  let lastErr: unknown;
  try {
    const rows = await queryOnce(QUERY_PRIMARY, params);
    return { rows, path: QUERY_PRIMARY };
  } catch (e) {
    lastErr = e;
  }
  // 首选失败：备用路径并发择优，谁先成功用谁（原实现是最多 5 条串行）
  try {
    return await Promise.any(
      QUERY_FALLBACKS.map(async (path) => ({ rows: await queryOnce(path, params), path })),
    );
  } catch {
    const err = lastErr as Error & { code?: string };
    throw Object.assign(new Error(`12306 查询失败：${String(lastErr)}`), {
      code: err?.code || 'UPSTREAM_FAIL',
    });
  }
}

export const trainSource: TrainDataSource = new Cr12306Source();
