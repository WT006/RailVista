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

/**
 * 公路行政等级（v2 语义，PRD-万里路书-全国公路旅游网 §9）：
 * expressway 国家高速 / national 普通国道 / provincial 省道 / county 县道 / township 乡道 / village 村道。
 * v1 的字母编号前缀语义保留为 RoadRefPrefix（编号主键规范见 §3.2）。
 */
export type RoadClass = 'expressway' | 'national' | 'provincial' | 'county' | 'township' | 'village';

/** 编号前缀字母：G 国道（含 G+4 位国家高速）/ S 省道 / X 县道 / Y 乡道 / C 村道 */
export type RoadRefPrefix = 'G' | 'S' | 'X' | 'Y' | 'C';

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

// ═══════════════════════════════════════════════════════════════════════════
// 万里路书 · 全国公路旅游网（v0.4.0 新增，PRD-万里路书-全国公路旅游网-20261001）
// 说明：本区块为 v2 主功能类型（L0 索引 / L1 几何 / 沿程匹配 / 搜索 / 榜单）。
//       保留上方 v1 的 Drive* 路书类型不删（路书页继续使用）；新类型统一用 Road
//       前缀命名，避免与 v1 的 Drive* 混淆。
// ═══════════════════════════════════════════════════════════════════════════

/** L0 索引条目（data/roads/index/*.json，供搜索 / 列表 / 地图 LOD / 编号键盘候选） */
export interface RoadIndexEntry {
  /** 主键：国道/高速全国唯一 "G318"；省道及以下省内唯一 "青海:S101" */
  key: string;
  /** 编号：'G318'（高速为 G+4 位，如 'G5611'） */
  ref: string;
  /** 中文线名：'沪聂线' */
  name?: string;
  class: RoadClass;
  provinces: string[];
  fromPlace: string;
  toPlace: string;
  /** 里程（km，估算值，OSM 众包还原） */
  lengthKm: number;
  /** bbox [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  spotCount: number;
  /** 是否已有 L1 几何（data/roads/geom/{key}.json） */
  hasGeom: boolean;
  source: 'authoritative' | 'osm_only';
  status: 'ok' | 'partial' | 'broken' | 'unverified';
}

/** L1 几何节点（城市 / 交叉 / 服务 / 垭口 / 端点） */
export interface RoadGeometryNode {
  name: string;
  atKm: number;
  type: 'city' | 'junction' | 'service' | 'pass' | 'endpoint';
}

/** 段间断点状态：normal 正常小断点 / suspect 可疑大断点(>200km) / no_connect 无连通way / urban_skip 城市区域跳过 */
export type GapStatus = 'normal' | 'suspect' | 'no_connect' | 'urban_skip';

/** 段间断点标注（主链与 segments 之间、segments 之间的未贯通处） */
export interface GapAnnotation {
  /** 断点在全线中的里程位置（km） */
  atKm: number;
  /** 未贯通 Haversine 距离（km），>200 时 status='suspect' */
  gapKm: number;
  /** 断点起始段索引：0=主链，1+=segments 索引 */
  fromSeg: number;
  /** 断点终止段索引 */
  toSeg: number;
  status: GapStatus;
}

/** L1 几何（data/roads/geom/{key}.json，按 key 懒加载） */
export interface RoadGeometry {
  key: string;
  points: RoadPoint[];
  /** 逐点累计里程（km），与 points 等长 */
  cumKm: number[];
  nodes: RoadGeometryNode[];
  simplified: boolean;
  /** 多段几何数组（orphan 链按里程降序，每段 ≥2 点）；缺失或空数组表示单段几何，向后兼容旧文件 */
  segments?: RoadPoint[][];
  /** 段间断点标注数组（主链末点↔segments 首点、segments 间） */
  gapAnnotations?: GapAnnotation[];
}

/** 公路侧景点沿程可见性（与铁路 SpotVisibility 的语义差异见 PRD §5.3） */
export type RoadVisibility = 'roadside' | 'detour5' | 'detour20' | 'distant';

/** 公路侧景点（data/roads/roadside-spots.json，目标 3 万条） */
export interface RoadsideSpot {
  id: string;
  name: string;
  lng: number;
  lat: number;
  tier: 'A' | 'B' | 'C';
  /** 六维分类：'nature.mountain' / 'engineering.spiral-road' / 'service.charging' ... */
  category: string;
  score: number;
  /** 沿程可见性（决定缓冲半径），默认 detour20 */
  visibility?: RoadVisibility;
  intro?: string;
  tags?: string[];
  province?: string;
  /** 官方资质：['5A','世界遗产','中国传统村落'] */
  honors?: string[];
  bestView?: SpotBestView;
  stayMin?: number;
  /** 是否可停车（Tier C 小确幸关键属性） */
  canPark?: boolean;
  source: string;
  verified?: boolean;
}

/** 合成路线章节（沿程分段标题） */
export interface RoadChapter {
  title: string;
  fromKm: number;
  toKm: number;
}

/** 合成路线（OD 规划结果 / 榜单条目指向的路线） */
export interface RoadRoute {
  id: string;
  name: string;
  roadKeys: string[];
  provinces: string[];
  lengthKm: number;
  durationMin?: number;
  coords: RoadPoint[];
  chapters?: RoadChapter[];
  boardIds?: string[];
  /** 规划引擎：amap（在线）/ local / local-spliced（端点外接）/ direct（两点直连） */
  engine?: string;
  /** 引擎说明（诚实标注，UI 直接展示） */
  engineNote?: string;
  /** 多段几何（orphan 链，主链外未贯通段，前端可渲染为虚线） */
  segments?: RoadPoint[][];
  /** 段间断点标注（主链与 segments 之间未贯通处） */
  gapAnnotations?: GapAnnotation[];
}

/** 搜索命中类别（PRD §4 四类索引） */
export type PlaceKind = 'place' | 'road' | 'spot' | 'facility';

/** 搜索命中（/api/drive/suggest） */
export interface PlaceHit {
  kind: PlaceKind;
  /** place: 行政码 / road: key / spot: spot.id / facility: osm id */
  id: string;
  /** 'G318' 或 '稻城亚丁' */
  name: string;
  /** '沪聂线·上海→聂拉木' 或 '四川·甘孜' */
  sub: string;
  lng: number;
  lat: number;
  score: number;
}

/** 沿程匹配选项（filterSpotsAlongRoad） */
export interface AlongRouteOptions {
  /** 沿路缓冲半径上限（km），默认 35（distant）；各可见性分档见 ROAD_BUFFER_KM */
  bufferKm?: number;
  /** 是否做左右侧判定，默认 true */
  autoSide?: boolean;
  /** 只返回某几类（category 前缀匹配，如 ['nature', 'engineering.spiral-road']） */
  categories?: string[];
  /** 最少「值得一看」分值，过滤路人 POI；C1/C2 默认 35，C3 实时默认 45 */
  minScore?: number;
  maxCount?: number;
}

/** 沿程景点（filterSpotsAlongRoad 输出，按 progressKm 升序） */
export interface AlongSpot {
  id: string;
  name: string;
  lng: number;
  lat: number;
  /** 在路线上的投影里程（km，从起点算） */
  progressKm: number;
  /** 到路线的垂直距离（km） */
  distKm: number;
  /** 左右侧：相对路线正方向 */
  side: 'left' | 'right' | 'unknown';
  sideConfidence: 'high' | 'mid' | 'low';
  category: string;
  score: number;
  /** 偏离主路多远需要绕行（km），0 = 就在路边；= distKm×2−0.3 向下取整到 0.5 */
  detourKm: number;
  /** 建议停留（分钟） */
  stayMin?: number;
  intro?: string;
  tier: 'A' | 'B' | 'C';
  visibility?: RoadVisibility;
  honors?: string[];
  bestView?: SpotBestView;
  canPark?: boolean;
  province?: string;
}

/** 榜单条目：指向路网里的实际路线（引用 + 精选，非独立数据） */
export interface RankingItem {
  rank: number;
  /** → data/roads/routes/{routeId}.json（可选，无文件时用内联元数据） */
  routeId: string;
  /** 'G315 西宁—喀什' 或 '独库公路' */
  name: string;
  alias?: string[];
  /** 该条目由哪些公路编号串成（可多条） */
  roadKeys: string[];
  province: string[];
  lengthKm?: number;
  /** OD 兜底：无 roadKeys 几何时按起终点规划（如 长城文化：山海关→嘉峪关） */
  fromPlace?: string;
  toPlace?: string;
  highlight?: string;
  tags?: string[];
  /** 归属榜单的交叉索引：这条路同时出现在哪些榜 */
  alsoIn?: string[];
}

/** 统一榜单模型（一个 schema 装下所有榜单，加新榜单 = 加一个 JSON，零代码） */
export interface RankingBoard {
  id: string;
  title: string;
  subtitle?: string;
  source: {
    org: string;
    doc?: string;
    url?: string;
    publishedAt?: string;
  };
  level: 'national' | 'provincial' | 'media';
  cover?: string;
  itemCount: number;
  items: RankingItem[];
}

/** 榜单摘要（列表页用，不含 items） */
export interface RankingBoardSummary {
  id: string;
  title: string;
  subtitle?: string;
  level: RankingBoard['level'];
  org: string;
  publishedAt?: string;
  itemCount: number;
}

/** /api/drive/network/stats 响应 */
export interface RoadNetworkStats {
  national: number;
  expressway: number;
  provincial: number;
  county: number;
  township: number;
  village: number;
  totalKm: number;
  hasGeom: number;
  hasGeomRatio: number;
  spotCount: number;
  /** 覆盖诚实说明（PRD §3.1：不能装作什么都有） */
  coverage: {
    targetNational: number;
    targetExpressway: number;
    notes: string[];
  };
  updated: string;
}
