import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import {
  DEFAULT_LAYER_VISIBILITY,
  prefsKey,
  type CalibrationRecord,
  type LayerVisibility,
  type UserSegment,
} from '@railvista/shared';
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

export const usePrefsStore = defineStore('prefs', () => {
  const departureIso = ref<string | null>(null);
  const calibration = ref<CalibrationRecord | null>(null);
  const layers = ref<LayerVisibility>({ ...DEFAULT_LAYER_VISIBILITY });

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
  }

  watch(
    () => useTripStore().segment,
    () => loadForCurrentTrip(),
    { deep: true },
  );

  return {
    departureIso,
    calibration,
    layers,
    loadForCurrentTrip,
    setDeparture,
    setCalibration,
    setLayer,
  };
});
