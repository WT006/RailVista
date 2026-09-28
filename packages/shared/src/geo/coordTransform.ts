/**
 * GCJ-02（火星坐标/高德/腾讯） ↔ WGS-84（GPS/OSM/Google 国际）坐标系转换。
 *
 * RailVista 中折线（OSM / 精品走廊 / stations-geo.json）均为 WGS-84，
 * 而高德地理编码兜底返回 GCJ-02，若不转换会引入 300~600m 系统偏移，
 * 直接污染站点投影里程与后续 ETA 计算。
 *
 * 本实现采用标准偏导迭代法（精度 < 1m），纯函数无副作用。
 */

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;
const X_PI = PI * 3_000 / 180.0;

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 + 2.0 * x - 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/** GCJ-02 坐标偏移量（相对 WGS-84） */
function delta(lngWgs: number, latWgs: number): { dLng: number; dLat: number } {
  let dLat = transformLat(lngWgs - 105.0, latWgs - 35.0);
  let dLng = transformLng(lngWgs - 105.0, latWgs - 35.0);
  const radLat = (latWgs / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { dLng, dLat };
}

/**
 * GCJ-02 → WGS-84（精确迭代法，精度 < 1m）。
 * 用于高德地理编码兜底坐标转换到与折线一致的 WGS-84 坐标系。
 */
export function gcj02ToWgs84(lng: number, lat: number): { lng: number; lat: number } {
  const { dLng, dLat } = delta(lng, lat);
  const lngWgs = lng - dLng;
  const latWgs = lat - dLat;
  const { dLng: dLng2, dLat: dLat2 } = delta(lngWgs, latWgs);
  return { lng: lng - dLng2, lat: lat - dLat2 };
}

/**
 * WGS-84 → GCJ-02（正向偏移，用于反向校验或写入高德格式）。
 */
export function wgs84ToGcj02(lng: number, lat: number): { lng: number; lat: number } {
  const { dLng, dLat } = delta(lng, lat);
  return { lng: lng + dLng, lat: lat + dLat };
}