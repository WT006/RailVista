import { DEFAULT_LAYER_VISIBILITY } from '@railvista/shared';
import { toRaw } from 'vue';
import {
  saveTripSnapshot,
  type PreciseCacheStatus,
  type TripSnapshot,
} from './tripCache';
import { usePrefsStore } from '../stores/prefsStore';
import { useTripStore } from '../stores/tripStore';

function preciseStatusOf(trip: ReturnType<typeof useTripStore>): PreciseCacheStatus {
  const st = trip.preciseJob?.status;
  if (st === 'done' || st === 'partial') return st;
  if (trip.railwaySource === 'precise') return 'done';
  return null;
}

/** 将当前行程写入本地缓存（演示行程跳过） */
export async function persistActiveTrip(opts?: {
  bumpOpenedAt?: boolean;
  setResume?: boolean;
}): Promise<TripSnapshot | null> {
  const trip = useTripStore();
  if (!trip.segment || trip.isDemo) return null;
  const prefs = usePrefsStore();
  return saveTripSnapshot({
    segment: toRaw(trip.segment),
    stopsAll: toRaw(trip.stopsAll),
    scenicSpots: toRaw(trip.scenicSpots),
    railwayCoords: toRaw(trip.railwayCoords) as [number, number][],
    railwaySource: trip.railwaySource,
    polylineHint: trip.polylineHint,
    canUpgradePrecise: trip.canUpgradePrecise,
    preciseStatus: preciseStatusOf(trip),
    prefs: {
      departureIso: prefs.departureIso,
      calibration: prefs.calibration ? { ...toRaw(prefs.calibration) } : null,
      layers: { ...prefs.layers },
    },
    bumpOpenedAt: opts?.bumpOpenedAt,
    setResume: opts?.setResume,
  });
}

export function hydrateFromSnapshot(snap: TripSnapshot) {
  const trip = useTripStore();
  const prefs = usePrefsStore();
  trip.hydrateFromSnapshot(snap);
  prefs.applyFromSnapshot(
    snap.prefs ?? {
      departureIso: null,
      calibration: null,
      layers: { ...DEFAULT_LAYER_VISIBILITY },
    },
  );
}
