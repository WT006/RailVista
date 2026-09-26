/** 车站（查询/地图共用） */
export interface StationRef {
  name: string;
  telecode: string;
  lng?: number;
  lat?: number;
  city?: string;
}

/** 车次列表项 */
export interface TrainSummary {
  trainCode: string;
  trainNo: string;
  from: StationRef;
  to: StationRef;
  departTime: string;
  arriveTime: string;
  duration: string;
  date: string;
}

/** 经停站 */
export interface Stop {
  seq: number;
  name: string;
  telecode?: string;
  arriveTime: string | null;
  departTime: string | null;
  dayOffset?: number;
  lng?: number;
  lat?: number;
  intro?: string;
  /** depart | stop | arrive — 预置包兼容 */
  type?: 'depart' | 'stop' | 'arrive';
  /** 预置包绝对时刻 ISO */
  at?: string;
  arrive?: string;
  depart?: string;
}

/** 用户截取后的行程 */
export interface UserSegment {
  trainCode: string;
  trainNo: string;
  date: string;
  fromName: string;
  toName: string;
  fromTelecode?: string;
  toTelecode?: string;
  stops: Stop[];
  baseDepartureIso: string;
  baseArrivalIso: string;
}

export type SpotSide = 'left' | 'right' | 'both' | 'unknown';

/** 车窗可见性：决定默认贴线距离阈值 */
export type SpotVisibility = 'on_track' | 'window' | 'distant';

/** v3 六维分类，见 docs/scenic-schema-v3.md §3 */
export type SpotDimension =
  | 'geo'
  | 'nature'
  | 'culture'
  | 'history'
  | 'construct'
  | 'architecture';

/** v3 最佳观赏时段 */
export interface SpotBestView {
  /** 推荐月份 1~12；空数组/缺省 = 全年 */
  months?: number[];
  timeOfDay: 'day' | 'dawn' | 'dusk' | 'night' | 'any';
  light?: 'front' | 'back' | 'any';
  note?: string;
  blocked?: Array<'night_pass' | 'tunnel' | 'sound_barrier' | 'urban'>;
}

/** v3 来源条目，见 docs/scenic-schema-v3.md §2.6/§6 */
export interface SpotSource {
  type: 'authority' | 'wiki' | 'osm' | 'news' | 'academic' | 'ugc';
  level: 'S' | 'A' | 'B' | 'C';
  /** 完整 URL / Wikidata Q 号 / OSM way|node/id */
  ref: string;
  quote?: string;
  checkedAt: string;
}

/** v3 线路归属（里程沿走廊折线首点起算） */
export interface SpotLineRef {
  corridorId: string;
  alongKmFrom: number;
  alongKmTo?: number;
  nearStations?: string[];
  distKm: number;
}

export interface ScenicSpot {
  id: string;
  name: string;
  lng: number;
  lat: number;
  intro?: string;
  timeLabel?: string;
  at?: string;
  side?: SpotSide;
  nightOnly?: boolean;
  visibility?: SpotVisibility;
  category?: string;
  /** 入库可选；空则按 visibility 默认半径 */
  maxDistKm?: number;
  /** 匹配结果：点到行程折线最短距离 */
  distKm?: number;
  /** 匹配结果：投影点距折线起点累计公里 */
  progressKm?: number;
  source: 'preset' | 'curated' | 'ai_generated' | 'ai_reviewed';
  trainCode?: string;

  // —— v3 纯扩展字段（全部可选；v2 老数据不带也能被读取）——
  /** 近景 <2km / 中景 2~15km / 远景 >15km */
  viewScale?: 'near' | 'mid' | 'far';
  /** 可持续观赏时长（分钟） */
  viewMinutes?: number;
  /** 六维主维度，1~2 个 */
  dimensions?: SpotDimension[];
  /** 受控细类型，见 docs/scenic-schema-v3.md §3 */
  subtype?: string;
  tags?: string[];
  lines?: SpotLineRef[];
  /** side 方向约定，v3 固定 line_forward */
  sideRefDirection?: 'line_forward';
  bestView?: SpotBestView;
  sources?: SpotSource[];
  verification?: {
    status: 'verified' | 'probable' | 'unverified' | 'rejected';
    checkedAt: string;
    checkedBy?: string;
    method?: string;
  };
  reviewedAt?: string;
  reviewRound?: string;
  status?: 'active' | 'deprecated';
}

export interface LayerVisibility {
  rail: boolean;
  station: boolean;
  spot: boolean;
  train: boolean;
  gps: boolean;
}

export interface CalibrationRecord {
  stationName: string;
  offsetMs: number;
  calibratedAt: string;
  anchorIso: string;
}

export interface ScheduleResolveResult {
  departure: Date;
  arrival: Date;
  offsetMs: number;
  baseDeparture: Date;
  baseArrival: Date;
}

export interface GpsSample {
  lng: number;
  lat: number;
  accuracy: number;
  timestamp: number;
}

export interface LngLat {
  lng: number;
  lat: number;
}

export interface RailwayPoint extends LngLat {
  index: number;
  distFromStart: number;
}

export interface ProgressResult {
  progress: number;
  mode: string;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

export interface PresetPackage {
  meta: {
    train: string;
    from: string;
    to: string;
    trainNo?: string;
    date?: string;
  };
  stations: Array<{
    name: string;
    type: 'depart' | 'stop' | 'arrive';
    at?: string;
    arrive?: string;
    depart?: string;
    lng: number;
    lat: number;
    intro?: string;
    telecode?: string;
  }>;
  scenicSpots: Array<{
    id: number | string;
    name: string;
    timeLabel?: string;
    at?: string;
    nightOnly?: boolean;
    lng: number;
    lat: number;
    intro?: string;
    side?: SpotSide;
  }>;
  /** 可选：真实/精细铁路线折线 [lng, lat][]（如 OSM） */
  railway?: [number, number][];
  railwaySource?: 'osm' | 'station' | 'preset';
}
