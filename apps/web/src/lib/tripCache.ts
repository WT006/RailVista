import {
  resolveSchedule,
  type CalibrationRecord,
  type LayerVisibility,
  type ScenicSpot,
  type Stop,
  type UserSegment,
} from '@railvista/shared';
import { toRaw } from 'vue';

export const TRIP_CACHE_VERSION = 2;
export const MAX_RECENT_TRIPS = 10;
export const EXPIRE_DAYS_AFTER_ARRIVAL = 2;
const EXPIRE_MS = EXPIRE_DAYS_AFTER_ARRIVAL * 24 * 60 * 60 * 1000;

const DB_NAME = 'railvista-trip-cache';
const DB_VERSION = 1;
const STORE = 'snapshots';

const INDEX_KEY = 'railvista:recentTrips';
const RESUME_KEY = 'railvista:autoResumeTripKey';

/** partial：完成但有缺口，或加载中途已落盘的精确折线；timeout：客户端硬超时，未固化结果 */
export type PreciseCacheStatus = 'done' | 'partial' | 'timeout' | null;

export type TripSnapshotPrefs = {
  departureIso: string | null;
  calibration: CalibrationRecord | null;
  layers: LayerVisibility;
};

export type TripSnapshot = {
  key: string;
  version: number;
  openedAt: number;
  isDemo: false;
  segment: UserSegment;
  stopsAll: Stop[];
  scenicSpots: ScenicSpot[];
  railwayCoords: [number, number][];
  railwaySource: 'precise' | 'station';
  polylineHint: string;
  canUpgradePrecise: boolean;
  preciseStatus: PreciseCacheStatus;
  /** 进行中的精确任务 id；刷新后可尝试续轮询（服务端内存任务仍在时） */
  preciseJobId?: string | null;
  prefs: TripSnapshotPrefs;
};

export type TripIndexEntry = {
  key: string;
  trainCode: string;
  trainNo: string;
  date: string;
  fromName: string;
  toName: string;
  baseArrivalIso: string;
  /** 含发车偏移后的到站时刻，用于过期与「进行中」 */
  effectiveArrivalIso: string;
  openedAt: number;
  hasPrecise: boolean;
  preciseStatus: PreciseCacheStatus;
};

/** Pinia/Vue Proxy 不能直接 structuredClone，先 toRaw 再 JSON 深拷贝 */
function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value as object))) as T;
}

export function tripCacheKey(
  seg: Pick<UserSegment, 'trainCode' | 'date' | 'fromName' | 'toName'>,
): string {
  return `${seg.trainCode}|${seg.date}|${seg.fromName}|${seg.toName}`;
}

function effectiveArrivalIso(segment: UserSegment, departureIso: string | null): string {
  const sch = resolveSchedule(segment.baseDepartureIso, segment.baseArrivalIso, departureIso);
  return sch.arrival.toISOString();
}

function readIndexRaw(): TripIndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TripIndexEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndexRaw(entries: TripIndexEntry[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota */
  }
}

export function getAutoResumeTripKey(): string | null {
  try {
    return localStorage.getItem(RESUME_KEY);
  } catch {
    return null;
  }
}

export function setAutoResumeTripKey(key: string | null) {
  try {
    if (key) localStorage.setItem(RESUME_KEY, key);
    else localStorage.removeItem(RESUME_KEY);
  } catch {
    /* private mode */
  }
}

export function clearAutoResume() {
  setAutoResumeTripKey(null);
}

const STAY_ON_SELECT_KEY = 'railvista:stayOnSelect';

export function markStayOnSelect() {
  try {
    sessionStorage.setItem(STAY_ON_SELECT_KEY, '1');
  } catch {
    /* */
  }
}

export function consumeStayOnSelect(): boolean {
  try {
    const v = sessionStorage.getItem(STAY_ON_SELECT_KEY);
    if (v) {
      sessionStorage.removeItem(STAY_ON_SELECT_KEY);
      return true;
    }
  } catch {
    /* */
  }
  return false;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  try {
    await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
  } finally {
    db.close();
  }
}

export async function getSnapshot(key: string): Promise<TripSnapshot | null> {
  try {
    const db = await openDb();
    try {
      const snap = await idbRequest<TripSnapshot | undefined>(
        db.transaction(STORE, 'readonly').objectStore(STORE).get(key),
      );
      if (!snap || snap.version !== TRIP_CACHE_VERSION) return null;
      return snap;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function deleteSnapshot(key: string): Promise<void> {
  try {
    await idbDelete(key);
  } catch {
    /* ignore */
  }
  writeIndexRaw(readIndexRaw().filter((e) => e.key !== key));
  if (getAutoResumeTripKey() === key) clearAutoResume();
}

function toIndexEntry(snap: TripSnapshot): TripIndexEntry {
  return {
    key: snap.key,
    trainCode: snap.segment.trainCode,
    trainNo: snap.segment.trainNo,
    date: snap.segment.date,
    fromName: snap.segment.fromName,
    toName: snap.segment.toName,
    baseArrivalIso: snap.segment.baseArrivalIso,
    effectiveArrivalIso: effectiveArrivalIso(snap.segment, snap.prefs.departureIso),
    openedAt: snap.openedAt,
    hasPrecise: snap.railwaySource === 'precise' || snap.preciseStatus != null,
    preciseStatus: snap.preciseStatus,
  };
}

/** 丢掉过期项并截断到上限 */
export async function pruneRecentTrips(nowMs = Date.now()): Promise<TripIndexEntry[]> {
  const keep: TripIndexEntry[] = [];
  const drop: string[] = [];

  for (const e of readIndexRaw()) {
    const arrival = new Date(e.effectiveArrivalIso).getTime();
    if (!Number.isFinite(arrival) || nowMs > arrival + EXPIRE_MS) drop.push(e.key);
    else keep.push(e);
  }

  keep.sort((a, b) => b.openedAt - a.openedAt);
  while (keep.length > MAX_RECENT_TRIPS) {
    const removed = keep.pop();
    if (removed) drop.push(removed.key);
  }

  for (const key of drop) {
    try {
      await idbDelete(key);
    } catch {
      /* */
    }
  }

  writeIndexRaw(keep);
  const resume = getAutoResumeTripKey();
  if (resume && !keep.some((e) => e.key === resume)) clearAutoResume();
  return keep;
}

export function listRecentTrips(): TripIndexEntry[] {
  return readIndexRaw().slice().sort((a, b) => b.openedAt - a.openedAt);
}

export function isTripInProgress(
  entry: Pick<TripIndexEntry, 'effectiveArrivalIso'>,
  nowMs = Date.now(),
): boolean {
  const arrival = new Date(entry.effectiveArrivalIso).getTime();
  return Number.isFinite(arrival) && nowMs < arrival;
}

export type SaveTripInput = {
  segment: UserSegment;
  stopsAll: Stop[];
  scenicSpots: ScenicSpot[];
  railwayCoords: [number, number][];
  railwaySource: 'precise' | 'station';
  polylineHint: string;
  canUpgradePrecise: boolean;
  preciseStatus: PreciseCacheStatus;
  preciseJobId?: string | null;
  prefs: TripSnapshotPrefs;
  /** 是否刷新 openedAt 并置顶，默认 true */
  bumpOpenedAt?: boolean;
  /** 是否设为自动恢复目标；默认 false，仅用户显式「设为当前行程」时为 true */
  setResume?: boolean;
};

export async function saveTripSnapshot(input: SaveTripInput): Promise<TripSnapshot | null> {
  try {
    const key = tripCacheKey(input.segment);
    const prev = await getSnapshot(key);
    const openedAt =
      input.bumpOpenedAt === false && prev ? prev.openedAt : Date.now();

    const snap: TripSnapshot = {
      key,
      version: TRIP_CACHE_VERSION,
      openedAt,
      isDemo: false,
      segment: cloneData(input.segment),
      stopsAll: cloneData(input.stopsAll),
      scenicSpots: cloneData(input.scenicSpots),
      railwayCoords: cloneData(input.railwayCoords),
      railwaySource: input.railwaySource,
      polylineHint: input.polylineHint,
      canUpgradePrecise: input.canUpgradePrecise,
      preciseStatus: input.preciseStatus,
      preciseJobId: input.preciseJobId ?? null,
      prefs: cloneData(input.prefs),
    };

    const db = await openDb();
    try {
      await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).put(snap));
    } finally {
      db.close();
    }

    let entries = readIndexRaw().filter((e) => e.key !== key);
    entries.unshift(toIndexEntry(snap));
    entries.sort((a, b) => b.openedAt - a.openedAt);

    const overflow = entries.slice(MAX_RECENT_TRIPS);
    entries = entries.slice(0, MAX_RECENT_TRIPS);
    writeIndexRaw(entries);

    for (const o of overflow) {
      try {
        await idbDelete(o.key);
      } catch {
        /* */
      }
      if (getAutoResumeTripKey() === o.key) clearAutoResume();
    }

    if (input.setResume === true) setAutoResumeTripKey(key);

    await pruneRecentTrips();
    return snap;
  } catch (e) {
    console.warn('[tripCache] save failed', e);
    return null;
  }
}
