/**
 * 万里路书 · 旅行纪念票 —— 色板 / 主题 / 航司 logo 数据表
 *
 * 纪律同 `roadColors.ts`：票面一切颜色与品牌资产只准从这里取，
 * 组件内禁止硬编码色值。主题通过 CSS 变量注入 TicketFace。
 */
import type { TicketKind } from '@railvista/shared';

import logoCa from '../assets/ticket/ca.jpg';
import logoCz from '../assets/ticket/cz.jpg';
import logoMu from '../assets/ticket/mu.jpg';
import logoHu from '../assets/ticket/hu.jpg';
import logoMf from '../assets/ticket/mf.jpg';
import logo3u from '../assets/ticket/3u.png';
import logoZh from '../assets/ticket/zh.png';
import logoSc from '../assets/ticket/sc-crop.png';
import logo9c from '../assets/ticket/9c.jpg';
import logoHo from '../assets/ticket/ho.png';
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
