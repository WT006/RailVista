/**
 * 自驾轨迹关键点采样器（零框架依赖）。
 *
 * 只记录关键点（起点/终点/途经/停留/打卡/章节），不存每秒坐标 ——
 * 省电省流量。7 天行程典型仅 ~200 个关键点（对比每秒记录约 60 万点，省 99.9%）。
 *
 * 采样规则：
 *   - 首次 feed → start
 *   - 位移 >500m 且距上个 pass ≥120s → pass
 *   - 速度 <5km/h 持续 >5min → stay（记录驻留时长）
 *   - 进入 highlight 100m 半径 → checkin（同一 highlight 仅一次）
 *   - 跨章节边界 → chapter
 *   - finish() → end
 */

import type {
  DriveHighlight,
  RoadbookChapter,
  TrackKeyPoint,
  TrackPointType,
} from '../types.js';

export interface FeedSample {
  lng: number;
  lat: number;
  /** epoch ms */
  ts: number;
  speedKmh?: number;
  heading?: number;
  /** 投影后的里程桩（km），调用方传入 */
  alongKm?: number;
}

export interface TrackSamplerOptions {
  highlights?: DriveHighlight[];
  chapters?: RoadbookChapter[];
  /** 途经点最小间距（m），默认 500 */
  passMinM?: number;
  /** 途经点最小间隔（s），默认 120 */
  passMinSec?: number;
  /** 驻留判定速度阈值（km/h），默认 5 */
  dwellSpeedKmh?: number;
  /** 驻留判定持续时长（ms），默认 5min */
  dwellMinMs?: number;
  /** 打卡半径（m），默认 100 */
  checkinM?: number;
}

export interface TrackSampler {
  feed(sample: FeedSample): TrackKeyPoint[];
  /** 结束记录，返回 end 点（若有） */
  finish(ts: number): TrackKeyPoint[];
  /** 当前已采样点数 */
  readonly pointCount: number;
}

export function createTrackSampler(opts: TrackSamplerOptions = {}): TrackSampler {
  const passMinM = opts.passMinM ?? 500;
  const passMinSec = opts.passMinSec ?? 120;
  const dwellSpeedKmh = opts.dwellSpeedKmh ?? 5;
  const dwellMinMs = opts.dwellMinMs ?? 5 * 60 * 1000;
  const checkinM = opts.checkinM ?? 100;

  const highlights = opts.highlights ?? [];
  const chapters = opts.chapters ?? [];

  let started = false;
  let lastPassTs = 0;
  let lastPass: { lng: number; lat: number } | null = null;
  let dwellStartTs: number | null = null;
  let lastChapterIdx = -1;
  const checkedIn = new Set<string>();

  const points: TrackKeyPoint[] = [];

  function push(type: TrackPointType, sample: FeedSample, extra: Partial<TrackKeyPoint> = {}) {
    const p: TrackKeyPoint = {
      type,
      at: new Date(sample.ts).toISOString(),
      lng: sample.lng,
      lat: sample.lat,
      alongKm: sample.alongKm,
      heading: sample.heading,
      speedKmh: sample.speedKmh,
      ...extra,
    };
    points.push(p);
    return p;
  }

  function findHighlightWithin(sample: FeedSample): DriveHighlight | undefined {
    if (!sample.alongKm) return undefined;
    // 里程桩在 highlight 附近（沿路 ±checkinM）且横向距离近
    for (const h of highlights) {
      if (checkedIn.has(h.id)) continue;
      const dKm = Math.abs(h.alongKm - (sample.alongKm ?? 0));
      if (dKm * 1000 <= checkinM) return h;
    }
    return undefined;
  }

  function currentChapterIdx(alongKm: number | undefined): number {
    if (alongKm == null || chapters.length === 0) return -1;
    for (let i = 0; i < chapters.length; i += 1) {
      if (alongKm >= chapters[i].fromKm && alongKm < chapters[i].toKm) return i;
    }
    return chapters.length - 1;
  }

  function feed(sample: FeedSample): TrackKeyPoint[] {
    const emitted: TrackKeyPoint[] = [];

    if (!started) {
      emitted.push(push('start', sample));
      started = true;
      lastPassTs = sample.ts;
      lastPass = { lng: sample.lng, lat: sample.lat };
    }

    // 打卡
    const hit = findHighlightWithin(sample);
    if (hit) {
      checkedIn.add(hit.id);
      emitted.push(push('checkin', sample, { highlightId: hit.id, label: hit.name }));
    }

    // 章节
    const chapterIdx = currentChapterIdx(sample.alongKm);
    if (chapterIdx >= 0 && chapterIdx !== lastChapterIdx) {
      lastChapterIdx = chapterIdx;
      emitted.push(push('chapter', sample, { chapterId: chapters[chapterIdx]?.id }));
    }

    // 途经：位移 + 时间双阈值
    if (lastPass) {
      const distM = haversineM(lastPass, sample);
      const dtSec = (sample.ts - lastPassTs) / 1000;
      if (distM >= passMinM && dtSec >= passMinSec) {
        emitted.push(push('pass', sample));
        lastPass = { lng: sample.lng, lat: sample.lat };
        lastPassTs = sample.ts;
      }
    }

    // 驻留检测
    const speed = sample.speedKmh ?? 1e9;
    if (speed < dwellSpeedKmh) {
      if (dwellStartTs == null) dwellStartTs = sample.ts;
      if (sample.ts - dwellStartTs >= dwellMinMs) {
        emitted.push(push('stay', sample, {
          dwellMin: Math.round((sample.ts - dwellStartTs) / 60000),
        }));
        dwellStartTs = null; // 重置，避免连续触发
      }
    } else {
      dwellStartTs = null;
    }

    return emitted;
  }

  function finish(ts: number): TrackKeyPoint[] {
    const last = points[points.length - 1];
    const sample: FeedSample = last
      ? { lng: last.lng, lat: last.lat, ts, alongKm: last.alongKm, heading: last.heading, speedKmh: last.speedKmh }
      : { lng: 0, lat: 0, ts };
    // 避免与 start 重复（空轨迹）
    if (points.length === 0) {
      return [];
    }
    return [push('end', sample)];
  }

  return {
    feed,
    finish,
    get pointCount() {
      return points.length;
    },
  };
}

function haversineM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h)) * 1000;
}
