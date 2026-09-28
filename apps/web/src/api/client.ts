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
    throw Object.assign(new Error(json.error?.message || `请求失败 ${res.status}`), {
      code: json.error?.code,
      status: res.status,
    });
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
  /** B4/P0-4：未能定位坐标的经停站名（前端渲染占位提示，不再凭空消失） */
  unresolvedStops?: string[];
  scenicSpots?: import('@railvista/shared').ScenicSpot[];
};

/** /api/atlas/overview 的走廊条目（折线已抽稀 ≤300 点） */
export type AtlasCorridorLite = {
  id: string;
  name: string;
  stationsHint: string[];
  polyline: [number, number][];
  lineSpotCount: number;
  geoSpotCount: number;
  spotCount: number;
  spotIds: string[];
  lengthKm: number;
};

/** /api/atlas/overview 的景点条目 */
export type AtlasSpotLite = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  intro?: string;
  category?: string;
  dimensions?: string[];
  corridorIds: string[];
  matchKind: 'line' | 'geo' | null;
};

export type AtlasOverviewData = {
  corridors: AtlasCorridorLite[];
  spots: AtlasSpotLite[];
  meta: { corridorCount: number; spotCount: number; generatedAt: string; buildMs: number };
};

/** 线路详情页景点：带沿线里程 */
export type AtlasCorridorSpot = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  intro?: string;
  category?: string;
  dimensions: string[];
  matchKind: 'line' | 'geo' | null;
  alongKm: number;
  distKm: number;
};

export type AtlasCorridorDetail = {
  id: string;
  name: string;
  stationsHint: string[];
  note?: string;
  railway: [number, number][];
  lengthKm: number;
  spotIds: string[];
  lineSpotCount: number;
  geoSpotCount: number;
  spots: AtlasCorridorSpot[];
};

export const api = {
  async getHealth(): Promise<{
    status: 'up' | 'down';
    version?: { commit: string; corridorCount: number; buildTime: string };
    features?: { autoUpgrade: boolean };
  }> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${BASE}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      const json = (await res.json()) as ApiResponse<{
        status: string;
        version?: { commit: string; corridorCount: number; buildTime: string };
        features?: { autoUpgrade?: boolean };
      }>;
      if (json.ok && json.data?.status === 'up') {
        return {
          status: 'up',
          version: json.data.version,
          features: { autoUpgrade: json.data.features?.autoUpgrade === true },
        };
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
  abandonRailGeometryJob(jobId: string) {
    return request<{ jobId: string; abandoned: boolean }>(
      `/rail-geometry/jobs/${encodeURIComponent(jobId)}/abandon`,
      { method: 'POST' },
    );
  },
  /** 全国铁路景点地图：全部走廊（抽稀折线）+ 全量景点，只读聚合，60s 服务端缓存 */
  getAtlasOverview() {
    return request<AtlasOverviewData>('/atlas/overview');
  },
  /** 线路详情页：单条走廊完整折线 + 沿线景点（含里程） */
  getAtlasCorridor(id: string) {
    return request<AtlasCorridorDetail>(`/atlas/corridor/${encodeURIComponent(id)}`);
  },
};
