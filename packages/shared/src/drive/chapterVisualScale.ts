/**
 * 沿程进度条「混合视觉刻度」：短段保底可见，长段仍更宽，避免纯里程比例挤成一团。
 *
 * 权重：
 *   w_i = α·(1/n) + (1−α)·(len_i^p / Σ len^p)
 * 默认 α=0.45（近半均等保底）、p=0.5（开方软化极端长短比）。
 *
 * 进度 / GPS / 景点仍用真实公里；仅 UI 色块与滑块位置走本映射。
 */

export type ChapterKmRange = {
  fromKm: number;
  toKm: number;
};

export type ChapterVisualSlice = {
  fromKm: number;
  toKm: number;
  /** 视觉起点 0–100 */
  leftPct: number;
  /** 视觉宽度，合计约 100 */
  widthPct: number;
};

export type ChapterVisualScale = {
  slices: ChapterVisualSlice[];
  spanKm: number;
};

export type ChapterVisualScaleOptions = {
  /** 均等保底占比，0=纯路程，1=纯均等。默认 0.45 */
  equalBlend?: number;
  /** 路程权重幂次，1=线性，0.5=开方软化。默认 0.5 */
  lengthPower?: number;
  /** 单段最小视觉宽度（%）。默认 2 */
  minWidthPct?: number;
};

const DEFAULT_EQUAL_BLEND = 0.45;
const DEFAULT_LENGTH_POWER = 0.5;
const DEFAULT_MIN_WIDTH_PCT = 2;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * 由章节里程区间构建混合视觉刻度。
 * `spanKm` 若大于末段 toKm，末尾空白按「虚尾」并入最后一段视觉（与现网末段接主链行为一致）。
 */
export function buildChapterVisualScale(
  chapters: readonly ChapterKmRange[],
  spanKm: number,
  opts: ChapterVisualScaleOptions = {},
): ChapterVisualScale {
  const equalBlend = clamp(opts.equalBlend ?? DEFAULT_EQUAL_BLEND, 0, 1);
  const lengthPower = Math.max(0.15, opts.lengthPower ?? DEFAULT_LENGTH_POWER);
  const minWidthPct = Math.max(0, opts.minWidthPct ?? DEFAULT_MIN_WIDTH_PCT);
  const span = Number.isFinite(spanKm) && spanKm > 0 ? spanKm : 0;

  if (!chapters.length || !(span > 0)) {
    return { slices: [], spanKm: span };
  }

  const ranges = chapters.map((ch, i) => {
    const fromKm = Number(ch.fromKm);
    let toKm = Number(ch.toKm);
    if (!Number.isFinite(fromKm) || !Number.isFinite(toKm)) {
      return { fromKm: 0, toKm: 0, len: 0 };
    }
    // 末章接到进度条跨度，避免尾部无色块
    if (i === chapters.length - 1 && span > toKm) toKm = span;
    const len = Math.max(0, toKm - fromKm);
    return { fromKm, toKm, len };
  });

  const n = ranges.length;
  const powered = ranges.map((r) => (r.len > 0 ? r.len ** lengthPower : 0));
  const poweredSum = powered.reduce((a, b) => a + b, 0);

  let weights = ranges.map((_, i) => {
    const equal = 1 / n;
    const dist = poweredSum > 0 ? powered[i]! / poweredSum : equal;
    return equalBlend * equal + (1 - equalBlend) * dist;
  });

  // 保底最小宽度后重新归一
  const rawSum = weights.reduce((a, b) => a + b, 0) || 1;
  weights = weights.map((w) => Math.max(minWidthPct / 100, w / rawSum));
  const boostSum = weights.reduce((a, b) => a + b, 0) || 1;
  weights = weights.map((w) => w / boostSum);

  const slices: ChapterVisualSlice[] = [];
  let left = 0;
  for (let i = 0; i < n; i += 1) {
    const widthPct = i === n - 1 ? Math.max(0, 100 - left) : weights[i]! * 100;
    slices.push({
      fromKm: ranges[i]!.fromKm,
      toKm: ranges[i]!.toKm,
      leftPct: Math.round(left * 1000) / 1000,
      widthPct: Math.round(widthPct * 1000) / 1000,
    });
    left += widthPct;
  }
  return { slices, spanKm: span };
}

/** 真实公里 → 视觉百分比（段内线性） */
export function kmToVisualPct(scale: ChapterVisualScale, km: number): number {
  const { slices, spanKm } = scale;
  if (!slices.length || !(spanKm > 0)) {
    return spanKm > 0 ? clamp((km / spanKm) * 100, 0, 100) : 0;
  }
  const x = clamp(km, 0, spanKm);
  for (const s of slices) {
    const len = s.toKm - s.fromKm;
    if (x < s.fromKm) return s.leftPct;
    if (x <= s.toKm || len <= 0) {
      if (len <= 0) return s.leftPct;
      const t = (x - s.fromKm) / len;
      return clamp(s.leftPct + t * s.widthPct, 0, 100);
    }
  }
  const last = slices[slices.length - 1]!;
  return clamp(last.leftPct + last.widthPct, 0, 100);
}

/** 视觉百分比 → 真实公里（段内线性） */
export function visualPctToKm(scale: ChapterVisualScale, pct: number): number {
  const { slices, spanKm } = scale;
  if (!slices.length || !(spanKm > 0)) {
    return spanKm > 0 ? clamp((pct / 100) * spanKm, 0, spanKm) : 0;
  }
  const p = clamp(pct, 0, 100);
  for (const s of slices) {
    const right = s.leftPct + s.widthPct;
    if (p < s.leftPct) return s.fromKm;
    if (p <= right || s.widthPct <= 0) {
      if (s.widthPct <= 0) return s.fromKm;
      const t = (p - s.leftPct) / s.widthPct;
      return clamp(s.fromKm + t * (s.toKm - s.fromKm), 0, spanKm);
    }
  }
  return spanKm;
}
