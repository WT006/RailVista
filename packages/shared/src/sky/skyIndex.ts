/**
 * 观景/天象质量指数（旅途天象算法 · 气象融合层）
 *
 * 输入为 ETA 时刻的气象采样（云端逐时数据，见 apps/api /api/sky/met），
 * 输出 0~100 指数 + 分档，供 UI 展示与时间轴排序。
 */

/** 逐时气象采样（云量/湿度等为 0~1 比例） */
export interface SkyMetSample {
  atIso: string;
  tempC?: number;
  dewPointC?: number;
  /** 相对湿度 0~1 */
  humidity?: number;
  /** 10m 风速 m/s */
  windSpeedMs?: number;
  /** 低/中/高云量 0~1 */
  cloudLow?: number;
  cloudMid?: number;
  cloudHigh?: number;
  /** 总云量 0~1 */
  totalCloud?: number;
  visibilityKm?: number;
  /** 降水概率 0~1 */
  precipProb?: number;
  /** 零度层高度 m */
  freezingLevelM?: number;
}

export type SkyIndexBand = 'excellent' | 'good' | 'fair' | 'poor';

export interface SkyIndex {
  score: number;
  band: SkyIndexBand;
  /** 一句话解释（UI 直接展示） */
  note: string;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function bandOf(score: number): SkyIndexBand {
  if (score >= 75) return 'excellent';
  if (score >= 55) return 'good';
  if (score >= 35) return 'fair';
  return 'poor';
}

function makeIndex(score: number, note: string): SkyIndex {
  const s = Math.round(Math.max(0, Math.min(100, score)));
  return { score: s, band: bandOf(s), note };
}

const BAND_LABELS: Record<SkyIndexBand, string> = {
  excellent: '极佳',
  good: '不错',
  fair: '一般',
  poor: '较差',
};

export function bandLabel(band: SkyIndexBand): string {
  return BAND_LABELS[band];
}

/**
 * 霞光指数（朝霞/晚霞共用）。
 * 摄影经验模型：
 *   - 中高云 30%~90% 是「画布」，没有云不出彩，全被低云堵死也看不见；
 *   - 低云 < 55% 才有透光缝；
 *   - 能见度好、湿度低 → 颜色通透；
 *   - 降水概率高 → 直接扣分。
 */
export function computeGlowIndex(met: SkyMetSample | undefined): SkyIndex {
  if (!met) return makeIndex(50, '暂无气象数据，仅按天文条件估计');
  const midHigh = clamp01(((met.cloudMid ?? 0) + (met.cloudHigh ?? 0)) / 2 + Math.max(met.cloudMid ?? 0, met.cloudHigh ?? 0) / 2);
  const low = met.cloudLow ?? met.totalCloud ?? 0.5;
  const vis = met.visibilityKm ?? 15;
  const humidity = met.humidity ?? 0.6;
  const precip = precipProbGuard(met);

  // 云量得分：中高云在 0.3~0.9 之间越高越好（梯形）
  let cloudScore: number;
  if (midHigh < 0.15) cloudScore = 25; // 天空太干净，缺少反射画布
  else if (midHigh <= 0.9) cloudScore = 60 + 40 * ((midHigh - 0.15) / 0.75);
  else cloudScore = 35; // 满天厚云

  const lowPenalty = clamp01((low - 0.55) / 0.45) * 55;
  const visScore = clamp01((vis - 2) / 18) * 25;
  const humPenalty = clamp01((humidity - 0.75) / 0.25) * 18;
  const precipPenalty = precip * 45;

  const score = cloudScore - lowPenalty + visScore - humPenalty - precipPenalty;
  const noteParts: string[] = [];
  noteParts.push(midHigh >= 0.3 && midHigh <= 0.9 ? '中高云适中，晚霞有画布' : midHigh < 0.15 ? '天空少云，霞光较平淡' : '云层偏厚');
  if (low > 0.65) noteParts.push('低云偏多可能挡住日面');
  if (vis >= 12) noteParts.push('能见度好');
  if (precip > 0.3) noteParts.push('降水概率较高');
  return makeIndex(score, noteParts.join('，'));
}

function precipProbGuard(met: SkyMetSample): number {
  return clamp01(met.precipProb ?? 0);
}

/**
 * 观星指数：暗夜（天文昏影）+ 月光干扰 + 云量 + 能见度 + 光污染。
 * 太阳高度越低越好，由调用方把「是否已入夜」并入 score（sunAltDeg 参数）。
 */
export function computeStarIndex(
  met: SkyMetSample | undefined,
  astro: { sunAltDeg: number; moonIllum: number; moonAltDeg: number; bortle: number },
): SkyIndex {
  const darkness = clamp01((-astro.sunAltDeg - 12) / 6) * 30; // -18° 以下满分
  // 月光干扰：亮度 × 高度（地平线下不干扰）
  const moonPenalty =
    astro.moonAltDeg > 0 ? clamp01(astro.moonIllum) * clamp01(astro.moonAltDeg / 45) * 32 : 0;
  const lightPenalty = clamp01((astro.bortle - 1) / 8) * 30;
  const cloud = met ? clamp01(met.totalCloud ?? ((met.cloudLow ?? 0) + (met.cloudMid ?? 0) + (met.cloudHigh ?? 0)) / 3) : 0.5;
  const cloudPenalty = cloud * 35;
  const visScore = met ? clamp01(((met.visibilityKm ?? 10) - 4) / 16) * 12 : 6;

  const score = 28 + darkness + visScore - moonPenalty - lightPenalty - cloudPenalty;
  const notes: string[] = [];
  if (astro.sunAltDeg > -12) notes.push('天尚未全暗');
  if (moonPenalty > 15) notes.push('月光明亮，暗星目标受影响');
  if (lightPenalty > 18) notes.push('光污染偏强');
  if (cloud > 0.6) notes.push('云量偏多');
  if (!notes.length) notes.push('暗夜条件不错');
  // 银河可见：真暗夜 + 新月窗（月光不压场）+ 低光污染 + 少云
  if (
    astro.sunAltDeg <= -18 &&
    astro.moonIllum < 0.25 &&
    astro.bortle <= 4 &&
    cloud < 0.4 &&
    (astro.moonAltDeg <= 0 || astro.moonIllum < 0.12)
  ) {
    notes.push('银河可见');
  }
  return makeIndex(score, notes.join('，'));
}

/**
 * 彩虹可能性：太阳在地平线上 + 有降水概率（阵雨）+ 天空未被全阴封死。
 * 需要「背对太阳看雨帘」，故只给可能性提示。
 */
export function computeRainbowIndex(met: SkyMetSample | undefined, sunAltDeg: number): SkyIndex {
  if (sunAltDeg <= 1) return makeIndex(0, '太阳不在地平线上，无彩虹');
  if (!met) return makeIndex(40, '暂无气象数据，仅按天文条件估计');
  const precip = precipProbGuard(met);
  const cloud = clamp01(met.totalCloud ?? 0.5);
  // 太阳越低彩虹越明显（>42° 看不到主虹）
  const sunScore = sunAltDeg < 42 ? clamp01((40 - sunAltDeg) / 40) * 35 : 0;
  const rainScore = precip >= 0.2 && precip <= 0.85 ? 45 * clamp01(precip / 0.6) : precip > 0.85 ? 10 : 0;
  const cloudPenalty = clamp01((cloud - 0.85) / 0.15) * 25;
  const score = sunScore + rainScore - cloudPenalty;
  const notes: string[] = [];
  if (precip >= 0.2 && precip <= 0.85 && sunAltDeg > 1 && sunAltDeg < 42) {
    notes.push('有阵雨又出太阳，可能见彩虹');
  } else if (precip < 0.2) {
    notes.push('缺少降水，难有彩虹');
  } else {
    notes.push('雨势偏大或太阳过高');
  }
  return makeIndex(score, notes.join('，'));
}

/** 月观指数：月亮亮度 + 可见高度 + 云量（适合拍月亮/赏月） */
export function computeMoonIndex(
  met: SkyMetSample | undefined,
  astro: { moonIllum: number; moonAltDeg: number },
): SkyIndex {
  const illumScore = clamp01(astro.moonIllum) * 45;
  const altScore = clamp01(astro.moonAltDeg / 50) * 35;
  const cloud = met ? clamp01(met.totalCloud ?? 0.5) : 0.4;
  const cloudPenalty = cloud * 40;
  const score = 20 + illumScore + altScore - cloudPenalty;
  const notes: string[] = [];
  if (astro.moonIllum > 0.92) notes.push('接近满月');
  if (astro.moonAltDeg <= 0) notes.push('月亮在地平线下');
  else if (astro.moonAltDeg > 40) notes.push('月亮高度不错');
  if (cloud > 0.6) notes.push('云量偏多');
  return makeIndex(score, notes.join('，'));
}

/**
 * 云海可能性：低云充沛 + 近饱和 + 微风 +（零度层不贴地）→ 层积云贴地成海。
 * 这是可能性启发式，非莉景官方算法。
 */
export function computeSeaOfCloudsIndex(met: SkyMetSample | undefined): SkyIndex {
  if (!met) return makeIndex(30, '暂无气象数据');
  const low = clamp01(met.cloudLow ?? 0.5);
  const humidity = clamp01(met.humidity ?? 0.6);
  const wind = met.windSpeedMs ?? 3;
  const score =
    low * 40 +
    clamp01((humidity - 0.6) / 0.4) * 30 +
    (1 - clamp01(wind / 8)) * 15 +
    (met.freezingLevelM != null && met.freezingLevelM > 800 ? 10 : 5);
  const notes: string[] = [];
  if (low > 0.7) notes.push('低云充沛');
  if (humidity > 0.85) notes.push('近饱和湿度');
  if (wind > 5) notes.push('风偏大，云海不易积驻');
  return makeIndex(score, notes.join('，') || '条件一般');
}

/** 雾凇可能性：低温 + 近饱和 + 有风 + 无强降水 */
export function computeRimeIndex(met: SkyMetSample | undefined): SkyIndex {
  if (!met) return makeIndex(20, '暂无气象数据');
  const temp = met.tempC ?? 10;
  const humidity = clamp01(met.humidity ?? 0.6);
  const wind = met.windSpeedMs ?? 2;
  const precip = precipProbGuard(met);
  const tempScore = clamp01((3 - temp) / 8) * 45;
  const score =
    tempScore +
    clamp01((humidity - 0.75) / 0.25) * 30 +
    clamp01((wind - 1) / 5) * 12 * (temp <= 2 ? 1 : 0) -
    precip * 25;
  const notes: string[] = [];
  if (temp > 3) notes.push('气温偏高，不易结凇');
  else notes.push('低温配合湿度，有雾凇可能');
  return makeIndex(score, notes.join('，'));
}

/**
 * 综合观景指数：按天象类型挑选主导因子合成。
 * kind: 'glow' 霞光 | 'star' 观星 | 'moon' 月观 | 'day' 白天风光
 */
export function computeViewScore(
  kind: 'glow' | 'star' | 'moon' | 'day',
  met: SkyMetSample | undefined,
  ctx: {
    sunAltDeg: number;
    moonIllum: number;
    moonAltDeg: number;
    bortle: number;
    visibility?: string;
  },
): SkyIndex {
  switch (kind) {
    case 'glow': {
      const g = computeGlowIndex(met);
      const visPenalty = ctx.visibility === 'distant' ? 10 : 0;
      return makeIndex(g.score - visPenalty, g.note);
    }
    case 'star':
      return computeStarIndex(met, ctx);
    case 'moon':
      return computeMoonIndex(met, ctx);
    case 'day':
    default: {
      const cloud = met ? clamp01(met.totalCloud ?? 0.5) : 0.5;
      const vis = met ? clamp01(((met.visibilityKm ?? 12) - 3) / 17) : 0.5;
      const precip = met ? precipProbGuard(met) : 0;
      return makeIndex(55 + vis * 25 - cloud * 22 - precip * 30, '白天风光，以通透度为主');
    }
  }
}
