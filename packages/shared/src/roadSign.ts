/**
 * 万里路书 · 公路编号标志（路牌）制式分类 —— GB 5768 路线编号标志。
 *
 * 目标：给定一个路牌编号字符串（G6 / G3011 / G109 / S203 / X008 / 此生必驾318 …），
 * 自动识别其行政等级与国标制式（底色 / 边框 / 顶条 / 字色），供票面与地图统一渲染。
 * 纯 TS、零框架依赖，颜色为 GB 制式色（与 roadColors.ts 的「地图线色」是两套体系，
 * 此处只描述真实路牌外观，不混用）。
 *
 * 编号位数规则（对标 PRD §3.2 / 国标）：
 *   G + 1/2/4 位 → 国家高速（绿底 + 红顶条「国家高速」）
 *   G + 3 位     → 普通国道（红底白字白边）
 *   S + 1/2/4 位 → 省级高速（绿底 + 黄顶条「省级高速」）
 *   S + 3 位     → 省道（黄底黑字黑边）
 *   X / Y / C    → 县道 / 乡道 / 村道（白底黑字黑边）
 *   此生必驾 NNN → 主题徽记（深绛红 + 烫金边，叠加在国道之上的收藏向设计）
 */

export type RoadSignKind =
  | 'national-expressway'
  | 'provincial-expressway'
  | 'national-highway'
  | 'provincial-highway'
  | 'county'
  | 'township'
  | 'village'
  | 'scenic';

/** GB 制式外观：底色 / 字色 / 边框色 / 顶条底色 / 顶条字色 */
export interface RoadSignPalette {
  bg: string;
  fg: string;
  border: string;
  /** 顶条底色；无顶条为空串 */
  band: string;
  bandFg: string;
}

export interface RoadSignSpec {
  kind: RoadSignKind;
  /** 规范化编号（大写）；scenic 为纯数字串 */
  ref: string;
  /** 字母前缀 G/S/X/Y/C；scenic 为空串 */
  letter: string;
  /** 数字部分 */
  digits: string;
  /** 等级中文名：国家高速 / 省级高速 / 国道 / 省道 / 县道 / 乡道 / 村道 / 此生必驾 */
  label: string;
  /** 顶条文字（高速 / 此生必驾有；国道省道县乡村为空串） */
  bandText: string;
  palette: RoadSignPalette;
  /** 此生必驾路线别名（如「川藏南线 · 沪聂线」），非 scenic 为 undefined */
  scenicName?: string;
}

/** 此生必驾主题路线（编号 → 线路名）。可在编辑器以预设一键加入。 */
export const SCENIC_ROUTES: Record<string, string> = {
  '318': '川藏南线 · 沪聂线',
  '109': '青藏线 · 京拉线',
  '217': '独库公路 · 阿塔线',
};

const GREEN = '#0a7a3d';
const RED = '#d0342c';
const YELLOW = '#f5c400';
const INK = '#1a1a1a';
const WHITE = '#ffffff';
const GOLD = '#D4A853';
const CRIMSON = '#7a1220';

const PALETTES: Record<RoadSignKind, RoadSignPalette> = {
  'national-expressway': { bg: GREEN, fg: WHITE, border: WHITE, band: RED, bandFg: WHITE },
  'provincial-expressway': { bg: GREEN, fg: WHITE, border: WHITE, band: YELLOW, bandFg: INK },
  'national-highway': { bg: RED, fg: WHITE, border: WHITE, band: '', bandFg: WHITE },
  'provincial-highway': { bg: YELLOW, fg: INK, border: INK, band: '', bandFg: INK },
  county: { bg: WHITE, fg: INK, border: INK, band: '', bandFg: INK },
  township: { bg: WHITE, fg: INK, border: INK, band: '', bandFg: INK },
  village: { bg: WHITE, fg: INK, border: INK, band: '', bandFg: INK },
  scenic: { bg: '#14110a', fg: '#f7c325', border: '#f7c325', band: '#f7c325', bandFg: '#14110a' },
};

const LABELS: Record<RoadSignKind, string> = {
  'national-expressway': '国家高速',
  'provincial-expressway': '省级高速',
  'national-highway': '国道',
  'provincial-highway': '省道',
  county: '县道',
  township: '乡道',
  village: '村道',
  scenic: '此生必驾',
};

/** 是否有顶条（高速盾 / 此生必驾徽记为纵向带顶条；国道省道等为横向无顶条） */
export function hasBand(kind: RoadSignKind): boolean {
  return kind === 'national-expressway' || kind === 'provincial-expressway' || kind === 'scenic';
}

const SCENIC_RE = /^(?:此生必驾|必驾)\s*(\d{2,3})$/;
const CODE_RE = /^([GSXYC])(\d{1,4})$/;

function spec(kind: RoadSignKind, ref: string, letter: string, digits: string, scenicName?: string): RoadSignSpec {
  return {
    kind,
    ref,
    letter,
    digits,
    label: LABELS[kind],
    bandText: hasBand(kind) ? LABELS[kind] : '',
    palette: PALETTES[kind],
    ...(scenicName ? { scenicName } : {}),
  };
}

/**
 * 自动识别路牌制式。无法识别时回落为「国道」红盾（与 roadColors.classOfRef 的兜底一致），
 * 保证任何输入都有可渲染的国标外观，绝不空白。
 */
export function classifyRoadSign(raw: string): RoadSignSpec {
  const s = String(raw ?? '').trim().toUpperCase();

  const scenic = s.match(SCENIC_RE);
  if (scenic) {
    const digits = scenic[1]!;
    return spec('scenic', digits, '', digits, SCENIC_ROUTES[digits]);
  }

  const m = s.match(CODE_RE);
  if (m) {
    const letter = m[1]!;
    const digits = m[2]!;
    const n = digits.length;
    switch (letter) {
      case 'G':
        return n === 3
          ? spec('national-highway', s, letter, digits)
          : spec('national-expressway', s, letter, digits);
      case 'S':
        return n === 3
          ? spec('provincial-highway', s, letter, digits)
          : spec('provincial-expressway', s, letter, digits);
      case 'X':
        return spec('county', s, letter, digits);
      case 'Y':
        return spec('township', s, letter, digits);
      case 'C':
        return spec('village', s, letter, digits);
    }
  }
  // 兜底：纯数字视为国道（如直接输入 109）
  if (/^\d{3}$/.test(s)) return spec('national-highway', `G${s}`, 'G', s);
  return spec('national-highway', s || 'G109', 'G', s.replace(/\D/g, '') || '109');
}

/** 批量分类（票面 shields 列表用） */
export function classifyRoadSigns(refs: string[] | undefined | null): RoadSignSpec[] {
  return (refs ?? []).map(classifyRoadSign);
}

/** 此生必驾预设列表（编辑器一键加入用） */
export function scenicPresets(): { ref: string; label: string; name: string }[] {
  return Object.entries(SCENIC_ROUTES).map(([digits, name]) => ({
    ref: `此生必驾${digits}`,
    label: `此生必驾${digits}`,
    name,
  }));
}

/**
 * 「此生必驾」经典自驾国道编号集合（黑金色盾牌）。
 * 票面 shields 中只要出现这些编号，就渲染对应黑金盾牌。
 */
export const MUST_DRIVE_NUMBERS = new Set([
  '318', '219', '317', '315', '109', '217', '227', '214', '216', '228', '331',
]);

/** 从 shields 列表中找出首个「此生必驾」经典路线编号；无则 null */
export function mustDriveFromShields(shields: string[] | undefined | null): string | null {
  for (const s of shields ?? []) {
    const digits = String(s).replace(/[A-Za-z\u4e00-\u9fa5\s]/g, '');
    if (MUST_DRIVE_NUMBERS.has(digits)) return digits;
  }
  return null;
}

/** 把任意路牌输入规范化为纯编号（G109 / S203）；去除「此生必驾」等中文前缀 */
export function normalizeShieldCode(raw: string): string {
  const s = String(raw ?? '').trim().toUpperCase();
  const m = /([GSXYC])?\s*0*(\d{1,4})/.exec(s);
  if (!m) return s;
  const letter = m[1] ?? 'G';
  return `${letter}${m[2]}`;
}
