import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cache } from './cache.js';

type Point = { lng: number; lat: number };

const __dirname = dirname(fileURLToPath(import.meta.url));
const geoPath = join(__dirname, '../../../../data/stations-geo.json');

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
/** 选车后补坐标不能拖太久；失败则用地图站点折线兜底 */
const OVERPASS_TIMEOUT_MS = 12000;
const NOMINATIM_TIMEOUT_MS = 6000;
const NOMINATIM_MAX = 4;

let geoFileCache: Record<string, { name?: string; telecode?: string; lng: number; lat: number }> | null =
  null;
let geoDirty = false;
let geoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let geoMtimeMs = -1;

function normalizeStationName(name: string): string {
  return name.replace(/站$/, '').trim();
}

export function loadStationsGeo(): Record<
  string,
  { name?: string; telecode?: string; lng: number; lat: number }
> {
  if (existsSync(geoPath)) {
    try {
      const mtime = Number(statSync(geoPath).mtimeMs);
      if (geoFileCache && mtime === geoMtimeMs) return geoFileCache;
      geoFileCache = JSON.parse(readFileSync(geoPath, 'utf8'));
      geoMtimeMs = mtime;
      return geoFileCache!;
    } catch {
      /* fall through */
    }
  }
  if (!geoFileCache) geoFileCache = {};
  return geoFileCache;
}

function lookupLocalGeo(name: string): Point | null {
  const geo = loadStationsGeo();
  const key = normalizeStationName(name);
  const hit = geo[name] || geo[key] || geo[`${key}站`];
  if (hit?.lng != null && hit?.lat != null) return { lng: hit.lng, lat: hit.lat };
  return null;
}

function schedulePersistGeo() {
  if (!geoDirty) return;
  if (geoSaveTimer) return;
  geoSaveTimer = setTimeout(() => {
    geoSaveTimer = null;
    if (!geoDirty || !geoFileCache) return;
    try {
      writeFileSync(geoPath, JSON.stringify(geoFileCache, null, 0), 'utf8');
      geoDirty = false;
      console.log(`[geocode] persisted ${Object.keys(geoFileCache).length} stations → stations-geo.json`);
    } catch (e) {
      console.warn('[geocode] persist failed', e);
    }
  }, 800);
}

function rememberGeo(name: string, point: Point) {
  const key = normalizeStationName(name);
  if (!key) return;
  const geo = loadStationsGeo();
  if (geo[key]?.lng === point.lng && geo[key]?.lat === point.lat) return;
  geo[key] = { name: key, lng: point.lng, lat: point.lat };
  geoFileCache = geo;
  geoDirty = true;
  cache.set(`geo:osm:${key}`, point, 7 * 24 * 3600);
  schedulePersistGeo();
}

async function overpassStationsByNames(names: string[]): Promise<Map<string, Point>> {
  const unique = [...new Set(names.map(normalizeStationName).filter(Boolean))];
  const found = new Map<string, Point>();
  if (!unique.length) return found;

  // China-ish bbox to reduce noise
  const bbox = '18,73,54,135';
  const clauses = unique
    .flatMap((n) => {
      const withStation = n.endsWith('站') ? n : `${n}站`;
      return [
        `node["railway"="station"]["name"="${n}"](${bbox});`,
        `node["railway"="station"]["name"="${withStation}"](${bbox});`,
        `node["railway"="station"]["name:zh"="${n}"](${bbox});`,
        `node["railway"="station"]["name:zh"="${withStation}"](${bbox});`,
        `node["railway"="halt"]["name"="${n}"](${bbox});`,
        `node["public_transport"="station"]["name"="${n}"](${bbox});`,
      ];
    })
    .join('\n');

  const query = `
[out:json][timeout:10];
(
${clauses}
);
out center;
`.trim();

  let lastErr: unknown;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'RailVista/0.1 (station geocode)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as {
        elements?: Array<{
          type: string;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }>;
      };
      for (const el of json.elements || []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        const tagName = el.tags?.['name:zh'] || el.tags?.name || '';
        const key = normalizeStationName(tagName);
        if (!key) continue;
        if (!found.has(key)) found.set(key, { lng: lon, lat });
      }
      return found;
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn('[geocode] overpass batch failed/timeout', lastErr);
  return found;
}

async function nominatimStation(name: string): Promise<Point | null> {
  const q = name.endsWith('站') ? name : `${name}站`;
  const qs = new URLSearchParams({
    q,
    format: 'json',
    limit: '1',
    countrycodes: 'cn',
  });
  try {
    const res = await fetch(`${NOMINATIM}?${qs}`, {
      headers: {
        'User-Agent': 'RailVista/0.1 (educational railway map)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ lon: string; lat: string }>;
    const hit = json[0];
    if (!hit) return null;
    const lng = Number(hit.lon);
    const lat = Number(hit.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat };
  } catch {
    return null;
  }
}

export async function geocodeStation(name: string): Promise<Point | null> {
  if (!name) return null;
  const key = `geo:osm:${normalizeStationName(name)}`;
  const cached = cache.get<Point>(key);
  if (cached) return cached;

  const local = lookupLocalGeo(name);
  if (local) {
    cache.set(key, local, 7 * 24 * 3600);
    return local;
  }

  const batch = await overpassStationsByNames([name]);
  const hit = batch.get(normalizeStationName(name));
  if (hit) {
    rememberGeo(name, hit);
    return hit;
  }

  const nom = await nominatimStation(name);
  if (nom) {
    rememberGeo(name, nom);
    return nom;
  }
  return null;
}

export async function enrichStopsCoords<
  T extends { name: string; lng?: number; lat?: number },
>(stops: T[]): Promise<T[]> {
  const out: T[] = stops.map((s) => {
    if (s.lng != null && s.lat != null && Number.isFinite(s.lng) && Number.isFinite(s.lat)) {
      return s;
    }
    const local = lookupLocalGeo(s.name);
    if (local) {
      rememberGeo(s.name, local);
      return { ...s, lng: local.lng, lat: local.lat };
    }
    const mem = cache.get<Point>(`geo:osm:${normalizeStationName(s.name)}`);
    if (mem) return { ...s, lng: mem.lng, lat: mem.lat };
    return s;
  });

  const missing = out.filter(
    (s) => s.lng == null || s.lat == null || !Number.isFinite(s.lng) || !Number.isFinite(s.lat),
  );
  if (!missing.length) return out;

  const batch = await overpassStationsByNames(missing.map((s) => s.name));
  const still: T[] = [];
  const result = out.map((s) => {
    if (s.lng != null && s.lat != null && Number.isFinite(s.lng) && Number.isFinite(s.lat)) {
      return s;
    }
    const key = normalizeStationName(s.name);
    const point = batch.get(key) || null;
    if (point) {
      rememberGeo(s.name, point);
      return { ...s, lng: point.lng, lat: point.lat };
    }
    still.push(s);
    return s;
  });

  // 优先补全行程首末站（避免沪昆西段缺坐标导致截断到长沙）
  const endpointNames = new Set(
    [result[0]?.name, result[result.length - 1]?.name]
      .filter(Boolean)
      .map((n) => normalizeStationName(String(n))),
  );
  const stillSorted = [...still].sort((a, b) => {
    const ae = endpointNames.has(normalizeStationName(a.name)) ? 0 : 1;
    const be = endpointNames.has(normalizeStationName(b.name)) ? 0 : 1;
    return ae - be;
  });
  const toNom = stillSorted.slice(0, Math.max(NOMINATIM_MAX, endpointNames.size));
  if (toNom.length) {
    const nomHits = await Promise.all(
      toNom.map(async (s) => {
        const point = await nominatimStation(s.name);
        return point ? { name: s.name, point } : null;
      }),
    );
    const byName = new Map(
      nomHits.filter(Boolean).map((h) => [normalizeStationName(h!.name), h!.point] as const),
    );
    for (const hit of nomHits) {
      if (hit) rememberGeo(hit.name, hit.point);
    }
    return result.map((s) => {
      if (s.lng != null && s.lat != null && Number.isFinite(s.lng) && Number.isFinite(s.lat)) {
        return s;
      }
      const point = byName.get(normalizeStationName(s.name));
      return point ? { ...s, lng: point.lng, lat: point.lat } : s;
    });
  }

  return result;
}
