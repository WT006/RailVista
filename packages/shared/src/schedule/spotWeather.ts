/**
 * 景点到达时刻天气：字段形状 + 观景提示推导（纯函数，无网络）。
 * API 回填后前端 InfoWindow 直接展示 `label`。
 */

export type SpotViewHint = 'good' | 'fair' | 'poor';

export type SpotWeatherSource = 'qweather' | 'open-meteo' | 'none';

/** 单个景点在 ETA 对齐小时的天气快照 */
export interface SpotWeather {
  spotId: string;
  queried: boolean;
  /** 对齐到的预报时刻 ISO */
  atIso?: string;
  /** 天气现象文案（中文优先） */
  cond?: string;
  /** 图标/现象代码（和风 code 或 WMO code） */
  icon?: string;
  tempC?: number;
  /** 能见度 km */
  visKm?: number;
  /** 云量 0–1 */
  cloud?: number;
  /** 降水概率 0–1 */
  precipProb?: number;
  viewHint?: SpotViewHint;
  /** 可直接展示的一行文案 */
  label?: string;
  source?: SpotWeatherSource;
  /** 未查询成功时的简短原因（调试用，前端可不展示） */
  reason?: string;
}

export interface ViewHintInput {
  cond?: string;
  icon?: string;
  visKm?: number | null;
  cloud?: number | null;
  precipProb?: number | null;
  /** 景点可视档：远眺更依赖能见度 */
  visibility?: string;
}

const RAIN_RE = /雨|雪|雹|雷|雾|霾|沙|尘|rain|snow|thunder|fog|haze|dust|drizzle|sleet/i;
const CLEAR_RE = /晴|少云|clear|sunny|fair/i;
const CLOUDY_RE = /阴|多云|overcast|cloud/i;

/** 和风现象码：雨雪雾等不利于观景 */
const QW_POOR_CODES = new Set([
  '300', '301', '302', '303', '304', '305', '306', '307', '308', '309', '310', '311', '312', '313',
  '314', '315', '316', '317', '318', '350', '351', '399',
  '400', '401', '402', '403', '404', '405', '406', '407', '408', '409', '410', '456', '457', '499',
  '500', '501', '502', '503', '504', '507', '508', '509', '510', '511', '512', '513', '514', '515',
]);

/** WMO weather interpretation codes → 较差观景 */
const WMO_POOR = new Set([45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);

function isPoorCondition(cond?: string, icon?: string): boolean {
  if (icon != null && icon !== '') {
    if (QW_POOR_CODES.has(String(icon))) return true;
    const n = Number(icon);
    if (Number.isFinite(n) && WMO_POOR.has(n)) return true;
  }
  return Boolean(cond && RAIN_RE.test(cond));
}

/**
 * 观景质量粗分档：面向「车窗外能不能看见」，非气象学评分。
 * distant / far 对能见度与云量更敏感。
 */
export function computeViewHint(input: ViewHintInput): SpotViewHint {
  const distant =
    input.visibility === 'distant' ||
    input.visibility === 'far' ||
    input.visibility === 'mid';
  const vis = input.visKm;
  const cloud = input.cloud;
  const precip = input.precipProb;
  const poorCond = isPoorCondition(input.cond, input.icon);

  if (poorCond) return 'poor';
  if (vis != null && vis < 5) return 'poor';
  if (precip != null && precip >= 0.6) return 'poor';

  if (vis != null && vis < 10) return distant ? 'poor' : 'fair';
  if (precip != null && precip >= 0.35) return 'fair';
  if (cloud != null && cloud >= 0.85 && distant) return 'fair';
  if (vis != null && vis < 15 && distant) return 'fair';
  if (cloud != null && cloud >= 0.7 && distant) return 'fair';

  if (input.cond && CLEAR_RE.test(input.cond)) return 'good';
  if (input.cond && CLOUDY_RE.test(input.cond) && distant && (vis == null || vis < 20)) return 'fair';
  return 'good';
}

export function visQualityLabel(visKm?: number | null): string {
  if (visKm == null || !Number.isFinite(visKm)) return '';
  if (visKm >= 20) return '能见度好';
  if (visKm >= 10) return '能见度一般';
  if (visKm >= 5) return '能见度偏差';
  return '能见度差';
}

/** 景点可视档短标签（无天气时单独展示） */
export function visibilityShortLabel(visibility?: string): string {
  if (visibility === 'distant') return '远眺';
  if (visibility === 'on_track') return '穿行';
  if (visibility === 'window') return '窗外';
  return '';
}

type ViewKind = 'distant' | 'window' | 'on_track' | 'generic';

function viewKind(visibility?: string): ViewKind {
  if (visibility === 'distant' || visibility === 'far' || visibility === 'mid') return 'distant';
  if (visibility === 'window') return 'window';
  if (visibility === 'on_track') return 'on_track';
  return 'generic';
}

/**
 * 观景提示：结合景点可视档 + 天气分档，避免「窗外」景点还写「适合远眺」。
 * 有天气时用这句替代单独的「远眺/窗外」徽标。
 */
export function viewHintLabel(hint?: SpotViewHint, visibility?: string): string {
  if (!hint) return '';
  const kind = viewKind(visibility);
  if (hint === 'good') {
    if (kind === 'distant') return '远眺条件好';
    if (kind === 'window') return '窗外视野好';
    if (kind === 'on_track') return '穿行视野好';
    return '观景条件好';
  }
  if (hint === 'fair') {
    if (kind === 'distant') return '远眺一般';
    if (kind === 'window') return '窗外一般';
    if (kind === 'on_track') return '穿行一般';
    return '观景一般';
  }
  if (hint === 'poor') {
    if (kind === 'distant') return '远眺受限';
    if (kind === 'window') return '窗外受限';
    if (kind === 'on_track') return '穿行受限';
    return '观景受限';
  }
  return '';
}

/** 和风 icon / WMO code → 展示用 emoji */
export function weatherEmoji(icon?: string, cond?: string): string {
  const c = String(icon ?? '');
  const n = Number(c);
  if (c === '100' || c === '150' || n === 0) return '☀️';
  if (['101', '102', '103', '151', '152', '153'].includes(c) || n === 1 || n === 2 || n === 3) return '⛅';
  if (c === '104' || n === 45 || n === 48) return c === '104' ? '☁️' : '🌫️';
  if (QW_POOR_CODES.has(c) || (Number.isFinite(n) && WMO_POOR.has(n))) {
    if (/雪|snow|冰|sleet|71|73|75|77|85|86/i.test(`${cond ?? ''}${c}`)) return '🌨️';
    if (/雾|霾|沙|尘|fog|haze|45|48|5\d{2}/i.test(`${cond ?? ''}${c}`)) return '🌫️';
    if (/雷|thunder|95|96|99|302|303|304/i.test(`${cond ?? ''}${c}`)) return '⛈️';
    return '🌧️';
  }
  if (cond && RAIN_RE.test(cond)) return '🌧️';
  if (cond && CLEAR_RE.test(cond)) return '☀️';
  if (cond && CLOUDY_RE.test(cond)) return '☁️';
  return '🌤️';
}

/** 结构化天气展示字段（底栏 / 气泡 / 临近卡共用） */
export type SpotWeatherParts = {
  emoji: string;
  cond: string;
  temp: string;
  vis: string;
  /** 已结合景点可视档的观景提示 */
  hint: string;
  viewHint?: SpotViewHint;
  /** 有 hint 时 UI 可隐藏单独的远眺/窗外徽标 */
  hidesVisibilityBadge: boolean;
};

export function spotWeatherParts(
  w: Pick<SpotWeather, 'cond' | 'tempC' | 'visKm' | 'viewHint' | 'icon'> | null | undefined,
  visibility?: string,
): SpotWeatherParts | null {
  if (!w) return null;
  const cond = (w.cond || '').trim();
  const temp =
    w.tempC != null && Number.isFinite(w.tempC) ? `${Math.round(w.tempC)}°` : '';
  const vis = visQualityLabel(w.visKm);
  const hint = viewHintLabel(w.viewHint, visibility);
  if (!cond && !temp && !vis && !hint) return null;
  return {
    emoji: weatherEmoji(w.icon, w.cond),
    cond,
    temp,
    vis,
    hint,
    viewHint: w.viewHint,
    hidesVisibilityBadge: Boolean(hint),
  };
}

/** 纯文本兜底：☀️ 晴 · 18° · 远眺条件好 */
export function formatSpotWeatherLabel(
  w: Pick<SpotWeather, 'cond' | 'tempC' | 'visKm' | 'viewHint' | 'icon'>,
  visibility?: string,
): string {
  const p = spotWeatherParts(w, visibility);
  if (!p) return '';
  const parts: string[] = [];
  if (p.cond) parts.push(`${p.emoji} ${p.cond}`);
  else if (p.emoji) parts.push(p.emoji);
  if (p.temp) parts.push(p.temp);
  if (p.hint) parts.push(p.hint);
  else if (p.vis) parts.push(p.vis);
  return parts.filter(Boolean).join(' · ');
}

/** 从小时序列中取最接近 targetIso 的一档；超出范围返回 null */
export function pickHourlyNearest<T extends { atMs: number }>(
  hours: T[],
  targetIso: string,
  maxDeltaMs = 45 * 60_000,
): T | null {
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target) || !hours.length) return null;
  let best: T | null = null;
  let bestDelta = Infinity;
  for (const h of hours) {
    const d = Math.abs(h.atMs - target);
    if (d < bestDelta) {
      bestDelta = d;
      best = h;
    }
  }
  if (!best || bestDelta > maxDeltaMs) return null;
  return best;
}
