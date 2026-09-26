/**
 * 经停站「本地坐标快速填充」+ 坐标库版本指纹。
 *
 * 用途：给 getStops 的降级路径用 —— 当 enrichStopsCoords 超过最后期限时，
 * 先用本地 stations-geo 把能填的站填上（毫秒级），远程补点交给后台继续跑。
 *
 * 只读取 geocode.ts 已导出的能力，不修改 geocode.ts 本身。
 */
import { isPlausibleCnRailPoint, loadStationsGeo, matchesStationRegion } from './geocode.js';

type LngLat = { name: string; lng?: number; lat?: number };

function normalizeName(name: string): string {
  return String(name || '').trim().replace(/\s+/g, '');
}

function hasCoords(row: LngLat): boolean {
  return (
    row.lng != null &&
    row.lat != null &&
    Number.isFinite(Number(row.lng)) &&
    Number.isFinite(Number(row.lat))
  );
}

/**
 * 坐标库版本指纹：条目数 + 坐标取整后的累计和。
 * 任何新增站点或修正坐标都会改变指纹 → 用于让经停缓存自动失效。
 * 按 geo 对象引用做 memo（loadStationsGeo 本身按 mtime 缓存），每次请求几乎零成本。
 */
const versionMemo = new WeakMap<object, string>();

export function geoVersion(): string {
  const geo = loadStationsGeo();
  const cached = versionMemo.get(geo);
  if (cached) return cached;

  let count = 0;
  let sum = 0;
  for (const key of Object.keys(geo)) {
    const v = geo[key];
    if (!v || v.lng == null || v.lat == null) continue;
    count += 1;
    // 取整到 3 位小数（≈100m）后累加，规避浮点抖动
    sum += Math.round(Number(v.lng) * 1000) + Math.round(Number(v.lat) * 1000);
  }
  const version = `${count}:${sum}`;
  versionMemo.set(geo, version);
  return version;
}

/** 统计缺坐标的站数 */
export function countMissingCoords<T extends LngLat>(rows: T[]): number {
  let n = 0;
  for (const r of rows) if (!hasCoords(r)) n += 1;
  return n;
}

/**
 * 仅用本地 stations-geo 填充坐标（不做任何远程请求）。
 * 返回新数组 + 仍然缺坐标的站点名，供上层标记 coordStatus。
 */
export function fillLocalCoords<T extends LngLat>(rows: T[]): { rows: T[]; missing: string[] } {
  const geo = loadStationsGeo();
  const missing: string[] = [];
  const out = rows.map((row) => {
    if (hasCoords(row)) {
      const lng = Number(row.lng);
      const lat = Number(row.lat);
      if (isPlausibleCnRailPoint(lng, lat) && matchesStationRegion(row.name, lng, lat)) return row;
    }
    const raw = normalizeName(row.name);
    const bare = raw.replace(/站$/, '');
    const hit = geo[raw] || geo[bare] || geo[`${bare}站`];
    if (hit && hit.lng != null && hit.lat != null) {
      const lng = Number(hit.lng);
      const lat = Number(hit.lat);
      if (isPlausibleCnRailPoint(lng, lat) && matchesStationRegion(row.name, lng, lat)) {
        return { ...row, lng, lat };
      }
    }
    missing.push(row.name);
    return { ...row, lng: undefined, lat: undefined };
  });
  return { rows: out, missing };
}
