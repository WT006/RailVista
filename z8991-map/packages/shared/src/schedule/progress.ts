import type { GpsSample, LngLat, ProgressResult, RailwayPoint, ScenicSpot, Stop } from '../types.js';
import { effectiveScheduleDate, formatDepartLong, formatTime, shiftDate } from './index.js';
import type { CalibrationRecord } from '../types.js';

export function haversineKm(a: LngLat, b: LngLat): number {
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

export function buildPolyline(stops: Array<{ lng?: number; lat?: number }>): [number, number][] {
  return stops
    .filter((s): s is { lng: number; lat: number } => s.lng != null && s.lat != null)
    .map((s) => [s.lng, s.lat]);
}

/**
 * 按上下车站投影，从完整铁路线截取 OD 区间折线。
 * 无坐标或投影失败时返回 null，调用方应回退站点连线。
 */
export function slicePolylineByOd(
  fullCoords: [number, number][],
  from: { lng?: number; lat?: number },
  to: { lng?: number; lat?: number },
): [number, number][] | null {
  if (fullCoords.length < 2 || from.lng == null || from.lat == null || to.lng == null || to.lat == null) {
    return null;
  }
  const { path, lengthKm } = buildRailwayMetrics(fullCoords);
  if (lengthKm <= 0) return null;

  const a = projectToRailway(path, lengthKm, from.lng, from.lat);
  const b = projectToRailway(path, lengthKm, to.lng, to.lat);
  // 大型枢纽/联络线可能离主线稍远，放宽到 45km
  if (a.distKm > 45 || b.distKm > 45) return null;

  let p0 = Math.min(a.progress, b.progress);
  let p1 = Math.max(a.progress, b.progress);
  if (p1 - p0 < 0.0005) return null;

  const startKm = p0 * lengthKm;
  const endKm = p1 * lengthKm;
  const out: [number, number][] = [];

  const startPt = pointAtProgress(path, lengthKm, p0);
  out.push([startPt.lng, startPt.lat]);

  for (let i = 0; i < path.length; i += 1) {
    const d = path[i].distFromStart;
    if (d > startKm && d < endKm) {
      out.push([path[i].lng, path[i].lat]);
    }
  }

  const endPt = pointAtProgress(path, lengthKm, p1);
  out.push([endPt.lng, endPt.lat]);

  return out.length >= 2 ? out : null;
}

/** 优先用精细折线，否则站点连线 */
export function resolveTripPolyline(params: {
  stops: Array<{ lng?: number; lat?: number }>;
  preciseRailway?: [number, number][] | null;
}): { coords: [number, number][]; source: 'precise' | 'station' } {
  const stationLine = buildPolyline(params.stops);
  const odFrom = params.stops[0];
  const odTo = params.stops[params.stops.length - 1];
  const odEndsHaveCoords =
    odFrom?.lng != null &&
    odFrom?.lat != null &&
    odTo?.lng != null &&
    odTo?.lat != null;

  if (params.preciseRailway && params.preciseRailway.length >= 2) {
    // 首末站缺坐标时不要用「中间有坐标的站」当 OD，否则会把沪昆截成上海→长沙
    if (!odEndsHaveCoords) {
      return { coords: params.preciseRailway, source: 'precise' };
    }

    const from = odFrom;
    const to = odTo;

    // 若传入的已是站点折线（点数少且接近站点数），直接用
    if (
      params.preciseRailway.length <= Math.max(stationLine.length * 2, 8) &&
      stationLine.length >= 2
    ) {
      const sliced = slicePolylineByOd(params.preciseRailway, from, to);
      if (sliced && sliced.length >= 2) {
        const looksPrecise = params.preciseRailway.length >= stationLine.length + 2;
        return {
          coords: sliced,
          source: looksPrecise ? 'precise' : 'station',
        };
      }
      return {
        coords: params.preciseRailway,
        source: params.preciseRailway.length >= stationLine.length + 2 ? 'precise' : 'station',
      };
    }
    const sliced = slicePolylineByOd(params.preciseRailway, from, to);
    if (sliced && sliced.length >= 2) {
      return { coords: sliced, source: 'precise' };
    }
    // 截取失败时仍使用完整精细线，避免空白地图
    return { coords: params.preciseRailway, source: 'precise' };
  }
  return { coords: stationLine, source: 'station' };
}

export function buildRailwayMetrics(coords: [number, number][]): {
  path: RailwayPoint[];
  lengthKm: number;
} {
  const path: RailwayPoint[] = coords.map(([lng, lat], index) => ({
    lng,
    lat,
    index,
    distFromStart: 0,
  }));
  let lengthKm = 0;
  for (let i = 1; i < path.length; i += 1) {
    lengthKm += haversineKm(path[i - 1], path[i]);
    path[i].distFromStart = lengthKm;
  }
  return { path, lengthKm };
}

function interpolatePoint(a: LngLat, b: LngLat, t: number): LngLat {
  return {
    lng: a.lng + (b.lng - a.lng) * t,
    lat: a.lat + (b.lat - a.lat) * t,
  };
}

export function pointAtProgress(path: RailwayPoint[], lengthKm: number, progress: number): LngLat {
  if (!path.length) return { lng: 0, lat: 0 };
  const clamped = Math.max(0, Math.min(1, progress));
  if (lengthKm <= 0) return { lng: path[0].lng, lat: path[0].lat };
  const target = clamped * lengthKm;
  for (let i = 1; i < path.length; i += 1) {
    if (path[i].distFromStart >= target) {
      const prev = path[i - 1];
      const curr = path[i];
      const segLen = curr.distFromStart - prev.distFromStart || 1;
      const t = (target - prev.distFromStart) / segLen;
      return interpolatePoint(prev, curr, t);
    }
  }
  const last = path[path.length - 1];
  return { lng: last.lng, lat: last.lat };
}

export function projectToRailway(
  path: RailwayPoint[],
  lengthKm: number,
  lng: number,
  lat: number,
): { distKm: number; progress: number; point: LngLat } {
  let best = { distKm: Infinity, progress: 0, point: path[0] as LngLat };
  if (!path.length || lengthKm <= 0) return best;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = b.distFromStart - a.distFromStart || 1;
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const t = Math.max(
      0,
      Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / (dx * dx + dy * dy || 1)),
    );
    const point = interpolatePoint(a, b, t);
    const distKm = haversineKm({ lng, lat }, point);
    const progress = (a.distFromStart + segLen * t) / lengthKm;
    if (distKm < best.distKm) best = { distKm, progress, point };
  }
  return best;
}

function stationEventIso(s: Stop): string[] {
  const out: string[] = [];
  if (s.at) out.push(s.at);
  if (s.arrive) out.push(s.arrive);
  if (s.depart) out.push(s.depart);
  if (s.arriveTime) out.push(combineDateTimeFallback(s.arriveTime));
  if (s.departTime) out.push(combineDateTimeFallback(s.departTime));
  return out.filter(Boolean);
}

/** HH:mm without date — caller should prefer absolute ISO on Stop */
function combineDateTimeFallback(t: string): string {
  if (t.includes('T') || t.includes('-')) return t;
  return t;
}

export function scheduleProgress(params: {
  now: Date;
  departure: Date;
  arrival: Date;
  stops: Stop[];
  offsetMs: number;
}): number {
  const { now, departure, arrival, stops, offsetMs } = params;
  const shifted = (iso: string) => shiftDate(iso, offsetMs);

  if (now <= departure) return 0;
  if (now >= arrival) return 1;

  const timeline: { at: Date; name: string }[] = [];
  stops.forEach((s) => {
    if (s.at) timeline.push({ at: shifted(s.at), name: s.name });
    if (s.arrive) timeline.push({ at: shifted(s.arrive), name: `${s.name}（到）` });
    if (s.depart) timeline.push({ at: shifted(s.depart), name: `${s.name}（开）` });
    // dynamic stops from 12306 may only have HH:mm — treat as absolute if already ISO
    if (!s.at && !s.arrive && s.arriveTime && s.arriveTime.includes('T')) {
      timeline.push({ at: shifted(s.arriveTime), name: `${s.name}（到）` });
    }
    if (!s.at && !s.depart && s.departTime && s.departTime.includes('T')) {
      timeline.push({ at: shifted(s.departTime), name: `${s.name}（开）` });
    }
  });
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

  for (let i = 0; i < timeline.length - 1; i += 1) {
    const cur = timeline[i];
    const next = timeline[i + 1];
    if (now >= cur.at && now <= next.at) {
      const span = next.at.getTime() - cur.at.getTime() || 1;
      const localT = (now.getTime() - cur.at.getTime()) / span;
      const idxA = stops.findIndex((s) => cur.name.startsWith(s.name));
      const idxB = stops.findIndex((s) => next.name.startsWith(s.name));
      const a = idxA >= 0 ? idxA / (stops.length - 1) : i / (timeline.length - 1);
      const b = idxB >= 0 ? idxB / (stops.length - 1) : (i + 1) / (timeline.length - 1);
      return a + (b - a) * localT;
    }
  }
  return (now.getTime() - departure.getTime()) / (arrival.getTime() - departure.getTime());
}

export function resolveProgress(params: {
  now: Date;
  departure: Date;
  arrival: Date;
  stops: Stop[];
  offsetMs: number;
  calibration: CalibrationRecord | null;
  gps: GpsSample | null;
  path: RailwayPoint[];
  lengthKm: number;
  simulatedProgress?: number | null;
  forceSchedule?: boolean;
}): ProgressResult {
  const {
    now,
    departure,
    arrival,
    stops,
    offsetMs,
    calibration,
    gps,
    path,
    lengthKm,
    simulatedProgress,
    forceSchedule,
  } = params;

  if (simulatedProgress != null) {
    return { progress: Math.max(0, Math.min(1, simulatedProgress)), mode: '模拟进度' };
  }

  const effectiveNow = effectiveScheduleDate(now, calibration);
  const scheduleP = scheduleProgress({
    now: effectiveNow,
    departure,
    arrival,
    stops,
    offsetMs,
  });
  const calibrated = !!calibration;
  const scheduleMode = calibrated ? '时刻表估算（已校准）' : '时刻表估算';

  if (forceSchedule || !gps || lengthKm <= 0 || path.length < 2) {
    return { progress: scheduleP, mode: scheduleMode };
  }

  const ageMs = now.getTime() - gps.timestamp;
  if (ageMs > 120000 || gps.accuracy > 800) {
    return {
      progress: scheduleP,
      mode: calibrated ? '时刻表估算（已校准·GPS 弱）' : '时刻表估算（GPS 信号弱）',
    };
  }

  const projected = projectToRailway(path, lengthKm, gps.lng, gps.lat);
  if (projected.distKm > 8) {
    return {
      progress: scheduleP,
      mode: calibrated ? '时刻表估算（已校准·偏离）' : '时刻表估算（偏离铁路较远）',
    };
  }

  const blended = projected.progress * 0.65 + scheduleP * 0.35;
  return {
    progress: blended,
    mode: calibrated ? 'GPS + 时刻表（已校准）' : 'GPS + 时刻表',
  };
}

export function formatEta(targetDate: Date, referenceNow: Date): string {
  const diffMin = Math.round((targetDate.getTime() - referenceNow.getTime()) / 60000);
  if (diffMin <= 0) return '即将经过或已通过';
  if (diffMin < 60) return `约 ${diffMin} 分钟后`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `约 ${h} 小时 ${m} 分钟后`;
}

export function getUpcoming(params: {
  now: Date;
  departure: Date;
  arrival: Date;
  progress: number;
  offsetMs: number;
  calibration: CalibrationRecord | null;
  spots: ScenicSpot[];
  stops: Stop[];
  path: RailwayPoint[];
  lengthKm: number;
}): { name: string; timeLabel?: string; intro?: string; reason: string; kind: 'spot' | 'station' | 'end' } {
  const { now, departure, arrival, progress, offsetMs, calibration, spots, stops, path, lengthKm } =
    params;
  const shifted = (iso: string) => shiftDate(iso, offsetMs);
  const effectiveNow = effectiveScheduleDate(now, calibration);

  const sortedSpots = [...spots].filter((s) => s.at).sort((a, b) => shifted(a.at!).getTime() - shifted(b.at!).getTime());

  if (progress <= 0 && now < departure && sortedSpots[0]) {
    return {
      name: sortedSpots[0].name,
      timeLabel: sortedSpots[0].timeLabel,
      intro: sortedSpots[0].intro,
      reason: `${formatDepartLong(departure)} 发车 · 首个计划风景点`,
      kind: 'spot',
    };
  }

  if (progress >= 1) {
    const last = stops[stops.length - 1];
    return {
      name: last?.name || '终点',
      timeLabel: formatTime(arrival),
      intro: last?.intro,
      reason: '行程已结束',
      kind: 'end',
    };
  }

  const upcomingByTime = sortedSpots.find((s) => shifted(s.at!) >= effectiveNow);
  if (upcomingByTime) {
    return {
      name: upcomingByTime.name,
      timeLabel: upcomingByTime.timeLabel,
      intro: upcomingByTime.intro,
      reason: formatEta(shifted(upcomingByTime.at!), effectiveNow),
      kind: 'spot',
    };
  }

  // next station by progress
  const n = Math.max(stops.length - 1, 1);
  const nextStop = stops.find((_, i) => i / n > progress + 0.001) || stops[stops.length - 1];
  if (nextStop) {
    const iso = nextStop.arrive || nextStop.arriveTime || nextStop.at || nextStop.depart || nextStop.departTime;
    return {
      name: nextStop.name,
      timeLabel: iso ? formatTime(shifted(iso)) : undefined,
      intro: nextStop.intro,
      reason: iso ? formatEta(shifted(iso), effectiveNow) : '下一站',
      kind: 'station',
    };
  }

  return {
    name: stops[stops.length - 1]?.name || '终点',
    timeLabel: formatTime(arrival),
    reason: '行程即将结束',
    kind: 'end',
  };
}

// silence unused import warning for stationEventIso if tree-shaken
void stationEventIso;
