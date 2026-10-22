/**
 * 纪念票 → 中国足迹：保存一张票，就把票上走过的城市点亮。
 *
 * 难点是口径：票面存的是站名 / 途经点俗称（「西宁」「拉萨站」「独库公路」），
 * 足迹地图要的是 `chinaFootprintGeom` 里的地级行政区全称（「西宁市」）。
 * 这里统一走 站名索引 → 归一化市名 → 前缀匹配 三步，认不出来的名字直接跳过，
 * 绝不猜一个相近的城市点亮（点错城市比不点亮更糟）。
 */
import type { TicketConfig } from '@railvista/shared';
import { FOOTPRINT_CITIES, type FootprintCityGeom } from '../data/chinaFootprintGeom';
import { stationFood } from '../data/stationFoods';

const KEY_CITIES = 'rv-footprint-cities';
const KEY_PROVINCES = 'rv-footprint-provinces';

/** 地区级后缀：去掉后就是常见俗称（西宁市 → 西宁） */
const CITY_SUFFIX = /(市|地区|盟|自治州|自治县|林区|特别行政区)$/u;
/** 自治州全称里的民族串（海西蒙古族藏族自治州 → 海西） */
const ETHNIC_RUNE = /^(.*?)(?:[\u4e00-\u9fa5]{1,7}族)+(?:自治州|自治县)$/u;

const byName = new Map<string, FootprintCityGeom>();
/** 俗称 → 全称条目（同名只留第一个，避免歧义时乱点） */
const alias = new Map<string, FootprintCityGeom>();
for (const c of FOOTPRINT_CITIES) {
  byName.set(c.name, c);
  const stripped = c.name.replace(CITY_SUFFIX, '');
  for (const key of [stripped, c.name]) {
    if (!alias.has(key)) alias.set(key, byName.get(key) ?? c);
  }
  const ethnic = ETHNIC_RUNE.exec(c.name);
  if (ethnic?.[1] && ethnic[1].length >= 2 && !alias.has(ethnic[1])) alias.set(ethnic[1], c);
}

/** 前缀匹配兜底：只认「唯一命中」，两个以上候选说明有歧义，放弃 */
function byPrefix(name: string): FootprintCityGeom | null {
  if (name.length < 2) return null;
  let hit: FootprintCityGeom | null = null;
  for (const c of FOOTPRINT_CITIES) {
    const core = c.name.replace(CITY_SUFFIX, '');
    if (core !== name && core.startsWith(name)) {
      if (hit) return null;
      hit = c;
    }
  }
  return hit;
}

/** 任意地名 / 站名 → 足迹地图上的地级行政区；认不出返回 null */
export function resolveFootprintCity(raw: string): FootprintCityGeom | null {
  const name = String(raw ?? '').trim().replace(/[（(].*?[）)]/gu, '').replace(/站$/, '');
  if (name.length < 2) return null;
  const direct = alias.get(name) ?? byName.get(name) ?? byPrefix(name);
  if (direct) return direct;
  // 站名与市名不同名时（「合肥南」「德令哈」），借车站→城市的既有索引再试一次
  const food = stationFood(name);
  if (food?.city) return alias.get(food.city) ?? byPrefix(food.city);
  return null;
}

/** 票面上出现的地名：起讫两端 + 自驾途经点（顺序保持，去重） */
export function ticketPlaceNames(cfg: TicketConfig): string[] {
  const out: string[] = [];
  const push = (v?: string | null) => {
    const s = String(v ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(cfg.route?.ends?.[0]?.name);
  push(cfg.route?.ends?.[1]?.name);
  for (const w of cfg.route?.waypoints ?? []) push(w);
  return out;
}

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

/**
 * 点亮这张票覆盖的城市（以及它们在省级模式下的省）。
 * 返回本次**新增**的名称；已点亮过的不重复计。
 */
export function lightFootprintFromTicket(cfg: TicketConfig): {
  cities: string[];
  provinces: string[];
} {
  const cities = readList(KEY_CITIES);
  const provinces = readList(KEY_PROVINCES);
  const citySet = new Set(cities);
  const provinceSet = new Set(provinces);
  const addedCities: string[] = [];
  const addedProvinces: string[] = [];

  for (const raw of ticketPlaceNames(cfg)) {
    const hit = resolveFootprintCity(raw);
    if (!hit) continue;
    if (!citySet.has(hit.name)) {
      citySet.add(hit.name);
      addedCities.push(hit.name);
    }
    if (hit.province && !provinceSet.has(hit.province)) {
      provinceSet.add(hit.province);
      addedProvinces.push(hit.province);
    }
  }
  if (!addedCities.length && !addedProvinces.length) return { cities: [], provinces: [] };

  try {
    localStorage.setItem(KEY_CITIES, JSON.stringify([...citySet]));
    localStorage.setItem(KEY_PROVINCES, JSON.stringify([...provinceSet]));
  } catch {
    /* private mode / quota */
  }
  return { cities: addedCities, provinces: addedProvinces };
}

/** 足迹入口显示用：当前已点亮城市数 */
export function footprintLitCount(): number {
  return readList(KEY_CITIES).length;
}
