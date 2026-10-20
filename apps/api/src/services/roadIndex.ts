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
/**
 * 全国行政区划地名索引（省 / 地级市 / 区县，含坐标）。
 * 由 scripts/build-place-index.mjs 从高德行政区划一次性落盘，运行时只读——
 * 与 places-geo.json 分开，因为后者会被运行时 geocode 回写，混进去会把
 * 3500+ 条离线地名写进那个"缓存"文件。
 */
const ADMIN_PLACES_PATH = join(__dirname, '../../../../data/roads/places-admin.json');
const FACILITIES_PATH = join(__dirname, '../../../../data/roads/facilities.json');

// ── 地名锚点 ─────────────────────────────────────────────────────────────────
export interface PlaceAnchor {
  name: string;
  lng: number;
  lat: number;
  province?: string;
  /** 所属地级市（仅区县级有；直辖市的区县回落到省名，如 嘉定区 → 上海） */
  city?: string;
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

/**
 * 行政区划地名（省 / 地级市 / 区县），只读，按 mtime 热重载。
 * 与运行时回写的 places-geo.json 分开加载，搜索时才合并。
 */
let adminCache: { mtime: number; places: PlaceAnchor[] } | null = null;

function loadAdminPlaces(): PlaceAnchor[] {
  if (!existsSync(ADMIN_PLACES_PATH)) return [];
  try {
    const mtime = statSync(ADMIN_PLACES_PATH).mtimeMs;
    if (adminCache && adminCache.mtime === mtime) return adminCache.places;
    const file = JSON.parse(readFileSync(ADMIN_PLACES_PATH, 'utf8')) as PlacesFile;
    adminCache = { mtime, places: Array.isArray(file.places) ? file.places : [] };
    return adminCache.places;
  } catch {
    return [];
  }
}

/**
 * 合并后的候选：**行政区划库优先**，places-geo 只补它缺的名字。
 *
 * 顺序不能反：places-geo.json 是早年手工攒的，实测把「拉萨」「西安」都标成了
 * `level: 'province'`（它那 34 条"省级"里混着地级市），直接拿它当首选会让
 * 联想副标题显示成「西藏 · 省级」。行政区划库是按 adcode 层级落的，级别可靠。
 * places-geo 里独有的手工锚点（景区、口岸等）仍然照常补进来，不丢数据。
 */
let mergedCache: { key: string; places: PlaceAnchor[] } | null = null;

function mergedPlaces(): PlaceAnchor[] {
  const admin = loadAdminPlaces();
  const base = loadPlaces();
  const key = `${base.length}:${admin.length}:${statSafe(PLACES_PATH)}:${statSafe(ADMIN_PLACES_PATH)}`;
  if (mergedCache && mergedCache.key === key) return mergedCache.places;
  const seen = new Set(admin.map((p) => p.name));
  const out = admin.slice();
  for (const p of base) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }
  mergedCache = { key, places: out };
  return out;
}

function statSafe(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
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

const LEVEL_LABEL: Record<string, string> = {
  province: '省级',
  city: '地级市',
  county: '区县',
};

/** 省级行政区里其实是直辖市的那四个（高德把它们落在 province 层） */
const MUNICIPALITY = new Set(['北京', '上海', '天津', '重庆']);

/** 同名排序权重：地级市最常用，其次省级（直辖市），区县最后 */
function levelRank(level?: string): number {
  return level === 'city' ? 3 : level === 'province' ? 2 : 1;
}

/** 联想副标题：省 · 市 · 级别（同名区县靠它区分，如「朝阳区」北京 vs 长春） */
function placeSub(p: PlaceAnchor): string {
  // 直辖市的省级条目（北京/上海/天津/重庆）标「省级」不够准确
  const lv =
    p.level === 'province' && MUNICIPALITY.has(p.name) ? '直辖市' : LEVEL_LABEL[p.level ?? ''] ?? '地名';
  const parts = [p.province, p.city, lv].filter(Boolean);
  // 直辖市的 province 与 city 同名（上海/上海），去重一次免得显示「上海 · 上海 · 区县」
  return [...new Set(parts)].join(' · ');
}

function suggestPlacesOfKind(q: string, kind: PlaceKind, limit: number, province?: string): PlaceHit[] {
  const hits: PlaceHit[] = [];
  if (kind === 'place') {
    const scored: Array<{ hit: PlaceHit; rank: number }> = [];
    for (const p of mergedPlaces()) {
      const score = scoreText(q, p.name);
      if (!score) continue;
      scored.push({
        hit: {
          kind: 'place',
          id: p.name,
          name: p.name,
          sub: placeSub(p),
          lng: p.lng,
          lat: p.lat,
          score,
        },
        rank: levelRank(p.level),
      });
    }
    // 同分时「地级市 > 省级 > 县级」：OD 端点里地级市最常用，
    // 且要把「长沙（市）」排在「长沙县」前面、「朝阳市」排在「朝阳区」前面。
    // 再按名字长度升序——短名更像用户想输入的那个规范名。
    scored.sort(
      (a, b) =>
        b.hit.score - a.hit.score ||
        b.rank - a.rank ||
        a.hit.name.length - b.hit.name.length ||
        a.hit.name.localeCompare(b.hit.name, 'zh'),
    );
    return scored.slice(0, limit).map((s) => s.hit);
  } else if (kind === 'road') {
    // 2026-10-11：S/X/Y 编号跨省重复且候选远超 limit —— 选省过滤必须在打分截断之前，
    // 否则一省的碎片条目挤掉其他省编号，前端"选省"永远筛不到。
    const prov = province?.trim();
    // 2026-10-18：支持完整 key 输入（用户从榜单/联动把「河南:Y10」粘进搜索框——
    // 旧逻辑只有 ref 匹配，完整 key 恒 0 分导致 resolvePlace 解析失败）。
    // 规范化全角冒号；q 形如完整 key 时优先做 key 级匹配（key 命中 100、
    // 「省前缀+ref」组合命中 92），纯编号输入仍走原 ref/名称匹配。
    const qNorm = q.replace('：', ':');
    const qHasKey = qNorm.includes(':');
    const [qProv, qRest] = qHasKey ? qNorm.split(':') : ['', ''];
    for (const r of loadRoadIndex().entries as RoadIndexEntry[]) {
      if (prov && !r.key.startsWith(`${prov}:`)) continue;
      let refScore = r.ref === q ? 100 : r.ref.startsWith(q) ? 85 : 0;
      if (qHasKey && refScore < 92) {
        if (r.key === qNorm) refScore = 100;
        else if (qRest && r.key.split(':')[1] === qRest && r.key.startsWith(`${qProv}:`)) refScore = 92;
      }
      const nameScore = r.name ? scoreText(q, r.name) * 0.6 : 0; // 中文名（沪聂线）60%
      const odScore = `${r.fromPlace}${r.toPlace}`.includes(q) ? 40 : 0;
      const score = Math.max(refScore, Math.round(nameScore), odScore);
      if (!score) continue;
      hits.push({
        kind: 'road',
        id: r.key,
        name: r.ref,
        sub: [prov || r.key.split(':')[0], r.name, r.fromPlace && r.toPlace ? `${r.fromPlace} → ${r.toPlace}` : r.fromPlace || r.toPlace || ''].filter(Boolean).join(' · '),
        lng: r.bbox[0] || 104,
        lat: r.bbox[1] || 35,
        score,
      });
    }
    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 同分（前缀命中）：短编号优先（S2 < S20 < S201），避免截断淹没各省主编号
      const da = Number(a.name.replace(/\D/g, '')) || 0;
      const db = Number(b.name.replace(/\D/g, '')) || 0;
      if (a.name.length !== b.name.length) return a.name.length - b.name.length;
      return da - db || a.id.localeCompare(b.id, 'zh');
    });
    return hits.slice(0, limit);
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
export function suggestPlaces(q: string, kind?: PlaceKind, limit = 20, province?: string): PlaceHit[] {
  const query = (q || '').trim();
  if (!query) return [];
  if (kind) return suggestPlacesOfKind(query, kind, limit, province);
  const all = (['place', 'road', 'spot', 'facility'] as PlaceKind[]).flatMap((k) =>
    suggestPlacesOfKind(query, k, limit),
  );
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, limit);
}

/**
 * 沿程地名反查：给定坐标找最近的行政地名（用于给 OD 折线的里程分段起名）。
 *
 * 只查行政区划库（3564 条，线性扫描足够快：32 个分段 × 3564 ≈ 11 万次，
 * 实测 <5ms）。先找地级市、找不到再找区县 —— 段名要的是「这条路上过了哪个地方」，
 * 地级市比同名区县更能代表一个路段。
 *
 * @param maxKm 半径上限。超出就返回 null（宁可这一段不起名，也不拿远处地名糊弄）
 */
export function nearestPlaceName(
  lng: number,
  lat: number,
  maxKm = 60,
): { name: string; level: string; km: number } | null {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const places = loadAdminPlaces();
  if (!places.length) return null;
  let city: { name: string; level: string; km: number } | null = null;
  let county: { name: string; level: string; km: number } | null = null;
  for (const p of places) {
    const dLng = (p.lng - lng) * cosLat;
    const dLat = p.lat - lat;
    const km = Math.sqrt(dLng * dLng + dLat * dLat) * 111;
    if (km > maxKm) continue;
    if (p.level === 'province') continue; // 省级范围太大，不适合当段名
    if (p.level === 'city') {
      if (!city || km < city.km) city = { name: p.name, level: p.level, km };
    } else if (!county || km < county.km) {
      county = { name: p.name, level: p.level ?? 'county', km };
    }
  }
  // 区县明显更近（近一半以上）才用区县，否则一律用地级市名
  if (city && county && county.km * 2 < city.km) return county;
  return city ?? county;
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

/**
 * 高德 key 取用顺序：AMAP_SERVER_KEY → AMAP_KEY。
 *
 * 必须区分的原因（2026-10-11 实测）：apps/api/.env 里长期配的是前端 Web 端 key
 * （带 AMAP_SECURITY_CODE 的 JS API key），调 Web 服务接口恒返回
 * `USERKEY_PLAT_NOMATCH`，等于「配了 key 但在线 geocode / 驾车规划从来没成功过」。
 * 服务端调用必须用 Web 服务类型的 key，新增 AMAP_SERVER_KEY 承载它。
 */
export function amapKey(): string {
  return process.env.AMAP_SERVER_KEY || process.env.AMAP_KEY || '';
}

async function amapGeocode(name: string): Promise<PlaceAnchor | null> {
  const key = amapKey();
  if (!key) return null;
  const qs = new URLSearchParams({ key, address: name });
  try {
    const res = await fetch(`https://restapi.amap.com/v3/geocode/geo?${qs}`, {
      signal: AbortSignal.timeout(3500),
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

/**
 * 百度地理编码（2026-10-18）：geocoding/v3，ret_coordtype=wgs84ll 直接回 WGS-84 免转换。
 * 高德 Web 服务额度耗尽后恒快败返回 null，竞速数组里补百度源对冲。
 */
async function baiduGeocode(name: string): Promise<PlaceAnchor | null> {
  const key = process.env.BAIDU_MAP_KEY;
  if (!key) return null;
  try {
    const qs = new URLSearchParams({ address: name, ak: key, ret_coordtype: 'wgs84ll' });
    const res = await fetch(`https://api.map.baidu.com/geocoding/v3/?${qs}`, {
      signal: AbortSignal.timeout(3500),
      headers: { 'User-Agent': 'RailVista/0.4.0 (drive-geocode)' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: number;
      result?: { location?: { lng?: number; lat?: number }; level?: string };
    };
    const loc = json.status === 0 ? json.result?.location : undefined;
    if (!loc?.lng || !loc?.lat) return null;
    if (!isPlausibleCnPoint(loc.lng, loc.lat)) return null;
    return { name, lng: loc.lng, lat: loc.lat, level: 'county' };
  } catch {
    return null;
  }
}

async function nominatimGeocode(name: string): Promise<PlaceAnchor | null> {
  const qs = new URLSearchParams({ format: 'json', q: name, countrycodes: 'cn', limit: '1' });
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, {
      signal: AbortSignal.timeout(3500),
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


/**
 * A4：geocode 结果缓存（24h）。
 * 原实现每次未命中都要走网络，且高德失败后才串行试Nominatim，最长阻塞 12s；
 * 用户表现为「输入了没反应」（前端 DriveHome 是空 catch）。
 */
const geocodeCache = new Map<string, { at: number; hit: PlaceHit | null }>();
const GEOCODE_TTL_MS = 24 * 3600 * 1000;
const GEOCACHE_MAX = 200;

/** 本地未命中时的兜底 geocode：高德与 Nominatim 并行取先成功者，命中回写本地锚点 */
export async function geocodeFallback(name: string): Promise<PlaceHit | null> {
  const key = name.trim();
  if (!key) return null;
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.at < GEOCODE_TTL_MS) return cached.hit;

  // A4：原为串行 await（高德 6s 超时后才试 Nominatim 再 6s，最长 12s）。
  // 改为并行竞速，总耗时 = min(两者)，并把超时压到 3.5s。
  // 2026-10-14 修竞速语义：Promise.any 对 fulfill(null) 也立即结算——高德额度
  // 耗尽后恒快败返回 null，会把 Nominatim 的成功结果废掉（表现为「输入没反应」）。
  // 改为 null 即 reject 再 any；全败（含 AggregateError）catch 归 null 不外抛。
  // 2026-10-18 竞速源扩为 高德→百度→Nominatim（高德额度耗尽后百度兜上）。
  const hit = await Promise.any(
    [amapGeocode(key), baiduGeocode(key), nominatimGeocode(key)].map((p) =>
      p.then((anchor) => {
        if (!anchor) throw new Error('miss');
        return anchor;
      }),
    ),
  )
    .then((anchor) => {
      rememberPlace(anchor);
      return {
        kind: 'place' as const,
        id: anchor.name,
        name: anchor.name,
        sub: [anchor.province, '网络定位'].filter(Boolean).join(' · '),
        lng: anchor.lng,
        lat: anchor.lat,
        score: 30,
      };
    })
    .catch(() => null);

  if (geocodeCache.size >= GEOCACHE_MAX) {
    const oldest = geocodeCache.keys().next().value;
    if (oldest) geocodeCache.delete(oldest);
  }
  geocodeCache.set(key, { at: Date.now(), hit });
  return hit;
}
