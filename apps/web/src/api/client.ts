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
  /** 数据来源：rail=铁路景点库，road=公路景点库 */
  origin?: 'rail' | 'road';
  /** 采集/库内省份（铁路侧展示用；公路侧只作采集来源，展示用 display*） */
  province?: string;
  /** 公路景点按经纬度重算的展示省（铁路侧不使用） */
  displayProvince?: string;
  /** 公路景点按经纬度重算的展示市（铁路侧不使用） */
  displayCity?: string;
  /** 观赏评分（0–100）：公路侧有，铁路侧数据源无此字段 */
  score?: number;
  /** 质量分级 A/B/C */
  tier?: string;
  source?: string;
  ele?: number;
  hasWiki?: boolean;
};

/** 公路线路（编号公路，仅含已挂几何的） */
export type AtlasRoadCorridorLite = {
  key: string;
  ref: string;
  name?: string;
  class: string;
  polyline: [number, number][];
  lengthKm: number;
  spotCount: number;
  spotIds: string[];
};

export type AtlasOverviewData = {
  corridors: AtlasCorridorLite[];
  spots: AtlasSpotLite[];
  /** 双源融合：公路线路与公路景点（公路景点已排除从铁路迁移来的条目） */
  roadCorridors: AtlasRoadCorridorLite[];
  roadSpots: AtlasSpotLite[];
  meta: {
    corridorCount: number;
    spotCount: number;
    roadCorridorCount: number;
    /** 图集落图数量（已滤测绘噪音） */
    roadSpotCount: number;
    /** 公路原生库总量 */
    roadSpotLibraryCount?: number;
    roadMigratedExcluded: number;
    generatedAt: string;
    buildMs: number;
  };
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
  /** 按公开车次号（如 Z8991 / G87）查全程时刻表 */
  searchTrainByCode(code: string, date: string) {
    const qs = new URLSearchParams({ code, date });
    return request<{ stops: import('@railvista/shared').Stop[]; trainNo: string }>(
      `/trains/by-code?${qs}`,
    );
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
  /**
   * v0.6.3：公路侧明细（编号公路折线 + 公路原生景点）。
   * 与 overview 分开按需拉取 —— 并入后响应体 4.4MB，浏览器解析 + AMap 聚类
   * 1.2 万个点会长时间阻塞主线程，侧栏一直停在"正在加载"。
   */
  getAtlasRoad() {
    return request<{
      roadCorridors: AtlasRoadCorridorLite[];
      roadSpots: AtlasSpotLite[];
      meta: {
        roadCorridorCount: number;
        roadSpotCount: number;
        roadSpotLibraryCount?: number;
        roadMigratedExcluded: number;
        generatedAt: string;
      };
    }>('/atlas/road');
  },
  /** 线路详情页：单条走廊完整折线 + 沿线景点（含里程） */
  getAtlasCorridor(id: string) {
    return request<AtlasCorridorDetail>(`/atlas/corridor/${encodeURIComponent(id)}`);
  },
  // ── 万里路书 · 精品自驾公路 ─────────────────────────────────────────────
  /** 自驾线路列表 */
  getDriveRoutes() {
    return request<{
      routes: import('@railvista/shared').DriveRouteLite[];
      updated: string;
    }>('/drive/routes');
  },
  /** 自驾线路详情（含 geometry + chapters + highlights） */
  getDriveRoute(id: string) {
    return request<{
      route: import('@railvista/shared').DriveRoute;
      highlights: import('@railvista/shared').DriveHighlight[];
    }>(`/drive/routes/${encodeURIComponent(id)}`);
  },
  getDriveStats() {
    return request<{
      routeCount: number;
      totalKm: number;
      highlightCount: number;
      updated: string;
    }>('/drive/stats');
  },
  // ── 万里路书 · 全国公路旅游网（v0.4.0，PRD §5.5） ──────────────────────────
  /** 公路搜索：地名 / 编号 / 景点 / 服务区四类索引 + geocode 兜底 */
  suggestDrivePlaces(q: string, kind?: string, limit = 20) {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    if (kind) qs.set('kind', kind);
    return request<{ q: string; kind: string | null; hits: import('@railvista/shared').PlaceHit[] }>(
      `/drive/suggest?${qs}`,
    );
  },
  /** 单条公路详情（L1 几何 + 统计） */
  getDriveRoad(key: string) {
    return request<{
      entry: import('@railvista/shared').RoadIndexEntry;
      geometry: { key: string; points: [number, number][]; nodes: import('@railvista/shared').RoadGeometryNode[]; simplified: boolean } | null;
      totalKm?: number;
      spotCount?: number;
      note?: string;
      /** B2-1：端点地名与几何首/末点距离过远，nodes 不可作为里程标注 */
      endpointsUnverified?: boolean;
      lengthDeviation?: number | null;
      /** 已贯通里程（OSM 实际落库长度） */
      connectedKm?: number;
      /** 名义里程（权威名录） */
      nominalKm?: number;
      /** 已贯通 / 名义（百分比）；名义为 0 时为 null */
      coveragePct?: number | null;
    }>(`/drive/road/${encodeURIComponent(key)}`);
  },
  /** 双引擎 OD 规划 */
  planDriveRoute(params: { from: string; to: string; via?: string[]; engine?: 'auto' | 'local' }) {
    const qs = new URLSearchParams({ from: params.from, to: params.to });
    if (params.via?.length) qs.set('via', params.via.join(';'));
    if (params.engine) qs.set('engine', params.engine);
    return request<{ route: import('@railvista/shared').RoadRoute }>(`/drive/route?${qs}`);
  },
  /** 沿程：折线 + 景点 + 章节（C1 点对点 / C2 整条公路 / 路书条目） */
  getDriveAlong(params: {
    from?: string;
    to?: string;
    road?: string;
    route?: string;
    cat?: string[];
    min?: number;
    max?: number;
    engine?: 'auto' | 'local';
  }) {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.road) qs.set('road', params.road);
    if (params.route) qs.set('route', params.route);
    if (params.cat?.length) qs.set('cat', params.cat.join(','));
    if (params.min != null) qs.set('min', String(params.min));
    if (params.max != null) qs.set('max', String(params.max));
    if (params.engine) qs.set('engine', params.engine);
    return request<{
      route: import('@railvista/shared').RoadRoute;
      spots: import('@railvista/shared').AlongSpot[];
      chapters: import('@railvista/shared').RoadChapter[];
      highlights?: import('@railvista/shared').DriveHighlight[];
      legacyChapters?: unknown;
      spotLibrary?: { count: number; updated: string; note?: string };
    }>(`/drive/along?${qs}`);
  },
  /** 路网覆盖统计（含诚实说明） */
  getDriveNetworkStats() {
    return request<
      import('@railvista/shared').RoadNetworkStats & {
        topology: { loaded: boolean; nodeCount: number; edgeCount: number; roadKeyCount: number };
      }
    >('/drive/network/stats');
  },
  /** 地图公路图层（抽稀折线） */
  getDriveNetworkOverview() {
    const qs = new URLSearchParams({
      classes: 'expressway,national,provincial',
      limit: '800',
    });
    return request<{
      roads: Array<{
        key: string;
        ref: string;
        name?: string;
        class: import('@railvista/shared').RoadClass;
        polyline: [number, number][];
        lengthKm: number;
      }>;
      updated: string;
    }>(`/drive/network/overview?${qs}`);
  },
  /** 榜单列表 */
  getDriveBoards() {
    return request<{ boards: import('@railvista/shared').RankingBoardSummary[]; updated: string }>(
      '/drive/board',
    );
  },
  /** 单个榜单（含 alsoIn 交叉索引 + 几何可用性） */
  getDriveBoard(boardId: string) {
    return request<{
      board: import('@railvista/shared').RankingBoard;
      geomAvailable: boolean[];
    }>(`/drive/board/${encodeURIComponent(boardId)}`);
  },
  /** 景点到达时刻天气（和风优先，未配置 Key 时服务端回退 Open-Meteo） */
  getSpotWeathers(
    spots: Array<{
      spotId: string;
      lng: number;
      lat: number;
      atIso: string;
      visibility?: string;
    }>,
  ) {
    return request<{
      items: import('@railvista/shared').SpotWeather[];
      provider: string;
      configured: { qweather: boolean };
    }>('/weather/spots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spots }),
    });
  },
  // ── 万里路书 · 路书库（省 → 市 → 路线，玩法不限于自驾） ───────────────────
  /** 列表页一次拿齐：区划底座 + 统计 + 源文件清单 */
  getTravelOverview() {
    return request<{
      totalRoutes: number;
      totalPois: number;
      provinces: import('@railvista/shared').RoadbookProvince[];
      files: Array<{
        file: string;
        area?: string;
        updated: string;
        routeCount: number;
        routeIds: string[];
      }>;
      skipped: string[];
      latestUpdated: string;
    }>('/travel/overview');
  },
  /** 省 → 地级行政区底座（含 coverage / routeIds 回写） */
  getTravelRegions() {
    return request<{
      version: number;
      updated: string;
      provinces: import('@railvista/shared').RoadbookProvince[];
    }>('/travel/regions');
  },
  /** 筛选面板分面值（每项带路线数） */
  getTravelFacets() {
    return request<{
      provinces: Array<{ name: string; shortName: string; count: number }>;
      cities: Array<{ name: string; province: string; count: number; coverage: string }>;
      modes: Array<{ mode: string; label: string; count: number }>;
      tags: Array<{ tag: string; count: number }>;
    }>('/travel/facets');
  },
  /** 路线列表（筛选 / 排序 / 分页） */
  getTravelRoutes(params: Record<string, string | number | undefined> = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{
      total: number;
      routes: import('@railvista/shared').TravelRouteSummary[];
      counts: import('@railvista/shared').TravelCounts;
    }>(`/travel/routes${suffix}`);
  },
  /** 单条路线详情（分段 / 逐日 / 景点 / 实用信息） */
  getTravelRoute(id: string) {
    return request<import('@railvista/shared').TravelRouteDetail>(
      `/travel/route/${encodeURIComponent(id)}`,
    );
  },
  /** 按公路编号反查玩法（G318 有哪些线路可以玩） */
  getTravelRoutesByRoad(ref: string) {
    return request<{
      ref: string;
      total: number;
      routes: import('@railvista/shared').TravelRouteSummary[];
      note?: string;
    }>(`/travel/by-road/${encodeURIComponent(ref)}`);
  },
  // ── 万里路书 · 飞行纪念票 ─────────────────────────────────────────────────
  /** 航班号 + 日期查询航班（在线服务可用时自动带出起降机场/时刻/登机口；否则本地兜底） */
  lookupFlight(flightNo: string, date: string) {
    const qs = new URLSearchParams({ flightNo, date });
    return request<import('@railvista/shared').FlightLookup>(`/flights/lookup?${qs}`);
  },
};
