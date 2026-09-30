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

  // —— ETA 预估字段（由 spotEta 模块填充，全部可选）——
  /** 图定预计时刻 ISO */
  etaPlanIso?: string;
  /** 实时修正后预计时刻 ISO */
  etaIso?: string;
  /** 1σ 置信半宽（分钟） */
  sigmaMin?: number;
  /** 置信度分档 */
  confidence?: 'high' | 'mid' | 'low';
  /** 依据来源 */
  basis?: 'schedule' | 'gps' | 'calibrated' | 'mixed';
  /** 是否已通过 */
  passed?: boolean;
  /** 是否夜间经过（实时计算） */
  night?: boolean;
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

// ═══════════════════════════════════════════════════════════════════════════
// 万里路书 · 精品自驾公路（v0.3.0 新增）
// 说明：本区块为纯新增类型，与铁路侧类型无耦合；几何数据 [lng, lat, elev?] 第三位
//       可选高程，向后兼容（现有代码读取前两位不受影响）。
// ═══════════════════════════════════════════════════════════════════════════

/** 公路行政等级：G 国道 / S 省道 / X 县道 / Y 乡道 / C 村道 / E 高速 */
export type RoadClass = 'G' | 'S' | 'X' | 'Y' | 'C' | 'E';

/** 公路点：经纬度 + 可选高程（m） */
export type RoadPoint = [number, number, number?];

/** 自驾线路分组：三环 / 四横 / 五纵 */
export type DriveGroup = 'ring' | 'horizontal' | 'vertical';
/** 线路层级：国家级主干线 / 省级精品线 */
export type DriveTier = 'national' | 'provincial';

/** 骨架点：用于路网成链与章节划分 */
export interface DriveWaypoint {
  name: string;
  lng: number;
  lat: number;
  /** 优先走的公路编号 */
  preferRef?: string;
  /** 是否章节分界点 */
  chapterBreak?: boolean;
  required?: boolean;
}

/** 路书章节 */
export interface RoadbookChapter {
  id: string;
  index: number;
  title: string;
  /** 沿主线的里程区间（km） */
  fromKm: number;
  toKm: number;
  summary: string;
  roadRefs: string[];
  towns: string[];
  elevRange?: [number, number];
  highlightIds: string[];
  spotIds: string[];
  tips: string[];
  staySuggest?: string[];
}

/** 小确幸分类 */
export type HighlightCategory =
  | 'viewpoint' | 'landform' | 'roadside' | 'engineering' | 'water'
  | 'pasture' | 'village' | 'ruin' | 'plant' | 'night' | 'food' | 'curve';

/** 车速带：<40 slow ｜ 40~80 cruise ｜ >80 fast */
export type SpeedBand = 'slow' | 'cruise' | 'fast';

/** 小确幸点位（产品灵魂） */
export interface DriveHighlight {
  id: string;
  routeId: string;
  name: string;
  lng: number;
  lat: number;
  /** 沿主线的里程桩（km） */
  alongKm: number;
  roadRef?: string;
  stakeMark?: string;
  side: SpotSide;
  category: HighlightCategory;
  /** 车速 >80 时是否值得推送（值得减速） */
  worthSlowDown: boolean;
  /** 是否可以停车 */
  canPark: boolean;
  stopMinutes?: number;
  walkMinutes?: number;
  /** 提前多少公里提示，默认 5 */
  advanceKm?: number;
  /** 到达前多少米强提醒，默认 500 */
  notifyM?: number;
  direction?: 'forward' | 'backward' | 'both';
  /** 一句话小确幸 */
  intro: string;
  /** 怎么玩 */
  howToPlay: string;
  photoHint?: string;
  safetyNote?: string;
  bestView?: SpotBestView;
  dimensions?: SpotDimension[];
  spotId?: string;
  verification?: {
    status: 'verified' | 'probable' | 'unverified' | 'rejected';
    checkedAt: string;
    checkedBy?: string;
    method?: string;
  };
  source?: 'preset' | 'curated' | 'ai_generated' | 'ai_reviewed' | 'ugc';
}

/** 公路故事（进入区间自动播放，TTS 兜底） */
export interface RoadStory {
  id: string;
  routeId: string;
  title: string;
  fromKm: number;
  toKm: number;
  script: string;
  ttsText: string;
  audioUrl?: string;
  durationSec?: number;
  highlightIds?: string[];
  priority?: number;
}

/** 安全/景观提醒 */
export type RoadAlertKind =
  | 'scenic' | 'curve' | 'steep' | 'altitude' | 'rockfall'
  | 'ice' | 'wind' | 'fog' | 'construction' | 'speedlimit' | 'nocell';

export interface RoadAlert {
  id: string;
  routeId: string;
  kind: RoadAlertKind;
  fromKm: number;
  toKm: number;
  suggestSpeedKmh?: number;
  advanceKm?: number;
  text: string;
  severity: 'info' | 'warn' | 'danger';
  months?: number[];
}

/** 自驾线路 */
export interface DriveRoute {
  id: string;
  name: string;
  alias?: string[];
  tier: DriveTier;
  group?: DriveGroup;
  /** 政策编号，国家级线必填 */
  policyRef?: string;
  provinces: string[];
  summary: string;
  tags: string[];
  /** 主线里程（km），由构建脚本回写 */
  totalKm: number;
  driveDays: number;
  bestSeason: number[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  roadRefs: string[];
  startName: string;
  endName: string;
  waypoints: DriveWaypoint[];
  /** 成链后的完整折线 */
  geometry: RoadPoint[];
  /** 逐点累计里程（km），与 geometry 等长 */
  cumKm?: number[];
  chapters: RoadbookChapter[];
  highlightIds: string[];
  spotIds: string[];
  alerts: RoadAlert[];
  cover?: string;
  status: 'draft' | 'geometry_ready' | 'calibrated';
  updatedAt: string;
}

/** 轨迹关键点类型 */
export type TrackPointType = 'start' | 'end' | 'pass' | 'stay' | 'checkin' | 'chapter';

export interface TrackKeyPoint {
  type: TrackPointType;
  at: string;
  lng: number;
  lat: number;
  alongKm?: number;
  heading?: number;
  speedKmh?: number;
  elevM?: number;
  label?: string;
  highlightId?: string;
  chapterId?: string;
  dwellMin?: number;
}

/** 一条自驾轨迹：只存关键点，不存每秒坐标 */
export interface DriveTrack {
  id: string;
  routeId?: string;
  title?: string;
  startedAt: string;
  endedAt?: string;
  totalKm: number;
  driveMin?: number;
  points: TrackKeyPoint[];
  checkinCount: number;
  status: 'recording' | 'finished';
}

/** 雷达命中条目 */
export interface RadarHit {
  highlight: DriveHighlight;
  /** 前方还有多远（km） */
  aheadKm: number;
  /** 按当前车速预计到达秒数 */
  etaSec: number | null;
  /** 卡片文案 */
  cardText: string;
  /** 是否进入强提醒半径 */
  notify: boolean;
  sideText: string;
}

/** 自驾线路列表项（_index.json 条目，前端列表只读它） */
export interface DriveRouteLite {
  id: string;
  name: string;
  tier: DriveTier;
  group?: DriveGroup;
  provinces: string[];
  summary?: string;
  totalKm: number;
  driveDays: number;
  difficulty: number;
  bestSeason: number[];
  tags: string[];
  status: string;
  highlightCount: number;
  chapterCount: number;
  file: string;
}

/** 雷达结果 */
export interface RadarResult {
  primary: RadarHit | null;
  secondary: RadarHit | null;
  missed: RadarHit | null;
  alongKm: number;
  direction: 'forward' | 'backward' | 'unknown';
  band: SpeedBand;
  offRouteM: number;
}
