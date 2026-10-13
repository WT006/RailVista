/**
 * 自驾「当前行程」指针：对标铁路 tripCache 的 autoResume，
 * 只存身份 + 进度，不落整包快照（沿程页按 query 重拉即可）。
 */

export type DriveCurrentKind = 'od' | 'road' | 'route';

export type DriveCurrentTrip = {
  key: string;
  kind: DriveCurrentKind;
  title: string;
  /** OD */
  from?: string;
  to?: string;
  /** 整条公路编号 */
  road?: string;
  /** 路书条目 id */
  route?: string;
  /** 0–1 沿程进度，可选 */
  progress?: number;
  pinnedAt: number;
};

const STORAGE_KEY = 'railvista:driveCurrentTrip';

export function driveTripKeyFromQuery(q: {
  road?: unknown;
  route?: unknown;
  from?: unknown;
  to?: unknown;
}): string | null {
  if (typeof q.road === 'string' && q.road.trim()) return `road:${q.road.trim()}`;
  if (typeof q.route === 'string' && q.route.trim()) return `route:${q.route.trim()}`;
  const from = typeof q.from === 'string' ? q.from.trim() : '';
  const to = typeof q.to === 'string' ? q.to.trim() : '';
  if (from && to) return `od:${from}|${to}`;
  return null;
}

export function getDriveCurrentTrip(): DriveCurrentTrip | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DriveCurrentTrip;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.key !== 'string') return null;
    if (parsed.kind !== 'od' && parsed.kind !== 'road' && parsed.kind !== 'route') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setDriveCurrentTrip(trip: DriveCurrentTrip) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trip));
  } catch {
    /* private mode / quota */
  }
}

export function clearDriveCurrentTrip() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* */
  }
}

export function isDriveCurrentPinned(key: string | null | undefined): boolean {
  if (!key) return false;
  return getDriveCurrentTrip()?.key === key;
}

/** 仅在已 pin 且 key 匹配时更新进度；未 pin 不写入 */
export function updateDriveCurrentProgress(key: string, progress: number) {
  const cur = getDriveCurrentTrip();
  if (!cur || cur.key !== key) return;
  const p = Math.max(0, Math.min(1, progress));
  if (cur.progress != null && Math.abs(cur.progress - p) < 0.002) return;
  setDriveCurrentTrip({ ...cur, progress: p, pinnedAt: cur.pinnedAt });
}

export function buildDriveCurrentFromPage(input: {
  kind: DriveCurrentKind;
  title: string;
  from?: string;
  to?: string;
  road?: string;
  route?: string;
  progress?: number;
}): DriveCurrentTrip | null {
  let key: string | null = null;
  if (input.kind === 'road' && input.road?.trim()) key = `road:${input.road.trim()}`;
  else if (input.kind === 'route' && input.route?.trim()) key = `route:${input.route.trim()}`;
  else if (input.kind === 'od' && input.from?.trim() && input.to?.trim()) {
    key = `od:${input.from.trim()}|${input.to.trim()}`;
  }
  if (!key) return null;
  return {
    key,
    kind: input.kind,
    title: input.title.trim() || key,
    from: input.from?.trim() || undefined,
    to: input.to?.trim() || undefined,
    road: input.road?.trim() || undefined,
    route: input.route?.trim() || undefined,
    progress:
      input.progress != null && Number.isFinite(input.progress)
        ? Math.max(0, Math.min(1, input.progress))
        : undefined,
    pinnedAt: Date.now(),
  };
}

/** 继续行程用的 router query */
export function driveCurrentToQuery(trip: DriveCurrentTrip): Record<string, string> {
  const q: Record<string, string> = {};
  if (trip.kind === 'road' && trip.road) q.road = trip.road;
  else if (trip.kind === 'route' && trip.route) q.route = trip.route;
  else {
    if (trip.from) q.from = trip.from;
    if (trip.to) q.to = trip.to;
  }
  if (trip.progress != null && Number.isFinite(trip.progress) && trip.progress > 0) {
    q.progress = String(Math.round(trip.progress * 1000) / 1000);
  }
  return q;
}

export function driveCurrentMetaLabel(trip: DriveCurrentTrip): string {
  if (trip.kind === 'road') return trip.road ? `公路 ${trip.road}` : '公路全程';
  if (trip.kind === 'route') return '路书路线';
  if (trip.from && trip.to) return `${trip.from} → ${trip.to}`;
  return '起终点行程';
}
