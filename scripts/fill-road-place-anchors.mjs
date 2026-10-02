/**
 * 万里路书 · 为公路几何补齐「中途地名锚点」（nodes）
 *
 * 背景
 * ----
 * 公路详情页（/drive/road/:code）此前把全线按 120km 等分，段名写成「第 N 段 · 0—120 km」，
 * 无地名、无信息量。API 侧 `buildChapters()` 已支持按 nodes 里的地名切段，
 * 但 `data/roads/geom/*.json` 的 `nodes` 几乎全是空数组，所以永远走 120km 退化分支。
 *
 * v0.6.5 三级地名来源（优先级从高到低）
 * ------------------------------------
 *  1. `amap`    高德逆地理编码 `/v3/geocode/regeo`，取 addressComponent 的
 *               `township`（乡镇/街道级）→ `district`（区县级）→ `city`（地市级）。
 *               粒度最贴合「沿公路的小地名」，且是权威行政区划。
 *  2. `place`   本地地名库，全部离线、零配额：
 *                 · data/roads/places-geo.json    行政地名（省/地级市/重点县镇）
 *                 · data/roads/roadside-spots.json 乡镇级 POI（12728 条，**主力**）
 *                 · data/presets/scenic-spots.json 景区/山口级 POI（624 条）
 *               v0.6.5 之前只有前两个小库（217 条），西藏/新疆腹地会出现 401km 的
 *               超长段；接入 roadside-spots 后该缺口被切细（实测「拉萨—林芝」401km
 *               → 4 段）。
 *  3. `station` data/stations-geo.json 铁路站点（1327 个）。站名只是 towns 的子集，
 *               且站场常离公路沿线数公里，**精度最低**，仅当前两级都无解时兜底。
 *
 * 关于 --provider amap 的可用性（重要）
 * ------------------------------------
 * 代码已就绪，但**本机当前跑不通**：apps/web/.env 里的 VITE_AMAP_KEY 是
 * 高德 **JS API（Web端）** key，而高德 key 在创建时即绑定服务平台类型，
 * Web端 key 调 `restapi.amap.com` 会返回
 *   {"status":"0","info":"USERKEY_PLAT_NOMATCH","infocode":"10009"}
 * （`v3/ip` / `v3/place/text` / `v3/geocode/geo` 全部同样报错 —— 项目
 * `apps/api/src/services/geocode.ts` 的站点补坐标接口当下也是失效状态）
 * 这**不是网络问题**（restapi.amap.com 直连 81ms 返回 200）。
 * 要启用需在控制台新建服务平台为「Web服务」的 key，然后：
 *   AMAP_WEB_KEY=<新key> node scripts/fill-road-place-anchors.mjs --provider amap
 * key 优先读环境变量 AMAP_WEB_KEY，其次读 apps/web/.env 的 VITE_AMAP_KEY。
 * 脚本日志只打印掩码，不打印完整 key。
 *
 * 为什么必须重算 cumKm
 * --------------------
 * 落盘 geom 的 `cumKm` 与 `points` 等长但量纲不可信：实测 G217 末值 1023313.34，
 * 而同文件 drawnKm=2343.5；G318 末值 1627363.51 / drawnKm=6331.5。
 * 旧 G318 的 nodes 里 atKm 也是 1385010 这种「米」量纲，直接当 km 用会写出
 * 「0—1385010 km」这种荒谬分段。本脚本一律按 haversine 从 points 现算累计里程，
 * 产出的 atKm 单位是 **km**，与 buildChapters / 沿程景点 progressKm 同一量纲。
 *
 * 用法
 * ----
 *   node scripts/fill-road-place-anchors.mjs                       # 默认 offline，全量干线
 *   node scripts/fill-road-place-anchors.mjs --keys G217,G318      # 指定编号
 *   node scripts/fill-road-place-anchors.mjs --limit 5             # 先跑 5 条验证
 *   node scripts/fill-road-place-anchors.mjs --dry-run             # 只报告不落盘
 *   node scripts/fill-road-place-anchors.mjs --force               # 忽略缓存重算
 *   node scripts/fill-road-place-anchors.mjs --step 50             # 自定义锚点间距
 *   AMAP_WEB_KEY=... node scripts/fill-road-place-anchors.mjs --provider amap
 *
 * 断点续跑：结果缓存在 data/cache/place-anchors/{key}.json，已有 ≥2 个锚点的 key 默认跳过。
 * 落盘时只替换 nodes 字段，其余字段原样保留，压缩格式与现有文件一致。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GEOM_DIR = join(ROOT, 'data', 'roads', 'geom');
const INDEX_DIR = join(ROOT, 'data', 'roads', 'index');
const CACHE_DIR = join(ROOT, 'data', 'cache', 'place-anchors');
const PLACES_PATH = join(ROOT, 'data', 'roads', 'places-geo.json');
const ROADSIDE_PATH = join(ROOT, 'data', 'roads', 'roadside-spots.json');
const SCENIC_PATH = join(ROOT, 'data', 'presets', 'scenic-spots.json');
const STATIONS_PATH = join(ROOT, 'data', 'stations-geo.json');
const WEB_ENV_PATH = join(ROOT, 'apps', 'web', '.env');

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);

/** @param {string} name */
function flag(name) {
  return argv.includes(`--${name}`);
}

/** @param {string} name @param {string} fallback */
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

/** v0.6.5：默认 offline（本地三级库，纯离线可跑）；amap 需自备 Web服务 key */
const PROVIDER = opt('provider', 'offline');
const STEP_KM = Number(opt('step', '50'));
const MAX_KM = Number(opt('max-km', '40'));
const MIN_GAP_KM = Number(opt('min-gap', '40'));
const LIMIT = Number(opt('limit', '0'));
const DRY_RUN = flag('dry-run');
const FORCE = flag('force');
const CLASSES = opt('classes', 'expressway,national')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const KEY_LIST = opt('keys', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/** 高德限速：按 QPS 计配额，保守取 3 req/s（≈333ms 间隔） */
const AMAP_MIN_INTERVAL_MS = 340;

// ── 地理工具 ────────────────────────────────────────────────────────────────
const EARTH_R_KM = 6371;

/** Haversine 距离（km） */
function haversineKm(lng1, lat1, lng2, lat2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 从 points 现算累计里程（km）。
 * 不能用落盘的 cumKm —— 实测其量纲与 drawnKm 差 2~3 个数量级（见文件头说明）。
 * @param {Array<[number, number, number?]>} points
 * @returns {number[]}
 */
function computeCumKm(points) {
  const cum = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    cum[i] = cum[i - 1] + haversineKm(a[0], a[1], b[0], b[1]);
  }
  return cum;
}

/**
 * 判断是否为「有效中文名」。
 *
 * 用于两处：
 *  1. 地名锚点过滤 —— 纯英文名的乡镇 POI 对中文用户无意义，且 OSM 上这类条目
 *     常是 `Viewpoint` / `318` 这类无意义串，不能当地名用。
 *  2. 前端精选景点排序 —— 纯 ASCII 名在中文界面里突兀（实测精选第 6 名
 *     `Grand Canyon trailhead`），需降权并标注「未译名」。
 *
 * 规则：只要含 CJK 字符即算有中文名；否则视为未译名。
 * @param {string} name
 */
function hasChineseName(name) {
  return /[㐀-䶿一-鿿豈-﫿]/.test(String(name ?? ''));
}

// ── 地名库（三级）────────────────────────────────────────────────────────────
/** @typedef {'amap' | 'place' | 'station'} AnchorSource */
/**
 * @typedef {Object} GazetteerEntry
 * @property {string} name
 * @property {number} lng
 * @property {number} lat
 * @property {AnchorSource} source
 * @property {string} level     来源子标签，仅用于排查（admin / roadside / scenic / station）
 * @property {number} rank      同名去重时的优先级，数值大者胜
 * @property {'settlement'|'pass'|'landmark'} kind  地名类别，决定优先级与吸附半径
 */

/**
 * 载入本地地名库（tier 2 place + tier 3 station）。
 * 同名去重时按 rank 取胜：place(admin) > place(roadside) > place(scenic) > station。
 * @returns {GazetteerEntry[]}
 */
function loadGazetteer() {
  /** @type {GazetteerEntry[]} */
  const raw = [];

  /**
   * 统一入口：清洗名称 → 过滤 → 分类 → 入库
   * @param {{name:string,lng:number,lat:number,category?:string}} item
   * @param {AnchorSource} source
   * @param {string} level
   * @param {number} rank
   */
  const add = (item, source, level, rank) => {
    if (!item?.name || !Number.isFinite(item.lng) || !Number.isFinite(item.lat)) return;
    if (!hasChineseName(item.name)) return;
    if (!isPlaceLikeName(item.name, item.category)) return;
    const name = cleanPlaceName(item.name);
    if (!name) return;
    raw.push({ name, lng: item.lng, lat: item.lat, source, level, rank, kind: classifyPlace(name, level) });
  };

  // ── tier 2a：行政地名（人工精选，34 省 + 117 地级市 + 66 重点县镇）──
  if (existsSync(PLACES_PATH)) {
    const file = JSON.parse(readFileSync(PLACES_PATH, 'utf8'));
    for (const p of file.places ?? []) add(p, 'place', 'admin:' + (p.level ?? 'place'), 4);
  }

  // ── tier 2b：公路侧 POI（12728 条，**主力**）──
  // 只取「像地名」的条目：设施类（服务区/观景台/门/馆…）被清洗或剔除，
  // 剩下聚落、山口、景区地标。
  if (existsSync(ROADSIDE_PATH)) {
    const file = JSON.parse(readFileSync(ROADSIDE_PATH, 'utf8'));
    for (const s of file.spots ?? []) add(s, 'place', 'roadside', 3);
  }

  // ── tier 2c：景区 / 山口级 POI ──
  if (existsSync(SCENIC_PATH)) {
    const file = JSON.parse(readFileSync(SCENIC_PATH, 'utf8'));
    for (const s of file.spots ?? []) add(s, 'place', 'scenic', 2);
  }

  // ── tier 3：铁路站点（站名即镇名）──
  if (existsSync(STATIONS_PATH)) {
    const file = JSON.parse(readFileSync(STATIONS_PATH, 'utf8'));
    for (const st of Object.values(file)) {
      if (!st?.name) continue;
      // 站名去掉结尾的「站」：铁路站名绝大多数即城镇名（奎屯 / 库车 / 巴楚 / 喀什…）
      add({ name: String(st.name).replace(/站$/, ''), lng: st.lng, lat: st.lat }, 'station', 'station', 1);
    }
  }

  // 同名去重：rank 高者胜（同 rank 时先到先得）
  /** @type {Map<string, GazetteerEntry>} */
  const byName = new Map();
  for (const g of raw) {
    const cur = byName.get(g.name);
    if (!cur || g.rank > cur.rank) byName.set(g.name, g);
  }
  return [...byName.values()];
}

/**
 * 判断 POI 名称是否「像地名」（可用于分段），而非纯设施/信息点。
 *
 * 排除的是明显不是地名的形态：纯数字（国道编号 318）、纯英文（Viewpoint）、
 * 以及带明确设施后缀的条目（服务区/收费站/加油站/停车区/观景台/出入口…）——
 * 这些是「路上的设施」，不是「路上的地名」。
 * @param {string} name
 * @param {string} [category]
 */
function isPlaceLikeName(name, category) {
  const n = String(name);
  // 纯数字（如 "318"）不是地名
  if (/^\d+$/.test(n)) return false;
  if (FACILITY_SUFFIX_RE.test(n)) return false;
  // 观景台/观景点这类是「体验点」不是「地名」，但山口/垭口是地名，保留
  if (/(观景台|观景点|拍照点|打卡点)$/.test(n)) return false;
  // category 明确是纯服务设施的也排除
  if (category && /^service\.(charging|fuel|parking|toll)/.test(category)) return false;
  return true;
}

// ── 地名清洗：把「POI 全称」还原成「地名」──────────────────────────────────
/**
 * 设施类尾缀。命中后**剥掉尾缀取前缀当地名**（如「乔尔玛烈士陵园」→「乔尔玛」、
 * 「天山石林东门」→「天山石林」）；剥完前缀不足 2 字则整条丢弃。
 * 注意：观景台/观景点/拍照点/打卡点不在此列 —— 它们剥不出地名（会得到无意义的
 * 前缀），由 isPlaceLikeName 直接排除。
 */
const FACILITY_SUFFIX_RE =
  /(东门|西门|南门|北门|正门|侧门|服务中心|服务站|服务区|加油站|收费站|停车区|停车位|停车厂|出入口|互通立交|立交桥|道班|养护大队|养护中队|检查站|客运站|公交站|陈列馆|博物馆|纪念馆|纪念碑|烈士陵园|公墓|医院|学校|银行|邮局|法院|派出所|消防队|供电所|水文站|管理所|收费站|大门|广场|停车)$/;

/** 方位/程度限定词，剥掉后是本体名（「羊卓雍措方向（远眺）」→「羊卓雍措」） */
const QUALIFIER_SUFFIX_RE = /(方向|远眺|近观|全景|视角|一带|沿线|附近|景区入口|入口)$/;

/**
 * 把 POI 名称清洗成可用于分段的「地名」。
 *
 * 1. 去掉尾部括号补充说明：`XX（远眺）` → `XX`
 * 2. 剥掉方位/程度限定词：`XX方向` → `XX`
 * 3. 剥掉设施尾缀并保留前缀：`天山石林东门` → `天山石林`；剥完不足 2 字则丢弃
 *
 * @param {string} raw 原始名称
 * @returns {string} 清洗后的地名；不可用时返回空串
 */
function cleanPlaceName(raw) {
  let n = String(raw ?? '').trim();
  if (!n) return '';
  // 1) 去掉尾部括号（可能是补充说明，也可能整个名称都在括号里）
  n = n.replace(/[（(][^）)]*[）)]\s*$/u, '').trim();
  if (!n) return '';
  // 2) 剥方位/程度限定词（可重复：「XX方向附近」）
  for (let i = 0; i < 2; i += 1) {
    const before = n;
    n = n.replace(QUALIFIER_SUFFIX_RE, '').trim();
    if (n === before) break;
  }
  if (!n) return '';
  // 3) 剥设施尾缀，保留前缀
  const m = FACILITY_SUFFIX_RE.exec(n);
  if (m) {
    const stem = n.slice(0, n.length - m[0].length).trim();
    // 前缀不足 2 字（如「广场」→「广」）说明剥完没有有效地名，丢弃
    if (stem.length < 2 || !hasChineseName(stem)) return '';
    n = stem;
  }
  return hasChineseName(n) ? n : '';
}

/**
 * 地名类别，决定优先级与吸附半径。
 *  - settlement 聚落/行政/站名：最适合当分段名，吸附半径最大
 *  - pass       山口/山岭/关隘：公路分段的天然节点
 *  - landmark   景区/地标/古建：仅用于填补空白
 *
 * @param {string} name 清洗后的地名
 * @param {string} level 来源子标签：admin*(行政) / station(站名) / roadside / scenic
 */
function classifyPlace(name, level) {
  // 行政地名（places-geo.json 的 province/city/county）与站名都是聚落级
  if (level === 'station' || level.startsWith('admin')) return 'settlement';
  if (/(山口|山|岭|垭口|关|达坂)$/.test(name)) return 'pass';
  return 'landmark';
}

// ── tier 1：高德逆地理编码 ──────────────────────────────────────────────────
const AMAP_REGEO_URL = 'https://restapi.amap.com/v3/geocode/regeo';
/** @type {Map<string, string|null>} 坐标(4 位小数) → 地名 | null（失败也缓存，避免重复打配额） */
const amapCache = new Map();
let lastAmapAt = 0;
let amapKey = '';
let amapDisabledReason = '';

/** 从环境变量或 apps/web/.env 读取高德 key（不硬编码，日志掩码） */
function loadAmapKey() {
  const fromEnv = process.env.AMAP_WEB_KEY || process.env.AMAP_KEY;
  if (fromEnv) return fromEnv.trim();
  if (existsSync(WEB_ENV_PATH)) {
    const m = /^VITE_AMAP_KEY\s*=\s*(.+)$/m.exec(readFileSync(WEB_ENV_PATH, 'utf8'));
    if (m) return m[1].trim();
  }
  return '';
}

/** 日志用掩码，绝不打印完整 key */
function maskKey(k) {
  if (!k) return '(未配置)';
  return k.length > 10 ? `${k.slice(0, 4)}****${k.slice(-4)}` : '****';
}

/**
 * 高德逆地理编码：取 township → district → city。
 * @param {number} lng @param {number} lat @returns {Promise<string|null>}
 */
async function amapRegeo(lng, lat) {
  const ck = `${lng.toFixed(4)},${lat.toFixed(4)}`;
  if (amapCache.has(ck)) return amapCache.get(ck);
  if (amapDisabledReason) return null;

  const since = Date.now() - lastAmapAt;
  if (since < AMAP_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, AMAP_MIN_INTERVAL_MS - since));
  }
  lastAmapAt = Date.now();

  const url = `${AMAP_REGEO_URL}?key=${encodeURIComponent(amapKey)}&location=${lng},${lat}&extensions=base`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      amapCache.set(ck, null);
      return null;
    }
    const body = await res.json();
    if (body.status !== '1' || !body.regeocode) {
      // USERKEY_PLAT_NOMATCH = key 平台类型不匹配（Web端 key 不能调 Web服务），属致命配置错误
      if (body.info === 'USERKEY_PLAT_NOMATCH' || body.infocode === '10009') {
        amapDisabledReason = `${body.info}(${body.infocode})`;
        console.error(
          `[amap] 逆地理编码不可用：${amapDisabledReason}。` +
            '该 key 是高德「Web端(JS API)」类型，无法调用 Web服务接口；' +
            '请设置 AMAP_WEB_KEY 为服务平台=「Web服务」的 key，或改用 --provider offline。',
        );
      }
      amapCache.set(ck, null);
      return null;
    }
    const ac = body.regeocode.addressComponent ?? {};
    // township 是数组（多乡镇时并列），非空时取第一个
    const pick = (v) => (Array.isArray(v) ? (v.find((x) => x && hasChineseName(x)) ?? '') : v ?? '');
    const township = String(pick(ac.township) ?? '').trim();
    const district = String(pick(ac.district) ?? '').trim();
    const city = String(pick(ac.city) ?? '').trim();
    // 直辖市的 city 与 province 同名（「北京市」），此时降级用 district
    const name = township || district || (hasChineseName(city) ? city.replace(/市$/, '') : '');
    const out = name || null;
    amapCache.set(ck, out);
    return out;
  } catch {
    amapCache.set(ck, null);
    return null;
  }
}

// ── 待处理 key ──────────────────────────────────────────────────────────────
/** 干线索引文件名（class → 文件名），与 scripts/build-road-index.mjs 保持一致 */
const CLASS_INDEX = {
  expressway: 'expressway.json',
  national: 'national.json',
  provincial: 'provincial.json',
  county: 'county.json',
  township: 'township.json',
};

/** 文件名规则与 getRoadGeometry 一致：只替换文件系统非法字符，中文省名原样保留 */
function geomFile(key) {
  return join(GEOM_DIR, `${key.replace(/[:/\\*?"<>|]/g, '_')}.json`);
}

function collectKeys() {
  if (KEY_LIST.length) return KEY_LIST;
  const out = [];
  const seen = new Set();
  for (const cls of CLASSES) {
    const file = CLASS_INDEX[cls];
    if (!file) continue;
    const p = join(INDEX_DIR, file);
    if (!existsSync(p)) continue;
    const idx = JSON.parse(readFileSync(p, 'utf8'));
    for (const e of idx.roads ?? []) {
      const key = e.key ?? e.ref;
      if (!key || !e.hasGeom || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

// ── 锚点抽取 ────────────────────────────────────────────────────────────────
/**
 * @typedef {Object} Anchor
 * @property {string} name
 * @property {number} atKm    沿主链的里程（km）
 * @property {'city'|'junction'|'service'|'pass'|'endpoint'} type
 * @property {AnchorSource} source  地名来源分级
 * @property {number} lng
 * @property {number} lat
 * @property {string} level  来源子标签
 * @property {number} offsetKm  锚点到折线的距离（km），排查吸附质量
 */

/** @param {GazetteerEntry} e @returns {Anchor['type']} */
function anchorType(e) {
  if (e.source === 'station') return 'service';
  if (e.level === 'province') return 'junction';
  return 'city';
}

/**
 * 地名类别的吸附半径倍率（km）。
 *
 * 聚落是公路分段最自然的节点，站场/镇中心可能离公路几公里到几十公里，
 * 放宽一些；山口几乎在路边；地标（景区/古建）只在没有更地名的候选时才用，
 * 半径收紧以免把「擦边而过的景区」当成沿线地名。
 */
const KIND_RADIUS_KM = { settlement: 1.0, pass: 0.8, landmark: 0.5 };

/** 类别优先级：数值大者先选（聚落 > 山口 > 地标） */
const KIND_PRIORITY = { settlement: 3, pass: 2, landmark: 1 };

/**
 * 在候选中挑一个最佳锚点：先按类别优先级，再按距离，最后按 rank。
 * @param {Array<[number,number,number?]>} points
 * @param {number} i 主链点下标
 * @param {GazetteerEntry[]} gaz
 * @param {Set<string>} used 已用地名
 * @param {number} maxKm 全局最大半径
 * @returns {{e:GazetteerEntry,d:number}|null}
 */
function pickBestEntry(points, i, gaz, used, maxKm) {
  const lng = points[i][0];
  const lat = points[i][1];
  /** @type {GazetteerEntry|null} */
  let best = null;
  let bestScore = -Infinity;
  for (const c of gaz) {
    if (used.has(c.name)) continue;
    const d = haversineKm(lng, lat, c.lng, c.lat);
    const limit = maxKm * (KIND_RADIUS_KM[c.kind] ?? 1);
    if (d > limit) continue;
    // 打分：类别优先，其次距离（每 10km 扣 1 分），最后 rank 微调
    const score = KIND_PRIORITY[c.kind] * 100 - d / 10 + c.rank * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = c;
      if (c.kind === 'settlement' && d <= 8) break; // 附近的聚落基本就是最优解
    }
  }
  return best ? { e: best, d: haversineKm(lng, lat, best.lng, best.lat) } : null;
}

/**
 * tier 2/3：本地地名库就近吸附（按类别优先级）。
 * @param {Array<[number,number,number?]>} points
 * @param {number[]} cum
 * @param {GazetteerEntry[]} gaz
 * @param {number} maxKm
 * @returns {Anchor[]}
 */
function pickGazetteerAnchors(points, cum, gaz, maxKm) {
  /** @type {Anchor[]} */
  const out = [];
  const used = new Set();
  let nextKm = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (cum[i] < nextKm) continue;
    // 各类别分别用完用名池，避免「某个聚落名被一个地标抢先用掉」
    const hit = pickBestEntry(points, i, gaz, used, maxKm);
    if (hit) {
      const lastKm = out.length ? out[out.length - 1].atKm : -Infinity;
      if (cum[i] - lastKm >= MIN_GAP_KM) {
        used.add(hit.e.name);
        out.push({
          name: hit.e.name,
          atKm: Math.round(cum[i] * 10) / 10,
          type: anchorType(hit.e),
          source: hit.e.source,
          lng: hit.e.lng,
          lat: hit.e.lat,
          level: hit.e.level,
          offsetKm: Math.round(hit.d * 10) / 10,
        });
      }
    }
    nextKm = cum[i] + STEP_KM;
  }
  return out;
}

/**
 * tier 1 优先 + tier 2/3 兜底：逐锚点先问高德，失败再查本地库。
 * @param {Array<[number,number,number?]>} points
 * @param {number[]} cum
 * @param {GazetteerEntry[]} gaz
 * @param {number} maxKm
 * @returns {Promise<Anchor[]>}
 */
async function pickAmapFirstAnchors(points, cum, gaz, maxKm) {
  /** @type {Anchor[]} */
  const out = [];
  const used = new Set();
  let nextKm = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (cum[i] < nextKm) continue;
    const lastKm = out.length ? out[out.length - 1].atKm : -Infinity;
    if (cum[i] - lastKm < MIN_GAP_KM) {
      nextKm = cum[i] + STEP_KM;
      continue;
    }
    /** @type {Anchor | null} */
    let picked = null;

    // tier 1：高德
    if (!amapDisabledReason) {
      const nm = await amapRegeo(points[i][0], points[i][1]);
      if (nm && !used.has(nm)) {
        picked = {
          name: nm,
          atKm: Math.round(cum[i] * 10) / 10,
          type: 'city',
          source: 'amap',
          lng: points[i][0],
          lat: points[i][1],
          level: 'amap',
          offsetKm: 0,
        };
      }
    }

    // tier 2/3：本地库兜底
    if (!picked) {
      const hit = pickBestEntry(points, i, gaz, used, maxKm);
      if (hit) {
        picked = {
          name: hit.e.name,
          atKm: Math.round(cum[i] * 10) / 10,
          type: anchorType(hit.e),
          source: hit.e.source,
          lng: hit.e.lng,
          lat: hit.e.lat,
          level: hit.e.level,
          offsetKm: Math.round(hit.d * 10) / 10,
        };
      }
    }

    if (picked) {
      used.add(picked.name);
      out.push(picked);
    }
    nextKm = cum[i] + STEP_KM;
  }
  return out;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  if (PROVIDER !== 'offline' && PROVIDER !== 'amap' && PROVIDER !== 'nominatim') {
    console.error(`未知 provider：${PROVIDER}（可选 offline | amap | nominatim）`);
    process.exit(1);
  }

  /** @type {GazetteerEntry[]} */
  let gaz = [];
  if (PROVIDER !== 'nominatim') {
    gaz = loadGazetteer();
    const bySource = { place: 0, station: 0 };
    const byLevel = {};
    for (const g of gaz) {
      bySource[g.source] += 1;
      byLevel[g.level] = (byLevel[g.level] ?? 0) + 1;
    }
    console.error(
      `[gazetteer] 载入 ${gaz.length} 条地名（place ${bySource.place} / station ${bySource.station}）` +
        ` 明细：${Object.entries(byLevel).map(([k, v]) => `${k}=${v}`).join(' ')}`,
    );
  }

  if (PROVIDER === 'amap') {
    amapKey = loadAmapKey();
    console.error(`[amap] key=${maskKey(amapKey)}（来源：AMAP_WEB_KEY 环境变量或 apps/web/.env）`);
    if (!amapKey) {
      console.error('[amap] 未找到 key，该 provider 全部回落到本地库。建议改用 --provider offline。');
    }
  }

  const keys = collectKeys();
  const withGeom = keys.filter((k) => existsSync(geomFile(k)));
  const todo = withGeom.slice(0, LIMIT > 0 ? LIMIT : withGeom.length);
  console.error(
    `[plan] 目标 ${keys.length} 条干线，其中有几何 ${withGeom.length} 条，本次处理 ${todo.length} 条` +
      `（step=${STEP_KM}km max=${MAX_KM}km minGap=${MIN_GAP_KM}km provider=${PROVIDER}${DRY_RUN ? ' dry-run' : ''}）`,
  );

  mkdirSync(CACHE_DIR, { recursive: true });

  let written = 0;
  let skipped = 0;
  let totalAmap = 0;
  let totalPlace = 0;
  let totalStation = 0;
  /** @type {Array<{key:string,anchors:number}>} */
  const report = [];

  for (const key of todo) {
    const file = geomFile(key);
    const geom = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(geom.points) || geom.points.length < 2) {
      skipped += 1;
      continue;
    }

    const cacheFile = join(CACHE_DIR, `${key.replace(/[:/\\*?"<>|]/g, '_')}.json`);
    /** @type {Anchor[] | null} */
    let anchors = null;
    if (!FORCE && existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
        // provider 变了就重算（tier 优先级不同，结果不可复用）
        if (
          Array.isArray(cached.anchors) &&
          cached.anchors.length >= 2 &&
          (PROVIDER === 'nominatim' || cached.provider === PROVIDER || cached.provider === 'gazetteer')
        ) {
          anchors = cached.anchors;
        }
      } catch {
        anchors = null;
      }
    }

    if (!anchors) {
      const cum = computeCumKm(geom.points);
      anchors =
        PROVIDER === 'nominatim'
          ? await pickNominatimAnchors(geom.points, cum)
          : PROVIDER === 'amap'
            ? await pickAmapFirstAnchors(geom.points, cum, gaz, MAX_KM)
            : pickGazetteerAnchors(geom.points, cum, gaz, MAX_KM);
      writeFileSync(
        cacheFile,
        JSON.stringify(
          {
            key,
            provider: PROVIDER,
            stepKm: STEP_KM,
            maxKm: MAX_KM,
            minGapKm: MIN_GAP_KM,
            chainKm: Math.round((cum[cum.length - 1] ?? 0) * 10) / 10,
            anchors,
          },
          null,
          1,
        ),
        'utf8',
      );
    }

    report.push({ key, anchors: anchors.length });
    for (const a of anchors) {
      if (a.source === 'amap') totalAmap += 1;
      else if (a.source === 'place') totalPlace += 1;
      else totalStation += 1;
    }

    if (anchors.length < 2) {
      // 不足 2 个锚点无法切段：保持 nodes 原样（不写空数组污染数据）
      skipped += 1;
      continue;
    }

    if (!DRY_RUN) {
      // 只替换 nodes，其余字段与原压缩格式保持一致
      geom.nodes = anchors.map((a) => ({ name: a.name, atKm: a.atKm, type: a.type, source: a.source }));
      writeFileSync(file, JSON.stringify(geom), 'utf8');
    }
    written += 1;
    console.error(
      `  ${DRY_RUN ? '[dry]' : '   '} ${key}  ${anchors.length} 锚点  ` +
        anchors.map((a) => `${a.name}@${a.atKm}[${a.source}]`).join(' / '),
    );
  }

  console.error(`\n[done] 写入 ${written} 条，跳过 ${skipped} 条`);
  console.error(`[source 分布] amap ${totalAmap} / place ${totalPlace} / station ${totalStation}`);
  const few = report.filter((r) => r.anchors < 3);
  if (few.length) {
    console.error(
      `[warn] 锚点 <3 的编号（UI 上会退化为里程等分或只有 1 段）：${few.map((r) => r.key).join(', ')}`,
    );
  }
}

/** @param {Array<[number,number,number?]>} points @param {number[]} cum @returns {Promise<Anchor[]>} */
async function pickNominatimAnchors(points, cum) {
  /** @type {Anchor[]} */
  const out = [];
  const used = new Set();
  let nextKm = 0;
  const cache = new Map();
  for (let i = 0; i < points.length; i += 1) {
    if (cum[i] < nextKm) continue;
    const ck = `${points[i][0].toFixed(4)},${points[i][1].toFixed(4)}`;
    let name = cache.get(ck);
    if (name === undefined) {
      const since = Date.now() - lastAmapAt;
      if (since < 1100) await new Promise((r) => setTimeout(r, 1100 - since));
      lastAmapAt = Date.now();
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${points[i][1]}&lon=${points[i][0]}` +
            '&format=json&zoom=8&accept-language=zh-CN',
          {
            headers: { 'User-Agent': 'RailVista/0.6.5 (road place anchor builder)' },
            signal: AbortSignal.timeout(8000),
          },
        );
        const body = res.ok ? await res.json() : null;
        name = (body?.name || String(body?.display_name ?? '').split(',')[0] || '').trim() || null;
      } catch {
        name = null;
      }
      cache.set(ck, name);
    }
    // 反查失败 / 无名 → 跳过（不编造地名）
    if (name && hasChineseName(name) && !used.has(name)) {
      const lastKm = out.length ? out[out.length - 1].atKm : -Infinity;
      if (cum[i] - lastKm >= MIN_GAP_KM) {
        used.add(name);
        out.push({
          name,
          atKm: Math.round(cum[i] * 10) / 10,
          type: 'city',
          source: 'place',
          lng: points[i][0],
          lat: points[i][1],
          level: 'nominatim',
          offsetKm: 0,
        });
      }
    }
    nextKm = cum[i] + STEP_KM;
  }
  return out;
}

await main();
