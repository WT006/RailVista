import type { ApiResponse } from '@railvista/shared';
import { getClientId } from '../lib/clientId';

const BASE = import.meta.env.VITE_API_BASE || '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'X-Client-Id': getClientId(),
      ...(init?.headers || {}),
    },
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.ok) {
    throw new Error(json.error?.message || `请求失败 ${res.status}`);
  }
  return json.data;
}

export type RailGeometryData = {
  coords: [number, number][];
  stops?: Array<{ name: string; lng?: number; lat?: number }>;
  source: 'osm' | 'mixed' | 'station' | 'local' | 'none';
  segmentsOk: number;
  segmentsTotal: number;
  fromPreset?: boolean;
  canUpgrade?: boolean;
  corridorId?: string;
  corridorName?: string;
  message?: string;
  scenicSpots?: import('@railvista/shared').ScenicSpot[];
};

export type RailQualityTier =
  | 'corridor'
  | 'network'
  | 'local'
  | 'osm'
  | 'soft'
  | 'mixed'
  | 'station';

export type RailGeometryJob = {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'partial' | 'failed';
  segmentsTotal: number;
  segmentsDone: number;
  segmentsOk: number;
  coords: [number, number][];
  source: 'osm' | 'mixed' | 'station' | 'local';
  message: string;
  qualityTier?: RailQualityTier;
  trainCode?: string;
  stops?: Array<{ name?: string; lng?: number; lat?: number }>;
  scenicSpots?: import('@railvista/shared').ScenicSpot[];
};

export const api = {
  async getHealth(): Promise<{
    status: 'up' | 'down';
    version?: { commit: string; corridorCount: number; buildTime: string };
  }> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${BASE}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      const json = (await res.json()) as ApiResponse<{
        status: string;
        version?: { commit: string; corridorCount: number; buildTime: string };
      }>;
      if (json.ok && json.data?.status === 'up') {
        return { status: 'up', version: json.data.version };
      }
      return { status: 'down' };
    } catch {
      return { status: 'down' };
    }
  },
  suggestStations(q: string) {
    return request<{ stations: { name: string; telecode: string }[] }>(
      `/stations/suggest?q=${encodeURIComponent(q)}`,
    );
  },
  searchTrains(from: string, to: string, date: string) {
    const qs = new URLSearchParams({ from, to, date });
    return request<{ trains: import('@railvista/shared').TrainSummary[] }>(`/trains?${qs}`);
  },
  getStops(params: {
    trainNo: string;
    trainCode: string;
    from: string;
    to: string;
    date: string;
  }) {
    const qs = new URLSearchParams(params);
    return request<{ stops: import('@railvista/shared').Stop[] }>(`/trains/stops?${qs}`);
  },
  getPreset(id: string) {
    return request<import('@railvista/shared').PresetPackage>(`/presets/${encodeURIComponent(id)}`);
  },
  getRailGeometry(body: {
    trainCode?: string;
    stops: Array<{ lng?: number; lat?: number; name?: string }>;
    /** preset：仅精品预置；full：含 OSM（默认） */
    mode?: 'preset' | 'full';
  }) {
    return request<RailGeometryData>('/rail-geometry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  createRailGeometryJob(body: {
    trainCode?: string;
    stops: Array<{ lng?: number; lat?: number; name?: string }>;
    retryFailedOnly?: boolean;
  }) {
    return request<RailGeometryJob>('/rail-geometry/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  getRailGeometryJob(jobId: string) {
    return request<RailGeometryJob>(`/rail-geometry/jobs/${encodeURIComponent(jobId)}`);
  },
};
