import type { Stop, TrainSummary } from '@railvista/shared';
import { resolveTelecode } from './stationIndex.js';
import { enrichStopsCoords, loadStationsGeo } from './geocode.js';
import { envInt, fetchWithTimeout, HttpTimeoutError, withDeadline } from './http.js';
import { trainCache } from './trainCache.js';
import { countMissingCoords, fillLocalCoords, geoVersion } from './stopsLocalGeo.js';
import { sliceStopsByOdNames } from './stopOdSlice.js';

/** 12306 常回整趟；按请求 OD 裁切并重标 seq/type */
function clampStopsToOd(stops: Stop[], fromName: string, toName: string): Stop[] {
  const sliced = sliceStopsByOdNames(stops, fromName, toName);
  if (!sliced || sliced.length < 2) return stops;
  return sliced.map((s, idx, arr) => ({
    ...s,
    seq: idx + 1,
    type: idx === 0 ? 'depart' : idx === arr.length - 1 ? 'arrive' : 'stop',
  }));
}

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
/** 北京时间今天（yyyy-MM-dd） */
function bjTodayYmd(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
/** 本地日期平移 N 天（yyyy-MM-dd，+08:00 基准） */
function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** 目标日期相对北京时间今天的天数（负=过去） */
function dayDiffFromToday(date: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00+08:00`) - Date.parse(`${bjTodayYmd()}T00:00:00+08:00`)) / 86400_000,
  );
}
/** 把 HH:MM(+dayOffset) 差格式化成 duration（HH:MM） */
function durationBetween(a: Stop, b: Stop): string {
  const mins = (s: Stop): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.departTime || s.arriveTime || "");
    if (!m) return null;
    return (s.dayOffset || 0) * 1440 + Number(m[1]) * 60 + Number(m[2]);
  };
  const ma = mins(a);
  const mb = mins(b);
  if (ma == null || mb == null) return "";
  const d = Math.max(mb - ma, 0);
  return `${String(Math.floor(d / 60)).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`;
}
/** attachAbsoluteTimes 后 departTime/arriveTime 是 ISO；UI/合成需要 HH:MM */
function isoToHm(v: string | null | undefined): string {
  return v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(11, 16) : '';
}

/** 直查行（真实余票行）优先，回溯行按 trainNo 补缺，按发车时刻排序 */
function mergeByTrainNo(direct: TrainSummary[], retro: TrainSummary[]): TrainSummary[] {
  const seen = new Set(direct.map((t) => t.trainNo));
  const out = [...direct, ...retro.filter((t) => !seen.has(t.trainNo))];
  out.sort((a, b) => a.departTime.localeCompare(b.departTime));
  return out;
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
  const geo = loadStationsGeo();
  const fromName = fromSt?.name || fromCode;
  const toName = toSt?.name || toCode;
  const fromGeo = geo[fromName] || geo[fromName.replace(/站$/, '')] || geo[fromCode];
  const toGeo = geo[toName] || geo[toName.replace(/站$/, '')] || geo[toCode];
  return {
    trainCode,
    trainNo,
    from: {
      name: fromName,
      telecode: fromCode,
      pinyin: fromSt?.pinyin || undefined,
      ...(fromGeo?.lng != null && fromGeo?.lat != null
        ? { lng: Number(fromGeo.lng), lat: Number(fromGeo.lat) }
        : {}),
    },
    to: {
      name: toName,
      telecode: toCode,
      pinyin: toSt?.pinyin || undefined,
      ...(toGeo?.lng != null && toGeo?.lat != null
        ? { lng: Number(toGeo.lng), lat: Number(toGeo.lat) }
        : {}),
    },
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

// ────────────────────────────── 车站大屏（wifi.12306.cn stoptime） ──────────────────────────────

/**
 * 车站大屏接口：返回车站在指定日期经停的全部车次（含已发车、售罄、票务列表不展示的车），
 * 等价于「车站大屏拉数据」，是当日已发车/历史日期候选枚举的完整数据源。
 * 限流较严（突发即 429）：请求经统一队列串行 + 最小间隔 + 退避重试，结果按站/日期缓存。
 */
interface BoardRow {
  trainNo: string;
  trainCode: string;
  startStationName: string;
  startStationCode: string;
  endStationName: string;
  endStationCode: string;
  arriveTime?: string;
  departTime?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 大屏时间 "1254" → "12:54"；非法返回空串 */
function boardHm(v: string | undefined): string {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(v || '');
  return m ? `${String(Number(m[1])).padStart(2, '0')}:${m[2]}` : '';
}

/** 大屏请求串行队列：保证请求间有最小间隔，避免触发限流 */
let boardChain: Promise<void> = Promise.resolve();
let boardLastAt = 0;
function boardThrottled<T>(fn: () => Promise<T>): Promise<T> {
  const task = boardChain.then(async () => {
    const wait = boardLastAt + 700 - Date.now();
    if (wait > 0) await sleep(wait);
    boardLastAt = Date.now();
    return fn();
  });
  boardChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function fetchBoardRowsUncached(stationCode: string, date: string): Promise<BoardRow[]> {
  const url =
    `https://wifi.12306.cn/wifiapps/ticket/api/stoptime/queryByStationCodeAndDate` +
    `?stationCode=${stationCode}&trainDate=${date}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await boardThrottled(() =>
        fetchWithTimeout(
          url,
          {
            headers: {
              'User-Agent': UA,
              Referer: 'https://www.12306.cn/',
              Accept: 'application/json',
            },
          },
          { timeoutMs: httpTimeoutMs(), label: '12306 车站大屏' },
        ),
      );
      if (res.status === 429) {
        throw Object.assign(new Error('车站大屏接口限流'), { code: 'RATE_LIMITED' });
      }
      if (!res.ok) {
        throw Object.assign(new Error(`车站大屏查询失败 HTTP ${res.status}`), { code: 'UPSTREAM_FAIL' });
      }
      const body = await withDeadline(res.json() as Promise<unknown>, httpTimeoutMs());
      if (body.value == null) {
        throw Object.assign(new HttpTimeoutError('12306 车站大屏', httpTimeoutMs()), {
          code: 'UPSTREAM_TIMEOUT',
        });
      }
      const json = body.value as { data?: BoardRow[] };
      const rows = Array.isArray(json.data) ? json.data : [];
      logMetric('board.upstream', { stationCode, date, rows: rows.length });
      return rows;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(1200 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : Object.assign(new Error('车站大屏查询失败'), { code: 'UPSTREAM_FAIL' });
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
  /** 按公开车次号（如 Z8991 / G87）查全程时刻表，返回经停序列与 12306 内部 trainNo */
  queryByCode(code: string, date: string): Promise<{ stops: Stop[]; trainNo: string }>;
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
    // 2026-10-19 已发车/历史回溯：目标日期 ≤ 今天时（过去日期 leftTicket 返回 HTML 错误页），
    // 改为「车站大屏候选 → 逐车按目标日期查经停」合成，retro 字段如实标注来源。
    // 实测：今天 leftTicket 列表只含此刻之后的车（已发车行不返回），所以今天不能只直查——
    // 必须直查（真实余票行）+ 大屏回溯（当日已发车/售罄车次）合并，按 trainNo 去重。
    if (dayDiffFromToday(date) === 0) {
      let direct: TrainSummary[] = [];
      try {
        direct = await this.fetchTrains(fromSt.telecode, toSt.telecode, date);
      } catch {
        /* 直查失败不致命，回溯兜底 */
      }
      const retroKey = `retro:${cacheKey}`;
      const retro = await trainCache.getOrLoad<TrainSummary[]>(
        retroKey,
        600,
        () => this.fetchRetroTrains(fromSt, toSt, date),
        { staleWhileRevalidate: swrEnabled(), negativeTtlSec: negativeTtlSec() },
      );
      const merged = mergeByTrainNo(direct, retro);
      logMetric('trains.search', {
        key: cacheKey,
        ms: Date.now() - t0,
        count: merged.length,
        direct: direct.length,
        retro: retro.length,
      });
      return merged;
    }
    if (dayDiffFromToday(date) < 0) {
      const retroKey = `retro:${cacheKey}`;
      return trainCache.getOrLoad<TrainSummary[]>(
        retroKey,
        7 * 86400,
        () => this.fetchRetroTrains(fromSt, toSt, date),
        { staleWhileRevalidate: swrEnabled(), negativeTtlSec: negativeTtlSec() },
      );
    }
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

  /** 车站大屏单站/单日：带限流重试的缓存封装，失败返回 null（不抛） */
  private async fetchBoardRows(stationCode: string, date: string): Promise<BoardRow[] | null> {
    const key = `board:${stationCode}:${date}`;
    const diff = dayDiffFromToday(date);
    const ttl = diff < 0 ? 7 * 86400 : diff === 0 ? 1800 : 3600;
    try {
      return await trainCache.getOrLoad<BoardRow[]>(key, ttl, () =>
        fetchBoardRowsUncached(stationCode, date), {
          staleWhileRevalidate: swrEnabled(),
          negativeTtlSec: 60,
        });
    } catch {
      return null;
    }
  }

  /**
   * 车站大屏交集枚举候选：X 站（目标日期）的全部经停车次 ∩ Y 站（目标日期 +0..3 天）的
   * 经停车次。交集即「目标日期从 X 出发、能到达 Y」的全部车次——含已发车、售罄、
   * 隔日开行（大屏按实际开行日列车，天然过滤当日停运车次）。
   * 返回 null = 大屏不可用（限流/故障），由调用方退化为余票列表并集。
   */
  private async boardCandidates(
    fromSt: { telecode: string; name: string },
    toSt: { telecode: string; name: string },
    date: string,
  ): Promise<TrainSummary[] | null> {
    const xRows = await this.fetchBoardRows(fromSt.telecode, date);
    if (!xRows?.length) return null;
    const ySets: Set<string>[] = [];
    for (let k = 0; k <= 3; k++) {
      const rows = await this.fetchBoardRows(toSt.telecode, shiftYmd(date, k));
      ySets.push(new Set((rows || []).map((r) => r.trainNo)));
    }
    const out: TrainSummary[] = [];
    const seen = new Set<string>();
    for (const r of xRows) {
      if (seen.has(r.trainNo)) continue;
      // 终到 X 的车没有发车时刻，不可能继续载客去 Y
      const departTime = boardHm(r.departTime);
      if (!departTime) continue;
      if (!ySets.some((s) => s.has(r.trainNo))) continue;
      seen.add(r.trainNo);
      out.push({
        trainCode: r.trainCode,
        trainNo: r.trainNo,
        from: { name: r.startStationName, telecode: r.startStationCode },
        to: { name: r.endStationName, telecode: r.endStationCode },
        departTime,
        arriveTime: boardHm(r.arriveTime),
        duration: '',
        date,
      });
    }
    return out;
  }

  /**
   * 已发车/历史日期的 OD 列表合成（leftTicket 对过去日期返回 HTML 错误页；今天列表只含
   * 此刻之后的车）。候选取两路并集后逐车按目标日期查经停回溯：
   * 1. 车站大屏交集（精确站，含已发车/售罄车次，按实际开行日过滤）；
   * 2. 「今天∪明天∪后天」余票列表并集——12306 对同城站做聚合（「上海」含上海虹桥等），
   *    补大屏精确站交集漏掉的同城站始发/终到车（如上海虹桥→北京南的 G 车）。
   * 两路都可能缺车（售罄列表不展示、隔日开行未被大屏/列表覆盖）——前端必须引导
   * 用户直接输车次号（queryByCode 过去日期实测可用，100% 真实数据）。
   */
  private async fetchRetroTrains(
    fromSt: { telecode: string; name: string },
    toSt: { telecode: string; name: string },
    date: string,
  ): Promise<TrainSummary[]> {
    const t0 = Date.now();
    const cands: TrainSummary[] = [];
    const seen = new Set<string>();
    const addAll = (trs: TrainSummary[]): void => {
      for (const tr of trs) {
        if (seen.has(tr.trainNo)) continue;
        seen.add(tr.trainNo);
        cands.push(tr);
      }
    };
    // 两路候选并行拉取（大屏走限流队列较慢，余票列表不受其拖累）
    const bases = [bjTodayYmd(), shiftYmd(bjTodayYmd(), 1), shiftYmd(bjTodayYmd(), 2)];
    const ticketTask = (async (): Promise<TrainSummary[]> => {
      const out: TrainSummary[] = [];
      for (const b of bases) {
        try {
          out.push(...(await this.fetchTrains(fromSt.telecode, toSt.telecode, b)));
        } catch {
          /* 单个候选日失败不致命 */
        }
      }
      return out;
    })();
    const board = await this.boardCandidates(fromSt, toSt, date);
    const ticket = await ticketTask;
    // 大屏候选优先（已确认当日开行），余票并集补缺（同城站聚合）
    addAll(board || []);
    addAll(ticket);
    const source = [board ? 'board' : '', ticket.length ? 'ticket' : ''].filter(Boolean).join('+') || 'none';
    if (!cands.length) return [];
    const pool = cands.slice(0, 100);
    const out: TrainSummary[] = [];
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (idx < pool.length) {
        const c = pool[idx++]!;
        try {
          const r = await this.retroOne(c, fromSt, toSt, date);
          if (r) out.push(r);
        } catch {
          /* 单车失败跳过 */
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, () => worker()));
    out.sort((a, b) => a.departTime.localeCompare(b.departTime));
    logMetric('retro.search', { ms: Date.now() - t0, source, cands: pool.length, hits: out.length });
    return out;
  }

  /**
   * 单车回溯：目标日期直查经停（czxx 过去/当日日期均可用）→ 空则按邻近日期同时刻表把
   * 绝对时刻平移到目标日期模拟（retro=simulated，如实降级）。
   * 返回 null = 该车不经停 OD 站或所有日期都拿不到时刻表。
   */
  private async retroOne(
    cand: TrainSummary,
    fromSt: { telecode: string; name: string },
    toSt: { telecode: string; name: string },
    date: string,
  ): Promise<TrainSummary | null> {
    const fromCode = cand.from.telecode || fromSt.telecode;
    const toCode = cand.to.telecode || toSt.telecode;
    // 依次尝试：目标日期 → +1 天 → -1 天 → 候选原日期（去重）
    const tryDates = [...new Set([date, shiftYmd(date, 1), shiftYmd(date, -1), cand.date])];
    let full: Stop[] | null = null;
    let retro: 'historical' | 'simulated' = 'historical';
    for (const d of tryDates) {
      let s: Stop[] | null = null;
      try {
        s = await this.fullStops(cand.trainNo, d, fromCode, toCode);
      } catch {
        continue;
      }
      if (s.length < 2) continue;
      if (d === date) {
        full = s;
      } else {
        // 目标日期上游无数据：按 d 日同时刻表平移模拟（HH:MM 保留，绝对时刻按目标日期重算）
        full = attachAbsoluteTimes(
          s.map((x) => ({
            ...x,
            at: undefined,
            arrive: undefined,
            depart: undefined,
            arriveTime: isoToHm(x.arriveTime),
            departTime: isoToHm(x.departTime),
          })),
          date,
        );
        retro = 'simulated';
      }
      break;
    }
    if (!full) return null;
    const sliced = sliceStopsByOdNames(full, fromSt.name, toSt.name);
    if (!sliced || sliced.length < 2) return null; // 该车不经停此 OD
    const first = sliced[0]!;
    const last = sliced[sliced.length - 1]!;
    // attachAbsoluteTimes 后 departTime/arriveTime 是 ISO；UI 需要 HH:MM
    const departTime = isoToHm(first.departTime) || isoToHm(first.arriveTime);
    const arriveTime = isoToHm(last.arriveTime) || isoToHm(last.departTime);
    if (!departTime || !arriveTime) return null;
    const startIso = first.depart || first.arrive || first.at || '';
    const endIso = last.arrive || last.depart || last.at || '';
    const minutes = Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000));
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    const duration = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return {
      trainCode: cand.trainCode,
      trainNo: cand.trainNo,
      from: cand.from,
      to: cand.to,
      departTime,
      arriveTime,
      duration,
      date,
      retro,
    };
  }

  /** 全程经停缓存（按 trainNo+日期，跨 OD 复用）：回溯合成逐车调用，避免重复冲击 12306 */
  private async fullStops(
    trainNo: string,
    date: string,
    fromCode: string,
    toCode: string,
  ): Promise<Stop[]> {
    const key = `fullstops:${trainNo}:${date}`;
    return trainCache.getOrLoad<Stop[]>(
      key,
      envInt('CACHE_TTL_STOPS_SEC', 10800),
      () => this.fetchStopsBase({ trainNo, date }, fromCode, toCode),
      { staleWhileRevalidate: swrEnabled(), negativeTtlSec: negativeTtlSec() },
    );
  }

  async getStops(query: StopsQuery): Promise<Stop[]> {
    const t0 = Date.now();
    const fromSt = resolveTelecode(query.from);
    const toSt = resolveTelecode(query.to);
    if (!fromSt || !toSt) throw Object.assign(new Error('车站无法识别'), { code: 'BAD_STATION' });

    const cacheKey = `stops:${query.trainNo}:${query.date}:${fromSt.telecode}:${toSt.telecode}`;
    const toOd = (rows: Stop[]) => clampStopsToOd(rows, query.from, query.to);

    // ── 缓存命中且坐标齐全 → 直接返回，不再重跑 enrich（原实现每次都重跑） ──
    const cached = trainCache.getWithAge<Stop[]>(cacheKey);
    if (cached) {
      const missing = countMissingCoords(cached.value);
      const versionChanged = stopsGeoVersion.get(cacheKey) !== geoVersion();
      if (missing === 0 && !versionChanged) {
        logMetric('stops.cacheHit', { key: cacheKey, ms: Date.now() - t0, missing });
        return toOd(cached.value);
      }
      // 坐标有缺口或坐标库已更新：带最后期限补齐，超时先用旧值
      const p = enrichStopsCoords(cached.value, { trainCode: query.trainCode }).then(toOd);
      settleEnrich(p, cacheKey);
      const r = await withDeadline(p, stopsEnrichDeadlineMs());
      logMetric('stops.cacheHitEnrich', {
        key: cacheKey,
        ms: Date.now() - t0,
        missing,
        timedOut: r.timedOut,
      });
      return r.value ?? toOd(cached.value);
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

    // 先按 OD 裁切再 enrich/回写，避免后台 settle 把整趟车写回 XNO→LSO 缓存
    const rawOd = toOd(raw);
    const p = enrichStopsCoords(rawOd, { trainCode: query.trainCode }).then(toOd);
    settleEnrich(p, cacheKey);
    const r = await withDeadline(p, stopsEnrichDeadlineMs());

    // 超时降级：先用本地坐标库能填的填上，远程补点继续在后台跑并回写缓存
    const final = r.value ?? toOd(fillLocalCoords(rawOd).rows);
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

  /**
   * 按公开车次号查全程时刻表。
   * 两步走：
   *   1. 12306 公开搜索服务（search.12306.cn，无需会话）按 keyword 命中候选，
   *      取"车次号精确相等"的一条，拿到内部 train_no 与首末站；
   *   2. 复用 kyfw czxx/queryByTrainNo 链路（fetchStopsBase）取完整经停序列，
   *      解析 / 坐标 / 绝对时间与 getStops 完全一致。
   * 注：搜索服务只覆盖预售期（约 15 天）内的开行日，超期自然返回 NOT_FOUND。
   */
  async queryByCode(code: string, date: string): Promise<{ stops: Stop[]; trainNo: string }> {
    const t0 = Date.now();
    const norm = code.trim().toUpperCase();
    if (!/^[A-Z]?\d{1,6}$/.test(norm)) {
      throw Object.assign(new Error('车次号格式不正确，例如 Z8991 或 G87'), { code: 'BAD_CODE' });
    }

    const cacheKey = `bycode:${norm}:${date}`;
    const cached = trainCache.getWithAge<{ stops: Stop[]; trainNo: string }>(cacheKey);
    if (cached) {
      logMetric('bycode.cacheHit', { key: cacheKey, ms: Date.now() - t0 });
      return cached.value;
    }

    try {
      const result = await this.fetchByCode(norm, date);
      trainCache.set(cacheKey, result, stopsTtlSec(result.stops));
      logMetric('bycode.fetch', { key: cacheKey, ms: Date.now() - t0, stops: result.stops.length });
      return result;
    } catch (e) {
      const err = e as Error & { code?: string };
      trainCache.setNegative(
        cacheKey,
        { code: err.code || 'UPSTREAM_FAIL', message: err.message || '车次查询失败' },
        negativeTtlSec(),
      );
      throw e;
    }
  }

  /** 第一步：公开搜索接口命中精确车次 → 内部 train_no + 首末站电码 */
  private async fetchByCode(
    code: string,
    date: string,
  ): Promise<{ stops: Stop[]; trainNo: string }> {
    const t0 = Date.now();
    const params = new URLSearchParams({ keyword: code, date: date.replaceAll('-', '') });
    const url = `https://search.12306.cn/search/v1/train/search?${params}`;
    const res = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': UA, Referer: 'https://www.12306.cn/' } },
      { timeoutMs: httpTimeoutMs(), label: '12306 车次号查询' },
    );
    if (!res.ok) {
      throw Object.assign(new Error(`车次号查询失败 HTTP ${res.status}`), { code: 'UPSTREAM_FAIL' });
    }
    const body = await withDeadline(res.json() as Promise<unknown>, httpTimeoutMs());
    if (body.value == null) {
      throw Object.assign(new HttpTimeoutError('12306 车次号查询', httpTimeoutMs()), {
        code: 'UPSTREAM_TIMEOUT',
      });
    }
    const json = body.value as {
      status?: boolean;
      data?: Array<{
        station_train_code?: string;
        train_no?: string;
        from_station?: string;
        to_station?: string;
      }>;
    };
    // keyword 会模糊命中 G87 → G870/G871 等一串，必须精确相等才算数
    const hit = (json.data || []).find(
      (r) => (r.station_train_code || '').toUpperCase() === code,
    );
    if (!hit?.train_no) {
      throw Object.assign(new Error('未查到该车次，请核对车次号与日期'), {
        code: 'NOT_FOUND',
      });
    }

    const fromSt = resolveTelecode(hit.from_station || '');
    const toSt = resolveTelecode(hit.to_station || '');
    if (!fromSt || !toSt) {
      throw Object.assign(new Error('车次首末站无法识别'), { code: 'BAD_STATION' });
    }

    // 第二步：与 getStops 共用同一条经停查询链路（kyfw czxx/queryByTrainNo）
    const stops = await this.fetchStopsBase({ trainNo: hit.train_no, date }, fromSt.telecode, toSt.telecode);
    logMetric('bycode.upstream', { ms: Date.now() - t0, stops: stops.length, trainNo: hit.train_no });
    return { stops, trainNo: hit.train_no };
  }

  /** 强制完整补坐标：忽略最后期限，等远程补点全部完成后再返回 */
  async enrichStopsNow(query: StopsQuery): Promise<Stop[]> {
    const t0 = Date.now();
    const fromSt = resolveTelecode(query.from);
    const toSt = resolveTelecode(query.to);
    if (!fromSt || !toSt) throw Object.assign(new Error('车站无法识别'), { code: 'BAD_STATION' });

    const cacheKey = `stops:${query.trainNo}:${query.date}:${fromSt.telecode}:${toSt.telecode}`;
    const toOd = (rows: Stop[]) => clampStopsToOd(rows, query.from, query.to);
    const cached = trainCache.getWithAge<Stop[]>(cacheKey);
    const base = toOd(
      cached?.value ?? (await this.fetchStopsBase(query, fromSt.telecode, toSt.telecode)),
    );
    const enriched = toOd(await enrichStopsCoords(base, { trainCode: query.trainCode }));
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
          stopoverMin: r.stopover_time && r.stopover_time !== '----' ? Number(r.stopover_time) : undefined,
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
