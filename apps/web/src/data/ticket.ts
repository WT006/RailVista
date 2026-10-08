/**
 * 万里路书 · 旅行纪念票 —— 色板 / 主题 / 航司 logo 数据表
 *
 * 纪律同 `roadColors.ts`：票面一切颜色与品牌资产只准从这里取，
 * 组件内禁止硬编码色值。主题通过 CSS 变量注入 TicketFace。
 */
import type { TicketKind } from '@railvista/shared';

// 航司官方素材（透明底）：ca/cz 2026-10 接入透明底新素材，mu 为正方形版
import logoCa from '../assets/ticket/ca.png';
import logoCz from '../assets/ticket/cz.png';
import logoMu from '../assets/ticket/mu.png';
import logoHu from '../assets/ticket/hu.png';
import logoMf from '../assets/ticket/mf.jpg';
import logo3u from '../assets/ticket/3u.png';
import logoZh from '../assets/ticket/zh.png';
import logoSc from '../assets/ticket/sc-crop.png';
import logo9c from '../assets/ticket/9c.jpg';
import logoHo from '../assets/ticket/ho.png';
// 补充 16 家航司官方 logo（2026-10-05 接入，均经 1:1 正方形归一，见 scripts/normalize-new-airline-logos.mjs）
import logoGs from '../assets/ticket/gs.png';
import logoJd from '../assets/ticket/jd.png';
import logoKn from '../assets/ticket/kn.png';
import logoG5 from '../assets/ticket/g5.png';
import logoEu from '../assets/ticket/eu.png';
import logoWz from '../assets/ticket/wz.png';
import logoNs from '../assets/ticket/ns.png';
import logoFu from '../assets/ticket/fu.png';
import logoUq from '../assets/ticket/uq.png';
import logoAq from '../assets/ticket/aq.png';
import logoGj from '../assets/ticket/gj.png';
import logoQw from '../assets/ticket/qw.png';
import logoGt from '../assets/ticket/gt.png';
import logoA6 from '../assets/ticket/a6.png';
import logoGx from '../assets/ticket/gx.png';
import logoRy from '../assets/ticket/ry.png';
import logoSkyteam from '../assets/ticket/skyteam.jpg';
import logoStarAlliance from '../assets/ticket/staralliance-crop.png';
import logoOneworld from '../assets/ticket/oneworld.jpg';

export interface TicketThemeFg {
  tx: string;
  tx2: string;
  tx3: string;
  line: string;
  chip: string;
  chipLine: string;
}

export interface TicketTheme {
  id: string;
  label: string;
  kind: TicketKind;
  /** 三段渐变底色 */
  grad: [string, string, string];
  accent: string;
  accentHi: string;
  fg: TicketThemeFg;
  /** 防伪底纹变体 */
  guil: 'gold' | 'blue';
  /** 票号颜色（默认跟随 accent；经典蓝票为红色票号） */
  serialColor?: string;
}

export const TICKET_THEMES: TicketTheme[] = [
  {
    id: 'rail-xuanlan',
    label: '典藏 · 玄蓝烫金',
    kind: 'railway',
    grad: ['#131327', '#16213e', '#0e315c'],
    accent: '#D4A853',
    accentHi: '#f6e2a5',
    fg: {
      tx: '#ffffff',
      tx2: 'rgba(255,255,255,.72)',
      tx3: 'rgba(255,255,255,.45)',
      line: 'rgba(255,255,255,.14)',
      chip: 'rgba(255,255,255,.06)',
      chipLine: 'rgba(255,255,255,.12)',
    },
    guil: 'gold',
  },
  {
    id: 'rail-blue',
    label: '经典蓝票 · 12306 纪念',
    kind: 'railway',
    grad: ['#f3fbff', '#dceef9', '#c8e2f2'],
    accent: '#0d5c8c',
    accentHi: '#0d5c8c',
    fg: {
      tx: '#0d3b66',
      tx2: 'rgba(13,59,102,.78)',
      tx3: 'rgba(13,59,102,.52)',
      line: 'rgba(13,59,102,.2)',
      chip: 'rgba(255,255,255,.35)',
      chipLine: 'rgba(13,59,102,.22)',
    },
    guil: 'blue',
    serialColor: '#d0342c',
  },
  {
    id: 'drive-dusk',
    label: '大漠 · 落霞紫橙',
    kind: 'drive',
    grad: ['#221232', '#63284c', '#b8503c'],
    accent: '#D4A853',
    accentHi: '#f6e2a5',
    fg: {
      tx: '#ffffff',
      tx2: 'rgba(255,255,255,.72)',
      tx3: 'rgba(255,255,255,.45)',
      line: 'rgba(255,255,255,.14)',
      chip: 'rgba(255,255,255,.06)',
      chipLine: 'rgba(255,255,255,.12)',
    },
    guil: 'gold',
  },
  {
    id: 'flight-night',
    label: '夜空 · 巡航深蓝',
    kind: 'flight',
    grad: ['#071120', '#10304f', '#27619b'],
    accent: '#D4A853',
    accentHi: '#f6e2a5',
    fg: {
      tx: '#ffffff',
      tx2: 'rgba(255,255,255,.72)',
      tx3: 'rgba(255,255,255,.45)',
      line: 'rgba(255,255,255,.14)',
      chip: 'rgba(255,255,255,.06)',
      chipLine: 'rgba(255,255,255,.12)',
    },
    guil: 'gold',
  },
];

export function ticketTheme(id: string): TicketTheme {
  return TICKET_THEMES.find((t) => t.id === id) ?? TICKET_THEMES[0]!;
}

export function themesForKind(kind: TicketKind): TicketTheme[] {
  return TICKET_THEMES.filter((t) => t.kind === kind);
}

export const TICKET_KIND_META: Record<TicketKind, { label: string; chip: string }> = {
  railway: { label: '铁路纪念票', chip: 'RAILWAY PASS' },
  drive: { label: '自驾纪念票', chip: 'DRIVE PASS' },
  flight: { label: '飞行纪念票', chip: 'BOARDING PASS' },
};

export interface AirlineMeta {
  code: string;
  name: string;
  en: string;
  prefix: string;
  logo: string;
  /** 联盟 id；南航 2019 年已退出天合联盟，故为 null */
  alliance: string | null;
}

export const AIRLINES: Record<string, AirlineMeta> = {
  cz: { code: 'cz', name: '中国南方航空', en: 'CHINA SOUTHERN', prefix: 'CZ', logo: logoCz, alliance: null },
  ca: { code: 'ca', name: '中国国际航空', en: 'AIR CHINA', prefix: 'CA', logo: logoCa, alliance: 'staralliance' },
  mu: { code: 'mu', name: '中国东方航空', en: 'CHINA EASTERN', prefix: 'MU', logo: logoMu, alliance: 'skyteam' },
  hu: { code: 'hu', name: '海南航空', en: 'HAINAN AIRLINES', prefix: 'HU', logo: logoHu, alliance: null },
  mf: { code: 'mf', name: '厦门航空', en: 'XIAMENAIR', prefix: 'MF', logo: logoMf, alliance: 'skyteam' },
  '3u': { code: '3u', name: '四川航空', en: 'SICHUAN AIRLINES', prefix: '3U', logo: logo3u, alliance: null },
  zh: { code: 'zh', name: '深圳航空', en: 'SHENZHEN AIRLINES', prefix: 'ZH', logo: logoZh, alliance: 'staralliance' },
  sc: { code: 'sc', name: '山东航空', en: 'SHANDONG AIRLINES', prefix: 'SC', logo: logoSc, alliance: 'staralliance' },
  '9c': { code: '9c', name: '春秋航空', en: 'SPRING AIRLINES', prefix: '9C', logo: logo9c, alliance: null },
  ho: { code: 'ho', name: '吉祥航空', en: 'JUNEYAO AIR', prefix: 'HO', logo: logoHo, alliance: null },

  // ── 补充航司（2026-10-03 建表 / 2026-10-05 接入官方 logo）──
  // 官方 VI 已逐一目视核验；gt 桂林为蓝底 app 图标制式（无白底版官方素材）。
  // 联盟归属按公开资料：三大集团成员均已核对；地方/低成本航司多数无联盟。
  gs: { code: 'gs', name: '天津航空', en: 'TIANJIN AIRLINES', prefix: 'GS', logo: logoGs, alliance: null },
  jd: { code: 'jd', name: '首都航空', en: 'BEIJING CAPITAL AIRLINES', prefix: 'JD', logo: logoJd, alliance: null },
  kn: { code: 'kn', name: '中国联合航空', en: 'CHINA UNITED AIRLINES', prefix: 'KN', logo: logoKn, alliance: null },
  g5: { code: 'g5', name: '华夏航空', en: 'CHINA EXPRESS AIRLINES', prefix: 'G5', logo: logoG5, alliance: null },
  eu: { code: 'eu', name: '成都航空', en: 'CHENGDU AIRLINES', prefix: 'EU', logo: logoEu, alliance: null },
  wz: { code: 'wz', name: '西部航空', en: 'WESTERN AIRLINES', prefix: 'WZ', logo: logoWz, alliance: null },
  ns: { code: 'ns', name: '河北航空', en: 'HEBEI AIRLINES', prefix: 'NS', logo: logoNs, alliance: null },
  fu: { code: 'fu', name: '福州航空', en: 'FUZHOU AIRLINES', prefix: 'FU', logo: logoFu, alliance: null },
  uq: { code: 'uq', name: '乌鲁木齐航空', en: 'URUMQI AIRLINES', prefix: 'UQ', logo: logoUq, alliance: null },
  aq: { code: 'aq', name: '九元航空', en: '9 AIRLINES', prefix: 'AQ', logo: logoAq, alliance: null },
  gj: { code: 'gj', name: '长龙航空', en: 'LOONG AIR', prefix: 'GJ', logo: logoGj, alliance: null },
  qw: { code: 'qw', name: '青岛航空', en: 'QINGDAO AIRLINES', prefix: 'QW', logo: logoQw, alliance: null },
  gt: { code: 'gt', name: '桂林航空', en: 'AIR GUILIN', prefix: 'GT', logo: logoGt, alliance: null },
  a6: { code: 'a6', name: '湖南航空', en: 'HUNAN AIRLINES', prefix: 'A6', logo: logoA6, alliance: null },
  gx: { code: 'gx', name: '北部湾航空', en: 'BEGUI BAY AIRLINES', prefix: 'GX', logo: logoGx, alliance: null },
  ry: { code: 'ry', name: '江西航空', en: 'JIANGXI AIRLINES', prefix: 'RY', logo: logoRy, alliance: null },
};

export const ALLIANCES: Record<string, { name: string; logo: string }> = {
  staralliance: { name: '星空联盟 Star Alliance', logo: logoStarAlliance },
  skyteam: { name: '天合联盟 SkyTeam', logo: logoSkyteam },
  oneworld: { name: '寰宇一家 oneworld', logo: logoOneworld },
};

/** 车次色片（票面/选择器共用；纪律同 SelectTrip 的 TRAIN_COLORS） */
export const TRAIN_CHIP_COLORS: Record<string, string> = {
  G: '#4d9fff',
  D: '#37c3a0',
  C: '#8f7ae8',
  Z: '#e8b03a',
  T: '#e8933a',
  K: '#5aa860',
  L: '#c77dae',
  '': '#8a94a6',
};

export function trainChipColor(code: string): string {
  const c = String(code || '').trim().toUpperCase();
  const k = /^[A-Z]/.test(c) ? c[0]! : '';
  return TRAIN_CHIP_COLORS[k] ?? TRAIN_CHIP_COLORS['']!;
}
