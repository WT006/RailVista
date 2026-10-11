/**
 * 旅途天象时间轴（RailVista 天象观景 · 核心算法）
 *
 * 沿列车里程-时间曲线逐步采样，对每个采样点计算：
 *   位置（折线插值）→ 列车航向 → 太阳/月亮地平坐标 → 天光相位分类
 * 再把连续同相位采样归并成「天象片段（episode）」，并精化出日出/日落/月出/月落时刻。
 *
 * 车窗左右侧判定：
 *   rel = normalize(sunAz − trainHeading) ∈ (−180°, 180°]
 *   rel > 0 → 太阳在行进方向右侧车窗；rel < 0 → 左侧；|rel| ≤ 45° 偏前方；|rel| ≥ 135° 偏后方。
 */
import type { LngLat, RailwayPoint, ScenicSpot, Stop } from '../types.js';
import { pointAtProgress } from '../schedule/progress.js';
import { moonPhase, moonPosition, type MoonPhase } from './moon.js';
import { equatorialToHorizontal } from './sun.js';
import { estimateLightPollution, type LightPollutionEstimate } from './lightPollution.js';
import {
  findAltitudeCrossings,
  sunPosition,
  ASTRONOMICAL_TWILIGHT_ALT_DEG,
  GOLDEN_BLUE_ALT_DEG,
  GOLDEN_HOUR_ALT_DEG,
  GLOW_ALT_DEG,
  NAUTICAL_TWILIGHT_ALT_DEG,
  SUN_RISE_ALT_DEG,
} from './sun.js';

/** 天光相位 */
export type SkyPhaseKind =
  | 'dawnGlow' // 朝霞窗口
  | 'sunrise' // 日出
  | 'goldenMorning' // 金色时刻（晨）
  | 'blueMorning' // 蓝色时刻（晨）
  | 'day' // 白天
  | 'goldenEvening' // 金色时刻（昏）
  | 'duskGlow' // 晚霞窗口
  | 'sunset' // 日落
  | 'blueEvening' // 蓝色时刻（昏）
  | 'nautical' // 航海晨昏蒙影
  | 'astroTwilight' // 天文晨昏蒙影
  | 'night'; // 夜间

/** 车窗侧（相对行进方向） */
export type SkySide = 'left' | 'right';
export type SkyFacing = 'front' | 'ahead' | 'side' | 'behind';

export interface SkySideInfo {
  side: SkySide;
  /** 相对方位角（−180~180，正=右侧） */
  relAngleDeg: number;
  facing: SkyFacing;
  /** 文案：如「右侧车窗 · 偏前方」 */
  label: string;
}

export interface SkyEpisode {
  id: string;
  kind: SkyPhaseKind;
  /** 中文标题：如「晚霞窗口」 */
  title: string;
  startMs: number;
  endMs: number;
  startIso: string;
  endIso: string;
  /** 里程（km） */
  startKm: number;
  endKm: number;
  /** 中点位置 */
  lng: number;
  lat: number;
  /** 最近站/景点名 */
  nearName: string;
  /** 中点太阳/月亮状态 */
  sunAltDeg: number;
  sunAzDeg: number;
  moonAltDeg: number;
  moonAzDeg: number;
  /** 太阳侧别（朝霞/日出/金色/晚霞/日落类事件） */
  sunSide: SkySideInfo;
  /** 月亮侧别（夜间事件） */
  moonSide: SkySideInfo;
  /** 中点光污染估算 */
  light: LightPollutionEstimate;
  /** 夜间片段：银心（人马座方向，银河最亮处）地平坐标与车窗侧别 */
  galCenter?: { altDeg: number; azDeg: number; side: SkySideInfo };
}

export interface SkyMoment {
  kind: 'sunrise' | 'sunset' | 'moonrise' | 'moonset';
  title: string;
  atMs: number;
  atIso: string;
  lng: number;
  lat: number;
  nearName: string;
  sideInfo: SkySideInfo;
}

export interface SkyTripResult {
  episodes: SkyEpisode[];
  moments: SkyMoment[];
  moon: MoonPhase;
  /** 行程中点的光污染（概览卡用） */
  light: LightPollutionEstimate;
}

export interface SkyTripInput {
  path: RailwayPoint[];
  lengthKm: number;
  /** 时刻（绝对 ms）→ 里程（km） */
  kmAtTime: (ms: number) => number;
  departureMs: number;
  arrivalMs: number;
  stops?: Stop[];
  spots?: ScenicSpot[];
  /** 采样步长（ms），默认 4 分钟 */
  stepMs?: number;
}

const PHASE_TITLES: Record<SkyPhaseKind, string> = {
  dawnGlow: '朝霞窗口',
  sunrise: '日出',
  goldenMorning: '晨间金色时刻',
  blueMorning: '晨间蓝色时刻',
  day: '白天',
  goldenEvening: '黄昏金色时刻',
  duskGlow: '晚霞窗口',
  sunset: '日落',
  blueEvening: '黄昏蓝色时刻',
  nautical: '航海蒙影',
  astroTwilight: '天文蒙影',
  night: '夜间',
};

/** 朝霞/晚霞/金色/蓝色/日出日落是「看点」，夜间与白天段在 UI 中压缩展示 */
const HIGHLIGHT_KINDS = new Set<SkyPhaseKind>([
  'dawnGlow',
  'sunrise',
  'goldenMorning',
  'blueMorning',
  'goldenEvening',
  'duskGlow',
  'sunset',
  'blueEvening',
]);

function rad(d: number): number {
  return (d * Math.PI) / 180;
}

function deg(r: number): number {
  return (r * 180) / Math.PI;
}

function norm180(degIn: number): number {
  let d = ((degIn + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

function norm360(degIn: number): number {
  return ((degIn % 360) + 360) % 360;
}

/** 折线在 given km 处的航向角（度，正北 0，顺时针） */
export function headingAtKm(path: RailwayPoint[], lengthKm: number, km: number): number {
  if (path.length < 2) return 0;
  const target = Math.max(0, Math.min(lengthKm, km));
  for (let i = 1; i < path.length; i += 1) {
    if (path[i].distFromStart >= target || i === path.length - 1) {
      const a = path[i - 1];
      const b = path[i];
      const dx = (b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
      const dy = b.lat - a.lat;
      return norm360(deg(Math.atan2(dx, dy)) + 360) % 360;
    }
  }
  return 0;
}

/** 车窗侧别判定 */
export function sideFromRelativeAngle(relAngleDeg: number): SkySideInfo {
  const rel = norm180(relAngleDeg);
  const side: SkySide = rel >= 0 ? 'right' : 'left';
  const abs = Math.abs(rel);
  const facing: SkyFacing = abs <= 45 ? 'front' : abs >= 135 ? 'behind' : 'side';
  const facingText =
    facing === 'front' ? '偏前方' : facing === 'behind' ? '偏后方' : side === 'right' ? '右侧' : '左侧';
  return {
    side,
    relAngleDeg: Math.round(rel * 10) / 10,
    facing,
    label: facing === 'front' ? `正前偏${side === 'right' ? '右' : '左'}` : facing === 'behind' ? `正后偏${side === 'right' ? '右' : '左'}` : `${facingText}车窗`,
  };
}

/** 天光相位分档（互斥，按太阳高度角 + 升落方向） */
function classifyPhase(sunAltDeg: number, rising: boolean): SkyPhaseKind {
  if (sunAltDeg >= GOLDEN_HOUR_ALT_DEG) return 'day'; // ≥ +6°
  if (sunAltDeg >= 0) return rising ? 'goldenMorning' : 'goldenEvening'; // 0° ~ +6° 金色时刻
  if (sunAltDeg >= GOLDEN_BLUE_ALT_DEG) return rising ? 'dawnGlow' : 'duskGlow'; // -4° ~ 0° 霞光核心
  if (sunAltDeg >= -6) return rising ? 'blueMorning' : 'blueEvening'; // -6° ~ -4° 蓝色时刻
  if (sunAltDeg >= NAUTICAL_TWILIGHT_ALT_DEG) return 'nautical';
  if (sunAltDeg >= ASTRONOMICAL_TWILIGHT_ALT_DEG) return 'astroTwilight';
  return 'night';
}

function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(h));
}

function nearestName(lng: number, lat: number, stops?: Stop[], spots?: ScenicSpot[]): string {
  let bestName = '';
  let bestD = Infinity;
  for (const s of stops ?? []) {
    if (s.lng == null || s.lat == null) continue;
    const d = haversineKm({ lng, lat }, { lng: s.lng, lat: s.lat });
    if (d < bestD) {
      bestD = d;
      bestName = s.name;
    }
  }
  for (const s of spots ?? []) {
    if (!Number.isFinite(s.lng) || !Number.isFinite(s.lat)) continue;
    const d = haversineKm({ lng, lat }, { lng: s.lng, lat: s.lat });
    if (d < bestD * 0.6) {
      bestD = d;
      bestName = s.name;
    }
  }
  return bestName;
}

interface Sample {
  t: number;
  km: number;
  lng: number;
  lat: number;
  heading: number;
  sunAlt: number;
  sunAz: number;
  moonAlt: number;
  moonAz: number;
  kind: SkyPhaseKind;
  rising: boolean;
}

/**
 * 构建旅途天象时间轴。纯计算，可直接在浏览器运行。
 */
export function buildSkyTripTimeline(input: SkyTripInput): SkyTripResult {
  const { path, lengthKm, kmAtTime, departureMs, arrivalMs, stops, spots } = input;
  const stepMs = input.stepMs ?? 4 * 60_000;
  const t0 = Math.min(departureMs, arrivalMs);
  const t1 = Math.max(departureMs, arrivalMs);

  const samples: Sample[] = [];
  let prevSunAlt: number | null = null;
  for (let t = t0; t <= t1 + 1; t += stepMs) {
    const km = Math.max(0, Math.min(lengthKm, kmAtTime(t)));
    const progress = lengthKm > 0 ? km / lengthKm : 0;
    const pt = pointAtProgress(path, lengthKm, progress);
    const heading = headingAtKm(path, lengthKm, km);
    const sun = sunPosition(pt.lng, pt.lat, t);
    const moon = moonPosition(pt.lng, pt.lat, t);
    const rising = prevSunAlt == null ? sun.altitudeDeg >= 0 : sun.altitudeDeg > prevSunAlt;
    samples.push({
      t,
      km,
      lng: pt.lng,
      lat: pt.lat,
      heading,
      sunAlt: sun.altitudeDeg,
      sunAz: sun.azimuthDeg,
      moonAlt: moon.altitudeDeg,
      moonAz: moon.azimuthDeg,
      kind: classifyPhase(sun.altitudeDeg, rising),
      rising,
    });
    prevSunAlt = sun.altitudeDeg;
  }
  if (!samples.length) {
    return {
      episodes: [],
      moments: [],
      moon: moonPhase(t0),
      light: estimateLightPollution(path[0]?.lng ?? 104, path[0]?.lat ?? 35),
    };
  }

  // 归并连续同相位片段
  const episodes: SkyEpisode[] = [];
  let segStart = 0;
  const flush = (endIdx: number) => {
    const first = samples[segStart]!;
    const last = samples[endIdx]!;
    const mid = samples[Math.floor((segStart + endIdx) / 2)]!;
    const sunRel = norm180(mid.sunAz - mid.heading);
    const moonRel = norm180(mid.moonAz - mid.heading);
    // 夜段附银心方位（银河最亮处，人马座方向）
    let galCenter: SkyEpisode['galCenter'];
    if (first.kind === 'night' || first.kind === 'astroTwilight') {
      const gc = equatorialToHorizontal(mid.lng, mid.lat, mid.t, {
        raDeg: 266.4,
        decDeg: -28.94,
      });
      galCenter = {
        altDeg: Math.round(gc.altitudeDeg * 10) / 10,
        azDeg: Math.round(gc.azimuthDeg * 10) / 10,
        side: sideFromRelativeAngle(norm180(gc.azimuthDeg - mid.heading)),
      };
    }
    episodes.push({
      id: `sky-${episodes.length}`,
      kind: first.kind,
      title: PHASE_TITLES[first.kind],
      startMs: first.t,
      endMs: last.t + stepMs,
      startIso: new Date(first.t).toISOString(),
      endIso: new Date(last.t + stepMs).toISOString(),
      startKm: first.km,
      endKm: last.km,
      lng: mid.lng,
      lat: mid.lat,
      nearName: nearestName(mid.lng, mid.lat, stops, spots),
      sunAltDeg: Math.round(mid.sunAlt * 10) / 10,
      sunAzDeg: Math.round(mid.sunAz * 10) / 10,
      moonAltDeg: Math.round(mid.moonAlt * 10) / 10,
      moonAzDeg: Math.round(mid.moonAz * 10) / 10,
      sunSide: sideFromRelativeAngle(sunRel),
      moonSide: sideFromRelativeAngle(moonRel),
      light: estimateLightPollution(mid.lng, mid.lat),
      galCenter,
    });
  };
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i]!.kind !== samples[segStart]!.kind) {
      flush(i - 1);
      segStart = i;
    }
  }
  flush(samples.length - 1);

  // 关键时刻：日出/日落（0.833° 穿越）+ 月出/月落，二分精化
  const moments: SkyMoment[] = [];
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const locAt = (ms: number): { lng: number; lat: number; heading: number; km: number } => {
    const km = Math.max(0, Math.min(lengthKm, kmAtTime(ms)));
    const pt = pointAtProgress(path, lengthKm, lengthKm > 0 ? km / lengthKm : 0);
    return { lng: pt.lng, lat: pt.lat, heading: headingAtKm(path, lengthKm, km), km };
  };

  const addCrossings = (
    kind: 'sunrise' | 'sunset' | 'moonrise' | 'moonset',
    targetAlt: number,
  ) => {
    const altWithLoc = (ms: number) => {
      const loc = locAt(ms);
      return kind.startsWith('sun')
        ? sunPosition(loc.lng, loc.lat, ms).altitudeDeg
        : moonPosition(loc.lng, loc.lat, ms).altitudeDeg;
    };
    const { riseMs, setMs } = findAltitudeCrossings(altWithLoc, first.t, last.t, targetAlt, 8 * 60_000);
    const at = kind === 'sunrise' || kind === 'moonrise' ? riseMs : setMs;
    if (at == null) return;
    const loc = locAt(at);
    const az =
      kind.startsWith('sun')
        ? sunPosition(loc.lng, loc.lat, at).azimuthDeg
        : moonPosition(loc.lng, loc.lat, at).azimuthDeg;
    moments.push({
      kind,
      title: kind === 'sunrise' ? '日出' : kind === 'sunset' ? '日落' : kind === 'moonrise' ? '月出' : '月落',
      atMs: at,
      atIso: new Date(at).toISOString(),
      lng: loc.lng,
      lat: loc.lat,
      nearName: nearestName(loc.lng, loc.lat, stops, spots),
      sideInfo: sideFromRelativeAngle(norm180(az - loc.heading)),
    });
  };
  addCrossings('sunrise', SUN_RISE_ALT_DEG);
  addCrossings('sunset', SUN_RISE_ALT_DEG);
  addCrossings('moonrise', 0);
  addCrossings('moonset', 0);
  moments.sort((a, b) => a.atMs - b.atMs);

  const midSample = samples[Math.floor(samples.length / 2)]!;
  return {
    episodes,
    moments,
    moon: moonPhase(departureMs),
    light: estimateLightPollution(midSample.lng, midSample.lat),
  };
}

/** 供 UI 过滤：只保留看点片段 */
export function highlightEpisodes(episodes: SkyEpisode[]): SkyEpisode[] {
  return episodes.filter((e) => HIGHLIGHT_KINDS.has(e.kind) || (e.kind === 'night' && e.endMs - e.startMs > 2 * 3_600_000));
}

/** 地图渲染用结果包：时间轴 + 各片段指数（前端合成后回传） */
export interface SkyMapResult {
  result: SkyTripResult;
  scores: Record<string, import('./skyIndex.js').SkyIndex>;
}
