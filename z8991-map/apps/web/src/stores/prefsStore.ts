import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import {
  DEFAULT_LAYER_VISIBILITY,
  prefsKey,
  type CalibrationRecord,
  type LayerVisibility,
  type UserSegment,
} from '@railvista/shared';
import type { TripSnapshotPrefs } from '../lib/tripCache';
import { useTripStore } from './tripStore';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...(fallback as object), ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

function schedulePersistPrefs() {
  void import('../lib/persistTrip').then(({ persistActiveTrip }) => {
    void persistActiveTrip({ bumpOpenedAt: false, setResume: false });
  });
}

export const usePrefsStore = defineStore('prefs', () => {
  const departureIso = ref<string | null>(null);
  const calibration = ref<CalibrationRecord | null>(null);
  const layers = ref<LayerVisibility>({ ...DEFAULT_LAYER_VISIBILITY });
  /** 从快照灌入时跳过一次写回，避免覆盖 */
  let suppressPersist = false;

  function segmentKey(): UserSegment | null {
    return useTripStore().segment;
  }

  function loadForCurrentTrip() {
    const seg = segmentKey();
    if (!seg) return;
    try {
      departureIso.value = localStorage.getItem(prefsKey(seg, 'departure'));
    } catch {
      departureIso.value = null;
    }
    calibration.value = readJson<CalibrationRecord | null>(prefsKey(seg, 'calibration'), null);
    layers.value = readJson(prefsKey(seg, 'layers'), { ...DEFAULT_LAYER_VISIBILITY });
  }

  function applyFromSnapshot(prefs: TripSnapshotPrefs) {
    suppressPersist = true;
    departureIso.value = prefs.departureIso;
    calibration.value = prefs.calibration ? { ...prefs.calibration } : null;
    layers.value = { ...DEFAULT_LAYER_VISIBILITY, ...prefs.layers };
    const seg = segmentKey();
    if (seg) {
      try {
        if (prefs.departureIso) localStorage.setItem(prefsKey(seg, 'departure'), prefs.departureIso);
        else localStorage.removeItem(prefsKey(seg, 'departure'));
        if (prefs.calibration) {
          localStorage.setItem(prefsKey(seg, 'calibration'), JSON.stringify(prefs.calibration));
        } else {
          localStorage.removeItem(prefsKey(seg, 'calibration'));
        }
        localStorage.setItem(prefsKey(seg, 'layers'), JSON.stringify(layers.value));
      } catch {
        /* */
      }
    }
    queueMicrotask(() => {
      suppressPersist = false;
    });
  }

  function setDeparture(iso: string | null) {
    const seg = segmentKey();
    departureIso.value = iso;
    if (!seg) return;
    try {
      if (iso) localStorage.setItem(prefsKey(seg, 'departure'), iso);
      else localStorage.removeItem(prefsKey(seg, 'departure'));
      localStorage.removeItem(prefsKey(seg, 'calibration'));
      calibration.value = null;
    } catch {
      /* private mode */
    }
    if (!suppressPersist && !useTripStore().isDemo) schedulePersistPrefs();
  }

  function setCalibration(record: CalibrationRecord | null) {
    const seg = segmentKey();
    calibration.value = record;
    if (!seg) return;
    try {
      if (record) localStorage.setItem(prefsKey(seg, 'calibration'), JSON.stringify(record));
      else localStorage.removeItem(prefsKey(seg, 'calibration'));
    } catch {
      /* */
    }
    if (!suppressPersist && !useTripStore().isDemo) schedulePersistPrefs();
  }

  function setLayer(layer: keyof LayerVisibility, show: boolean) {
    const seg = segmentKey();
    layers.value = { ...layers.value, [layer]: show };
    if (!seg) return;
    try {
      localStorage.setItem(prefsKey(seg, 'layers'), JSON.stringify(layers.value));
    } catch {
      /* */
    }
    if (!suppressPersist && !useTripStore().isDemo) schedulePersistPrefs();
  }

  watch(
    () => useTripStore().segment,
    () => {
      if (suppressPersist) return;
      loadForCurrentTrip();
    },
    { deep: true },
  );

  return {
    departureIso,
    calibration,
    layers,
    loadForCurrentTrip,
    applyFromSnapshot,
    setDeparture,
    setCalibration,
    setLayer,
  };
});
