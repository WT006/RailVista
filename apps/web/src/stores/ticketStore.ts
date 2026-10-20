/**
 * 万里路书 · 旅行纪念票 store（Pinia setup 风格，持久化手写 localStorage，
 * 容错模式参照 prefsStore：try/catch 包裹、隐私模式静默兜底）。
 *
 * - config：当前编辑中的票面配置（草稿自动落盘 railvista:ticketDraft）
 * - saved：已保存的配置列表（railvista:ticketSaved）
 * - 智能联动：
 *   applyTrain  12306 车次 → 票面自动生成（含里程估算），仅座位/感言等少量个性化
 *   applyFlight 航班查询结果 → 起降机场（含英文名）/时刻/里程/巡航高度自动匹配
 *   applyDriveRoute 自驾 OD 规划 → 路牌/里程/驾驶时长自动生成，路牌可手动增删
 */
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import {
  createTicketConfig,
  cruiseAltitudeM,
  flightDurationMinEst,
  flightLevelText,
  getAirline,
  getAirport,
  haversineKm,
  makeTicketSerial,
  newTicketId,
  normalizeShieldCode,
  parseFlightIata,
  type FlightLookup,
  type RoadRoute,
  type TicketConfig,
  type TicketKind,
  type TrainSummary,
} from '@railvista/shared';
import { themesForKind } from '../data/ticket';

const DRAFT_KEY = 'railvista:ticketDraft';
const SAVED_KEY = 'railvista:ticketSaved';
/** 本机已保存纪念票上限（超出淘汰最旧） */
export const SAVED_TICKET_MAX = 5;

/** 旧演示短链 → 正式路书站（仅迁移占位值，用户自定义 URL 不动） */
const LEGACY_QR_URL = 'https://hw.hey.world/t/demo';
const WAYBOOK_QR_URL = 'https://waybook.tyuho.cn';

export interface SavedTicket {
  id: string;
  name: string;
  updatedAt: number;
  config: TicketConfig;
  /** 保存时固化的去重键，避免二次计算漂移 */
  fingerprint?: string;
}

const ELEV_POINTS_MAX = 64;

/** 草稿迁移：二维码域名 + 海拔采样异常膨胀清理（旧编辑器把 `, ` 拆出一串 0） */
function migrateQrValue(cfg: TicketConfig): TicketConfig {
  let next = cfg;
  const elev = cfg.route?.elevPoints;
  if (Array.isArray(elev) && elev.length > ELEV_POINTS_MAX) {
    next = {
      ...next,
      route: { ...next.route, elevPoints: elev.slice(0, ELEV_POINTS_MAX) },
    };
  }
  if (next.qr?.value !== LEGACY_QR_URL) return next;
  return {
    ...next,
    qr: { ...next.qr, value: WAYBOOK_QR_URL },
    brand: {
      ...next.brand,
      footerText: next.brand.footerText?.includes('hey.world')
        ? '万里路书 · waybook.tyuho.cn\n微信扫二维码打开'
        : next.brand.footerText,
    },
  };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function dotDate(iso: string): string {
  return (iso || '').replace(/-/g, '.');
}

function capPy(py?: string): string | undefined {
  return py ? py.toUpperCase() : undefined;
}

/** 分钟 → 2h15m */
function hm(min?: number): string {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

function nf(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 从 dateText / serial 抽 YYYY.MM.DD 或 YYYY-MM-DD，用于展示与去重 */
function coreDatePart(cfg: TicketConfig): string {
  const fromText = (cfg.dateText || '').split(/[·•]/)[0]?.trim() ?? '';
  if (fromText) return fromText.replace(/\s+/g, '');
  const m = /HW-[A-Z]+-(\d{8})/i.exec(cfg.serial || '');
  if (!m?.[1]) return '';
  const d = m[1];
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

function odLabel(cfg: TicketConfig): string {
  const a = cfg.route.ends[0];
  const b = cfg.route.ends[1];
  const left = (a?.code || a?.name || '').trim();
  const right = (b?.code || b?.name || '').trim();
  if (left && right) return `${left}→${right}`;
  return left || right;
}

/**
 * 列表展示名：核心行程信息，避免千篇一律的「铁路纪念票」。
 * 铁路 G123 北京南→上海虹桥 · 2026.10.14
 * 飞行 CA4401 PEK→CTU · 2026.10.14
 * 自驾 青甘大环线 · 西宁→西宁
 */
export function ticketCoreName(cfg: TicketConfig): string {
  const od = odLabel(cfg);
  const date = coreDatePart(cfg);
  if (cfg.kind === 'railway') {
    const code = (cfg.route.middleLabel || '').trim();
    const head = [code, od].filter(Boolean).join(' ');
    return [head, date].filter(Boolean).join(' · ') || cfg.title || '铁路纪念票';
  }
  if (cfg.kind === 'flight') {
    const no = (cfg.airline?.flightNo || cfg.route.middleLabel || '').trim();
    const head = [no, od].filter(Boolean).join(' ');
    return [head, date].filter(Boolean).join(' · ') || cfg.title || '飞行纪念票';
  }
  const routeName = (cfg.subtitle || '').trim();
  const head = routeName && od && !routeName.includes('→') ? `${routeName} · ${od}` : routeName || od;
  return [head, date].filter(Boolean).join(' · ') || cfg.title || '自驾纪念票';
}

function normFpPart(s: string): string {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[·•．]/g, '.')
    .toLowerCase();
}

/** 同一行程指纹（座位/感言等个性化不参与），用于重复保存提示 */
export function ticketFingerprint(cfg: TicketConfig): string {
  const a = normFpPart(cfg.route.ends[0]?.code || cfg.route.ends[0]?.name || '');
  const b = normFpPart(cfg.route.ends[1]?.code || cfg.route.ends[1]?.name || '');
  const date = normFpPart(coreDatePart(cfg));
  if (cfg.kind === 'railway') {
    return ['r', normFpPart(cfg.route.middleLabel || ''), a, b, date].join('|');
  }
  if (cfg.kind === 'flight') {
    const no = normFpPart(cfg.airline?.flightNo || cfg.route.middleLabel || '');
    return ['f', no, a, b, date].join('|');
  }
  const shields = [...(cfg.route.shields ?? [])]
    .map((s) => normFpPart(s))
    .filter(Boolean)
    .sort()
    .join(',');
  return ['d', normFpPart(cfg.subtitle || ''), a, b, shields, date].join('|');
}

export interface RailPersonalize {
  seatClass?: string;
  carNo?: string;
  seatNo?: string;
  berth?: string;
  quote?: string;
}

/**
 * 成票时的主题：用户已在主流程选定本票种的主题就沿用，否则回落到该票种首款。
 * 否则「换主题 → 重新查车次」会把票面颜色悄悄改回默认。
 */
function resolveTheme(kind: TicketKind, current: string): string {
  const list = themesForKind(kind);
  return list.some((t) => t.id === current) ? current : (list[0]?.id ?? '');
}

/** 铁路里程：优先站坐标弦长×线型系数；无坐标时用历时×典型均速估算 */
function estimateRailMileageKm(t: TrainSummary): number | undefined {
  if (t.from.lat != null && t.from.lng != null && t.to.lat != null && t.to.lng != null) {
    const chord = haversineKm(
      { lat: t.from.lat, lng: t.from.lng },
      { lat: t.to.lat, lng: t.to.lng },
    );
    if (chord > 0) {
      const code = String(t.trainCode || '').toUpperCase();
      const factor = /^[GDC]/.test(code) ? 1.12 : 1.22;
      return Math.max(1, Math.round(chord * factor));
    }
  }
  const m = /^(\d+):(\d{2})$/.exec(String(t.duration || '').trim());
  if (!m) return undefined;
  const hours = Number(m[1]) + Number(m[2]) / 60;
  if (!(hours > 0)) return undefined;
  const code = String(t.trainCode || '').toUpperCase();
  const kmh = /^[GDC]/.test(code) ? 250 : /^Z/.test(code) ? 120 : 90;
  return Math.max(1, Math.round(hours * kmh));
}

export interface FlightChoices {
  depIata?: string;
  arrIata?: string;
  cabin: string;
  seat?: string;
  windowSide?: string;
  depTime?: string;
  arrTime?: string;
  gate?: string;
}

export interface DriveRouteMeta {
  routeName?: string;
  vehicle?: string;
  days?: string;
  dateText?: string;
  waypoints?: string[];
}

export const useTicketStore = defineStore('ticket', () => {
  const draftRaw = readJson<TicketConfig | null>(DRAFT_KEY, null);
  const config = ref<TicketConfig>(
    draftRaw ? migrateQrValue(draftRaw) : createTicketConfig('railway'),
  );
  const saved = ref<SavedTicket[]>(
    readJson<SavedTicket[]>(SAVED_KEY, [])
      .map((t) => ({
        ...t,
        config: migrateQrValue(t.config),
      }))
      .slice(0, SAVED_TICKET_MAX),
  );
  /** 纯预览模式：隐藏编辑侧栏，票面居中放大 */
  const previewOnly = ref(false);

  let persistTimer: number | undefined;
  watch(
    config,
    () => {
      window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => writeJson(DRAFT_KEY, config.value), 300);
    },
    { deep: true },
  );

  function patch(p: Partial<TicketConfig>) {
    config.value = { ...config.value, ...p, updatedAt: Date.now() };
  }

  /** 切换票种 = 以该票种出厂默认开一张新票（已保存的不受影响） */
  function newTicket(kind: TicketKind) {
    config.value = createTicketConfig(kind);
  }

  // ── 铁路 ──────────────────────────────────────────────────────────────────
  /** 车次选择联动：TrainSummary → 票面自动生成（里程由站坐标/历时估算，无需用户填） */
  function applyTrain(t: TrainSummary) {
    const seq = saved.value.length + 1;
    const mileageKm = estimateRailMileageKm(t);
    patch({
      kind: 'railway',
      title: '铁路纪念票',
      subtitle: '',
      serial: makeTicketSerial('railway', t.date, seq),
      dateText: `${dotDate(t.date)} · ${t.departTime} 开`,
      metaLeft: `${dotDate(t.date)} · ${t.departTime} 开`,
      metaRight: '',
      route: {
        ...config.value.route,
        ends: [
          { name: t.from.name, pinyin: capPy(t.from.pinyin) },
          { name: t.to.name, pinyin: capPy(t.to.pinyin) },
        ],
        middleLabel: t.trainCode,
        waypoints: [],
        shields: [],
        elevPoints: [],
      },
      stats: [
        { label: '出发 DEPART', value: t.departTime },
        { label: '到达 ARRIVE', value: t.arriveTime },
        { label: '历时 DURATION', value: t.duration || '—' },
        { label: '里程 MILEAGE', value: mileageKm != null ? nf(mileageKm) : '—', unit: 'km' },
      ],
      tags: [],
      quote: '',
      seal: { enabled: true, emblem: 'rail', text: '中国铁路 CHINA RAILWAY', sub: '纪念制票' },
      background: { ...config.value.background, theme: resolveTheme('railway', config.value.background.theme) },
    });
  }

  /** 铁路个性化：仅席别/座位/铺位/感言；里程已在选车时自动写入 */
  function setRailPersonalize(p: RailPersonalize) {
    const seatText = [p.carNo ? `${p.carNo}车` : '', p.seatNo ? `${p.seatNo}号` : '', p.berth ?? '']
      .filter(Boolean)
      .join('');

    const tags: TicketConfig['tags'] = [];
    if (p.seatClass) tags.push({ text: p.seatClass });
    patch({
      metaRight: seatText,
      tags,
      ...(p.quote != null ? { quote: p.quote } : {}),
    });
  }

  // ── 飞行 ──────────────────────────────────────────────────────────────────
  /** 航班查询联动：FlightLookup + 用户少量选择（舱位/座位）→ 票面自动生成 */
  function applyFlight(lookup: FlightLookup, ch: FlightChoices) {
    const depIata = lookup.dep?.iata ?? ch.depIata ?? '';
    const arrIata = lookup.arr?.iata ?? ch.arrIata ?? '';
    const ap = getAirport(depIata);
    const bp = getAirport(arrIata);

    const depTime = lookup.dep?.actual ?? lookup.dep?.scheduled ?? ch.depTime ?? '';
    const arrTime = lookup.arr?.actual ?? lookup.arr?.scheduled ?? ch.arrTime ?? '';
    const gate = lookup.dep?.gate ?? ch.gate ?? '';

    let distance = lookup.distanceKm;
    if ((distance == null || distance <= 0) && ap && bp) distance = Math.round(haversineKm(ap, bp));
    let duration = lookup.durationMin;
    if ((duration == null || duration <= 0) && distance && distance > 0) {
      duration = flightDurationMinEst(distance);
    }
    const cruise = lookup.cruiseAltitudeM ?? (distance ? cruiseAltitudeM(distance) : undefined);

    const shortName = (a?: ReturnType<typeof getAirport>) =>
      a ? a.name.replace(/国际机场$/, '').replace(/机场$/, '') : '';

    // 二字码缺失时从航班号自解析：3U/8L/9C 这类数字开头码易被上游截空
    const airlineIata = lookup.airlineIata || parseFlightIata(lookup.flightNumber)?.airlineIata;
    const airlineInfo = airlineIata ? getAirline(airlineIata) : undefined;

    const stats: TicketConfig['stats'] = [
      { label: '日期 DATE', value: dotDate(lookup.date) },
      { label: '起飞 DEPART', value: depTime || '—' },
      { label: '降落 ARRIVE', value: arrTime || '—' },
      { label: '舱位 CLASS', value: ch.cabin },
      { label: '座位 SEAT', value: ch.seat || '—' },
    ];
    if (gate) stats.push({ label: '登机口 GATE', value: gate });
    stats.push(
      { label: '飞行时长 DURATION', value: hm(duration) },
      { label: '里程 DISTANCE', value: distance ? nf(distance) : '—', unit: 'km' },
      {
        label: '巡航高度 CRUISE',
        value: cruise ? `${nf(cruise)} m · ${flightLevelText(cruise)}` : '—',
      },
    );

    const tags: TicketConfig['tags'] = [];
    if (ch.windowSide) tags.push({ text: `🪟 ${ch.windowSide}舷窗`, hot: true });

    patch({
      kind: 'flight',
      title: '飞行纪念票',
      subtitle: airlineInfo ? `${airlineInfo.name} · BOARDING PASS` : '纪念登机牌',
      serial:
        config.value.serial ||
        makeTicketSerial('flight', lookup.date, saved.value.length + 1),
      dateText: dotDate(lookup.date),
      metaLeft: `起飞 ${depTime || '—'} → 降落 ${arrTime || '—'}`,
      metaRight: `${ch.cabin}${ch.seat ? ` · ${ch.seat}` : ''}`,
      route: {
        ...config.value.route,
        ends: [
          { name: shortName(ap) || depIata, code: depIata, pinyin: ap?.nameEn },
          { name: shortName(bp) || arrIata, code: arrIata, pinyin: bp?.nameEn },
        ],
        middleLabel: lookup.flightNumber,
        waypoints: [],
        shields: [],
        elevPoints: [],
      },
      stats,
      tags,
      quote: config.value.quote,
      seal: { enabled: true, emblem: 'air', text: '中国民航 · 纪念登机牌', sub: 'BOARDING PASS' },
      background: { ...config.value.background, theme: resolveTheme('flight', config.value.background.theme) },
      airline: airlineInfo
        ? {
            code: airlineInfo.iata.toLowerCase(),
            name: airlineInfo.name,
            en: airlineInfo.nameEn.toUpperCase(),
            flightNo: lookup.flightNumber,
            alliance: airlineInfo.alliance ?? null,
          }
        : null,
    });
  }

  // ── 自驾 ──────────────────────────────────────────────────────────────────
  /** 自驾 OD 规划联动：RoadRoute → 路牌/里程/驾驶时长 + 个性字段写入票面 */
  function applyDriveRoute(route: RoadRoute, meta: DriveRouteMeta = {}) {
    const shields = Array.from(
      new Set([
        ...(route.roadKeys ?? []).map((k) => normalizeShieldCode(k)),
        ...(config.value.route.shields ?? []),
      ].filter(Boolean)),
    );
    let waypoints = (meta.waypoints ?? []).map((s) => s.trim()).filter(Boolean);
    if (!waypoints.length && route.name.includes('→')) {
      waypoints = route.name.split('→').map((s) => s.trim()).filter(Boolean);
    }

    const days = meta.days?.trim() || '';
    const dateText = meta.dateText?.trim() || '';
    const routeName = meta.routeName?.trim() || '';
    const vehicle = meta.vehicle?.trim() || '';

    const metaParts = [
      days,
      `${nf(route.lengthKm)} km`,
      route.durationMin ? `驾驶 ${hm(route.durationMin)}` : '',
    ].filter(Boolean);

    const stats: TicketConfig['stats'] = [];
    if (days) stats.push({ label: '行程 TRIP', value: days });
    stats.push({ label: '总里程 DISTANCE', value: nf(route.lengthKm), unit: 'km' });
    if (route.durationMin) stats.push({ label: '驾驶 DRIVING', value: hm(route.durationMin), unit: '' });
    if (waypoints.length) stats.push({ label: '途经点 WAYPOINTS', value: String(waypoints.length) });
    if (route.provinces?.length) {
      stats.push({ label: '跨越省份 PROVINCES', value: String(route.provinces.length) });
    }
    if (shields.length) stats.push({ label: '路牌 ROADS', value: String(shields.length) });

    const tags: TicketConfig['tags'] = [];
    if (vehicle) tags.push({ text: `🚙 ${vehicle}` });

    patch({
      kind: 'drive',
      title: '自驾纪念票',
      subtitle: routeName || route.name || '我的自驾路线',
      serial: makeTicketSerial('drive', new Date().toISOString().slice(0, 10), saved.value.length + 1),
      dateText,
      metaLeft: metaParts.join(' · '),
      metaRight: '',
      route: {
        ...config.value.route,
        ends: [
          { name: waypoints[0] ?? '' },
          { name: waypoints[waypoints.length - 1] ?? '' },
        ],
        waypoints,
        shields,
        elevPoints: [],
      },
      stats,
      tags,
      quote: config.value.quote,
      seal: {
        enabled: true,
        emblem: 'road',
        text: '万里路书 · 精品自驾公路',
        sub: routeName || '自驾认证',
      },
      background: { ...config.value.background, theme: resolveTheme('drive', config.value.background.theme) },
    });
  }

  /** 路牌：手动添加（自动识别国道/高速制式） */
  function addShield(code: string) {
    const norm = normalizeShieldCode(code);
    const shields = config.value.route.shields ?? [];
    if (norm && !shields.includes(norm)) {
      const next = [...shields, norm];
      patch({
        route: { ...config.value.route, shields: next },
        stats: config.value.stats.map((s) =>
          s.label.startsWith('路牌') ? { ...s, value: String(next.length) } : s,
        ),
      });
    }
  }

  /** 路牌：删除指定项 */
  function removeShield(i: number) {
    const shields = [...(config.value.route.shields ?? [])];
    shields.splice(i, 1);
    const waypoints = config.value.route.waypoints ?? [];
    patch({
      route: { ...config.value.route, shields },
      stats: config.value.stats.map((s) =>
        s.label.startsWith('路牌') ? { ...s, value: String(shields.length) } : s,
      ),
    });
  }

  /** 自驾途经点更新 */
  function setDriveWaypoints(waypoints: string[]) {
    patch({
      route: {
        ...config.value.route,
        waypoints,
        ends: [
          { name: waypoints[0] ?? '' },
          { name: waypoints[waypoints.length - 1] ?? '' },
        ],
      },
      stats: config.value.stats.map((s) =>
        s.label.startsWith('途经点') ? { ...s, value: String(waypoints.length) } : s,
      ),
    });
  }

  /** 自驾杂项（路线名/天数/日期/车辆/感言）——规划后微调时同步票面 */
  function setDriveMeta(p: {
    routeName?: string;
    days?: string;
    dateText?: string;
    vehicle?: string;
    quote?: string;
  }) {
    const tags = config.value.tags.filter((t) => !t.text.startsWith('🚙'));
    const vehicle = p.vehicle?.trim();
    if (vehicle) tags.push({ text: `🚙 ${vehicle}` });

    const days = p.days != null ? p.days.trim() : undefined;
    const routeName = p.routeName != null ? p.routeName.trim() : undefined;

    // 保留里程 / 驾驶文案，只替换天数段
    let metaLeft = config.value.metaLeft ?? '';
    if (days != null) {
      const rest = metaLeft
        .split(' · ')
        .filter((part) => part && !/天|晚/.test(part) && !/^\d+D/i.test(part));
      metaLeft = [days, ...rest].filter(Boolean).join(' · ');
    }

    const stats = config.value.stats.filter((s) => !s.label.startsWith('行程'));
    if (days) stats.unshift({ label: '行程 TRIP', value: days });

    patch({
      ...(p.dateText != null ? { dateText: p.dateText.trim() } : {}),
      ...(p.quote != null ? { quote: p.quote } : {}),
      ...(routeName != null
        ? {
            subtitle: routeName || config.value.subtitle,
            seal: { ...config.value.seal, sub: routeName || '自驾认证' },
          }
        : {}),
      metaLeft,
      stats,
      tags,
    });
  }

  /** 列表里是否已有同一张票（票号优先，其次行程指纹） */
  function findDuplicate(cfg: TicketConfig = config.value): SavedTicket | undefined {
    const serial = (cfg.serial || '').trim();
    const fp = ticketFingerprint(cfg);
    return saved.value.find((s) => {
      const savedSerial = (s.config?.serial || '').trim();
      if (serial && savedSerial && serial === savedSerial) return true;
      if (s.fingerprint && s.fingerprint === fp) return true;
      return ticketFingerprint(s.config) === fp;
    });
  }

  /**
   * 保存到本机列表。
   * - 列表项 id 与草稿 id 脱钩：不同行程各占一条。
   * - 同票号 / 同行程已存在 → 不写入，返回 duplicate。
   */
  function save(name?: string): { status: 'saved'; item: SavedTicket } | { status: 'duplicate' } {
    const cfg = clone(config.value);
    const displayName = name?.trim() || ticketCoreName(cfg);
    const fp = ticketFingerprint(cfg);

    if (findDuplicate(cfg)) {
      return { status: 'duplicate' };
    }

    const item: SavedTicket = {
      id: newTicketId(),
      name: displayName,
      updatedAt: Date.now(),
      config: cfg,
      fingerprint: fp,
    };
    saved.value.unshift(item);
    if (saved.value.length > SAVED_TICKET_MAX) {
      saved.value = saved.value.slice(0, SAVED_TICKET_MAX);
    }
    writeJson(SAVED_KEY, saved.value);
    return { status: 'saved', item };
  }

  function loadSaved(id: string) {
    const hit = saved.value.find((s) => s.id === id);
    if (hit) config.value = clone(hit.config);
  }

  /** 从行程痕迹载入草稿（不自动写入 saved） */
  function loadConfig(cfg: TicketConfig) {
    config.value = clone(cfg);
  }

  function removeSaved(id: string) {
    saved.value = saved.value.filter((s) => s.id !== id);
    writeJson(SAVED_KEY, saved.value);
  }

  return {
    config,
    saved,
    previewOnly,
    patch,
    newTicket,
    applyTrain,
    setRailPersonalize,
    applyFlight,
    applyDriveRoute,
    addShield,
    removeShield,
    setDriveWaypoints,
    setDriveMeta,
    save,
    findDuplicate,
    loadSaved,
    loadConfig,
    removeSaved,
  };
});
