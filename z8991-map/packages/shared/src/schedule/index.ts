import type {
  CalibrationRecord,
  LayerVisibility,
  ScheduleResolveResult,
  Stop,
  UserSegment,
} from '../types.js';

export const CALIBRATE_WINDOW_MS = 45 * 60 * 1000;

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  rail: true,
  station: true,
  spot: true,
  train: true,
  gps: true,
};

export function prefsKey(segment: Pick<UserSegment, 'trainCode' | 'date' | 'fromName' | 'toName'>, kind: string): string {
  const id = `${segment.trainCode}|${segment.date}|${segment.fromName}|${segment.toName}`;
  return `railvista:${kind}:${id}`;
}

export function shiftDate(value: string | Date, offsetMs: number): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + offsetMs);
}

export function resolveSchedule(
  baseDepartureIso: string,
  baseArrivalIso: string,
  departureIso?: string | null,
): ScheduleResolveResult {
  const baseDeparture = new Date(baseDepartureIso);
  const baseArrival = new Date(baseArrivalIso);
  const departure = new Date(departureIso || baseDepartureIso);
  const offsetMs = departure.getTime() - baseDeparture.getTime();
  const arrival = shiftDate(baseArrival, offsetMs);
  return { departure, arrival, offsetMs, baseDeparture, baseArrival };
}

export function toDatetimeLocalValue(isoOrDate: string | Date): string {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const s = date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  return s.slice(0, 16).replace(' ', 'T');
}

export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  return `${value}:00+08:00`;
}

export function effectiveScheduleDate(now: Date | number, calibration: CalibrationRecord | null): Date {
  const base = now instanceof Date ? now : new Date(now);
  if (!calibration || typeof calibration.offsetMs !== 'number') return base;
  return new Date(base.getTime() - calibration.offsetMs);
}

export function getStationAnchorTime(
  station: Stop,
  shifted: (iso: string) => Date,
): Date | null {
  if (station.type === 'depart' || station.type === 'arrive') return null;
  const arrive = station.arrive || station.arriveTime;
  if (!arrive) return null;
  return shifted(arrive);
}

export function computeCalibrationOffset(now: Date, anchorTime: Date): number {
  return now.getTime() - anchorTime.getTime();
}

export function formatOffsetLabel(offsetMs: number): string {
  const min = Math.round(offsetMs / 60000);
  if (min === 0) return '准点';
  if (min > 0) return `晚点 ${min} 分钟`;
  return `早点 ${Math.abs(min)} 分钟`;
}

export function isNearScheduledArrival(
  now: Date,
  station: Stop,
  shifted: (iso: string) => Date,
  windowMs = CALIBRATE_WINDOW_MS,
): boolean {
  const anchor = getStationAnchorTime(station, shifted);
  if (!anchor) return false;
  return Math.abs(now.getTime() - anchor.getTime()) <= windowMs;
}

export function getCalibratableStations(stops: Stop[]): Stop[] {
  return stops.filter((s) => {
    if (s.type === 'stop') return true;
    if (s.type === 'depart' || s.type === 'arrive') return false;
    return !!(s.arrive || s.arriveTime) && !!(s.depart || s.departTime);
  });
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDepartBadge(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatDepartLong(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`;
}

export function formatSpotTimeLabel(
  timeLabel: string | undefined,
  shiftedStart: Date,
): string {
  const start = shiftedStart;
  const m = timeLabel && timeLabel.match(/(\d{1,2}:\d{2})\s*[～~]\s*(\d{1,2}:\d{2})/);
  if (!m) return formatTime(start);
  const [sh, sm] = m[1].split(':').map(Number);
  const [eh, em] = m[2].split(':').map(Number);
  let durMin = eh * 60 + em - (sh * 60 + sm);
  if (durMin < 0) durMin += 24 * 60;
  const end = new Date(start.getTime() + durMin * 60000);
  return `${formatTime(start)}～${formatTime(end)}`;
}

export function formatStationSchedule(station: Stop, shifted: (iso: string) => Date): string {
  if (station.type === 'depart' || (!station.arrive && !station.arriveTime && (station.at || station.departTime))) {
    const t = station.at || station.departTime || station.depart;
    if (t) return `开点 ${formatTime(shifted(t))} · 始发`;
  }
  if (station.type === 'arrive' || (!station.depart && !station.departTime && (station.at || station.arriveTime))) {
    const t = station.at || station.arriveTime || station.arrive;
    if (t && station.type === 'arrive') return `到点 ${formatTime(shifted(t))} · 终到`;
  }
  const arrIso = station.arrive || station.arriveTime;
  const depIso = station.depart || station.departTime;
  if (arrIso && depIso) {
    return `到 ${formatTime(shifted(arrIso))} · 开 ${formatTime(shifted(depIso))}`;
  }
  if (arrIso) return `到点 ${formatTime(shifted(arrIso))}`;
  if (depIso) return `开点 ${formatTime(shifted(depIso))}`;
  return '';
}

/** OD 截取：iFrom < iTo */
export function sliceStopsByOd(stopsAll: Stop[], fromName: string, toName: string): Stop[] {
  const iFrom = stopsAll.findIndex((s) => s.name === fromName || s.name.startsWith(fromName));
  const iTo = stopsAll.findIndex((s) => s.name === toName || s.name.startsWith(toName));
  if (iFrom < 0 || iTo < 0 || iFrom >= iTo) {
    throw new Error(`无法截取区间：${fromName} → ${toName}`);
  }
  return stopsAll.slice(iFrom, iTo + 1).map((s, idx, arr) => {
    const copy = { ...s, seq: idx + 1 };
    if (idx === 0) copy.type = 'depart';
    else if (idx === arr.length - 1) copy.type = 'arrive';
    else copy.type = 'stop';
    return copy;
  });
}

export function stopAnchorIso(stop: Stop, prefer: 'depart' | 'arrive' | 'auto' = 'auto'): string | null {
  if (prefer === 'depart') return stop.depart || stop.departTime || stop.at || stop.arrive || stop.arriveTime;
  if (prefer === 'arrive') return stop.arrive || stop.arriveTime || stop.at || stop.depart || stop.departTime;
  if (stop.type === 'depart') return stop.at || stop.depart || stop.departTime || stop.arrive || stop.arriveTime;
  if (stop.type === 'arrive') return stop.at || stop.arrive || stop.arriveTime || stop.depart || stop.departTime;
  return stop.depart || stop.departTime || stop.arrive || stop.arriveTime || stop.at || null;
}

export function buildUserSegment(params: {
  trainCode: string;
  trainNo: string;
  date: string;
  fromName: string;
  toName: string;
  fromTelecode?: string;
  toTelecode?: string;
  stopsAll: Stop[];
}): UserSegment {
  const stops = sliceStopsByOd(params.stopsAll, params.fromName, params.toName);
  const first = stops[0];
  const last = stops[stops.length - 1];
  const baseDepartureIso = stopAnchorIso(first, 'depart');
  const baseArrivalIso = stopAnchorIso(last, 'arrive');
  if (!baseDepartureIso || !baseArrivalIso) {
    throw new Error('区间首末站缺少时刻');
  }
  return {
    trainCode: params.trainCode,
    trainNo: params.trainNo,
    date: params.date,
    fromName: first.name,
    toName: last.name,
    fromTelecode: params.fromTelecode,
    toTelecode: params.toTelecode,
    stops,
    baseDepartureIso,
    baseArrivalIso,
  };
}
