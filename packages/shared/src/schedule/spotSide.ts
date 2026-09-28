/**
 * 车窗观赏方位（左/右）自动判定引擎
 *
 * 实现依据：docs/scenic-supplement-20260928.md §3
 *
 * 关键约束（§3.4 单位陷阱）：
 *   「方向向量 d」与「偏移向量 v」必须换算到**同一个局部 ENU 公里平面**后再叉乘。
 *   若直接对经纬度（弧度）做叉乘，cross 的量纲是 rad²，再与 km 阈值比较，判据恒真，
 *   会导致所有点被误判成 both。本模块统一使用：
 *      Ky = 110.574 km/°     （纬度）
 *      Kx = 111.320 * cos(latRef) km/° （经度，latRef 取线段两端平均纬度）
 *   此时 cross 的量纲为 km²，几何自检式 |cross| / |d| = distKm 成立（因 v ⊥ d）。
 */
import type {
  LngLat,
  RailwayPoint,
  SpotLineRef,
  SpotRefDirection,
  SpotSide,
  SpotSideConfidence,
  SpotVisibility,
} from '../types.js';

/** 纬度 1° 对应公里 */
export const KM_PER_DEG_LAT = 110.574;
/** 经度 1° 在赤道对应公里（使用时会乘以 cos(lat)） */
export const KM_PER_DEG_LNG = 111.32;

/** 判定为「两侧均可」的贴线距离上限（km），见 §3.3 4)a */
export const SIDE_BOTH_DIST_KM = 0.3;
/** 延展型景观的里程跨度阈值（km），见 §3.3 4)b */
export const EXTENDED_SPAN_KM = 10;
/** 临近提醒卡的提前量（km），见 §4.3 */
export const APPROACH_LEAD_KM = 5;
/** 临近提醒卡的淡出延迟（km），见 §4.3 */
export const APPROACH_TRAIL_KM = 2;

/** 别名：类型唯一来源在 ../types.js */
export type SideConfidence = SpotSideConfidence;

/** 参考方向：side 是在哪个方向基准下算出来的，见 §3.2 */
export type SideRefDirection = SpotRefDirection;

export interface LineProjection {
  /** 投影点距折线起点累计公里 */
  alongKm: number;
  /** 垂距（km） */
  distKm: number;
  /** 0~1 归一化进度 */
  ratio: number;
  point: LngLat;
  /** d.x * v.y - d.y * v.x，单位 km²；>0 表示景点在行进方向左侧 */
  crossKm2: number;
  /** 该线段航向角（度，正北为 0，顺时针） */
  headingDeg: number;
  /** t 被 clamp 到整条折线的起/终点之外 → 点位在走廊覆盖范围外侧，需人工复核 §3.5 */
  clampedOutside: boolean;
}

export interface SpotRuntimeSide {
  side: SpotSide;
  confidence: SideConfidence;
  /** 当前车次方向是否相对数据存储基准发生了翻转 */
  flipped: boolean;
  sideRefDirection: SideRefDirection;
  alongKm: number;
  distKm: number;
  /** 需要人工复核（投影落到端点外 / 无法确定） */
  needsReview: boolean;
  reason?: string;
}

function rad(d: number): number {
  return (d * Math.PI) / 180;
}

function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(h));
}

/** 把经纬差换算到以 A 为原点的局部东(x)/北(y)公里平面 */
function toLocalKm(a: LngLat, p: LngLat, latRef: number): { x: number; y: number } {
  const kx = KM_PER_DEG_LNG * Math.cos(rad(latRef));
  return { x: (p.lng - a.lng) * kx, y: (p.lat - a.lat) * KM_PER_DEG_LAT };
}

/**
 * 步骤 1~3：找最近投影 + 局部 ENU 公里平面换算 + 叉积定侧。
 * 返回 null 表示折线不可用。
 */
export function projectSpotToLine(
  path: RailwayPoint[],
  lengthKm: number,
  lng: number,
  lat: number,
): LineProjection | null {
  if (!path || path.length < 2 || !(lengthKm > 0)) return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const s: LngLat = { lng, lat };
  let best: LineProjection | null = null;

  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const latRef = (a.lat + b.lat) / 2;

    const bb = toLocalKm(a, b, latRef);
    const ss = toLocalKm(a, s, latRef);
    const dx = bb.x;
    const dy = bb.y;
    const l2 = dx * dx + dy * dy;
    if (l2 <= 0) continue;

    const rawT = (ss.x * dx + ss.y * dy) / l2;
    const t = Math.max(0, Math.min(1, rawT));

    const vx = ss.x - dx * t;
    const vy = ss.y - dy * t;
    const perp = Math.hypot(vx, vy);

    if (!best || perp < best.distKm) {
      const segLen = b.distFromStart - a.distFromStart;
      const alongKm = a.distFromStart + segLen * t;
      const clampedOutside = (t <= 0 && i === 1) || (t >= 1 && i === path.length - 1);
      best = {
        alongKm: Math.round(alongKm * 100) / 100,
        distKm: Math.round(haversineKm(s, { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t }) * 1000) / 1000,
        ratio: lengthKm > 0 ? alongKm / lengthKm : 0,
        point: { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t },
        crossKm2: dx * vy - dy * vx,
        headingDeg: (Math.atan2(dx, dy) * 180) / Math.PI,
        clampedOutside,
      };
    }
  }
  return best;
}

/** 左右侧互换（both 与 unknown 保持不变），见 §3.2 换算规则 */
export function flipSide(side: SpotSide | undefined, flipped: boolean): SpotSide {
  const base: SpotSide = side && side !== 'unknown' ? side : 'unknown';
  if (!flipped) return base;
  if (base === 'left') return 'right';
  if (base === 'right') return 'left';
  return base;
}

/** 参考方向的存储侧别 → 实际车次方向的侧别 */
export function applyDirection(side: SpotSide | undefined, reversed: boolean): SpotSide {
  return flipSide(side, reversed);
}

/** 判断 lineRef 是否为延展型景观（河流/山脉/平原段落），见 §3.3 4)b */
export function isExtendedSpot(lineRef?: { alongKmFrom?: number; alongKmTo?: number }): boolean {
  if (!lineRef) return false;
  const from = lineRef.alongKmFrom;
  const to = lineRef.alongKmTo;
  if (typeof from !== 'number' || typeof to !== 'number') return false;
  return Math.abs(to - from) > EXTENDED_SPAN_KM;
}

/** 在 lines[] 中挑出当前走廊的里程区间；无 corridorId 时取第一条 */
export function pickLineRef(
  lines: SpotLineRef[] | undefined,
  corridorId?: string,
): SpotLineRef | undefined {
  if (!lines?.length) return undefined;
  if (corridorId) {
    const hit = lines.find((l) => l.corridorId === corridorId);
    if (hit) return hit;
  }
  return lines[0];
}

/** 临近提醒窗口：[进入点 - lead, 离开点 + trail]，见 §4.3 */
export interface ApproachWindow {
  fromKm: number;
  toKm: number;
}

export function approachWindow(
  params: { alongKm: number; lineRef?: SpotLineRef },
  leadKm = APPROACH_LEAD_KM,
  trailKm = APPROACH_TRAIL_KM,
): ApproachWindow {
  const end = typeof params.lineRef?.alongKmTo === 'number' ? params.lineRef!.alongKmTo! : params.alongKm;
  return { fromKm: params.alongKm - leadKm, toKm: end + trailKm };
}

/** 当前里程是否落在临近提醒窗口内 */
export function withinApproach(window: ApproachWindow, currentKm: number): boolean {
  return currentKm >= window.fromKm && currentKm <= window.toKm;
}

/** UI 文案：左/右/两侧，见 §4.6 */
export const SIDE_LABELS: Record<SpotSide, string> = {
  left: '列车左侧',
  right: '列车右侧',
  both: '两侧均可',
  unknown: '方位待确认',
};

/** UI 箭头符号（无障碍：与文字并列显示，不单靠颜色区分），见 §4.6 */
export const SIDE_ARROWS: Record<SpotSide, string> = {
  left: '←',
  right: '→',
  both: '↔',
  unknown: '?',
};

export function sideLabel(side?: SpotSide): string {
  return SIDE_LABELS[side && side !== 'unknown' ? side : 'unknown'];
}

export function sideArrow(side?: SpotSide): string {
  return SIDE_ARROWS[side && side !== 'unknown' ? side : 'unknown'];
}

export interface ResolveSpotSideParams {
  path: RailwayPoint[];
  lengthKm: number;
  lng: number;
  lat: number;
  /** 数据里静态存储的 side（基准方向见 sideRefDirection） */
  storedSide?: SpotSide;
  /** 该点在当前线路上的里程区间，用于识别延展型景观 */
  lineRef?: { alongKmFrom?: number; alongKmTo?: number };
  sideRefDirection?: SideRefDirection;
  /** 行程是否与参考方向相反；缺省时由数据侧 side 与实际计算的侧别自动推断 */
  reversed?: boolean;
}

/**
 * 完整求侧流程（§3.3 第 4 步的退化规则 + §4.5 的 confidence）。
 */
export function resolveSpotSide(params: ResolveSpotSideParams): SpotRuntimeSide | null {
  const projection = projectSpotToLine(params.path, params.lengthKm, params.lng, params.lat);
  if (!projection) return null;

  const sideRefDirection: SideRefDirection = params.sideRefDirection ?? 'line_forward';
  const extended = isExtendedSpot(params.lineRef);
  const distKm = Math.round(projection.distKm * 100) / 100;

  let side: SpotSide = 'unknown';
  let confidence: SideConfidence = 'high';
  let needsReview = projection.clampedOutside;
  let reason: string | undefined;

  // 判定顺序很重要：先处理「判断不出来」，再处理「两侧都能看」。
  //
  // 关键语义（易错点）：`both` 是一个**正常的、确定的方位结论**，不等于「没把握」。
  // 贴线通过、延展型景观（河流/山脉/平原段落本来就是一路两边都能看到）都是可信结论，
  // 置信度应为 high；只有真正无法判定（投影落到走廊覆盖范围之外）才判 unknown + low。
  // 否则会把一大片本来清晰的景点涂成灰色「低置信度」，反而误导用户。
  if (projection.clampedOutside) {
    // 点位在走廊覆盖范围的端点之外 —— 根本判断不了它在哪一侧，不是「两侧均可」
    side = 'unknown';
    confidence = 'low';
    reason = '投影落在线路起终点之外，点位在走廊覆盖范围外侧，方位无法判定';
  } else if (distKm <= SIDE_BOTH_DIST_KM) {
    side = 'both';
    confidence = 'high';
    reason = `距轨 ${distKm} km，贴线/正侧通过，两侧均可`;
  } else if (extended) {
    side = 'both';
    confidence = 'high';
    reason = '延展型景观（里程跨度 > 10 km），沿途两侧均可观赏';
  } else {
    side = projection.crossKm2 > 0 ? 'left' : 'right';
    confidence = 'high';
  }

  if (needsReview && !reason) reason = '投影落到端点外，需人工复核';

  // §3.2 方向换算：只接受调用方显式给出的 reversed（行程方向 vs sideRefDirection 基准）。
  // 切勿「据 storedSide 与几何结果是否一致」去反推翻转——那会自我抵消：
  // 反向行驶时几何已翻面、与存储值不符 → 被判成 flipped → 又翻回来，
  // 结果变成永远盲信数据，左右侧对行程方向失去敏感性（往返同一区间方位不变）。
  const flipped = params.reversed === true;

  // 几何优先：方位结论以「本次车次实际行进方向」的叉积结果为准，不迁就数据侧。
  //
  // 与数据侧不一致时**只记录原因、不降置信度**：反向行驶本来就会让几何结果与
  // 按走廊正方向存储的 side 相反，那是正常现象而非数据错误；若据此降级，
  // 会把反向车次上的所有景点一律染成「低置信度」，制造大面积假告警。
  // 真正该降级的只有「判断不出来」（已在上文判为 unknown）。
  if (
    params.storedSide &&
    params.storedSide !== 'unknown' &&
    params.storedSide !== 'both' &&
    side !== 'both' &&
    side !== 'unknown' &&
    params.storedSide !== side
  ) {
    const conflict = `几何判定 ${side} 与数据侧 ${params.storedSide} 不一致（多为反向行驶，可核对）`;
    reason = reason ? `${reason}；${conflict}` : conflict;
  }

  return {
    side: flipSide(side, flipped),
    confidence,
    flipped,
    sideRefDirection,
    alongKm: projection.alongKm,
    distKm,
    needsReview,
    reason,
  };
}

/** 可见性 → 默认最大贴线距离（km），与 scenic.ts 保持一致 */
export const VISIBILITY_MAX_DIST_KM: Record<SpotVisibility, number> = {
  on_track: 3,
  window: 8,
  distant: 35,
};

/** 资质荣誉标签字典，见 docs/scenic-supplement-20260928.md §2.2 */
export const HONOR_LABELS: Record<string, string> = {
  WNH: '世界自然遗产',
  WCH: '世界文化遗产',
  WMNH: '世界文化与自然双重遗产',
  GGP: '世界地质公园',
  RAMSAR: '国际重要湿地',
  NPARK: '国家公园',
  NNR: '国家级自然保护区',
  NSCENIC: '国家级风景名胜区',
  NCH: '全国重点文物保护单位',
  NWETLAND: '国家湿地公园',
  NWATER: '国家水利风景区',
  NGEO: '国家地质公园',
  NFOREST: '国家森林公园',
  AAAAA: '国家 5A 级景区',
  AAAA: '国家 4A 级景区',
  CNG: '中国国家地理最美榜单',
  NIAHS: '国家重要农业文化遗产',
  WORLDIRRIG: '世界灌溉工程遗产',
  PATRIOT: '全国爱国主义教育示范基地',
  MAJOR_PROJ: '国家重大工程',
  KEY_UNIV: '双一流建设高校',
};

export function honorLabel(code: string): string {
  return HONOR_LABELS[code] ?? code;
}

export function honorLabels(codes?: string[]): string[] {
  if (!codes?.length) return [];
  return codes.map(honorLabel);
}
