import { onMounted, onUnmounted, ref } from 'vue';
import type { GpsSample } from '@railvista/shared';

const BUFFER_SIZE = 30;
const OUTLIER_SPEED_MS = 139;

function haversineKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function useGeolocation() {
  const gps = ref<GpsSample | null>(null);
  const available = ref(false);
  const lastObservedAt = ref(0);
  let watchId: number | null = null;
  let buffer: GpsSample[] = [];

  function pushSample(sample: GpsSample): void {
    if (buffer.length > 0) {
      const last = buffer[buffer.length - 1];
      const jump = haversineKm(last, sample);
      const dt = (sample.timestamp - last.timestamp) / 1000;
      if (dt > 0 && (jump * 1000) / dt > OUTLIER_SPEED_MS) return;
    }
    buffer.push(sample);
    if (buffer.length > BUFFER_SIZE) buffer.shift();
  }

  function smoothSample(): GpsSample | null {
    if (buffer.length === 0) return null;
    const weights = buffer.map((_, i) => i + 1);
    const totalW = weights.reduce((s, w) => s + w, 0);
    const lng = buffer.reduce((s, p, i) => s + p.lng * weights[i], 0) / totalW;
    const lat = buffer.reduce((s, p, i) => s + p.lat * weights[i], 0) / totalW;
    const accuracy = Math.min(...buffer.map((p) => p.accuracy));
    const last = buffer[buffer.length - 1];
    return {
      lng,
      lat,
      accuracy,
      timestamp: last.timestamp,
      speed: last.speed,
      heading: last.heading,
    };
  }

  onMounted(() => {
    if (!navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        available.value = true;
        const sample: GpsSample = {
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
          speed: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed : undefined,
          heading: pos.coords.heading != null && !Number.isNaN(pos.coords.heading) ? pos.coords.heading : undefined,
        };
        lastObservedAt.value = pos.timestamp;
        pushSample(sample);
        gps.value = smoothSample();
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

  return { gps, available, lastObservedAt };
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
