/**
 * 万里路书 · 旅行纪念票 —— 可配置票面模型
 *
 * 票面所有展示项（标题 / 日期 / 路线 / 编号 / 印章 / 备注 / 二维码 / 背景等）
 * 全部由 TicketConfig 承载，渲染层（apps/web components/ticket/TicketFace.vue）
 * 不做任何硬编码文案；主题色板落在 apps/web src/data/ticket.ts。
 */

export type TicketKind = 'railway' | 'drive' | 'flight';

/** 路线端点：铁路=站名+拼音，飞行=机场名+IATA 三字码 */
export interface TicketRouteEnd {
  name: string;
  /** 拼音 / 英文注记（真实车票双行排版），可选 */
  pinyin?: string;
  /** 三字码（飞行 IATA），可选 */
  code?: string;
}

export interface TicketStatItem {
  label: string;
  value: string;
  unit?: string;
}

export interface TicketTagItem {
  text: string;
  hot?: boolean;
}

/** 印章徽记图形：无 / 铁路 / 公路 / 民航 */
export type TicketSealEmblem = 'none' | 'rail' | 'road' | 'air';

export interface TicketSealConfig {
  enabled: boolean;
  emblem: TicketSealEmblem;
  text: string;
  sub?: string;
}

export interface TicketQrConfig {
  enabled: boolean;
  caption: string;
  /** 二维码内容（分享短链）；渲染层据此生成确定性码图 */
  value: string;
}

export interface TicketBackgroundConfig {
  /** 主题 id，见 apps/web src/data/ticket.ts 的 TICKET_THEMES */
  theme: string;
  /** 自定义背景图（URL 或 dataURL），低透明度叠在主题渐变上 */
  imageUrl?: string;
  /** 背景图透明度 0-1 */
  opacity: number;
}

export interface TicketBrandConfig {
  /** 顶部品牌微标 */
  logo: boolean;
  /** 票面中央低透明度品牌水印 */
  watermark: boolean;
  /** 页脚微缩文字（\n 分行） */
  footerText: string;
}

/** 承运航司引用（飞行票）；logo 由 apps/web 数据表按 code 解析 */
export interface TicketAirlineRef {
  code: string;
  name: string;
  en: string;
  flightNo: string;
  /** 联盟 id：staralliance / skyteam / oneworld / null */
  alliance?: string | null;
}

export interface TicketRouteConfig {
  ends: [TicketRouteEnd, TicketRouteEnd];
  /** 路线线中央胶囊文字（车次号 / 航班号等） */
  middleLabel?: string;
  /** 途经点链（自驾）；长度 >2 时渲染途经点链替代两端点 */
  waypoints?: string[];
  /** 路牌编号（自驾）：G6/G30 等高速绿盾，G109 等国道红盾 */
  shields?: string[];
  /** 海拔剖面采样点（自驾），渲染层自动归一化 */
  elevPoints?: number[];
  /** 海拔剖面峰值标注 */
  elevPeakLabel?: string;
}

export interface TicketConfig {
  id: string;
  kind: TicketKind;
  title: string;
  subtitle: string;
  /** 票号，规则 HW-{RAIL|DRIVE|FLIGHT}-{yyyymmdd}-{seq} */
  serial: string;
  dateText: string;
  /** 路线区左右两行补充信息（发车时间 / 座位 等） */
  metaLeft?: string;
  metaRight?: string;
  route: TicketRouteConfig;
  stats: TicketStatItem[];
  tags: TicketTagItem[];
  /** 一句话感言 */
  quote: string;
  seal: TicketSealConfig;
  qr: TicketQrConfig;
  background: TicketBackgroundConfig;
  brand: TicketBrandConfig;
  airline?: TicketAirlineRef | null;
  updatedAt: number;
}

export const TICKET_SERIAL_PREFIX: Record<TicketKind, string> = {
  railway: 'RAIL',
  drive: 'DRIVE',
  flight: 'FLIGHT',
};

/** 票号规则：HW-RAIL-20260715-001 */
export function makeTicketSerial(kind: TicketKind, dateStr: string, seq = 1): string {
  const digits = (dateStr || '').replace(/\D/g, '').slice(0, 8).padEnd(8, '0');
  return `HW-${TICKET_SERIAL_PREFIX[kind]}-${digits}-${String(seq).padStart(3, '0')}`;
}

export function newTicketId(): string {
  return `tk-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** 各票种出厂默认配置（示例数据即产品文案范本，可在编辑器中全部改写） */
export function createTicketConfig(kind: TicketKind): TicketConfig {
  const base: TicketConfig = {
    id: newTicketId(),
    kind,
    title: '',
    subtitle: '',
    serial: '',
    dateText: '',
    route: { ends: [{ name: '' }, { name: '' }] },
    stats: [],
    tags: [],
    quote: '',
    seal: { enabled: true, emblem: 'none', text: '' },
    qr: { enabled: true, caption: 'SCAN · 路书', value: 'https://hw.hey.world/t/demo' },
    background: { theme: '', opacity: 0.18 },
    brand: { logo: true, watermark: true, footerText: '万里路书 HEY WORLD\n扫码查看完整路书' },
    airline: null,
    updatedAt: Date.now(),
  };

  if (kind === 'railway') {
    return {
      ...base,
      title: '铁路纪念票',
      subtitle: '青藏铁路 · 天路之旅',
      serial: makeTicketSerial('railway', '2026-07-15'),
      dateText: '2026.07.15 · 19:40 开',
      metaLeft: '2026.07.15 · 19:40 开',
      metaRight: '07车15号下铺 · 风景侧',
      route: {
        ends: [
          { name: '西宁西', pinyin: 'XININGXI' },
          { name: '拉萨', pinyin: 'LHASA' },
        ],
        middleLabel: 'Z8991',
      },
      stats: [
        { label: '里程 MILEAGE', value: '1,972', unit: 'km' },
        { label: '时长 DURATION', value: '21h40m' },
        { label: '海拔爬升 ASCENT', value: '+4,543', unit: 'm' },
        { label: '最高海拔 APEX', value: '5,072', unit: 'm' },
      ],
      tags: [
        { text: '✨ 小确幸 5 处已打卡', hot: true },
        { text: '📸 取景框 12 张', hot: true },
        { text: '供氧车厢' },
      ],
      quote: '“在可可西里看到了藏羚羊”',
      seal: { enabled: true, emblem: 'rail', text: '中国铁路 CHINA RAILWAY', sub: '纪念制票' },
      background: { theme: 'rail-xuanlan', opacity: 0.18 },
    };
  }

  if (kind === 'drive') {
    return {
      ...base,
      title: '自驾纪念票',
      subtitle: '青甘环线 · 国家级精品自驾公路',
      serial: makeTicketSerial('drive', '2026-08-01', 3),
      dateText: '2026.08.01 - 2026.08.07',
      metaLeft: '7天6晚 · 2,200km · 驾驶38h',
      route: {
        ends: [{ name: '西宁' }, { name: '西宁' }],
        waypoints: ['西宁', '青海湖', '茶卡', '敦煌', '西宁'],
        shields: ['G6', 'G3011', 'G109'],
        elevPoints: [2200, 3200, 3100, 3400, 3817, 1100, 2200],
        elevPeakLabel: '当金山口 3,817m',
      },
      stats: [
        { label: '行程 TRIP', value: '7天6晚' },
        { label: '总里程 DISTANCE', value: '2,200', unit: 'km' },
        { label: '驾驶 DRIVING', value: '38', unit: 'h' },
        { label: '途经 VIA', value: '3省 / 8市' },
      ],
      tags: [
        { text: '✨ 小确幸 8 处', hot: true },
        { text: '📸 取景框 23 张', hot: true },
        { text: '⛽ 加油 12 次' },
        { text: '🚙 坦克300' },
      ],
      quote: '“当金山口的日落，值得所有的颠簸”',
      seal: { enabled: true, emblem: 'road', text: '万里路书 · 国家级精品自驾公路', sub: '青甘环线认证' },
      background: { theme: 'drive-dusk', opacity: 0.18 },
    };
  }

  return {
    ...base,
    title: '飞行纪念票',
    subtitle: '云端之旅记录',
    serial: makeTicketSerial('flight', '2026-07-15', 7),
    dateText: '2026.07.15',
    metaLeft: '起飞 08:30 → 降落 12:45',
    metaRight: '巡航 10,668 m',
    route: {
      ends: [
        { name: '广州白云', code: 'CAN' },
        { name: '拉萨贡嘎', code: 'LXA' },
      ],
      middleLabel: 'CZ3467',
    },
    stats: [
      { label: '日期 DATE', value: '2026.07.15' },
      { label: '起飞 DEPART', value: '08:30' },
      { label: '降落 ARRIVE', value: '12:45' },
      { label: '登机口 GATE', value: 'B12' },
      { label: '座位 SEAT', value: '32A' },
      { label: '舱位 CLASS', value: '经济舱' },
    ],
    tags: [
      { text: '🪟 左舷窗 · 看雪山侧', hot: true },
      { text: '✨ 舷窗小确幸 2（雪山/云海）', hot: true },
    ],
    quote: '“万米高空之上，雪山就在窗外”',
    seal: { enabled: true, emblem: 'air', text: '中国民航 · 纪念登机牌', sub: 'BOARDING PASS' },
    airline: {
      code: 'cz',
      name: '中国南方航空',
      en: 'CHINA SOUTHERN',
      flightNo: 'CZ3467',
      alliance: null,
    },
    background: { theme: 'flight-night', opacity: 0.18 },
  };
}
