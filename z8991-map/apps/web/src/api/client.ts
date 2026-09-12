import type { ApiResponse } from '@railvista/shared';

const BASE = import.meta.env.VITE_API_BASE || '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
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
  source: 'osm' | 'mixed' | 'station' | 'none';
  segmentsOk: number;
  segmentsTotal: number;
  fromPreset?: boolean;
  canUpgrade?: boolean;
  corridorId?: string;
  corridorName?: string;
  message?: string;
};

export type RailGeometryJob = {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'partial' | 'failed';
  segmentsTotal: number;
  segmentsDone: number;
  segmentsOk: number;
  coords: [number, number][];
  source: 'osm' | 'mixed' | 'station';
  message: string;
  trainCode?: string;
  stops?: Array<{ name?: string; lng?: number; lat?: number }>;
};

export const api = {
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
