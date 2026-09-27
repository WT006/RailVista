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
  /** 站停时长（分钟），来自 12306 stopover_time，用于曲线构建校验与技术停车识别 */
  stopoverMin?: number;
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

/**
 * side 的参考方向基准，见 docs/scenic-supplement-20260928.md §3.2。
 * - line_forward：以 `lines[].corridorId` 走廊折线的首点→末点为正方向；
 * - up_direction：以上行方向为正方向；
 * - toward_xxx：以驶向某个终点站的方向为正方向。
 */
export type SpotRefDirection = 'line_forward' | 'up_direction' | `toward_${string}`;

/** 运行时定侧置信度，见 §4.5 */
export type SpotSideConfidence = 'high' | 'low';

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
  /** side 的方向基准，见 docs/scenic-supplement-20260928.md §3.2 */
  sideRefDirection?: 'line_forward' | 'up_direction' | `toward_${string}`;
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
  /** 资质荣誉标签代码，取值见 shared/schedule/spotSide.ts HONOR_LABELS（§2.2） */
  honors?: string[];

  // —— 运行时自动定侧结果（由 filterSpotsAlongRailway 填充，不由数据文件维护）——
  /** 自动判定的左/右侧（已按当前车次实际方向换算） */
  sideRuntime?: SpotSide;
  sideConfidence?: SpotSideConfidence;
  /** 当前行程方向相对 sideRefDirection 是否相反 */
  sideFlipped?: boolean;
  /** 投影落到端点外等情形，需人工复核（§3.5） */
  sideNeedsReview?: boolean;
  sideReason?: string;
  /** 在当前线路上的里程区间，来自 lines[] 命中项 */
  alongKmFrom?: number;
  alongKmTo?: number;
  /** 命中走廊 id */
  matchedCorridorId?: string;
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
  /** GPS 速度（m/s），来自 coords.speed，用于卡尔曼融合与状态机 */
  speed?: number;
  /** GPS 航向（度），来自 coords.heading，用于卡尔曼融合与状态机 */
  heading?: number;
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
  /** 里程坐标（m），传入里程轴时填充 */
  km?: number;
  /** 速度（m/s），卡尔曼融合输出 */
  v?: number;
  /** 1σ 置信半宽（m），卡尔曼融合输出 */
  sigma?: number;
}

/** 景点 ETA 预估结果（带置信度） */
export interface SpotEta {
  spotId: string;
  /** 里程坐标（m） */
  km: number;
  /** 图定时刻 ISO */
  etaPlanIso: string;
  /** 实时修正后时刻 ISO */
  etaIso: string;
  /** 1σ 置信半宽（分钟） */
  sigmaMin: number;
  /** 置信度分档 */
  confidence: 'high' | 'mid' | 'low';
  /** 依据来源 */
  basis: 'schedule' | 'gps' | 'calibrated' | 'mixed';
  /** 是否已通过 */
  passed: boolean;
  /** 是否夜间经过（实时计算） */
  night: boolean;
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
