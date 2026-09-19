import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../../../../data');
const cachePath = join(dataDir, 'station_name.cache.json');

export interface StationIndexItem {
  name: string;
  telecode: string;
  pinyin: string;
  short: string;
  city?: string;
}

let stations: StationIndexItem[] = [];
let byTelecode = new Map<string, StationIndexItem>();
let byName = new Map<string, StationIndexItem>();

const STATION_NAME_URL = 'https://kyfw.12306.cn/otn/resources/js/framework/station_name.js';

function parseStationNameJs(text: string): StationIndexItem[] {
  const m = text.match(/['"]([^'"]+)['"]/);
  const raw = m?.[1] || text;
  const parts = raw.split('@').filter(Boolean);
  const list: StationIndexItem[] = [];
  for (const part of parts) {
    const f = part.split('|');
    // format: short|name|telecode|pinyin|short2|id
    if (f.length < 4) continue;
    list.push({
      short: f[0],
      name: f[1],
      telecode: f[2],
      pinyin: f[3],
    });
  }
  return list;
}

function indexList(list: StationIndexItem[]) {
  stations = list;
  byTelecode = new Map(list.map((s) => [s.telecode, s]));
  byName = new Map(list.map((s) => [s.name, s]));
}

export async function loadStationIndex(force = false): Promise<void> {
  if (!force && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as {
        fetchedAt: number;
        stations: StationIndexItem[];
      };
      const age = Date.now() - (cached.fetchedAt || 0);
      if (cached.stations?.length && age < 7 * 24 * 3600 * 1000) {
        indexList(cached.stations);
        return;
      }
    } catch {
      /* refresh */
    }
  }

  try {
    const res = await fetch(STATION_NAME_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Referer: 'https://kyfw.12306.cn/otn/leftTicket/init',
      },
    });
    if (!res.ok) throw new Error(`station_name HTTP ${res.status}`);
    const text = await res.text();
    const list = parseStationNameJs(text);
    if (!list.length) throw new Error('empty station list');
    indexList(list);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({ fetchedAt: Date.now(), stations: list }),
      'utf8',
    );
  } catch (err) {
    if (stations.length) return;
    // minimal fallback from geo file names
    const geoPath = join(dataDir, 'stations-geo.json');
    if (existsSync(geoPath)) {
      const geo = JSON.parse(readFileSync(geoPath, 'utf8')) as Record<
        string,
        { name?: string; telecode?: string; lng: number; lat: number }
      >;
      const list: StationIndexItem[] = Object.entries(geo).map(([key, v]) => ({
        name: v.name || key,
        telecode: v.telecode || key,
        pinyin: '',
        short: '',
      }));
      indexList(list);
    }
    console.warn('[stationIndex] load failed, using fallback', err);
  }
}

export function suggestStations(q: string, limit = 20): StationIndexItem[] {
  const query = q.trim().toLowerCase();
  if (!query) return stations.slice(0, limit);
  const scored: { s: StationIndexItem; score: number }[] = [];
  for (const s of stations) {
    const name = s.name.toLowerCase();
    const py = s.pinyin.toLowerCase();
    const short = s.short.toLowerCase();
    const code = s.telecode.toLowerCase();
    let score = -1;
    if (name === query || code === query) score = 100;
    else if (name.startsWith(query)) score = 80;
    else if (short.startsWith(query) || py.startsWith(query)) score = 70;
    else if (name.includes(query)) score = 50;
    else if (py.includes(query) || short.includes(query)) score = 40;
    if (score >= 0) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.s);
}

export function resolveTelecode(fromOrCode: string): StationIndexItem | undefined {
  const q = fromOrCode.trim();
  if (byTelecode.has(q.toUpperCase())) return byTelecode.get(q.toUpperCase());
  if (byName.has(q)) return byName.get(q);
  // strip 站 suffix
  if (q.endsWith('站') && byName.has(q.slice(0, -1))) return byName.get(q.slice(0, -1));
  const hit = suggestStations(q, 1)[0];
  return hit;
}

export function getStationByTelecode(code: string): StationIndexItem | undefined {
  return byTelecode.get(code);
}
