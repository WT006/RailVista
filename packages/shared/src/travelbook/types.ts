/**
 * 万里路书 · 路书库（按「省份 → 城市」组织的旅游路线图层）
 *
 * 与 v1 的 `Drive*` 自驾线路 / v2 的 `Road*` 公路网索引三者互不重叠：
 *   DriveRoute   —— 单条自驾线路的真实行车几何（含 geometry/cumKm/雷达）
 *   RoadIndexEntry —— 单条编号公路的技术底座（L0 索引 / L1 几何）
 *   TravelRoute  —— **面向用户的旅行攻略层**：一条「怎么玩」的组合产品
 *
 * 旅行攻略层不关心路怎么成链，只关心「玩什么 / 走哪条路 / 多少公里 / 几天」。
 * 一条 TravelRoute 可以横跨多个 DriveRoute，也可以完全不用车（徒步 / 火车 / 班车）。
 *
 * 数据落盘：data/presets/roadbooks/*.json（一个大区一个源文件，内含 routes 数组）
 *           data/presets/roadbooks/_regions.json（全国省 → 地级行政区区划底座）
 */

// ═══════════════════════════════════════════════════════════════════════════
// 枚举
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 玩法类型。**路线类型不限于自驾**：同一条地理走廊常常对应多种玩法
 * （例如青藏线可自驾、可搭火车沿 G109 并行；青海湖可自驾也可环湖骑行）。
 */
export type TravelMode =
  /** 自驾 / 租车：全程自己开车 */
  | 'selfdrive'
  /** 包车 / 拼车：当地司机带车，是高原与边疆线路的主流玩法 */
  | 'charter'
  /** 公共交通：火车 + 客运班车 + 景区直通车，无车也能走 */
  | 'public'
  /** 骑行：公路车 / 山地车 */
  | 'cycling'
  /** 徒步 / 轻装穿越 */
  | 'hiking'
  /** 混合：铁路或航班抵达后转 short-line 包车 / 班车 */
  | 'mixed';

export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
  selfdrive: '自驾',
  charter: '包车/拼车',
  public: '公共交通',
  cycling: '骑行',
  hiking: '徒步',
  mixed: '混合玩法',
};

/** 路线几何形态 */
export type TravelShape =
  /** 闭环：起点即终点 */
  | 'loop'
  /** 单程点对点：通常配合异地还车或单向交通 */
  | 'point'
  /** 往返：原路进出 */
  | 'outback'
  /** 走廊：沿一条主轴推进，可任意截取 */
  | 'corridor';

export const TRAVEL_SHAPE_LABEL: Record<TravelShape, string> = {
  loop: '环线',
  point: '单程',
  outback: '往返',
  corridor: '走廊',
};

/** 路线影响力层级 */
export type TravelTier =
  /** 国家级：跨 2 省以上，或全国性知名度 */
  | 'national'
  /** 区域级：省内跨市，或跨省短环 */
  | 'regional'
  /** 城市级：单城及周边，周末可向 */
  | 'city';

export const TRAVEL_TIER_LABEL: Record<TravelTier, string> = {
  national: '国家级',
  regional: '区域级',
  city: '城市级',
};

/** 道路等级（分段用） */
export type TravelRoadClass =
  | '国道'
  | '高速'
  | '省道'
  | '县道'
  | '乡道'
  | '景区公路'
  | '城市道路'
  | '步道';

/** 节点角色 */
export type TravelNodeRole =
  /** 出发城市 / 集散地 */
  | 'hub'
  | 'start'
  | 'end'
  /** 过夜驻点 */
  | 'stay'
  /** 途经不驻留 */
  | 'pass';

/** 景点分类（六维 + 人文补充） */
export type TravelPoiCategory =
  | 'mountain'
  | 'water'
  | 'landform'
  | 'grassland'
  | 'forest'
  | 'desert'
  | 'village'
  | 'temple'
  | 'ruin'
  | 'culture'
  | 'cityview'
  | 'roadside'
  | 'food';

export const TRAVEL_POI_CATEGORY_LABEL: Record<TravelPoiCategory, string> = {
  mountain: '雪山冰川',
  water: '湖泊河流',
  landform: '地貌奇观',
  grassland: '草原牧场',
  forest: '森林峡谷',
  desert: '沙漠戈壁',
  village: '古村古镇',
  temple: '寺庙宗教',
  ruin: '遗址古迹',
  culture: '人文民俗',
  cityview: '城市景观',
  roadside: '沿途小景',
  food: '风味美食',
};

/** 难度 1~5 */
export type TravelDifficulty = 1 | 2 | 3 | 4 | 5;

export const TRAVEL_DIFFICULTY_LABEL: Record<TravelDifficulty, string> = {
  1: '轻松',
  2: '休闲',
  3: '中等',
  4: '较难',
  5: '挑战',
};

// ═══════════════════════════════════════════════════════════════════════════
// 区划底座：省 → 地级行政区
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 城市级条目。尚未写路线的城市 `coverage = 'todo'`，
 * 区划底座先铺满全国，路线内容再逐一补 —— 这就是「扩展能力」的落点。
 */
export interface RoadbookCity {
  /** 行政区划代码（地级），空缺表示待补 */
  code?: string;
  /** 地级行政区名（地区 / 盟 / 自治州 / 市） */
  name: string;
  /** 旅游语境下的别名，便于搜索命中 */
  alias?: string[];
  /** 行政中心坐标（WGS-84 近似值），未采集时缺省 */
  lng?: number;
  lat?: number;
  /** 该城市已覆盖的下辖区县/县级市（用于更细颗粒度的补全进度） */
  districts?: string[];
  /** 关联路线 id，由装载器回写 */
  routeIds?: string[];
  /**
   * covered  —— 已有成线攻略
   * partial  —— 仅被跨市路线途经，尚未出独立城市路线
   * todo     —— 待补
   */
  coverage: 'covered' | 'partial' | 'todo';
  /** 城市名片（搜索/列表用的一句话） */
  cardNote?: string;
}

export interface RoadbookProvince {
  /** 省级行政区划代码 */
  code: string;
  /** 全称，如「内蒙古自治区」 */
  name: string;
  /** 简称（列表/筛选主键），如「内蒙古」 */
  shortName: string;
  /** 七大地理分区 */
  region: '华北' | '东北' | '华东' | '华中' | '华南' | '西南' | '西北';
  lng: number;
  lat: number;
  cities: RoadbookCity[];
}

export interface RoadbookRegionsFile {
  version: number;
  updated: string;
  note?: string;
  provinces: RoadbookProvince[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 路线内容
// ═══════════════════════════════════════════════════════════════════════════

/** 整体介绍（需求 4：最佳季节 / 建议天数 / 难度 / 适合人群） */
export interface TravelIntro {
  /** 整体介绍正文 */
  overview: string;
  /** 最佳季节文字版（与 bestSeason 月数组互补） */
  bestSeason: string;
  /** 逐月/逐段的季节说明 */
  seasonNotes?: { months: number[]; note: string }[];
  /** 建议天数 */
  days: number;
  /** 天数说明（含可压缩/可延展） */
  daysNote?: string;
  /** 难度 1~5 */
  difficulty: TravelDifficulty;
  /** 难度成因说明（海拔？路况？需徒步？） */
  difficultyNote: string;
  /** 适合人群 */
  audience: string[];
  /** 不建议人群 */
  avoid?: string[];
}

/** 沿途节点（城镇 / 县城 / 景区镇），构成路线的骨架 */
export interface TravelNode {
  name: string;
  /** 省级简称 */
  province: string;
  /** 地级行政区名 */
  city: string;
  lng: number;
  lat: number;
  role: TravelNodeRole;
  /** 海拔（m） */
  elevM?: number;
  note?: string;
}

/** 关键路段（需求 3：国道/省道编号 + 起止 + 里程） */
export interface TravelSegment {
  id: string;
  index: number;
  name: string;
  fromNode: string;
  toNode: string;
  /** 途经地名 */
  via?: string[];
  /** 途经道路编号，国道在前 */
  roadRefs: string[];
  roadClass: TravelRoadClass;
  /** 里程（km） */
  distanceKm: number;
  /** 纯驾驶时长（h） */
  driveHours?: number;
  /** 海拔区间（m） */
  altRange?: [number, number];
  /** 路况 */
  condition?: string;
  /** 该段的特殊提示（季节封闭、限速、检查站等） */
  note?: string;
  /**
   * 编号待核：该走廊确实存在但没有公开稳定的行政编号
   * （景区公路、近年改扩建路段、编号刚调整的国道接线）。
   * 置 true 后 roadRefs 可填俗称，构建校验不会把它当成缺编号报错。
   */
  refPending?: boolean;
  /** 该段覆盖的景点 id */
  poiIds: string[];
  /** 是否收费高速 */
  toll?: boolean;
}

/** 沿途核心景点（需求 2：名称 + 所在省市 + 简要特色） */
export interface TravelPoi {
  id: string;
  name: string;
  /** 省级简称 */
  province: string;
  /** 地级行政区名 */
  city: string;
  category: TravelPoiCategory;
  lng: number;
  lat: number;
  /** 一句话核心特色 */
  tagline: string;
  /** 景点介绍（正文） */
  intro: string;
  /** 必去标记 */
  mustSee?: boolean;
  /** 游览时长（h） */
  visitHours?: number;
  /** 门票/预约提示 */
  ticketNote?: string;
  /** 最佳时间 */
  bestTime?: string;
  /** 资质标签：5A / 世界遗产 / 国家公园 … */
  level?: string;
  /** 从主线绕行里程（km，往返合计） */
  detourKm?: number;
}

/** 逐日行程 */
export interface TravelDay {
  day: number;
  title: string;
  fromNode: string;
  toNode: string;
  /** 当日里程（km） */
  distanceKm: number;
  driveHours?: number;
  roadRefs: string[];
  /** 住宿城市 */
  stayCity: string;
  poiIds: string[];
  summary: string;
  tips?: string[];
}

/** 实用信息：把「非自驾怎么玩」讲清楚 */
export interface TravelPractical {
  /** 证件：边防证 / 通行证 / 预约 */
  permit?: string;
  /** 高反与海拔提示 */
  altitudeNote?: string;
  /** 无车方案：铁路 / 航班 / 班车怎么接驳 */
  carFree?: string;
  /** 加油充电 */
  fuelNote?: string;
  /** 信号与通讯 */
  signalNote?: string;
  /** 装备 */
  gearNote?: string;
  /** 预订与旺季提示 */
  bookingNote?: string;
  /** 风险提示 */
  warnings?: string[];
}

/** 里程数据来源说明（避免把估算值包装成实测值） */
export interface TravelSourceRef {
  title: string;
  publisher?: string;
  url?: string;
  /** 用于哪些字段：totalKm / 路段 / 景点 */
  usedFor?: string;
}

/** 路线全量（详情页数据源） */
export interface TravelRouteDetail {
  id: string;
  name: string;
  /** 副标题（一句亮点） */
  subtitle: string;
  alias?: string[];
  /** 省级简称数组 */
  provinces: string[];
  /** 涉及地级行政区 */
  cities: string[];
  /** 主入口城市（列表页按此归类，详情页以此为默认起点） */
  anchorCity: string;
  /** 玩法类型：一条路线支持多种玩法 */
  modes: TravelMode[];
  primaryMode: TravelMode;
  shape: TravelShape;
  tier: TravelTier;
  tags: string[];
  /** 一句话速写 */
  summary: string;
  /** 总里程（km） */
  totalKm: number;
  /** 里程口径说明 */
  mileageNote?: string;
  days: number;
  bestSeason: number[];
  difficulty: TravelDifficulty;
  /** 全线主要道路编号 */
  roadRefs: string[];
  startNode: string;
  endNode: string;
  intro: TravelIntro;
  nodes: TravelNode[];
  segments: TravelSegment[];
  pois: TravelPoi[];
  plan: TravelDay[];
  practical: TravelPractical;
  sources?: TravelSourceRef[];
  /**
   * 编辑推荐序（本库自定的人工排序，非流量统计）。
   * 数字越小越靠前，用于「先看热门再看经典」的默认排序。
   */
  editorRank: number;
  status: 'published' | 'draft';
  updatedAt: string;
}

/** 列表项（索引层，装载器从 detail 派生，避免重复维护） */
export interface TravelRouteSummary {
  id: string;
  name: string;
  subtitle: string;
  alias?: string[];
  provinces: string[];
  cities: string[];
  anchorCity: string;
  modes: TravelMode[];
  primaryMode: TravelMode;
  shape: TravelShape;
  tier: TravelTier;
  tags: string[];
  summary: string;
  totalKm: number;
  days: number;
  bestSeason: number[];
  difficulty: TravelDifficulty;
  roadRefs: string[];
  startNode: string;
  endNode: string;
  editorRank: number;
  status: 'published' | 'draft';
  updatedAt: string;
  poiCount: number;
  mustSeeCount: number;
  segmentCount: number;
  nodeCount: number;
  planCount: number;
}

/** 排序标量 */
export interface TravelCounts {
  provinces: number;
  cities: number;
  routes: number;
  pois: number;
  /** covered 城市数 / 全国城市总数 */
  citiesCovered: number;
  /** 按玩法分布 */
  byMode: Partial<Record<TravelMode, number>>;
  /** 省份简称 → 路线数 */
  byProvince: Record<string, number>;
  /** 城市名 → 路线数 */
  byCity: Record<string, number>;
}

/** 列表返回值 */
export interface TravelRouteListResult {
  total: number;
  routes: TravelRouteSummary[];
  counts: TravelCounts;
}

// ═══════════════════════════════════════════════════════════════════════════
// 纯函数：筛选 / 排序（零框架依赖，Web 与鸿蒙共用）
// ═══════════════════════════════════════════════════════════════════════════

export interface TravelQuery {
  /** 省份简称 */
  province?: string;
  /** 地级行政区名 */
  city?: string;
  /** 玩法类型 */
  mode?: TravelMode;
  /** 关键词：路线名 / 别名 / 标签 / 节点 */
  q?: string;
  /** 月份 */
  month?: number;
  /** 难度上限 */
  maxDifficulty?: number;
  /** 天数上限 */
  maxDays?: number;
  /** 里程上限 */
  maxKm?: number;
  /** 形态 */
  shape?: TravelShape;
  /** 层级 */
  tier?: TravelTier;
  sort?: 'recommend' | 'km-desc' | 'km-asc' | 'days-asc' | 'days-desc';
  limit?: number;
  offset?: number;
}

function includesText(hay: (string | undefined)[], needle: string): boolean {
  return hay.some((h) => !!h && h.includes(needle));
}

/** 单条路线是否命中查询 */
export function matchTravelRoute(r: TravelRouteSummary, q: TravelQuery): boolean {
  if (q.province && !r.provinces.includes(q.province)) return false;
  if (q.city && !r.cities.includes(q.city) && r.anchorCity !== q.city) return false;
  if (q.mode && !r.modes.includes(q.mode)) return false;
  if (q.shape && r.shape !== q.shape) return false;
  if (q.tier && r.tier !== q.tier) return false;
  if (q.month !== undefined && !r.bestSeason.includes(q.month)) return false;
  if (q.maxDifficulty !== undefined && r.difficulty > q.maxDifficulty) return false;
  if (q.maxDays !== undefined && r.days > q.maxDays) return false;
  if (q.maxKm !== undefined && r.totalKm > q.maxKm) return false;
  const kw = q.q?.trim();
  if (kw) {
    const hit =
      includesText([r.name, r.subtitle, r.summary, r.anchorCity], kw) ||
      includesText(r.alias ?? [], kw) ||
      includesText(r.provinces, kw) ||
      includesText(r.cities, kw) ||
      includesText(r.tags, kw) ||
      includesText(r.roadRefs, kw);
    if (!hit) return false;
  }
  return true;
}

/** 筛选 + 排序 + 分页 */
export function queryTravelRoutes(
  routes: TravelRouteSummary[],
  q: TravelQuery = {},
): TravelRouteSummary[] {
  let out = routes.filter((r) => r.status === 'published' || q.q);
  out = out.filter((r) => matchTravelRoute(r, q));
  switch (q.sort) {
    case 'km-desc':
      out = [...out].sort((a, b) => b.totalKm - a.totalKm);
      break;
    case 'km-asc':
      out = [...out].sort((a, b) => a.totalKm - b.totalKm);
      break;
    case 'days-asc':
      out = [...out].sort((a, b) => a.days - b.days);
      break;
    case 'days-desc':
      out = [...out].sort((a, b) => b.days - a.days);
      break;
    default:
      // 推荐序：先看热度（editorRank），同 Rank 按里程降序（大线在前）
      out = [...out].sort(
        (a, b) => a.editorRank - b.editorRank || b.totalKm - a.totalKm,
      );
  }
  const offset = Math.max(0, q.offset ?? 0);
  const limit = q.limit && q.limit > 0 ? q.limit : out.length;
  return out.slice(offset, offset + limit);
}

/** 从详情派生列表项 */
export function toTravelSummary(r: TravelRouteDetail): TravelRouteSummary {
  return {
    id: r.id,
    name: r.name,
    subtitle: r.subtitle,
    alias: r.alias,
    provinces: r.provinces,
    cities: r.cities,
    anchorCity: r.anchorCity,
    modes: r.modes,
    primaryMode: r.primaryMode,
    shape: r.shape,
    tier: r.tier,
    tags: r.tags,
    summary: r.summary,
    totalKm: r.totalKm,
    days: r.days,
    bestSeason: r.bestSeason,
    difficulty: r.difficulty,
    roadRefs: r.roadRefs,
    startNode: r.startNode,
    endNode: r.endNode,
    editorRank: r.editorRank,
    status: r.status,
    updatedAt: r.updatedAt,
    poiCount: r.pois.length,
    mustSeeCount: r.pois.filter((p) => p.mustSee).length,
    segmentCount: r.segments.length,
    nodeCount: r.nodes.length,
    planCount: r.plan.length,
  };
}

/** 统计 */
export function summarizeTravel(routes: TravelRouteSummary[]): TravelCounts {
  const byMode: Partial<Record<TravelMode, number>> = {};
  const byProvince: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  for (const r of routes) {
    for (const m of r.modes) byMode[m] = (byMode[m] ?? 0) + 1;
    for (const p of r.provinces) byProvince[p] = (byProvince[p] ?? 0) + 1;
    for (const c of new Set([...r.cities, r.anchorCity])) {
      byCity[c] = (byCity[c] ?? 0) + 1;
    }
  }
  return {
    provinces: Object.keys(byProvince).length,
    cities: Object.keys(byCity).length,
    routes: routes.length,
    pois: routes.reduce((s, r) => s + r.poiCount, 0),
    citiesCovered: Object.keys(byCity).length,
    byMode,
    byProvince,
    byCity,
  };
}

/** 把一串月份压成「6-9月」「6、9月」这样的中文串 */
export function formatMonths(months: number[]): string {
  if (!months.length || months.length === 12) return '全年';
  const sorted = [...new Set(months)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const m of sorted) {
    const last = runs[runs.length - 1];
    if (last && m === last[last.length - 1] + 1) last.push(m);
    else runs.push([m]);
  }
  return `${runs.map((r) => (r.length >= 3 ? `${r[0]}-${r[r.length - 1]}` : r.join('、'))).join('、')} 月`;
}
