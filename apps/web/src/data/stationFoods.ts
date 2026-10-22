/**
 * 车站地方特色美食读取层。
 * 数据由 scripts/build-station-food-index.mts 生成到 stationFoods.json（站名 → 地级市 → 美食），
 * 生成时已保证「站名全集」全覆盖；运行期再按坐标 / 站名前缀兜底，
 * 兼容 12306 新增站与暂未收进主表的站。
 */
import dataFile from './stationFoods.json';
import { placeOfPoint } from './prefectureSeeds';

export type FoodDish = { name: string; note: string };
export type StationFood = {
  province: string;
  city: string;
  tag: string;
  dishes: FoodDish[];
};

type CityRow = { p: string; t: string; d: [string, string][] };

// stationFoods.json 由脚本产出，resolveJsonModule 推不出 d 的二元组类型，纯类型层收敛一次。
const CITIES = (dataFile as unknown as { cities: Record<string, CityRow> }).cities;
const STATION_CITY = (dataFile as unknown as { stations: Record<string, string> }).stations;

/** 市名 → 索引键，供「站名前缀即地名」兜底（长沙南 → 湖南/长沙） */
const CITY_NAME_KEYS = new Map<string, string>();
for (const key of Object.keys(CITIES)) {
  const city = key.slice(key.indexOf('/') + 1);
  if (city.length >= 2 && !CITY_NAME_KEYS.has(city)) CITY_NAME_KEYS.set(city, key);
}

function toFood(key: string, row: CityRow): StationFood {
  return {
    province: row.p,
    city: key.slice(key.indexOf('/') + 1),
    tag: row.t,
    dishes: row.d.map(([name, note]) => ({ name, note })),
  };
}

function byKey(key?: string | null): StationFood | null {
  if (!key) return null;
  const row = CITIES[key];
  return row ? toFood(key, row) : null;
}

/** 站名规范化：去空白、去尾部「站」（12306 与主表命名习惯不一致） */
function normalize(name: string): string {
  const t = String(name ?? '').trim();
  return t.length > 2 && t.endsWith('站') ? t.slice(0, -1) : t;
}

function longestCityPrefixKey(name: string): string | null {
  let bestKey: string | null = null;
  let bestLen = 0;
  for (const [city, key] of CITY_NAME_KEYS) {
    if (name.length > city.length && name.startsWith(city) && city.length > bestLen) {
      bestLen = city.length;
      bestKey = key;
    }
  }
  return bestKey;
}

/**
 * 取一个站的地方特色美食。
 * 查找顺序：站名索引（生成时已覆盖 12306 全量站）→ 坐标归市 → 站名前缀地名；
 * 全部落空返回 null（调用方不渲染空壳）。
 */
export function stationFood(
  stationName: string,
  coords?: { lng?: number; lat?: number } | null,
): StationFood | null {
  const name = normalize(stationName);
  if (!name) return null;

  const indexed = byKey(STATION_CITY[name]);
  if (indexed) return indexed;

  if (typeof coords?.lng === 'number' && typeof coords?.lat === 'number') {
    const place = placeOfPoint(coords.lng, coords.lat);
    const viaCoord = byKey(`${place.province}/${place.city}`);
    if (viaCoord) return viaCoord;
  }

  return byKey(longestCityPrefixKey(name));
}

/** 底栏 / 过站卡用的前 N 道 */
export function stationFoodTop(
  stationName: string,
  coords: { lng?: number; lat?: number } | null | undefined,
  max = 3,
): StationFood | null {
  const food = stationFood(stationName, coords);
  return food ? { ...food, dishes: food.dishes.slice(0, max) } : null;
}
