import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cache } from './cache.js';
import { lookupStopCoordFromCorridors } from './corridorNetwork.js';

type Point = { lng: number; lat: number };

const __dirname = dirname(fileURLToPath(import.meta.url));
const geoPath = join(__dirname, '../../../../data/stations-geo.json');

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
/** 选车后补坐标：长途车次缺站多，需更大预算（仍有超时上限） */
const OVERPASS_TIMEOUT_MS = 12000;
const NOMINATIM_TIMEOUT_MS = 6000;
const REMOTE_GEO_MAX = 20;

let geoFileCache: Record<string, { name?: string; telecode?: string; lng: number; lat: number }> | null =
  null;
let geoDirty = false;
let geoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let geoMtimeMs = -1;

function normalizeStationName(name: string): string {
  return name.replace(/站$/, '').trim();
}

/**
 * 易被 OSM/Nominatim 误匹配到同名他处的站：区域锚点（超距则拒收）。
 * 例如「潜江」曾被标到江苏句容附近，导致沪蓉示意线在苏皖交叉。
 */
const STATION_REGION_ANCHORS: Record<string, { lng: number; lat: number; maxKm: number }> = {
  潜江: { lng: 112.7685, lat: 30.4212, maxKm: 60 },
  荆州: { lng: 112.209, lat: 30.322, maxKm: 60 },
  宜昌东: { lng: 111.4608, lat: 30.6586, maxKm: 60 },
  枝江北: { lng: 111.751, lat: 30.512, maxKm: 60 },
  仙桃: { lng: 113.387, lat: 30.365, maxKm: 60 },
  天门南: { lng: 113.447, lat: 30.55, maxKm: 60 },
  汉川: { lng: 113.84, lat: 30.65, maxKm: 60 },
  扬州: { lng: 119.346, lat: 32.392, maxKm: 40 },
  扬州东: { lng: 119.55, lat: 32.42, maxKm: 40 },
  泰州: { lng: 119.976, lat: 32.531, maxKm: 40 },
  泰州南: { lng: 119.92, lat: 32.42, maxKm: 40 },
  南通西: { lng: 120.761, lat: 32.104, maxKm: 40 },
  张家港: { lng: 120.669, lat: 31.819, maxKm: 40 },
  六安: { lng: 116.494, lat: 31.717, maxKm: 40 },
  // 丽香铁路：易被误匹配到华北同名地
  小中甸: { lng: 99.81346, lat: 27.56238, maxKm: 40 },
  香格里拉: { lng: 99.68854, lat: 27.81332, maxKm: 40 },
  // 怀化南曾被沪昆 seed 标飞（西偏 ~34km），与张吉怀末端脱节
  怀化南: { lng: 109.98898, lat: 27.51439, maxKm: 25 },
  怀化: { lng: 109.96333, lat: 27.56083, maxKm: 25 },
  // 贵阳北曾被 guinan seed 标飞（东偏 ~35km），成贵/渝贵末端脱节
  贵阳北: { lng: 106.6725, lat: 26.6225, maxKm: 25 },
  // 宜宾西/兴文曾被 yukun seed 标到渝昆平行线
  宜宾西: { lng: 104.6033361, lat: 28.7257667, maxKm: 30 },
  兴文: { lng: 105.244562, lat: 28.338113, maxKm: 30 },
  // 杭黄：千岛湖/三阳曾被 seed 标飞，蓝线看似绕站
  千岛湖: { lng: 119.1880833, lat: 29.7374, maxKm: 25 },
  三阳: { lng: 118.801888, lat: 30.029526, maxKm: 25 },
  建德: { lng: 119.5314, lat: 29.6849, maxKm: 30 },
  // 桐庐站在城南街道（杭黄），勿与江南镇桐庐东混淆——错锚会把蓝线拉出尖刺
  桐庐: { lng: 119.727725, lat: 29.791394, maxKm: 20 },
  桐庐东: { lng: 119.75968, lat: 29.85729, maxKm: 20 },
  富阳: { lng: 119.955, lat: 30.003, maxKm: 30 },
  // 长白山：易被标到景区/旧 OD 南偏 ~7km，须钉在二道白河镇高铁站
  长白山: { lng: 128.1219234, lat: 42.4605171, maxKm: 5 },
  // 安图西：曾被 dunbai seed 标飞到敦白南线（偏 ~58km），真站在长珲城际
  安图西: { lng: 128.8876889, lat: 43.1110361, maxKm: 25 },
  // 大石头南：同为长珲站，曾被 dunbai seed 标飞
  大石头南: { lng: 128.4507972, lat: 43.297925, maxKm: 25 },
  // 襄阳东：东津高铁站（郑渝/武西），勿钉到郑渝北段或旧「襄州/襄阳东」普速站
  襄阳东: { lng: 112.2903833, lat: 32.0162806, maxKm: 15 },
  // 郑阜中间站曾被 corridor seed 反序钉到阜阳端
  许昌北: { lng: 113.92425, lat: 34.144447, maxKm: 25 },
  鄢陵南: { lng: 114.134064, lat: 34.065302, maxKm: 25 },
  扶沟南: { lng: 114.381253, lat: 33.997681, maxKm: 25 },
  // 海南西环：棋子湾/金月湾 曾错钉到儋州段
  棋子湾: { lng: 108.8044167, lat: 19.3389778, maxKm: 20 },
  金月湾: { lng: 108.7122333, lat: 18.7802889, maxKm: 20 },
  // 同名飞点
  山阴南: { lng: 112.832057, lat: 39.491682, maxKm: 30 },
  玉山南: { lng: 118.2880639, lat: 28.6499917, maxKm: 25 },
  海阳: { lng: 121.2846167, lat: 36.1214278, maxKm: 30 },
  海阳北: { lng: 120.9549389, lat: 37.0685306, maxKm: 25 },
  鹤壁: { lng: 114.26732889, lat: 35.76007389, maxKm: 25 },
  鹤壁东: { lng: 114.2948806, lat: 35.7055722, maxKm: 25 },
  淮阳南: { lng: 114.896263, lat: 33.504908, maxKm: 25 },
  溆浦: { lng: 110.573708, lat: 27.929358, maxKm: 30 },
  溆浦南: { lng: 110.5887194, lat: 27.6082361, maxKm: 20 },
  新化: { lng: 111.29777, lat: 27.731218, maxKm: 30 },
  新化南: { lng: 111.1551583, lat: 27.6581333, maxKm: 20 },
  新乡南: { lng: 113.85258806, lat: 35.04253806, maxKm: 25 },
  新余北: { lng: 114.8910417, lat: 27.9154333, maxKm: 25 },
  宜昌北: { lng: 111.4693833, lat: 30.7484194, maxKm: 25 },
};

function haversineKm(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** 名称区域锚点校验；无锚点则通过 */
export function matchesStationRegion(name: string, lng: number, lat: number): boolean {
  const key = normalizeStationName(name);
  const anchor = STATION_REGION_ANCHORS[key];
  if (!anchor) return true;
  return haversineKm({ lng, lat }, { lng: anchor.lng, lat: anchor.lat }) <= anchor.maxKm;
}

/**
 * 中国境内铁路站可信范围。排除日本本州/九州等误匹配
 * （东北边境如绥芬河 lng≈131、lat≈44 仍保留）。
 */
export function isPlausibleCnRailPoint(lng: number, lat: number): boolean {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lng < 73 || lng > 135 || lat < 18 || lat > 54) return false;
  // 日本本州/四国/九州主体（纬度偏低）；勿误伤中国东北边境
  if (lng >= 128.5 && lat < 41.5) return false;
  if (lng >= 138) return false;
  return true;
}

export function loadStationsGeo(): Record<
  string,
  { name?: string; telecode?: string; lng: number; lat: number; source?: string }
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
  if (hit?.lng == null || hit?.lat == null) return null;
  const point = { lng: Number(hit.lng), lat: Number(hit.lat) };
  if (!isPlausibleCnRailPoint(point.lng, point.lat)) {
    console.warn(`[geocode] reject bad local geo ${key}`, point);
    return null;
  }
  if (!matchesStationRegion(key, point.lng, point.lat)) {
    console.warn(`[geocode] reject out-of-region local geo ${key}`, point);
    delete geo[key];
    if (geo[name]) delete geo[name];
    geoFileCache = geo;
    geoDirty = true;
    schedulePersistGeo();
    return null;
  }
  return point;
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
  if (!isPlausibleCnRailPoint(point.lng, point.lat)) {
    console.warn(`[geocode] refuse to persist non-CN point ${key}`, point);
    return;
  }
  if (!matchesStationRegion(key, point.lng, point.lat)) {
    console.warn(`[geocode] refuse to persist out-of-region point ${key}`, point);
    return;
  }
  const geo = loadStationsGeo();
  if (geo[key]?.lng === point.lng && geo[key]?.lat === point.lat) return;
  geo[key] = { name: key, lng: point.lng, lat: point.lat };
  geoFileCache = geo;
  geoDirty = true;
  cache.set(`geo:osm:${key}`, point, 7 * 24 * 3600);
  schedulePersistGeo();
}

function tagMatchesStation(tagName: string, requested: string): boolean {
  const t = normalizeStationName(tagName);
  const r = normalizeStationName(requested);
  return !!t && !!r && (t === r || tagName === requested || tagName === `${r}站`);
}

function scoreStationHit(
  el: { tags?: Record<string, string>; lat: number; lon: number },
  requested: string,
): number {
  let score = 0;
  const railway = el.tags?.railway;
  const pt = el.tags?.public_transport;
  if (railway === 'station') score += 60;
  else if (railway === 'halt') score += 15;
  else if (pt === 'station') score += 25;

  const zh = el.tags?.['name:zh'] || '';
  const name = el.tags?.name || '';
  const r = normalizeStationName(requested);
  if (zh === `${r}站` || name === `${r}站`) score += 40;
  else if (normalizeStationName(zh) === r || normalizeStationName(name) === r) score += 25;

  // 略偏向中国几何中心，抑制境外同名
  const d = Math.hypot(el.lon - 105, el.lat - 35);
  score += Math.max(0, 25 - d / 2);
  return score;
}

async function overpassStationsByNames(names: string[]): Promise<Map<string, Point>> {
  const unique = [...new Set(names.map(normalizeStationName).filter(Boolean))];
  const found = new Map<string, Point>();
  if (!unique.length) return found;

  // China-ish bbox（仍可能扫到日本西部，需结果过滤）
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
        `node["railway"="halt"]["name:zh"="${n}"](${bbox});`,
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

  type Cand = { key: string; point: Point; score: number };
  const best = new Map<string, Cand>();

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
        if (!isPlausibleCnRailPoint(lon, lat)) continue;

        const tagName = el.tags?.['name:zh'] || el.tags?.name || '';
        for (const requested of unique) {
          if (!tagMatchesStation(tagName, requested)) continue;
          const score = scoreStationHit(
            { tags: el.tags, lat, lon },
            requested,
          );
          const prev = best.get(requested);
          if (!prev || score > prev.score) {
            best.set(requested, {
              key: requested,
              point: { lng: lon, lat },
              score,
            });
          }
        }
      }

      for (const [k, c] of best) found.set(k, c.point);
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
    limit: '3',
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
    for (const hit of json) {
      const lng = Number(hit.lon);
      const lat = Number(hit.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (!isPlausibleCnRailPoint(lng, lat)) continue;
      return { lng, lat };
    }
    return null;
  } catch {
    return null;
  }
}

/** 高德地名搜索（火车站类型），GCJ-02，仅作缺坐标兜底 */
async function amapStation(name: string): Promise<Point | null> {
  const key = process.env.AMAP_KEY;
  if (!key) return null;
  const keywords = name.endsWith('站') ? name : `${name}站`;
  const qs = new URLSearchParams({
    key,
    keywords,
    types: '150200',
    offset: '5',
    page: '1',
    extensions: 'base',
  });
  try {
    const res = await fetch(`https://restapi.amap.com/v3/place/text?${qs}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      pois?: Array<{ name?: string; location?: string }>;
    };
    if (json.status !== '1' || !json.pois?.length) return null;
    const want = normalizeStationName(name);
    const ranked = [...json.pois].sort((a, b) => {
      const an = normalizeStationName(a.name || '');
      const bn = normalizeStationName(b.name || '');
      const as = an === want || (a.name || '').includes(want) ? 0 : 1;
      const bs = bn === want || (b.name || '').includes(want) ? 0 : 1;
      return as - bs;
    });
    for (const poi of ranked) {
      const loc = poi.location?.split(',');
      if (!loc || loc.length < 2) continue;
      const lng = Number(loc[0]);
      const lat = Number(loc[1]);
      if (!isPlausibleCnRailPoint(lng, lat)) continue;
      return { lng, lat };
    }
    return null;
  } catch {
    return null;
  }
}

function acceptPoint(point: Point | null | undefined): point is Point {
  return !!point && isPlausibleCnRailPoint(point.lng, point.lat);
}

/**
 * 示意折线交错检测：中间站绕行远超直连时，清掉可疑坐标。
 * 时刻表站序本身正确；交叉几乎总是中间站坐标飞点（如潜江被标到江苏）。
 * 清除本地库脏点（含非 corridor），避免下次 enrich 再次污染。
 */
function scrubZigzagLocalCoords<T extends { name: string; lng?: number; lat?: number }>(
  stops: T[],
): T[] {
  const geo = loadStationsGeo();
  const out = stops.map((s) => ({ ...s }));
  let changed = true;
  let guard = 0;
  while (changed && guard < 8) {
    changed = false;
    guard += 1;
    for (let i = 1; i < out.length - 1; i++) {
      const prev = out[i - 1];
      const mid = out[i];
      const next = out[i + 1];
      if (
        prev.lng == null ||
        prev.lat == null ||
        mid.lng == null ||
        mid.lat == null ||
        next.lng == null ||
        next.lat == null
      ) {
        continue;
      }
      const a = { lng: Number(prev.lng), lat: Number(prev.lat) };
      const b = { lng: Number(mid.lng), lat: Number(mid.lat) };
      const c = { lng: Number(next.lng), lat: Number(next.lat) };
      if (
        !isPlausibleCnRailPoint(a.lng, a.lat) ||
        !isPlausibleCnRailPoint(b.lng, b.lat) ||
        !isPlausibleCnRailPoint(c.lng, c.lat)
      ) {
        continue;
      }
      const direct = haversineKm(a, c);
      const via = haversineKm(a, b) + haversineKm(b, c);
      // 直连已有一定跨度，且经中间站绕行明显过大 → 中间站坐标可疑
      if (!(direct > 40 && via > direct * 1.75 && via - direct > 50)) continue;

      const key = normalizeStationName(mid.name);
      const local = geo[key] || geo[mid.name];
      const src = String(local?.source || '');
      console.warn(
        `[geocode] scrub zigzag stop ${mid.name} via=${via.toFixed(0)}km direct=${direct.toFixed(0)}km source=${src || 'inline'}`,
      );
      out[i] = { ...mid, lng: undefined, lat: undefined };
      // 飞点会反复污染示意线：本地库一律清掉，交由区域锚点/远程重查
      if (geo[key]) {
        delete geo[key];
        geoFileCache = geo;
        geoDirty = true;
        schedulePersistGeo();
      }
      changed = true;
    }
  }
  return out;
}

export async function geocodeStation(name: string): Promise<Point | null> {
  if (!name) return null;
  const key = `geo:osm:${normalizeStationName(name)}`;
  const cached = cache.get<Point>(key);
  if (acceptPoint(cached) && matchesStationRegion(name, cached.lng, cached.lat)) {
    return cached;
  }

  const local = lookupLocalGeo(name);
  if (local) {
    cache.set(key, local, 7 * 24 * 3600);
    return local;
  }

  const batch = await overpassStationsByNames([name]);
  const hit = batch.get(normalizeStationName(name));
  if (acceptPoint(hit) && matchesStationRegion(name, hit.lng, hit.lat)) {
    rememberGeo(name, hit);
    return hit;
  }

  const nom = await nominatimStation(name);
  if (acceptPoint(nom) && matchesStationRegion(name, nom.lng, nom.lat)) {
    rememberGeo(name, nom);
    return nom;
  }

  const amap = await amapStation(name);
  if (acceptPoint(amap) && matchesStationRegion(name, amap.lng, amap.lat)) {
    rememberGeo(name, amap);
    return amap;
  }
  return null;
}

/** 本地库与入站坐标相差超过此距离时，以 stations-geo 为准（清掉景区/旧 OD 飞点） */
const LOCAL_GEO_OVERRIDE_KM = 2;

/**
 * G/D/C 车次：同城普速站名 → 高铁站名（避免黄点落在城南、蓝线走城北）。
 * K/T/Z 不改写，以免胶济等普速线错位。
 */
const HSR_PARALLEL_STATION_PREF: Record<string, string> = {
  淄博: '淄博北',
  潍坊: '潍坊北',
  章丘: '章丘北',
  临淄: '临淄北',
  青州: '青州市北',
  青州市: '青州市北',
  高密: '高密北',
};

function isHsrTrainCode(trainCode?: string): boolean {
  return !!trainCode && /^[GDC]/i.test(String(trainCode).trim());
}

function preferHsrStationName(name: string, trainCode?: string): string {
  const key = normalizeStationName(name);
  if (!isHsrTrainCode(trainCode)) return key;
  const pref = HSR_PARALLEL_STATION_PREF[key];
  if (!pref) return key;
  const geo = loadStationsGeo();
  if (geo[pref]?.lng != null) return pref;
  return key;
}

export async function enrichStopsCoords<
  T extends { name: string; lng?: number; lat?: number },
>(stops: T[], opts?: { trainCode?: string }): Promise<T[]> {
  const trainCode = opts?.trainCode;
  const out: T[] = scrubZigzagLocalCoords(
    stops.map((s) => {
      const lookupName = preferHsrStationName(s.name, trainCode);
      const renamed =
        lookupName !== normalizeStationName(s.name) ? lookupName : s.name;
      const local = lookupLocalGeo(lookupName) || lookupLocalGeo(s.name);
      // 已有坐标若不在中国可信范围，视为缺失（修复日本「天津」这类脏数据）
      if (s.lng != null && s.lat != null && Number.isFinite(s.lng) && Number.isFinite(s.lat)) {
        const lng = Number(s.lng);
        const lat = Number(s.lat);
        if (isPlausibleCnRailPoint(lng, lat) && matchesStationRegion(s.name, lng, lat)) {
          // 本地权威坐标存在且入站点偏离过远 → 覆盖（长白山曾钉在景区南侧）
          if (local) {
            const d = haversineKm({ lng, lat }, local);
            if (d > LOCAL_GEO_OVERRIDE_KM) {
              console.warn(
                `[geocode] prefer local geo ${s.name}→${renamed} over divergent inline d=${d.toFixed(1)}km`,
                { inline: { lng, lat }, local },
              );
              return { ...s, name: renamed, lng: local.lng, lat: local.lat };
            }
          }
          // G/D/C 已对齐本地高铁站坐标时，站名也改成高铁站（淄博→淄博北）
          if (renamed !== s.name && local) {
            return { ...s, name: renamed, lng: local.lng, lat: local.lat };
          }
          return s;
        }
        console.warn(`[geocode] drop implausible stop coords ${s.name}`, {
          lng: s.lng,
          lat: s.lat,
        });
      }
      if (local) {
        return { ...s, name: renamed, lng: local.lng, lat: local.lat };
      }
      const mem = cache.get<Point>(`geo:osm:${normalizeStationName(lookupName)}`);
      if (
        acceptPoint(mem) &&
        matchesStationRegion(renamed, mem.lng, mem.lat)
      ) {
        return { ...s, name: renamed, lng: mem.lng, lat: mem.lat };
      }
      return { ...s, name: renamed, lng: undefined, lat: undefined };
    }),
  );

  const missing = out.filter(
    (s) => s.lng == null || s.lat == null || !Number.isFinite(s.lng) || !Number.isFinite(s.lat),
  );
  // 远程补点后可能再次引入飞点，出口统一再 scrub 一次
  if (!missing.length) return scrubZigzagLocalCoords(out);

  // P0-4：本地/Overpass 都没命中后，用走廊 stationsHint 兜底补坐标（投影/插值点），
  // 避免经停站在前端凭空消失；属低置信度坐标，拼线时仍受站级硬门禁约束。
  const fillCorridorHints = (rows: T[]): T[] =>
    rows.map((s) => {
      if (s.lng != null && s.lat != null && Number.isFinite(s.lng) && Number.isFinite(s.lat)) {
        return s;
      }
      try {
        const hint = lookupStopCoordFromCorridors(s.name);
        if (hint) {
          console.warn(
            `[geocode] corridor-hint fallback coord for ${s.name} via ${hint.corridorId}`,
          );
          return { ...s, lng: hint.lng, lat: hint.lat };
        }
      } catch {
        /* 走廊加载失败不阻塞主流程 */
      }
      return s;
    });

  const batch = await overpassStationsByNames(missing.map((s) => s.name));
  const still: T[] = [];
  const result = out.map((s) => {
    if (s.lng != null && s.lat != null && Number.isFinite(s.lng) && Number.isFinite(s.lat)) {
      return s;
    }
    const key = normalizeStationName(s.name);
    const point = batch.get(key) || null;
    if (acceptPoint(point) && matchesStationRegion(s.name, point.lng, point.lat)) {
      rememberGeo(s.name, point);
      return { ...s, lng: point.lng, lat: point.lat };
    }
    still.push(s);
    return s;
  });

  // 优先补全行程首末站，再沿途均匀抽样，避免长途只解析到几个站导致示意线大跨/环路
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
  const budget = Math.min(
    stillSorted.length,
    Math.max(REMOTE_GEO_MAX, endpointNames.size, Math.ceil(stillSorted.length * 0.4)),
  );
  const toResolve: typeof stillSorted = [];
  const seen = new Set<string>();
  const pushUnique = (s: (typeof stillSorted)[number]) => {
    const k = normalizeStationName(s.name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    toResolve.push(s);
  };
  for (const s of stillSorted) {
    if (endpointNames.has(normalizeStationName(s.name))) pushUnique(s);
  }
  const rest = stillSorted.filter((s) => !endpointNames.has(normalizeStationName(s.name)));
  if (rest.length && toResolve.length < budget) {
    const need = budget - toResolve.length;
    if (rest.length <= need) {
      for (const s of rest) pushUnique(s);
    } else {
      for (let i = 0; i < need; i++) {
        const idx = Math.min(rest.length - 1, Math.round(((i + 0.5) * rest.length) / need - 0.5));
        pushUnique(rest[idx]);
      }
    }
  }
  if (toResolve.length) {
    // 限并发，避免 Nominatim/高德打爆
    const concurrency = 4;
    const hits: Array<{ name: string; point: Point } | null> = [];
    for (let i = 0; i < toResolve.length; i += concurrency) {
      const batchNames = toResolve.slice(i, i + concurrency);
      const part = await Promise.all(
        batchNames.map(async (s) => {
          const point =
            (await nominatimStation(s.name)) || (await amapStation(s.name));
          if (!acceptPoint(point) || !matchesStationRegion(s.name, point.lng, point.lat)) {
            return null;
          }
          return { name: s.name, point };
        }),
      );
      hits.push(...part);
    }
    const byName = new Map(
      hits.filter(Boolean).map((h) => [normalizeStationName(h!.name), h!.point] as const),
    );
    for (const hit of hits) {
      if (hit) rememberGeo(hit.name, hit.point);
    }
    return scrubZigzagLocalCoords(
      fillCorridorHints(
        result.map((s) => {
          if (s.lng != null && s.lat != null && Number.isFinite(s.lng) && Number.isFinite(s.lat)) {
            return s;
          }
          const point = byName.get(normalizeStationName(s.name));
          return point ? { ...s, lng: point.lng, lat: point.lat } : s;
        }),
      ),
    );
  }

  // 远程补点未排上预算：仍尝试走廊 hint 兜底
  return scrubZigzagLocalCoords(fillCorridorHints(result));
}
