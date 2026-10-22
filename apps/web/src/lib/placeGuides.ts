/**
 * 「到了一个地方 → 当地有什么玩法」的读取层。
 *
 * 车站/城市名与路书库 `cities` 的口径并不完全一致（自治州全称、地级市带「市」等），
 * 故按 市名精确 → 关键词 → 同省推荐 三级兜底；三级都空则返回 null，调用方不渲染空壳。
 * 结果按 `省/市` 缓存，顶部通告卡与底栏共用同一次请求。
 */
import { api } from '../api/client';
import { stationFood } from '../data/stationFoods';
import { placeOfPoint } from '../data/prefectureSeeds';
import type { TravelRouteSummary } from '@railvista/shared';

export type PlaceKey = { province: string; city: string };

/** 命中层级：决定卡片给用户的说法（「当地攻略」与「同省热门」不是一回事） */
export type GuideLevel = 'city' | 'keyword' | 'province';

export type PlaceGuides = {
  place: PlaceKey;
  level: GuideLevel;
  routes: TravelRouteSummary[];
};

/** 一张卡里最多列几条 */
export const GUIDE_LIMIT = 3;

const cache = new Map<string, Promise<PlaceGuides | null>>();

/** 草稿条目不对外（列表接口带 q 时会把 draft 一起放出来） */
function publishedOnly(routes: TravelRouteSummary[]): TravelRouteSummary[] {
  return routes.filter((r) => r.status === 'published');
}

async function query(params: Record<string, string | number>): Promise<TravelRouteSummary[] | null> {
  try {
    const res = await api.getTravelRoutes({ ...params, limit: GUIDE_LIMIT, sort: 'recommend' });
    return publishedOnly(res.routes);
  } catch {
    return null; // null = 没查到（网络/接口异常），与「查到 0 条」区分，避免把失败缓存成永久空
  }
}

async function load(place: PlaceKey): Promise<PlaceGuides | null> {
  const steps: Array<{ level: GuideLevel; params: Record<string, string | number> }> = [
    { level: 'city', params: { city: place.city } },
    // 路书库写全称（湘西土家族苗族自治州），美食索引写短名（湘西）→ 短名只能走关键词
    { level: 'keyword', params: { q: place.city } },
    { level: 'province', params: { province: place.province } },
  ];
  let anyFailed = false;
  for (const step of steps) {
    const routes = await query(step.params);
    if (!routes) {
      anyFailed = true;
      continue;
    }
    if (routes.length) return { place, level: step.level, routes };
  }
  if (anyFailed) throw new Error(`路书库查询失败：${place.province}/${place.city}`);
  return null;
}

/** 站名 → 地级市：复用美食索引（已覆盖 12306 全量站），落空再按坐标归市 */
export function placeOfStation(stop: {
  name?: string;
  lng?: number;
  lat?: number;
}): PlaceKey | null {
  if (!stop?.name) return null;
  const coords = { lng: stop.lng, lat: stop.lat };
  const food = stationFood(stop.name, coords);
  if (food) return { province: food.province, city: food.city };
  if (typeof stop.lng === 'number' && typeof stop.lat === 'number') {
    const place = placeOfPoint(stop.lng, stop.lat);
    if (place?.city) return { province: place.province, city: place.city };
  }
  return null;
}

/** 取当地玩法（同一次行程内重复调用命中缓存，不重复发请求） */
export function guidesForPlace(place: PlaceKey | null): Promise<PlaceGuides | null> {
  if (!place) return Promise.resolve(null);
  const key = `${place.province}/${place.city}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = load(place);
  cache.set(key, pending);
  // 请求失败不写死缓存，下次进入同一站还能再试
  pending.catch(() => cache.delete(key));
  return pending;
}
