/**
 * 万里路书 · 旅行纪念票 —— 共享类型与纯逻辑层
 *
 * 纪律（沿用 drive/* 的做法）：
 * - 本文件**零框架依赖**（不引 vue / pinia），Web 与鸿蒙端共用；
 * - 票面一切可展示字段都是配置项，组件内禁止硬编码文案；
 * - 票号生成必须纯函数且可复现（同输入同输出），便于草稿落盘后不漂移。
 */

/** 票种 */
export type TicketKind = 'railway' | 'drive' | 'flight';

/** 印章徽记 */
export type TicketSealEmblem = 'none' | 'rail' | 'road' | 'air';

/** 路线端点（起/终点，index 0 = 起，1 = 终） */
export interface TicketRouteEnd {
  name: string;
  /** 拼音，用于票面大字排版 */
  pinyin?: string;
  /** 三字码，如 BJS / SHA */
  code?: string;
}

/** 路线配置 */
export interface TicketRouteConfig {
  /** 固定两项：[起点, 终点] */
  ends: [TicketRouteEnd, TicketRouteEnd];
  /** 中线胶囊文案（车次号 / 航班号） */
  middleLabel?: string;
  /** 途经点链，>2 项时票面启用途经点渲染 */
  waypoints?: string[];
  /** 路牌编号，如 G6 / G3011 / G109 */
  shields?: string[];
  /** 海拔采样（米），与 elevPeakLabel 配套 */
  elevPoints?: number[];
  /** 峰值标注文案，如 "3817M" */
  elevPeakLabel?: string;
}

/** 数据宫格项 */
export interface TicketStatItem {
  label: string;
  value: string;
  /** 单位后缀，如 "km" / "min" */
  unit?: string;
}

/** 标签胶囊 */
export interface TicketTagItem {
  text: string;
  /** 高亮（主色填充） */
  hot?: boolean;
}

/** 印章 */
export interface TicketSealConfig {
  enabled: boolean;
  emblem: TicketSealEmblem;
  text: string;
  /** 副文（弧排小字） */
  sub?: string;
}

/** 二维码 */
export interface TicketQrConfig {
  enabled: boolean;
  caption: string;
  /** 二维码承载的内容（通常是一句话 URL） */
  value: string;
}

/** 品牌元素 */
export interface TicketBrandConfig {
  /** 顶部品牌微标 */
  logo: boolean;
  /** 票面品牌水印 */
  watermark: boolean;
  footerText: string;
}

/** 背景 */
export interface TicketBackgroundConfig {
  /** 主题 id，对应前端 TICKET_THEMES */
  theme: string;
  /** 背景图（URL 或 dataURL）；无图时用主题渐变 */
  imageUrl?: string;
  /** 背景图叠加强度 0~0.6 */
  opacity: number;
}

/** 承运航司（仅飞行票） */
export interface TicketAirlineConfig {
  /** 两字码，如 cz */
  code: string;
  /** 中文名 */
  name: string;
  /** 英文名 */
  en: string;
  /** 航班号，如 CZ3467 */
  flightNo: string;
  /** 联盟 id；南航 2019 年已退出天合联盟，故为 null */
  alliance: string | null;
}

/**
 * 票面配置（全量可编辑）。
 * 组件只读本结构渲染，不持有额外展示态 —— 这样草稿落盘即可完整还原票面。
 */
export interface TicketConfig {
  /** 本地唯一 id（保存列表的键） */
  id: string;
  kind: TicketKind;
  title: string;
  subtitle: string;
  /** 票号，如 R-20261003-0007 */
  serial: string;
  /** 日期行 */
  dateText: string;
  /** 路线左注 */
  metaLeft?: string;
  /** 路线右注 */
  metaRight?: string;
  route: TicketRouteConfig;
  stats: TicketStatItem[];
  tags: TicketTagItem[];
  quote: string;
  seal: TicketSealConfig;
  qr: TicketQrConfig;
  brand: TicketBrandConfig;
  background: TicketBackgroundConfig;
  /** 仅飞行票 */
  airline?: TicketAirlineConfig;
  updatedAt: number;
}

/** 票号前缀：铁路 R / 公路 D / 飞行 F */
const SERIAL_PREFIX: Record<TicketKind, string> = {
  railway: 'R',
  drive: 'D',
  flight: 'F',
};

/**
 * 生成票号。
 * 形如 `R-20261003-0007`：前缀 + 日期 + 4 位序号。
 * 纯函数 —— 同 (kind, date, seq) 必得同结果，草稿反复落盘不会让票号漂移。
 */
export function makeTicketSerial(kind: TicketKind, date: string, seq: number): string {
  const d = String(date || '').replace(/[^0-9]/g, '').slice(0, 8) || '00000000';
  const n = Math.max(1, Math.floor(seq || 1));
  return `${SERIAL_PREFIX[kind] ?? 'R'}-${d}-${String(n).padStart(4, '0')}`;
}

/** 本地唯一 id（不依赖 crypto.randomUUID，老旧 WebView 兜底） */
function makeId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 各票种的出厂默认文案（编辑器「恢复默认」的落点） */
const DEFAULT_CONTENT: Record<
  TicketKind,
  {
    title: string;
    subtitle: string;
    ends: [string, string];
    middleLabel?: string;
    stats: TicketStatItem[];
    tags: TicketTagItem[];
    quote: string;
    theme: string;
  }
> = {
  railway: {
    title: '铁路纪念票',
    subtitle: 'RAILWAY COMMEMORATIVE PASS',
    ends: ['北京南', '上海虹桥'],
    middleLabel: 'G1',
    stats: [
      { label: '出发 DEPART', value: '09:00' },
      { label: '到达 ARRIVE', value: '14:28' },
      { label: '历时 DURATION', value: '5:28' },
      { label: '里程 DISTANCE', value: '1318', unit: 'km' },
    ],
    tags: [
      { text: '复兴号', hot: true },
      { text: '京沪高铁' },
      { text: '商务座' },
    ],
    quote: '一路向东，把长江折叠成一条线。',
    theme: 'rail-xuanlan',
  },
  drive: {
    title: '自驾纪念票',
    subtitle: 'ROAD TRIP COMMEMORATIVE PASS',
    ends: ['成都', '拉萨'],
    middleLabel: 'G4218',
    stats: [
      { label: '出发 DEPART', value: '07:30' },
      { label: '抵达 ARRIVE', value: '第4天' },
      { label: '里程 DISTANCE', value: '2142', unit: 'km' },
      { label: '海拔 PEAK', value: '5013', unit: 'm' },
    ],
    tags: [
      { text: '此生必驾', hot: true },
      { text: 'G4218' },
      { text: '川藏线' },
    ],
    quote: '云在脚下，路在远方。',
    theme: 'drive-dusk',
  },
  flight: {
    title: '飞行纪念票',
    subtitle: 'BOARDING PASS',
    ends: ['北京首都', '新加坡樟宜'],
    middleLabel: 'CA811',
    stats: [
      { label: '起飞 DEPART', value: '01:15' },
      { label: '落地 ARRIVE', value: '07:30' },
      { label: '航程 DISTANCE', value: '4470', unit: 'km' },
      { label: '机型 AIRCRAFT', value: 'B77W' },
    ],
    tags: [
      { text: '星空联盟', hot: true },
      { text: '洲际航线' },
      { text: '公务舱' },
    ],
    quote: '万米高空，另一种人生维度。',
    theme: 'flight-night',
  },
};

/**
 * 以票种出厂默认开一张新票。
 * `newTicket` / store 初始化 / 单元测试共用同一入口，避免默认值散落多处。
 */
export function createTicketConfig(kind: TicketKind): TicketConfig {
  const d = DEFAULT_CONTENT[kind] ?? DEFAULT_CONTENT.railway;
  const date = today();
  return {
    id: makeId(),
    kind,
    title: d.title,
    subtitle: d.subtitle,
    serial: makeTicketSerial(kind, date, 1),
    dateText: date,
    metaLeft: `${d.ends[0]} → ${d.ends[1]}`,
    metaRight: '',
    route: {
      ends: [{ name: d.ends[0] }, { name: d.ends[1] }],
      middleLabel: d.middleLabel,
      waypoints: [],
      shields: [],
      elevPoints: [],
    },
    stats: d.stats.map((s) => ({ ...s })),
    tags: d.tags.map((t) => ({ ...t })),
    quote: d.quote,
    seal: {
      enabled: true,
      emblem: kind === 'railway' ? 'rail' : kind === 'drive' ? 'road' : 'air',
      text: '万里路书',
      sub: 'WANG LI LU SHU',
    },
    qr: { enabled: true, caption: '扫码查看行程', value: 'https://railvista.app/ticket' },
    brand: { logo: true, watermark: true, footerText: '本票为个人纪念用途，不作乘车凭证' },
    background: { theme: d.theme, opacity: 0.32 },
    updatedAt: Date.now(),
  };
}