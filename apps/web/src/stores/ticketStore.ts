/**
 * 万里路书 · 旅行纪念票 store（Pinia setup 风格，持久化手写 localStorage，
 * 容错模式参照 prefsStore：try/catch 包裹、隐私模式静默兜底）。
 *
 * - config：当前编辑中的票面配置（草稿自动落盘 railvista:ticketDraft）
 * - saved：已保存的配置列表（railvista:ticketSaved）
 * - 智能联动：
 *   applyTrain  12306 车次 → 票面自动生成，仅座位/里程等少量个性化
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
  normalizeShieldCode,
  type FlightLookup,
  type RoadRoute,
  type TicketConfig,
  type TicketKind,
  type TrainSummary,
} from '@railvista/shared';

const DRAFT_KEY = 'railvista:ticketDraft';
const SAVED_KEY = 'railvista:ticketSaved';

export interface SavedTicket {
  id: string;
  name: string;
  updatedAt: number;
  config: TicketConfig;
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

export interface RailPersonalize {
  seatClass?: string;
  carNo?: string;
  seatNo?: string;
  berth?: string;
  mileage?: number | null;
  quote?: string;
  scenicSide?: boolean;
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
  const config = ref<TicketConfig>(
    readJson<TicketConfig | null>(DRAFT_KEY, null) ?? createTicketConfig('railway'),
  );
  const saved = ref<SavedTicket[]>(readJson<SavedTicket[]>(SAVED_KEY, []));
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
  /** 车次选择联动：TrainSummary → 票面自动生成 */
  function applyTrain(t: TrainSummary) {
    const seq = saved.value.length + 1;
    let mileage: string | undefined;
    if (t.from.lat != null && t.from.lng != null && t.to.lat != null && t.to.lng != null) {
      // 直线距离仅作占位，铁路实际里程更长，用户可在个性化中改
      mileage = nf(
        haversineKm({ lat: t.from.lat, lng: t.from.lng }, { lat: t.to.lat, lng: t.to.lng }),
      );
    }
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
        { label: '里程 MILEAGE', value: mileage ?? '—', unit: 'km' },
      ],
      tags: [],
      quote: '',
      seal: { enabled: true, emblem: 'rail', text: '中国铁路 CHINA RAILWAY', sub: '纪念制票' },
      background: { ...config.value.background, theme: 'rail-xuanlan' },
    });
  }

  /** 铁路个性化：仅座位/铺位、里程、感言需要用户补，其余已自动 */
  function setRailPersonalize(p: RailPersonalize) {
    const seatText =
      [p.carNo ? `${p.carNo}车` : '', p.seatNo ? `${p.seatNo}号` : '', p.berth ?? '']
        .join('') + (p.scenicSide ? ' · 风景侧' : '');

    const stats = config.value.stats.map((s) => {
      if (s.label.startsWith('里程') && p.mileage != null && p.mileage > 0) {
        return { ...s, value: nf(p.mileage) };
      }
      return s;
    });
    const tags: TicketConfig['tags'] = [];
    if (p.seatClass) tags.push({ text: p.seatClass });
    patch({
      metaRight: seatText,
      stats,
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

    const airlineIata = lookup.airlineIata;
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
      background: { ...config.value.background, theme: 'flight-night' },
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
  /** 自驾 OD 规划联动：RoadRoute → 路牌/里程/驾驶时长自动生成 */
  function applyDriveRoute(route: RoadRoute, meta: DriveRouteMeta = {}) {
    const shields = Array.from(
      new Set((route.roadKeys ?? []).map((k) => normalizeShieldCode(k))),
    );
    let waypoints = meta.waypoints ?? [];
    if (!waypoints.length && route.name.includes('→')) {
      waypoints = route.name.split('→').map((s) => s.trim()).filter(Boolean);
    }

    const metaParts = [
      meta.days,
      `${nf(route.lengthKm)}km`,
      route.durationMin ? `驾驶${hm(route.durationMin)}` : '',
    ].filter(Boolean);

    const stats: TicketConfig['stats'] = [
      { label: '总里程 DISTANCE', value: nf(route.lengthKm), unit: 'km' },
    ];
    if (route.durationMin) stats.push({ label: '驾驶 DRIVING', value: hm(route.durationMin), unit: '' });
    stats.push({ label: '途经点 WAYPOINTS', value: String(waypoints.length) });
    if (route.provinces?.length) {
      stats.push({ label: '跨越省份 PROVINCES', value: String(route.provinces.length) });
    }
    stats.push({ label: '路牌 ROADS', value: String(shields.length) });

    const tags: TicketConfig['tags'] = [];
    if (meta.vehicle) tags.push({ text: `🚙 ${meta.vehicle}` });

    patch({
      kind: 'drive',
      title: '自驾纪念票',
      subtitle: meta.routeName ?? '',
      serial: makeTicketSerial('drive', new Date().toISOString().slice(0, 10), saved.value.length + 1),
      dateText: meta.dateText ?? '',
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
      seal: { enabled: true, emblem: 'road', text: '万里路书 · 精品自驾公路', sub: meta.routeName ?? '自驾认证' },
      background: { ...config.value.background, theme: 'drive-dusk' },
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

  /** 自驾杂项（天数/日期/车辆/感言） */
  function setDriveMeta(p: { days?: string; dateText?: string; vehicle?: string; quote?: string }) {
    const tags = config.value.tags.filter((t) => !t.text.startsWith('🚙'));
    if (p.vehicle) tags.push({ text: `🚙 ${p.vehicle}` });
    patch({
      ...(p.dateText != null ? { dateText: p.dateText } : {}),
      ...(p.quote != null ? { quote: p.quote } : {}),
      tags,
    });
  }

  function save(name?: string): SavedTicket {
    const item: SavedTicket = {
      id: config.value.id,
      name: name?.trim() || config.value.title || '未命名纪念票',
      updatedAt: Date.now(),
      config: clone(config.value),
    };
    const i = saved.value.findIndex((s) => s.id === item.id);
    if (i >= 0) saved.value.splice(i, 1, item);
    else saved.value.unshift(item);
    writeJson(SAVED_KEY, saved.value);
    return item;
  }

  function loadSaved(id: string) {
    const hit = saved.value.find((s) => s.id === id);
    if (hit) config.value = clone(hit.config);
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
    loadSaved,
    removeSaved,
  };
});
