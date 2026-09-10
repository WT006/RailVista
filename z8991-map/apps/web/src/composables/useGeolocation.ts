import { onMounted, onUnmounted, ref } from 'vue';
import type { GpsSample } from '@railvista/shared';

export function useGeolocation() {
  const gps = ref<GpsSample | null>(null);
  const available = ref(false);
  let watchId: number | null = null;

  onMounted(() => {
    if (!navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        available.value = true;
        gps.value = {
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
      },
      () => {
        available.value = false;
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
  });

  onUnmounted(() => {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
  });

  return { gps, available };
}

export function useNow(tickMs = 1000) {
  const now = ref(new Date());
  let timer: number | undefined;

  function readMock(): Date | null {
    const mock = new URLSearchParams(location.search).get('mockNow');
    if (!mock) return null;
    const d = new Date(mock);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  onMounted(() => {
    const tick = () => {
      now.value = readMock() || new Date();
    };
    tick();
    timer = window.setInterval(tick, tickMs);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return now;
}

export function readSimulatedProgress(): number | null {
  const raw =
    new URLSearchParams(location.search).get('progress') ??
    new URLSearchParams(location.search).get('simulate');
  if (raw == null) return null;
  const value = Number(raw);
  if (Number.isNaN(value)) return null;
  return value > 1 ? value / 100 : value;
}
