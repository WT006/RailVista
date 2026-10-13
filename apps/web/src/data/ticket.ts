/**
 * 万里路书 · 旅行纪念票 —— 色板 / 主题 / 航司 logo 数据表
 *
 * 纪律同 `roadColors.ts`：票面一切颜色与品牌资产只准从这里取，
 * 组件内禁止硬编码色值。主题通过 CSS 变量注入 TicketFace。
 */
/* 【作用域例外层】票面印刷色板（纪念票票面 / 主题，经 CSS 变量注入 TicketFace 等）：
 * 属数据语义色，集中在本文件声明，界面交互控件不得从这里取色
 * （2026-10-09 鸿蒙化收敛裁定，见 tokens.css 例外条款）。 */
import type { TicketKind } from '@railvista/shared';

// 航司官方素材（透明底）：ca/cz 2026-10 接入透明底新素材，mu/9c/3u/hu 为官方 1:1 正方形版（2026-10-12）
import logoCa from '../assets/ticket/ca.png';
import logoCz from '../assets/ticket/cz.png';
import logoMu from '../assets/ticket/mu.png';
import logoHu from '../assets/ticket/hu.png';
import logoMf from '../assets/ticket/mf.jpg';
import logo3u from '../assets/ticket/3u.png';
import logoZh from '../assets/ticket/zh.png';
import logoSc from '../assets/ticket/sc-crop.png';
import logo9c from '../assets/ticket/9c.png';
import logoHo from '../assets/ticket/ho.png';
// 补充航司官方 logo（均经 1:1 正方形归一，见 scripts/normalize-new-airline-logos.mjs）
import logoGs from '../assets/ticket/gs.png';
import logoJd from '../assets/ticket/jd.png';
import logoKn from '../assets/ticket/kn.png';
import logoG5 from '../assets/ticket/g5.png';
import logoEu from '../assets/ticket/eu.png';
import logoPn from '../assets/ticket/pn.png';
import logoNs from '../assets/ticket/ns.png';
import logoFu from '../assets/ticket/fu.png';
import logoUq from '../assets/ticket/uq.png';
import logo8l from '../assets/ticket/8l.png';
import logoGj from '../assets/ticket/gj.png';
import logoQw from '../assets/ticket/qw.png';
import logoKy from '../assets/ticket/ky.png';
import logoA6 from '../assets/ticket/a6.png';
import logoGx from '../assets/ticket/gx.png';
import logoRy from '../assets/ticket/ry.png';
import logoTv from '../assets/ticket/tv.png';
import logoAq from '../assets/ticket/aq.png';
import logoGt from '../assets/ticket/gt.png';
import logoFm from '../assets/ticket/fm.png';
import logoY8 from '../assets/ticket/y8.png';
import logoJr from '../assets/ticket/jr.png';
import logoDr from '../assets/ticket/dr.png';
import logo9h from '../assets/ticket/9h.png';
import logoOq from '../assets/ticket/oq.png';
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

  // ── 补充航司（2026-10-03 建表 / 2026-10-05 接入官方 logo / 2026-10-12 修正 IATA 代码）──
  // IATA 代码以 aviation.ts AIRLINE_LIST 为准；logo 文件名 = IATA 小写。
  // 联盟归属按公开资料：三大集团成员均已核对；地方/低成本航司多数无联盟。
  gs: { code: 'gs', name: '天津航空', en: 'TIANJIN AIRLINES', prefix: 'GS', logo: logoGs, alliance: null },
  jd: { code: 'jd', name: '首都航空', en: 'BEIJING CAPITAL AIRLINES', prefix: 'JD', logo: logoJd, alliance: null },
  kn: { code: 'kn', name: '中国联合航空', en: 'CHINA UNITED AIRLINES', prefix: 'KN', logo: logoKn, alliance: null },
  g5: { code: 'g5', name: '华夏航空', en: 'CHINA EXPRESS AIRLINES', prefix: 'G5', logo: logoG5, alliance: null },
  eu: { code: 'eu', name: '成都航空', en: 'CHENGDU AIRLINES', prefix: 'EU', logo: logoEu, alliance: null },
  pn: { code: 'pn', name: '西部航空', en: 'WEST AIR', prefix: 'PN', logo: logoPn, alliance: null },
  ns: { code: 'ns', name: '河北航空', en: 'HEBEI AIRLINES', prefix: 'NS', logo: logoNs, alliance: null },
  fu: { code: 'fu', name: '福州航空', en: 'FUZHOU AIRLINES', prefix: 'FU', logo: logoFu, alliance: null },
  uq: { code: 'uq', name: '乌鲁木齐航空', en: 'URUMQI AIRLINES', prefix: 'UQ', logo: logoUq, alliance: null },
  '8l': { code: '8l', name: '祥鹏航空', en: 'LUCKY AIR', prefix: '8L', logo: logo8l, alliance: null },
  gj: { code: 'gj', name: '长龙航空', en: 'LOONG AIR', prefix: 'GJ', logo: logoGj, alliance: null },
  qw: { code: 'qw', name: '青岛航空', en: 'QINGDAO AIRLINES', prefix: 'QW', logo: logoQw, alliance: null },
  ky: { code: 'ky', name: '昆明航空', en: 'KUNMING AIRLINES', prefix: 'KY', logo: logoKy, alliance: null },
  gt: { code: 'gt', name: '桂林航空', en: 'AIR GUILIN', prefix: 'GT', logo: logoGt, alliance: null },
  a6: { code: 'a6', name: '湖南航空', en: 'HUNAN AIRLINES', prefix: 'A6', logo: logoA6, alliance: null },
  gx: { code: 'gx', name: '北部湾航空', en: 'BEGUI BAY AIRLINES', prefix: 'GX', logo: logoGx, alliance: null },
  ry: { code: 'ry', name: '江西航空', en: 'JIANGXI AIRLINES', prefix: 'RY', logo: logoRy, alliance: null },

  // ── 补充航司（2026-10-12 新增，覆盖 aviation.ts 全部大陆航司）──
  fm: { code: 'fm', name: '上海航空', en: 'SHANGHAI AIRLINES', prefix: 'FM', logo: logoFm, alliance: 'skyteam' },
  y8: { code: 'y8', name: '金鹏航空', en: 'SUPARNA AIRLINES', prefix: 'Y8', logo: logoY8, alliance: null },
  jr: { code: 'jr', name: '幸福航空', en: 'JOY AIR', prefix: 'JR', logo: logoJr, alliance: null },
  dr: { code: 'dr', name: '瑞丽航空', en: 'RUILI AIRLINES', prefix: 'DR', logo: logoDr, alliance: null },
  '9h': { code: '9h', name: '长安航空', en: 'AIR CHANGAN', prefix: '9H', logo: logo9h, alliance: null },
  tv: { code: 'tv', name: '西藏航空', en: 'TIBET AIRLINES', prefix: 'TV', logo: logoTv, alliance: null },
  aq: { code: 'aq', name: '九元航空', en: '9 AIR', prefix: 'AQ', logo: logoAq, alliance: null },
  oq: { code: 'oq', name: '重庆航空', en: 'CHONGQING AIRLINES', prefix: 'OQ', logo: logoOq, alliance: null },
  // 港澳台 / 国际：按产品约定不补外国 logo
  cx: { code: 'cx', name: '国泰航空', en: 'CATHAY PACIFIC', prefix: 'CX', logo: '', alliance: 'oneworld' },
  br: { code: 'br', name: '长荣航空', en: 'EVA AIR', prefix: 'BR', logo: '', alliance: 'staralliance' },
  ci: { code: 'ci', name: '中华航空', en: 'CHINA AIRLINES', prefix: 'CI', logo: '', alliance: 'skyteam' },
  nx: { code: 'nx', name: '中国澳门航空', en: 'AIR MACAU', prefix: 'NX', logo: '', alliance: null },
  // 国际常用
  aa: { code: 'aa', name: '美国航空', en: 'AMERICAN AIRLINES', prefix: 'AA', logo: '', alliance: 'oneworld' },
  ua: { code: 'ua', name: '美国联合航空', en: 'UNITED AIRLINES', prefix: 'UA', logo: '', alliance: 'staralliance' },
  dl: { code: 'dl', name: '达美航空', en: 'DELTA AIR LINES', prefix: 'DL', logo: '', alliance: 'skyteam' },
  ba: { code: 'ba', name: '英国航空', en: 'BRITISH AIRWAYS', prefix: 'BA', logo: '', alliance: 'oneworld' },
  af: { code: 'af', name: '法国航空', en: 'AIR FRANCE', prefix: 'AF', logo: '', alliance: 'skyteam' },
  lh: { code: 'lh', name: '汉莎航空', en: 'LUFTHANSA', prefix: 'LH', logo: '', alliance: 'staralliance' },
  ek: { code: 'ek', name: '阿联酋航空', en: 'EMIRATES', prefix: 'EK', logo: '', alliance: null },
  sq: { code: 'sq', name: '新加坡航空', en: 'SINGAPORE AIRLINES', prefix: 'SQ', logo: '', alliance: 'staralliance' },
  jl: { code: 'jl', name: '日本航空', en: 'JAPAN AIRLINES', prefix: 'JL', logo: '', alliance: 'oneworld' },
  nh: { code: 'nh', name: '全日空', en: 'ALL NIPPON AIRWAYS', prefix: 'NH', logo: '', alliance: 'staralliance' },
  ke: { code: 'ke', name: '大韩航空', en: 'KOREAN AIR', prefix: 'KE', logo: '', alliance: 'skyteam' },
  oz: { code: 'oz', name: '韩亚航空', en: 'ASIANA AIRLINES', prefix: 'OZ', logo: '', alliance: 'staralliance' },
  qr: { code: 'qr', name: '卡塔尔航空', en: 'QATAR AIRWAYS', prefix: 'QR', logo: '', alliance: 'oneworld' },
  tk: { code: 'tk', name: '土耳其航空', en: 'TURKISH AIRLINES', prefix: 'TK', logo: '', alliance: 'staralliance' },
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
