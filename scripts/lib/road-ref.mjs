/**
 * 万里路书 · 公路编号工具（scripts/lib/road-ref.mjs）
 *
 * 与 scripts/validate-road-keys.mjs 的 §3.2 规则严格一致，供构建脚本共用：
 *   G + 1~3 位（<100）→ 国家高速主线（G4 京港澳）
 *   G + 1~3 位（>=100）→ 普通国道（G318 沪聂线）
 *   G + 4 位            → 国家高速（G5611 大丽高速）
 *   G + 1~2 位 + W/E/N  → 国家高速并行线（G15W 常台高速）
 *   S/X/Y/C + 1~4 位    → 省道 / 县道 / 乡道 / 村道（省内编号，必须带省前缀）
 *
 * 另外提供 ref 清洗（OSM 里同一编号会写成 "G318;G214"、小写、带空格等）。
 */

/** class → 单字母码（RVWN/瓦片/索引共用） */
export const CLASS_CODE = {
  expressway: 'E',
  national: 'G',
  provincial: 'S',
  county: 'X',
  township: 'Y',
  village: 'C',
  other: 'O',
};

export const CODE_CLASS = {
  E: 'expressway',
  G: 'national',
  S: 'provincial',
  X: 'county',
  Y: 'township',
  C: 'village',
  O: 'other',
};

/** 单个编号 → 等级（与 validate-road-keys.mjs 同规则）；不合法返回 null */
export function classifyRef(ref) {
  if (typeof ref !== 'string') return null;
  const r = ref.trim().toUpperCase();
  if (/^G\d{1,3}$/.test(r)) return Number(r.slice(1)) < 100 ? 'expressway' : 'national';
  if (/^G\d{4}$/.test(r)) return 'expressway';
  if (/^G\d{1,2}[WEN]$/.test(r)) return 'expressway';
  if (/^S\d{1,4}$/.test(r)) return 'provincial';
  if (/^X\d{1,4}$/.test(r)) return 'county';
  if (/^Y\d{1,4}$/.test(r)) return 'township';
  if (/^C\d{1,4}$/.test(r)) return 'village';
  return null;
}

/**
 * 编号规范化：去掉数字部分的零填充。
 * OSM 里同一条国道会写成 "G111" 与 "G0111" 两种形式（省道 "X001"/"X1" 同理），
 * 不归一化就会生成两个实体：G0111 还会被误判成"G+4 位 = 国家高速"。
 */
export function canonicalRef(ref) {
  const r = String(ref ?? '').trim().toUpperCase();
  // G + 4 位是"国家高速联络线"编号，**必须原样保留**：
  // G0111 是高速联络线，不是国道 G111（早先误把零填充一律去掉，
  // 结果把高速联络线的路段并进了同名国道，还导致 88 条联络线查不到几何）。
  if (/^G\d{4}$/.test(r)) return r;
  // 其余情况去掉零填充：G03 → G3、X001 → X1（OSM 里两种写法都常见）
  let m = /^G0*(\d{1,3})$/.exec(r);
  if (m) return 'G' + m[1];
  m = /^([SXYC])0*(\d{1,4})$/.exec(r);
  if (m) return m[1] + m[2];
  return r;
}

/**
 * 文件系统安全的 key → 文件名。
 * 注意（踩过的坑）：不能用 key.replace(/[^\w:]/g, '_') —— 中文省名会被替换成 _，
 * 而 ':' 在 Windows 上是 NTFS 备用数据流语法，结果所有省道几何被写进名为 "__" 的
 * ADS 流里，等于全部丢失。这里只把 ':' 换成 '_'，中文原样保留。
 */
export function keyToFileName(key) {
  return String(key).replace(/[:/\\*?"<>|]/g, '_') + '.json';
}

/**
 * ref 清洗：把 OSM 的 ref 字段拆成规范化编号数组。
 *   "G318;G214" → ['G318','G214']
 *   "g 318"     → ['G318']
 *   "G318、G214"→ ['G318','G214']
 *   "318"       → []      （无前缀纯数字，无法判定等级，交由 unknownNum 计数）
 */
export function normalizeRefs(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const out = [];
  const seen = new Set();
  for (const piece of raw.split(/[;,、，/|]+/)) {
    const r = canonicalRef(piece.replace(/[\s\u3000]+/g, ''));
    if (!r || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

/** 编号是否合法（classifyRef 非空即合法） */
export function isValidRef(ref) {
  return classifyRef(ref) !== null;
}

/**
 * 主键：
 *   国道/高速全国唯一 → "G318" / "G5611"
 *   省道及以下省内唯一 → "青海:S101" / "四川:X217"
 *   乡道/村道县级唯一（可选县名）→ "广东:博罗:Y012"
 */
export function buildKey(ref, province, county) {
  const cls = classifyRef(ref);
  if (!cls) return null;
  if (cls === 'national' || cls === 'expressway') return ref;
  if (!province) return null;
  if ((cls === 'township' || cls === 'village') && county) return province + ':' + county + ':' + ref;
  return province + ':' + ref;
}

/** OSM highway 取值 → 是否纳入路网要素库（含 track/service，可按开关裁剪） */
export const HIGHWAY_CORE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'unclassified', 'residential', 'living_street', 'road',
]);
export const HIGHWAY_LINK = new Set([
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);
export const HIGHWAY_OPTIONAL = new Set(['service', 'track']);

/**
 * @param {string} highway OSM highway 值
 * @param {{withTrack?: boolean, withService?: boolean}} [opts]
 */
export function isRoadHighway(highway, opts = {}) {
  if (!highway) return false;
  if (HIGHWAY_CORE.has(highway) || HIGHWAY_LINK.has(highway)) return true;
  if (highway === 'track') return opts.withTrack !== false;
  if (highway === 'service') return opts.withService !== false;
  return false;
}

/** 是否机动车可通行（用于拓扑建图；人行道/台阶/自行车道排除） */
export function isDrivable(highway) {
  return isRoadHighway(highway, { withTrack: true, withService: true });
}

/**
 * 依据 OSM 语义推断"最低行政等级"（仅用于无 ref 路段的展示分级）：
 * 编号缺失时，用 highway 类型给一个合理的缺省等级，便于底图分级着色。
 */
export function inferClass(highway, refClass) {
  if (refClass) return refClass;
  switch (highway) {
    case 'motorway':
    case 'motorway_link':
    case 'trunk':
    case 'trunk_link':
      return 'expressway';
    case 'primary':
    case 'primary_link':
      return 'national';
    case 'secondary':
    case 'secondary_link':
      return 'provincial';
    case 'tertiary':
    case 'tertiary_link':
      return 'county';
    case 'unclassified':
    case 'residential':
    case 'living_street':
    case 'road':
      return 'township';
    case 'track':
    case 'service':
      return 'village';
    default:
      return 'other';
  }
}
