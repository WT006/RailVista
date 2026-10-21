/**
 * 全局搜索（发现入口）数据契约。
 *
 * 一个聚合接口把「车次 / 走廊（铁路线）/ 编号公路 / 景点 / 路书」五类实体放进
 * 同一份结果，前端命令面板据此分组渲染，解决「数据广度够了、发现入口为零」的卡点。
 *
 * 景点附带 corridorNames / roadbookNames，让用户搜到景点后能一眼看到它关联的
 * 铁路线与路书，直接从「点」串到「线」与「书」，而非孤立的 POI。
 */

/** 车次号命中（正则识别 G/D/C/Z/T/K/Y/S + 数字，或纯数字普速） */
export interface SearchTrainHit {
  /** 车次号，如 'G87'、'Z8991'、'1461' */
  code: string;
  /** 车型分档：用于前端前缀着色 */
  kind: 'hsr' | 'intercity' | 'conventional' | 'other';
}

/** 铁路走廊命中 */
export interface SearchCorridorHit {
  id: string;
  name: string;
  /** 别名 / 俗称，如「宝成线」 */
  alias: string[];
  /** 沿线经停站名提示 */
  stationsHint: string[];
  /** 该走廊上的景点数量 */
  spotCount: number;
}

/** 编号公路命中 */
export interface SearchRoadHit {
  /** 主键：'G318'；省道及以下 '青海:S101' */
  key: string;
  /** 编号：'G318' */
  ref: string;
  /** 中文线名：'沪聂线' */
  name?: string;
  /** 技术等级 */
  class: string;
  /** 起止地名 */
  from: string;
  to: string;
  /** 里程（km） */
  lengthKm: number;
}

/** 景点命中（铁路景点库 + 公路景点库双源） */
export interface SearchSpotHit {
  id: string;
  name: string;
  lng: number;
  lat: number;
  category?: string;
  dimensions: string[];
  tags: string[];
  /** 展示省 */
  province?: string;
  /** 展示市（公路景点按经纬度重算） */
  city?: string;
  /** 数据来源：rail=铁路景点库，road=公路景点库 */
  origin: 'rail' | 'road';
  /** 关联铁路线（rail 景点：lines[].corridorId 映射） */
  corridorIds: string[];
  /** 关联铁路线名 */
  corridorNames: string[];
  /** 关联路书（路书 pois 中出现同名景点） */
  roadbookIds: string[];
  /** 关联路书名 */
  roadbookNames: string[];
  /** 一句话简介 */
  intro?: string;
}

/** 路书命中 */
export interface SearchRoadbookHit {
  id: string;
  name: string;
  subtitle?: string;
  tags: string[];
  cities: string[];
  provinces: string[];
  /** 途经公路编号，如 ['G318'] */
  roadRefs: string[];
  tier: string;
  days: number;
  totalKm: number;
}

export interface GlobalSearchResult {
  /** 回显的查询词 */
  q: string;
  /** 耗时（ms） */
  tookMs: number;
  /** 各类命中总数（去重口径 = 各组 length 之和） */
  total: number;
  trains: SearchTrainHit[];
  corridors: SearchCorridorHit[];
  roads: SearchRoadHit[];
  spots: SearchSpotHit[];
  roadbooks: SearchRoadbookHit[];
}

/** 车次号识别：前缀字母（可选）+ 1~4 位数字 */
const TRAIN_CODE_RE = /^([GDCZTKYS]?)(\d{1,5})$/i;

/** 按车次前缀判断车种分档 */
export function trainCodeKind(code: string): SearchTrainHit['kind'] {
  const prefix = code.charAt(0).toUpperCase();
  if (prefix === 'G' || prefix === 'D') return 'hsr';
  if (prefix === 'C') return 'intercity';
  if (prefix === 'Z' || prefix === 'T' || prefix === 'K' || prefix === 'L') return 'conventional';
  if (prefix === 'Y' || prefix === 'S') return 'other';
  return 'conventional'; // 纯数字普速
}

/** 输入是否像车次号（用于决定是否触发车次命中） */
export function isTrainCodeLike(input: string): boolean {
  const t = input.trim();
  if (!t) return false;
  return TRAIN_CODE_RE.test(t);
}