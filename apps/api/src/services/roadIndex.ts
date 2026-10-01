/**
 * 万里路书 · 全国公路旅游网 —— 公路搜索服务（PRD §4：四类索引统一入口）。
 *
 *   kind=place    地名：本地锚点 data/roads/places-geo.json（运行时 geocode 会回写）
 *   kind=road     公路编号：L0 索引（国道/高速/省道）
 *   kind=spot     景点：公路侧景点库 roadside-spots.json
 *   kind=facility 服务区/互通/收费站：data/roads/facilities.json（Overpass 预抓）
 *
 * 降级链（照抄 geocode.ts 的容错风格）：本地命中 → 不请求网络；未命中 →
 * 高德 geocode（AMAP_KEY，GCJ-02 转 WGS-84）→ Nominatim → null（前端提示点地图选点）。
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gcj02ToWgs84 } from '@railvista/shared';
import type { PlaceHit, PlaceKind, RoadIndexEntry } from '@railvista/shared';
import { loadRoadIndex } from './roadNetwork.js';
import { getRoadsideSpots } from './roadsideSpots.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLACES_PATH = join(__dirname, '../../../../data/roads/places-geo.json');
const FACILITIES_PATH = join(__dirname, '../../../../data/roads/facilities.json');

// ── 地名锚点 ─────────────────────────────────────────────────────────────────
export interface PlaceAnchor {
  name: string;
  lng: number;
  lat: number;
  province?: string;
  level?: 'province' | 'city' | 'county';
}

interface PlacesFile {
  version: number;
  updated: string;
  places: PlaceAnchor[];
}

let placesCache: { mtime: number; places: PlaceAnchor[] } | null = null;
let placesDirty = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function loadPlaces(): PlaceAnchor[] {
  if (!existsSync(PLACES_PATH)) return [];
  try {
    const mtime = statSync(PLACES_PATH).mtimeMs;
    if (placesCache && placesCache.mtime === mtime) return placesCache.places;
    const file = JSON.parse(readFileSync(PLACES_PATH, 'utf8')) as PlacesFile;
    placesCache = { mtime, places: Array.isArray(file.places) ? file.places : [] };
    return placesCache.places;
  } catch {
    return [];
  }
}

/** 运行时 geocode 命中回写（防抖 800ms，best-effort；PRD 附录 A6：此文件被改写属正常） */
function rememberPlace(anchor: PlaceAnchor): void {
  const places = loadPlaces();
  if (places.some((p) => p.name === anchor.name)) return;
  places.push(anchor);
  placesDirty = true;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!placesDirty) return;
    placesDirty = false;
    try {
      writeFileSync(
        PLACES_PATH,
        JSON.stringify({ version: 1, updated: new Date().toISOString().slice(0, 10), places }, null, 1),
        'utf8',
      );
    } catch {
      /* best-effort */
    }
  }, 800);
}

// ── 设施（服务区/互通/收费站，Overpass 预抓 + 名录核对） ─────────────────────
interface Facility {
  id: string;
  name: string;
  lng: number;
  lat: number;
  kind: 'service-area' | 'junction' | 'tollgate';
  road?: string;
}

let facilitiesCache: Facility[] | null = null;

function loadFacilities(): Facility[] {
  if (facilitiesCache) return facilitiesCache;
  if (!existsSync(FACILITIES_PATH)) {
    facilitiesCache = [];
    return facilitiesCache;
  }
  try {
    const file = JSON.parse(readFileSync(FACILITIES_PATH, 'utf8')) as { facilities?: Facility[] };
    facilitiesCache = Array.isArray(file.facilities) ? file.facilities : [];
  } catch {
    facilitiesCache = [];
  }
  return facilitiesCache;
}

// ── 打分（PRD §4.1） ─────────────────────────────────────────────────────────
function scoreText(q: string, text: string): number {
  if (!text) return 0;
  if (text === q) return 100;
  if (text.startsWith(q)) return 80;
  if (text.includes(q)) return 50;
  return 0;
}

function suggestPlacesOfKind(q: string, kind: PlaceKind, limit: number): PlaceHit[] {
  const hits: PlaceHit[] = [];
  if (kind === 'place') {
    for (const p of loadPlaces()) {
      const score = scoreText(q, p.name);
      if (!score) continue;
      hits.push({
        kind: 'place',
        id: p.name,
        name: p.name,
        sub: [p.province, p.level === 'province' ? '省级' : p.level === 'city' ? '地级市' : '县级'].filter(Boolean).join(' · ') || '地名',
        lng: p.lng,
        lat: p.lat,
        score,
      });
    }
  } else if (kind === 'road') {
    for (const r of loadRoadIndex().entries as RoadIndexEntry[]) {
      const refScore = r.ref === q ? 100 : r.ref.startsWith(q) ? 85 : 0;
      const nameScore = r.name ? scoreText(q, r.name) * 0.6 : 0; // 中文名（沪聂线）60%
      const odScore = `${r.fromPlace}${r.toPlace}`.includes(q) ? 40 : 0;
      const score = Math.max(refScore, Math.round(nameScore), odScore);
      if (!score) continue;
      hits.push({
        kind: 'road',
        id: r.key,
        name: r.ref,
        sub: `${r.name ? r.name + ' · ' : ''}${r.fromPlace} → ${r.toPlace}`,
        lng: r.bbox[0] || 104,
        lat: r.bbox[1] || 35,
        score,
      });
    }
  } else if (kind === 'spot') {
    for (const s of getRoadsideSpots()) {
      const score = scoreText(q, s.name);
      if (!score) continue;
      hits.push({
        kind: 'spot',
        id: s.id,
        name: s.name,
        sub: [s.province, s.honors?.[0]].filter(Boolean).join(' · ') || '沿线景点',
        lng: s.lng,
        lat: s.lat,
        score: s.score >= 70 ? Math.min(100, score + 5) : score,
      });
    }
  } else {
    for (const f of loadFacilities()) {
      const score = f.name === q ? 100 : f.name.includes(q) ? 50 : 0;
      if (!score) continue;
      hits.push({
        kind: 'facility',
        id: f.id,
        name: f.name,
        sub: [f.road, f.kind === 'service-area' ? '服务区' : f.kind === 'tollgate' ? '收费站' : '互通'].filter(Boolean).join(' · '),
        lng: f.lng,
        lat: f.lat,
        score,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** 统一入口：不传 kind 时四类混合，按分数取 top */
export function suggestPlaces(q: string, kind?: PlaceKind, limit = 20): PlaceHit[] {
  const query = (q || '').trim();
  if (!query) return [];
  if (kind) return suggestPlacesOfKind(query, kind, limit);
  const all = (['place', 'road', 'spot', 'facility'] as PlaceKind[]).flatMap((k) =>
    suggestPlacesOfKind(query, k, limit),
  );
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, limit);
}

/** OD 端点解析：地名优先，公路编号次之（取其起点） */
export function resolvePlace(text: string): PlaceHit | undefined {
  const query = (text || '').trim();
  if (!query) return undefined;
  const place = suggestPlacesOfKind(query, 'place', 1)[0];
  if (place) return place;
  const road = suggestPlacesOfKind(query, 'road', 1)[0];
  if (road) {
    // 公路命中：坐标取 L1 几何起点（无几何时用 bbox 角，调用方仍可规划）
    return road;
  }
  return undefined;
}

// ── 网络降级链：高德 → Nominatim（PRD §4.3） ────────────────────────────────
function isPlausibleCnPoint(lng: number, lat: number): boolean {
  return lng > 73 && lng < 136 && lat > 17 && lat < 55;
}

async function amapGeocode(name: string): Promise<PlaceAnchor | null> {
  const key = process.env.AMAP_KEY;
  if (!key) return null;
  const qs = new URLSearchParams({ key, address: name });
  try {
    const res = await fetch(`https://restapi.amap.com/v3/geocode/geo?${qs}`, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'RailVista/0.4.0 (drive-geocode)' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      geocodes?: Array<{ location?: string; province?: string; level?: string }>;
    };
    if (json.status !== '1' || !json.geocodes?.length) return null;
    const loc = json.geocodes[0]!.location;
    if (!loc) return null;
    const [glng, glat] = loc.split(',').map(Number);
    if (!Number.isFinite(glng) || !Number.isFinite(glat)) return null;
    const { lng, lat } = gcj02ToWgs84(glng, glat); // GCJ-02 → WGS-84，不转会偏 300~600m
    if (!isPlausibleCnPoint(lng, lat)) return null;
    return { name, lng, lat, province: json.geocodes[0]!.province, level: 'county' };
  } catch {
    return null;
  }
}

async function nominatimGeocode(name: string): Promise<PlaceAnchor | null> {
  const qs = new URLSearchParams({ format: 'json', q: name, countrycodes: 'cn', limit: '1' });
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'RailVista/0.4.0 (drive-geocode)' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ lon?: string; lat?: string; display_name?: string }>;
    const hit = json?.[0];
    if (!hit?.lon || !hit?.lat) return null;
    const lng = Number(hit.lon);
    const lat = Number(hit.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !isPlausibleCnPoint(lng, lat)) return null;
    return { name, lng, lat, level: 'county' };
  } catch {
    return null;
  }
}

/** 本地未命中时的兜底 geocode：高德优先，Nominatim 兜底；命中回写本地锚点 */
export async function geocodeFallback(name: string): Promise<PlaceHit | null> {
  const anchor = (await amapGeocode(name)) ?? (await nominatimGeocode(name));
  if (!anchor) return null;
  rememberPlace(anchor);
  return {
    kind: 'place',
    id: anchor.name,
    name: anchor.name,
    sub: [anchor.province, '网络定位'].filter(Boolean).join(' · '),
    lng: anchor.lng,
    lat: anchor.lat,
    score: 30,
  };
}
