import type { Stop, TrainSummary } from '@railvista/shared';
import { cache } from './cache.js';
import { resolveTelecode } from './stationIndex.js';
import { enrichStopsCoords, loadStationsGeo } from './geocode.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const QUERY_PATHS = [
  '/otn/leftTicket/queryO',
  '/otn/leftTicket/queryG',
  '/otn/leftTicket/queryA',
  '/otn/leftTicket/queryZ',
  '/otn/leftTicket/query',
];

let cookieJar = '';

function enrichStopCoords(stop: Stop): Stop {
  const geo = loadStationsGeo();
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

async function ensureSession(): Promise<void> {
  const res = await fetch('https://kyfw.12306.cn/otn/leftTicket/init', {
    headers: {
      'User-Agent': UA,
      Referer: 'https://www.12306.cn/',
    },
    redirect: 'manual',
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  if (setCookie.length) {
    cookieJar = setCookie.map((c) => c.split(';')[0]).join('; ');
  } else {
    const raw = res.headers.get('set-cookie');
    if (raw) cookieJar = raw.split(',').map((c) => c.split(';')[0].trim()).join('; ');
  }
}

function parseDuration(raw: string): string {
  // 12306 duration often like "20:28" meaning hours:minutes
  return raw || '';
}

function parseTrainRow(raw: string, date: string): TrainSummary | null {
  const f = raw.split('|');
  // common leftTicket field indexes (community-known):
  // 2 secret, 3 train_no, 4 train_code, 6 from, 7 to, 8 start, 9 end,
  // 10 depart, 11 arrive, 12 duration, ...
  if (f.length < 30) return null;
  const trainNo = f[2];
  const trainCode = f[3];
  const fromCode = f[6];
  const toCode = f[7];
  const departTime = f[8];
  const arriveTime = f[9];
  const duration = parseDuration(f[10]);
  if (!trainCode || !trainNo || !fromCode || !toCode) return null;
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

export interface TrainDataSource {
  searchTrains(from: string, to: string, date: string): Promise<TrainSummary[]>;
  getStops(query: {
    trainNo: string;
    trainCode: string;
    from: string;
    to: string;
    date: string;
  }): Promise<Stop[]>;
}

export class Cr12306Source implements TrainDataSource {
  async searchTrains(from: string, to: string, date: string): Promise<TrainSummary[]> {
    const fromSt = resolveTelecode(from);
    const toSt = resolveTelecode(to);
    if (!fromSt || !toSt) throw Object.assign(new Error('车站无法识别'), { code: 'BAD_STATION' });

    const cacheKey = `trains:${fromSt.telecode}:${toSt.telecode}:${date}`;
    const cached = cache.get<TrainSummary[]>(cacheKey);
    if (cached) return cached;

    await ensureSession();
    const params = new URLSearchParams({
      'leftTicketDTO.train_date': date,
      'leftTicketDTO.from_station': fromSt.telecode,
      'leftTicketDTO.to_station': toSt.telecode,
      purpose_codes: 'ADULT',
    });

    let lastErr: unknown;
    for (const path of QUERY_PATHS) {
      try {
        const url = `https://kyfw.12306.cn${path}?${params}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': UA,
            Referer: 'https://kyfw.12306.cn/otn/leftTicket/init',
            Cookie: cookieJar,
          },
        });
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        const json = (await res.json()) as {
          data?: { result?: string[]; flag?: string };
          status?: boolean;
          c_url?: string;
        };
        const rows = json.data?.result;
        if (!rows?.length) {
          // empty may be valid
          if (json.status === false && json.c_url) continue;
          cache.set(cacheKey, [], Number(process.env.CACHE_TTL_TRAINS_SEC || 900));
          return [];
        }
        const trains = rows
          .map((r) => parseTrainRow(r, date))
          .filter((t): t is TrainSummary => !!t);
        cache.set(cacheKey, trains, Number(process.env.CACHE_TTL_TRAINS_SEC || 900));
        return trains;
      } catch (e) {
        lastErr = e;
      }
    }
    throw Object.assign(new Error(`12306 查询失败：${String(lastErr)}`), {
      code: 'UPSTREAM_FAIL',
    });
  }

  async getStops(query: {
    trainNo: string;
    trainCode: string;
    from: string;
    to: string;
    date: string;
  }): Promise<Stop[]> {
    const fromSt = resolveTelecode(query.from);
    const toSt = resolveTelecode(query.to);
    if (!fromSt || !toSt) throw Object.assign(new Error('车站无法识别'), { code: 'BAD_STATION' });

    const cacheKey = `stops:${query.trainNo}:${query.date}:${fromSt.telecode}:${toSt.telecode}`;
    const cached = cache.get<Stop[]>(cacheKey);
    if (cached?.length) {
      // 始终再 enrich：stations-geo / 区域锚点更新后要覆盖缓存里的飞点（如长白山旧南偏）
      const fixed = await enrichStopsCoords(cached, { trainCode: query.trainCode });
      cache.set(cacheKey, fixed, Number(process.env.CACHE_TTL_STOPS_SEC || 10800));
      return fixed;
    }

    await ensureSession();
    const params = new URLSearchParams({
      train_no: query.trainNo,
      from_station_telecode: fromSt.telecode,
      to_station_telecode: toSt.telecode,
      depart_date: query.date,
    });
    const url = `https://kyfw.12306.cn/otn/czxx/queryByTrainNo?${params}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://kyfw.12306.cn/otn/leftTicket/init',
        Cookie: cookieJar,
      },
    });
    if (!res.ok) {
      throw Object.assign(new Error(`经停查询失败 HTTP ${res.status}`), { code: 'UPSTREAM_FAIL' });
    }
    const json = (await res.json()) as {
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
    const stops: Stop[] = rows.map((r, idx) => {
      const arrive = r.arrive_time === '----' ? null : r.arrive_time;
      const depart = r.start_time === '----' ? null : r.start_time;
      let type: Stop['type'] = 'stop';
      if (idx === 0) type = 'depart';
      if (idx === rows.length - 1) type = 'arrive';
      return enrichStopCoords({
        seq: Number(r.station_no) || idx + 1,
        name: r.station_name,
        arriveTime: arrive,
        departTime: depart,
        type,
      });
    });

    // attach absolute ISO using query.date + day rollover
    const withIso = attachAbsoluteTimes(stops, query.date);
    const enriched = await enrichStopsCoords(withIso, { trainCode: query.trainCode });
    cache.set(cacheKey, enriched, Number(process.env.CACHE_TTL_STOPS_SEC || 10800));
    return enriched;
  }
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

export const trainSource: TrainDataSource = new Cr12306Source();
