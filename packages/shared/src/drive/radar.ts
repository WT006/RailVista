/**
 * 小确幸雷达（零框架依赖）。
 *
 * 输入：当前 GPS（位置 + 速度 m/s + 航向）+ 线路（geometry/cumKm）+ 小确幸列表。
 * 输出：前方主卡片、次卡片、错过的点位、当前里程桩、方向、车速带、偏离距离。
 *
 * 硬规则（需求方明确，勿偏离）：
 *   - 车速 > 80km/h → 只推 worthSlowDown（值得减速）
 *   - 车速 < 40km/h → 只推 canPark（可以停车）
 *   - 40~80km/h    → 两者都推
 *   - 高速时 worthSlowDown 优先于距离排序（否则普通点会挤掉"错过可惜"的点）
 *   - 前瞻距离 lookahead = clamp(speedKmh * 0.05, 3, 15) km
 */

import type { DriveHighlight, RadarHit, RadarResult, SpeedBand } from '../types.js';
import { projectToRoute, resolveDirection, type DriveCoords, type DriveDirection } from './geo.js';

export interface RadarInput {
  lng: number;
  lat: number;
  /** GPS 速度（m/s），缺省按 0 处理 */
  speedMs?: number;
  /** GPS 航向（度），缺省按 unknown 处理 */
  heading?: number;
  /** 线路折线 */
  geometry: DriveCoords;
  /** 线路总里程（km） */
  totalKm: number;
  /** 该线小确幸 */
  highlights: DriveHighlight[];
  /** 通知半径（m），默认 500 */
  notifyM?: number;
}

/** 车速 → 车速带 */
export function speedBandOf(speedKmh: number): SpeedBand {
  if (speedKmh > 80) return 'fast';
  if (speedKmh < 40) return 'slow';
  return 'cruise';
}

/** 前瞻距离（km）：随车速伸缩 */
export function lookaheadKmOf(speedKmh: number): number {
  return Math.min(15, Math.max(3, speedKmh * 0.05));
}

/** 沿行驶方向，目标里程桩在当前点的前方距离（km）；环线需考虑总长回绕 */
function aheadKmOf(along: number, cur: number, direction: DriveDirection, totalKm: number): number {
  if (direction === 'backward') {
    let d = cur - along;
    if (d < 0) d += totalKm;
    return d;
  }
  let d = along - cur;
  if (d < 0) d += totalKm;
  return d;
}

/** 生成单条命中 */
function toHit(
  h: DriveHighlight,
  aheadKm: number,
  speedKmh: number,
  notifyM: number,
): RadarHit {
  const etaSec = speedKmh > 0 ? Math.round((aheadKm / speedKmh) * 3600) : null;
  const rounded = aheadKm >= 1 ? aheadKm.toFixed(1) : Math.round(aheadKm * 1000).toString();
  const unit = aheadKm >= 1 ? '公里' : '米';
  return {
    highlight: h,
    aheadKm,
    etaSec,
    cardText: `前方 ${rounded} ${unit}・小确幸：${h.name}`,
    notify: aheadKm * 1000 <= notifyM,
    sideText: h.side === 'left' ? '左侧' : h.side === 'right' ? '右侧' : '',
  };
}

export function computeRadar(input: RadarInput): RadarResult {
  const speedKmh = (input.speedMs ?? 0) * 3.6;
  const notifyM = input.notifyM ?? 500;

  const proj = projectToRoute(input.geometry, input.lng, input.lat);
  const direction = resolveDirection(input.heading, proj.tangentHeading);
  const band = speedBandOf(speedKmh);
  const lookahead = lookaheadKmOf(speedKmh);

  // 方向匹配：点位的 direction 约束
  const directionOk = (h: DriveHighlight): boolean =>
    !h.direction || h.direction === 'both' || h.direction === direction;

  // 前瞻窗口内的候选（含身后 0~1km 的"错过"检测用）
  const aheadCandidates = input.highlights.filter((h) => {
    if (!directionOk(h)) return false;
    const d = aheadKmOf(h.alongKm, proj.alongKm, direction, input.totalKm);
    return d >= 0 && d <= lookahead;
  });

  // ★ 车速感知过滤 ★
  const filtered = aheadCandidates.filter((h) => {
    if (band === 'fast') return h.worthSlowDown;
    if (band === 'slow') return h.canPark;
    return h.worthSlowDown || h.canPark;
  });

  // 排序：高速时 worthSlowDown 优先；否则按距离
  const byAhead = (a: DriveHighlight, b: DriveHighlight) =>
    aheadKmOf(a.alongKm, proj.alongKm, direction, input.totalKm) -
    aheadKmOf(b.alongKm, proj.alongKm, direction, input.totalKm);

  const sorted = filtered.sort((a, b) => {
    if (band === 'fast' && a.worthSlowDown !== b.worthSlowDown) {
      return a.worthSlowDown ? -1 : 1;
    }
    return byAhead(a, b);
  });

  const primary = sorted[0]
    ? toHit(sorted[0], aheadKmOf(sorted[0].alongKm, proj.alongKm, direction, input.totalKm), speedKmh, notifyM)
    : null;
  const secondary = sorted[1]
    ? toHit(sorted[1], aheadKmOf(sorted[1].alongKm, proj.alongKm, direction, input.totalKm), speedKmh, notifyM)
    : null;

  // 错过检测：身后 0~1km 内的 worthSlowDown 点
  const behind = input.highlights
    .filter((h) => h.worthSlowDown && directionOk(h))
    .filter((h) => {
      const d = aheadKmOf(h.alongKm, proj.alongKm, direction, input.totalKm);
      return d > input.totalKm - 1 && d <= input.totalKm; // 等价于身后 0~1km（回绕）
    })
    .filter((h) => h.alongKm !== (primary?.highlight.alongKm ?? -1));
  const missedHit = behind[0]
    ? toHit(behind[0], 0, speedKmh, notifyM)
    : null;

  return {
    primary,
    secondary,
    missed: missedHit,
    alongKm: proj.alongKm,
    direction,
    band,
    offRouteM: proj.offRouteM,
  };
}
