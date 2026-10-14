/**
 * 行程 → 纪念票 TicketConfig（纯函数，不碰 Pinia / localStorage）。
 * 铁路用 UserSegment；自驾用已加载的 RoadRoute（与 applyTrain / applyDriveRoute 字段对齐）。
 */
import {
  createTicketConfig,
  haversineKm,
  makeTicketSerial,
  normalizeShieldCode,
  type RoadRoute,
  type TicketConfig,
  type UserSegment,
} from '@railvista/shared';

function nf(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function hm(min?: number): string {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

function dotDate(iso: string): string {
  return (iso || '').replace(/-/g, '.').slice(0, 10);
}

/** 从 ISO 取本地 HH:mm（时刻表多为本地墙钟） */
function hmFromIso(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function durationBetween(depIso: string, arrIso: string): string {
  const a = new Date(depIso).getTime();
  const b = new Date(arrIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return '—';
  return hm(Math.round((b - a) / 60000));
}

export type DriveTicketMeta = {
  routeName?: string;
  vehicle?: string;
  days?: string;
  dateText?: string;
  waypoints?: string[];
};

/** UserSegment → 铁路纪念票配置 */
export function ticketConfigFromRailSegment(seg: UserSegment): TicketConfig {
  const stops = seg.stops ?? [];
  const fromStop = stops[0];
  const toStop = stops[stops.length - 1];
  const departTime = fromStop?.departTime || hmFromIso(seg.baseDepartureIso);
  const arriveTime = toStop?.arriveTime || hmFromIso(seg.baseArrivalIso);
  const duration = durationBetween(seg.baseDepartureIso, seg.baseArrivalIso);
  const date = (seg.date || seg.baseDepartureIso.slice(0, 10) || '').slice(0, 10);

  let mileage: string | undefined;
  if (
    fromStop?.lat != null &&
    fromStop?.lng != null &&
    toStop?.lat != null &&
    toStop?.lng != null
  ) {
    mileage = nf(
      haversineKm(
        { lat: fromStop.lat, lng: fromStop.lng },
        { lat: toStop.lat, lng: toStop.lng },
      ),
    );
  }

  const base = createTicketConfig('railway');
  return {
    ...base,
    kind: 'railway',
    title: '铁路纪念票',
    subtitle: '',
    serial: makeTicketSerial('railway', date, 1),
    dateText: `${dotDate(date)} · ${departTime} 开`,
    metaLeft: `${dotDate(date)} · ${departTime} 开`,
    metaRight: '',
    route: {
      ...base.route,
      ends: [{ name: seg.fromName }, { name: seg.toName }],
      middleLabel: seg.trainCode,
      waypoints: [],
      shields: [],
      elevPoints: [],
    },
    stats: [
      { label: '出发 DEPART', value: departTime },
      { label: '到达 ARRIVE', value: arriveTime },
      { label: '历时 DURATION', value: duration },
      { label: '里程 MILEAGE', value: mileage ?? '—', unit: 'km' },
    ],
    tags: [],
    quote: '',
    seal: { enabled: true, emblem: 'rail', text: '中国铁路 CHINA RAILWAY', sub: '纪念制票' },
    background: { ...base.background, theme: 'rail-xuanlan' },
    updatedAt: Date.now(),
  };
}

/** RoadRoute → 自驾纪念票配置（不写入 coords） */
export function ticketConfigFromDriveRoute(
  route: RoadRoute,
  meta: DriveTicketMeta = {},
): TicketConfig {
  const shields = Array.from(
    new Set((route.roadKeys ?? []).map((k) => normalizeShieldCode(k)).filter(Boolean)),
  );
  let waypoints = (meta.waypoints ?? []).map((s) => s.trim()).filter(Boolean);
  if (!waypoints.length && route.name.includes('→')) {
    waypoints = route.name.split('→').map((s) => s.trim()).filter(Boolean);
  }

  const days = meta.days?.trim() || '';
  const dateText = meta.dateText?.trim() || '';
  const routeName = meta.routeName?.trim() || '';
  const vehicle = meta.vehicle?.trim() || '';
  const today = new Date().toISOString().slice(0, 10);

  const metaParts = [
    days,
    `${nf(route.lengthKm)} km`,
    route.durationMin ? `驾驶 ${hm(route.durationMin)}` : '',
  ].filter(Boolean);

  const stats: TicketConfig['stats'] = [];
  if (days) stats.push({ label: '行程 TRIP', value: days });
  stats.push({ label: '总里程 DISTANCE', value: nf(route.lengthKm), unit: 'km' });
  if (route.durationMin) {
    stats.push({ label: '驾驶 DRIVING', value: hm(route.durationMin), unit: '' });
  }
  if (waypoints.length) stats.push({ label: '途经点 WAYPOINTS', value: String(waypoints.length) });
  if (route.provinces?.length) {
    stats.push({ label: '跨越省份 PROVINCES', value: String(route.provinces.length) });
  }
  if (shields.length) stats.push({ label: '路牌 ROADS', value: String(shields.length) });

  const tags: TicketConfig['tags'] = [];
  if (vehicle) tags.push({ text: `🚙 ${vehicle}` });

  const base = createTicketConfig('drive');
  return {
    ...base,
    kind: 'drive',
    title: '自驾纪念票',
    subtitle: routeName || route.name || '我的自驾路线',
    serial: makeTicketSerial('drive', today, 1),
    dateText,
    metaLeft: metaParts.join(' · '),
    metaRight: '',
    route: {
      ...base.route,
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
    quote: '',
    seal: {
      enabled: true,
      emblem: 'road',
      text: '万里路书 · 精品自驾公路',
      sub: routeName || route.name || '自驾认证',
    },
    background: { ...base.background, theme: 'drive-dusk' },
    updatedAt: Date.now(),
  };
}
