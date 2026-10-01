/**
 * 小确幸雷达组合式函数（Web）。
 *
 * 复用零框架依赖的 computeRadar（packages/shared/src/drive），
 * 雷达在前端本地计算、禁止网络往返（隧道无信号场景）。
 * 支持真实 GPS 与「模拟进度」两种输入：模拟模式用于 Web 端预览与实测。
 */
import { ref, type Ref } from 'vue';
import {
  buildPath,
  computeRadar,
  bearingDeg,
  type DriveRoute,
  type DriveHighlight,
  type RadarResult,
} from '@railvista/shared';

export interface SimulatePoint {
  lng: number;
  lat: number;
  heading: number;
}

/** 沿线路折线，由进度（0~1）取坐标与切向航向 */
export function pointOnRoute(route: DriveRoute, progress: number): SimulatePoint {
  const geometry = route.geometry;
  if (geometry.length === 0) return { lng: 0, lat: 0, heading: 0 };
  const { path, lengthKm } = buildPath(geometry);
  if (lengthKm <= 0) return { lng: geometry[0][0], lat: geometry[0][1], heading: 0 };
  const clamped = Math.max(0, Math.min(1, progress));
  const target = clamped * lengthKm;
  for (let i = 1; i < path.length; i += 1) {
    if (path[i].distFromStart >= target) {
      const a = path[i - 1];
      const b = path[i];
      const segLen = b.distFromStart - a.distFromStart || 1;
      const t = (target - a.distFromStart) / segLen;
      return {
        lng: a.lng + (b.lng - a.lng) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        heading: bearingDeg(a, b),
      };
    }
  }
  const last = path[path.length - 1];
  return { lng: last.lng, lat: last.lat, heading: bearingDeg(path[path.length - 2], last) };
}

export function useDriveRadar(
  routeRef: Ref<DriveRoute | null>,
  highlightsRef: Ref<DriveHighlight[]>,
) {
  const radar = ref<RadarResult | null>(null);

  function update(gps: { lng: number; lat: number; speedMs?: number; heading?: number }) {
    const route = routeRef.value;
    if (!route || route.geometry.length < 2) {
      radar.value = null;
      return;
    }
    radar.value = computeRadar({
      lng: gps.lng,
      lat: gps.lat,
      speedMs: gps.speedMs,
      heading: gps.heading,
      geometry: route.geometry,
      totalKm: route.totalKm,
      highlights: highlightsRef.value,
    });
  }

  /** 模拟进度行驶（Web 预览）：progress 0~1，speedKmh 用于车速带判定 */
  function simulate(progress: number, speedKmh: number) {
    const route = routeRef.value;
    if (!route) return;
    const p = pointOnRoute(route, progress);
    update({ lng: p.lng, lat: p.lat, speedMs: speedKmh / 3.6, heading: p.heading });
  }

  return { radar, update, simulate };
}
