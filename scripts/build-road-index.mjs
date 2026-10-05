/**
 * 万里路书 · 全国公路旅游网 —— L0 索引构建（PRD §3 Step 1 + §3.2 校验）。
 *
 * 用法：
 *   node scripts/fetch-plan-2022.mjs              # 先抓权威名录（301 国道 + 278 高速）
 *   node scripts/build-road-index.mjs             # 权威名录 + 元数据 → data/roads/index/
 *   node scripts/build-road-index.mjs --merge     # 额外并入 data/roads/geom/*.json 的几何统计
 *
 * 数据来源分层：
 *   1. data/roads/authoritative/plan-2022-{national,expressway}.json
 *      ←《国家公路网规划》(2022) 附件 1/2 官方方案表（scripts/fetch-plan-2022.mjs 抓取解析），
 *        提供编号 + 起讫点 + 控制点（301 + 278 全量）。
 *   2. 本文件内置 META 表：经典线的线名（沪聂线…）、官方里程参考值、途经省——
 *      规划表不含这三项，按已知线路人工维护，逐步补齐。
 *   3. 省道种子：省内编号跨省重复，主键 省:编号，几何与名录均为 OSM 众包（unverified）。
 *
 * 产物（PRD §3.3 L0 索引层；按等级分片，扩到全省道规模时再切省分片，加载接口已兼容）：
 *   data/roads/index/{national,expressway,provincial}.json
 *   data/roads/authoritative/{national,expressway,provincial}.json（原始层 + 官方里程参考值）
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRvwn } from './lib/rvwn.mjs';
import { canonicalRef } from './lib/road-ref.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX_DIR = join(ROOT, 'data/roads/index');
const GEOM_DIR = join(ROOT, 'data/roads/geom');
const AUTH_DIR = join(ROOT, 'data/roads/authoritative');
const mergeGeom = process.argv.includes('--merge') || process.argv.includes('--from-net');
const fromNet = process.argv.includes('--from-net');

/** PBF 省片 slug → 中文省名 */
const SLUG_TO_NAME = {
  anhui: '安徽', beijing: '北京', chongqing: '重庆', fujian: '福建', gansu: '甘肃',
  guangdong: '广东', guangxi: '广西', guizhou: '贵州', hainan: '海南', hebei: '河北',
  heilongjiang: '黑龙江', henan: '河南', hubei: '湖北', hunan: '湖南', inner_mongolia: '内蒙古',
  jiangsu: '江苏', jiangxi: '江西', jilin: '吉林', liaoning: '辽宁', macau: '澳门',
  ningxia: '宁夏', qinghai: '青海', shaanxi: '陕西', shandong: '山东', shanghai: '上海',
  shanxi: '山西', sichuan: '四川', tianjin: '天津', tibet: '西藏', xinjiang: '新疆',
  yunnan: '云南', zhejiang: '浙江', hong_kong: '香港',
};

/** S/X/Y/C 前缀 → class */
function classifyProvincial(ref) {
  if (/^S\d{1,4}$/.test(ref)) return 'provincial';
  if (/^X\d{1,4}$/.test(ref)) return 'county';
  if (/^Y\d{1,4}$/.test(ref)) return 'township';
  if (/^C\d{1,4}$/.test(ref)) return 'village';
  return null;
}

/**
 * 从 RVWN 要素库派生"事实名录"：省道/县道/乡道/村道的编号不是从某份文件抄来的，
 * 而是从全省每一段真实道路的 ref 标签里聚合出来的 —— 这是"县乡村道一条都没有"的解法。
 * 同时回收规划名录之外的 G/E 编号（OSM 有、官方表没有的），标 osm_only 不静默丢弃。
 */
function deriveFromNet() {
  const NET_DIR = join(ROOT, 'data/roads/net');
  if (!existsSync(NET_DIR)) return { provincial: [], extraNational: [], extraExpressway: [], provinces: 0 };
  const shards = readdirSync(NET_DIR).filter((f) => f.endsWith('.rvwn')).sort();
  const map = new Map();
  const extraRoads = new Map();
  // OSM 中真实出现过的编号集合：用于把"官方规划里存在、OSM 尚未出现"的条目
  // 与"OSM 有却装配失败"的条目区分开（门禁只对后者追责）
  const osmRefs = new Set();
  for (const f of shards) {
    const province = SLUG_TO_NAME[f.replace('.rvwn', '')] ?? f.replace('.rvwn', '');
    const r = openRvwn(join(NET_DIR, f));
    for (const w of r.iterateWays()) {
      if (!w.ref) continue;
      for (const rawRef of w.ref.split(';')) {
        const ref = canonicalRef(rawRef);
        osmRefs.add(ref);
        const cls = classifyProvincial(ref);
        if (!cls) {
          const gc = classifyRef(ref);
          if (gc) {
            let e = extraRoads.get(ref);
            if (!e) { e = { ref, class: gc, provinces: [], name: '', lengthKm: 0 }; extraRoads.set(ref, e); }
            if (!e.provinces.includes(province)) e.provinces.push(province);
            e.lengthKm += w.lenM / 1000;
            if (w.name && w.name.length > e.name.length) e.name = w.name;
          }
          continue;
        }
        const key = province + ':' + ref;
        let e = map.get(key);
        if (!e) {
          e = { key, ref, class: cls, provinces: [province], fromPlace: '', toPlace: '', lengthKm: 0, bbox: [0, 0, 0, 0], spotCount: 0, hasGeom: false, source: 'osm_only', status: 'unverified', wayCount: 0, name: '' };
          map.set(key, e);
        }
        e.lengthKm += w.lenM / 1000;
        e.wayCount += 1;
        if (w.name && w.name.length > e.name.length) e.name = w.name;
      }
    }
    r.close();
  }
  const rows = [...map.values()].map((e) => ({ ...e, lengthKm: Math.round(e.lengthKm * 10) / 10 }));
  rows.sort((a, b) => (a.class === b.class ? a.key.localeCompare(b.key) : a.class.localeCompare(b.class)));
  const extraRows = [...extraRoads.values()].map((e) => ({ ...e, lengthKm: Math.round(e.lengthKm * 10) / 10 }));
  return { provincial: rows, extraRoads: extraRows, osmRefs, provinces: shards.length };
}

// ── §3.2 编号主键校验（进库前硬门槛） ────────────────────────────────────────
// 1. G + 1~3 位数字 → national（普通国道）；例外：G + 1~2 位且 < 100（G1~G99）为高速主线
// 2. G + 4 位数字  → expressway（国家高速，G5611 是高速不是国道）
// 3. /^[SXYC]\d{1,4}$/ → 必须带省前缀（"青海:S101"），否则拒绝入库
function classifyRef(ref) {
  if (/^G\d{1,3}$/.test(ref)) {
    return Number(ref.slice(1)) < 100 ? 'expressway' : 'national';
  }
  if (/^G\d{4}$/.test(ref)) return 'expressway';
  // 并行线方位后缀（G15W 常台 / G4E 乐广 / G4N ...），同样属国家高速
  if (/^G\d{1,2}[WEN]$/.test(ref)) return 'expressway';
  return null;
}

function validateEntries(rows, file) {
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.key)) throw new Error(`${file}: 重复主键 ${r.key}`);
    seen.add(r.key);
    if (r.class === 'national' || r.class === 'expressway') {
      if (!/^G\d{1,4}([WEN])?$/.test(r.ref)) throw new Error(`${file}: 非法国道/高速编号 ${r.ref}`);
      const cls = classifyRef(r.ref);
      if (cls !== r.class) {
        throw new Error(`${file}: 编号 ${r.ref} 应为 ${cls}，登记为 ${r.class}`);
      }
    } else if (r.class === 'provincial') {
      if (!/^[SXYC]\d{1,4}$/.test(r.ref)) throw new Error(`${file}: 非法省道编号 ${r.ref}`);
      if (!/^.+:.+$/.test(r.key) || r.key.endsWith(`:${r.ref}`) === false) {
        throw new Error(`${file}: 省道主键必须为「省:编号」，得到 ${r.key}`);
      }
    }
  }
}

// ── 权威名录（2022 规划附件表） ──────────────────────────────────────────────
function loadPlan(file) {
  const p = join(AUTH_DIR, file);
  if (!existsSync(p)) return [];
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(j.roads) ? j.roads : [];
  } catch {
    return [];
  }
}
const planNational = loadPlan('plan-2022-national.json');
const planExpressway = loadPlan('plan-2022-expressway.json');

// ── META：线名 / 官方里程参考值 / 途经省（规划表不含，人工维护逐步补齐） ──────
// 字段：ref → [线名, 途经省(简), 官方里程参考值km(0=未核对)]
const NATIONAL_META = {
  G101: ['京沈线', '北京,河北,辽宁', 909], G102: ['京哈线', '北京,河北,天津,辽宁,吉林,黑龙江', 1337],
  G103: ['京塘线', '北京,天津', 143], G104: ['京福线', '北京,河北,天津,山东,江苏,安徽,浙江,福建', 2420],
  G105: ['京珠线', '北京,河北,山东,河南,安徽,湖北,江西,广东,澳门', 2285], G106: ['京广线', '北京,河北,山东,河南,湖北,湖南,广东', 2292],
  G107: ['京深线', '北京,河北,河南,湖北,湖南,广东', 2490], G108: ['京昆线', '北京,河北,山西,陕西,四川,云南', 3228],
  G109: ['京拉线', '北京,河北,山西,内蒙古,宁夏,甘肃,青海,西藏', 3901], G110: ['京银线', '北京,河北,内蒙古,宁夏', 1156],
  G111: ['京加线', '北京,河北,内蒙古,黑龙江', 1996], G112: ['', '天津,河北', 1085],
  G201: ['鹤大线', '黑龙江,吉林,辽宁', 1964], G202: ['黑大线', '黑龙江,吉林,辽宁', 1818],
  G203: ['明沈线', '黑龙江,吉林,辽宁,内蒙古', 700], G204: ['烟上线', '山东,江苏,上海', 966],
  G205: ['山深线', '河北,天津,山东,江苏,安徽,浙江,福建,广东', 2984], G206: ['烟汕线', '山东,江苏,安徽,江西,广东', 2324],
  G207: ['锡海线', '内蒙古,河北,山西,河南,湖北,湖南,广西,广东', 3738], G208: ['', '内蒙古,山西,河南', 990],
  G209: ['呼北线', '内蒙古,山西,河南,湖北,湖南,广西', 3312], G210: ['包南线', '内蒙古,陕西,四川,重庆,贵州,广西', 3047],
  G211: ['', '宁夏,甘肃,陕西,重庆', 1000], G212: ['兰渝线', '甘肃,四川,重庆,贵州,广西', 1302],
  G213: ['兰磨线', '甘肃,四川,云南', 2800], G214: ['西景线', '青海,西藏,云南', 3256],
  G215: ['柳格线', '甘肃,青海', 660], G216: ['', '新疆', 970],
  G217: ['阿库线', '新疆', 1079], G218: ['伊若线', '新疆', 1067],
  G219: ['新藏线', '新疆,西藏,云南,广西', 10065], G220: ['', '山东,河南,安徽,湖北,江西,广东', 2600],
  G221: ['哈同线', '黑龙江', 558], G222: ['哈伊线', '黑龙江', 333],
  G223: ['海榆东线', '海南', 323], G224: ['海榆中线', '海南', 309],
  G225: ['海榆西线', '海南', 429], G227: ['宁张线', '青海,甘肃', 341],
  G228: ['', '辽宁,河北,天津,山东,江苏,上海,浙江,福建,广东,广西', 6800],
  G301: ['绥满线', '黑龙江,内蒙古', 1580], G302: ['珲乌线', '吉林,内蒙古', 1000],
  G303: ['集锡线', '吉林,辽宁,内蒙古', 1000], G304: ['丹霍线', '辽宁,内蒙古', 850],
  G305: ['', '辽宁,内蒙古', 700], G306: ['', '辽宁,内蒙古', 500],
  G307: ['歧银线', '河北,山西,陕西,宁夏', 1350], G308: ['青石线', '山东,河北', 700],
  G309: ['荣兰线', '山东,河北,山西,陕西,甘肃,宁夏', 2200], G310: ['连天线', '江苏,山东,河南,陕西,甘肃,青海', 1600],
  G311: ['徐西线', '江苏,安徽,河南', 700], G312: ['沪霍线', '上海,江苏,安徽,河南,湖北,陕西,甘肃,宁夏,新疆', 4967],
  G314: ['乌红线', '新疆', 1948], G315: ['西莎线', '青海,新疆', 3063],
  G316: ['福兰线', '福建,江西,湖北,陕西,甘肃,青海', 2915], G317: ['成那线', '四川,西藏', 2043],
  G318: ['沪聂线', '上海,江苏,浙江,安徽,湖北,重庆,四川,西藏', 5476], G319: ['厦成线', '福建,江西,湖南,重庆,四川', 2631],
  G320: ['沪瑞线', '上海,浙江,江西,湖南,贵州,云南', 3695], G321: ['广成线', '广东,广西,贵州,四川', 2220],
  G322: ['', '浙江,江西,湖南,广西', 2300], G323: ['瑞临线', '江西,广东,广西,云南', 2919],
  G324: ['福昆线', '福建,广东,广西,贵州,云南', 2800], G325: ['广南线', '广东,广西', 900],
  G326: ['秀河线', '重庆,贵州,云南', 1000], G327: ['', '山东,江苏', 500],
  G328: ['宁启线', '江苏', 350], G329: ['杭沈线', '浙江', 250],
  G330: ['温寿线', '浙江', 330], G331: ['丹阿线', '辽宁,吉林,黑龙江,内蒙古,新疆', 9000],
  G345: ['', '江苏,安徽,河南,湖北,陕西,甘肃,四川,青海,西藏', 3800], G346: ['', '上海,江苏,安徽,湖北,陕西', 2000],
  G347: ['', '江苏,安徽,河南,湖北,陕西,甘肃,青海', 2500], G348: ['', '湖北,重庆,四川,云南', 2500],
};

const EXPRESSWAY_META = {
  G1: ['京哈高速', '北京,河北,天津,辽宁,吉林,黑龙江', 1200], G2: ['京沪高速', '北京,河北,天津,山东,江苏,上海', 1210],
  G3: ['京台高速', '北京,河北,山东,江苏,安徽,浙江,江西,福建', 2030], G4: ['京港澳高速', '北京,河北,河南,湖北,湖南,广东,澳门', 2285],
  G5: ['京昆高速', '北京,河北,山西,陕西,四川,云南', 2865], G6: ['京藏高速', '北京,河北,内蒙古,宁夏,甘肃,青海,西藏', 3710],
  G7: ['京新高速', '北京,河北,内蒙古,甘肃,新疆', 2768],
  G10: ['绥满高速', '黑龙江,内蒙古', 1300], G11: ['鹤大高速', '黑龙江,吉林,辽宁', 1390],
  G12: ['珲乌高速', '吉林,内蒙古', 890], G15: ['沈海高速', '辽宁,山东,江苏,上海,浙江,福建,广东,海南', 3710],
  G16: ['丹锡高速', '辽宁,内蒙古', 600], G18: ['荣乌高速', '山东,河北,天津,山西,内蒙古', 1800],
  G20: ['青银高速', '山东,河北,山西,陕西,宁夏', 1580], G22: ['青兰高速', '山东,河北,山西,陕西,甘肃', 1800],
  G25: ['长深高速', '吉林,辽宁,内蒙古,河北,天津,山东,江苏,浙江,福建,广东', 3585],
  G30: ['连霍高速', '江苏,山东,河南,陕西,甘肃,新疆', 4395], G35: ['济广高速', '山东,河南,安徽,江西,广东', 2100],
  G36: ['宁洛高速', '江苏,安徽,河南', 720], G40: ['沪陕高速', '上海,江苏,安徽,河南,湖北,陕西', 1490],
  G42: ['沪蓉高速', '上海,江苏,安徽,湖北,重庆,四川', 1960], G45: ['大广高速', '黑龙江,吉林,内蒙古,河北,北京,河南,湖北,江西,广东', 3550],
  G50: ['沪渝高速', '上海,江苏,浙江,安徽,湖北,重庆', 1770], G55: ['二广高速', '内蒙古,山西,河南,湖北,湖南,广东', 2685],
  G56: ['杭瑞高速', '浙江,安徽,江西,湖北,湖南,贵州,云南', 3405], G59: ['呼北高速', '内蒙古,山西,河南,湖北,湖南,广西', 2600],
  G60: ['沪昆高速', '上海,浙江,江西,湖南,贵州,云南', 2730], G65: ['包茂高速', '内蒙古,陕西,四川,重庆,湖南,广西,广东', 3010],
  G69: ['银百高速', '宁夏,甘肃,陕西,重庆,贵州,广西', 2200], G70: ['福银高速', '福建,江西,湖北,陕西,甘肃,宁夏', 2445],
  G72: ['泉南高速', '福建,江西,湖南,广西', 1500], G75: ['兰海高速', '甘肃,四川,重庆,贵州,广西,广东,海南', 2650],
  G76: ['厦蓉高速', '福建,江西,湖南,广西,贵州,四川', 2300], G78: ['汕昆高速', '广东,广西,贵州,云南', 1800],
  G80: ['广昆高速', '广东,广西,云南', 1600], G85: ['渝昆高速', '重庆,四川,云南', 1100],
  G91: ['辽中环线', '辽宁', 400], G92: ['杭州湾环线', '浙江', 450],
  G93: ['成渝环线', '四川,重庆', 1200], G94: ['珠三角环线', '广东', 200],
  G95: ['首都地区环线', '北京,河北,天津', 900], G98: ['海南地区环线', '海南', 613],
  G1511: ['日兰高速', '山东,河南', 470], G1512: ['甬金高速', '浙江', 180],
  G15W: ['常台高速', '江苏,浙江', 400], G1811: ['黄石高速', '河北', 300],
  G1812: ['沧榆高速', '河北,山西,陕西', 600], G2012: ['定武高速', '陕西,甘肃,宁夏', 400],
  G2513: ['淮徐高速', '江苏', 200], G3011: ['柳格高速', '甘肃,青海', 400],
  G4211: ['宁芜高速', '江苏,安徽', 60], G4215: ['蓉遵高速', '四川,贵州', 450],
  G4221: ['沪武高速', '上海,江苏,安徽,湖北', 800], G5011: ['芜合高速', '安徽', 100],
  G5013: ['渝蓉高速', '重庆,四川', 260], G5513: ['长张高速', '湖南', 310],
  G5611: ['大丽高速', '云南', 260], G7211: ['南友高速', '广西', 180],
};

// ── 省道种子（主键 省:编号；几何与名录均为 OSM 众包，status=unverified） ─────
const PROVINCIAL_SEED = [
  ['青海', 'S101', '', '西宁', '久治', 400],
  ['青海', 'S102', '', '西宁', '平安', 40],
  ['青海', 'S202', '', '恰卜恰', '贵德', 100],
  ['四川', 'S211', '', '丹巴', '小金', 60],
  ['四川', 'S217', '', '甘孜', '白玉', 300],
  ['四川', 'S303', '', '映秀', '卧龙', 45],
  ['云南', 'S308', '', '丽江', '香格里拉', 180],
  ['新疆', 'S101', '', '乌鲁木齐', '巴仑台', 300],
  ['西藏', 'S301', '', '拉萨', '羊八井', 80],
  ['甘肃', 'S301', '', '兰州', '刘家峡', 80],
  ['湖南', 'S228', '', '张家界', '武陵源', 40],
  ['河北', 'S272', '', '张北', '沽源', 90],
];

// ── 条目组装 ────────────────────────────────────────────────────────────────
function metaOf(map, ref) {
  const m = map[ref];
  return m ? { name: m[0] || undefined, provinces: m[1] ? m[1].split(',') : [], lengthKm: m[2] } : { name: undefined, provinces: [], lengthKm: 0 };
}

function fromPlan(plan, cls, metaMap) {
  return plan.map((r) => {
    const meta = metaOf(metaMap, r.ref);
    return {
      key: r.ref,
      ref: r.ref,
      name: meta.name,
      class: cls,
      provinces: meta.provinces,
      fromPlace: r.fromPlace,
      toPlace: r.toPlace,
      lengthKm: meta.lengthKm,
      bbox: [0, 0, 0, 0],
      spotCount: 0,
      hasGeom: false,
      source: 'authoritative',
      status: 'ok',
    };
  });
}

const national = fromPlan(planNational, 'national', NATIONAL_META);
const expressway = fromPlan(planExpressway, 'expressway', EXPRESSWAY_META);

const derived = fromNet ? deriveFromNet() : { provincial: [], extraRoads: [], provinces: 0 };

const provincial = (derived.provincial.length ? derived.provincial : PROVINCIAL_SEED.map(([province, ref, name, fromPlace, toPlace, lengthKm]) => ({
  key: `${province}:${ref}`,
  ref,
  name: name || undefined,
  class: 'provincial',
  provinces: [province],
  fromPlace,
  toPlace,
  lengthKm,
  bbox: [0, 0, 0, 0],
  spotCount: 0,
  hasGeom: false,
  source: 'osm_only',
  status: 'unverified',
})));

// 官方规划名录之外的 G/E 编号（OSM 有、规划表没有）：回收但不冒充权威
if (fromNet && derived.extraRoads.length) {
  const known = new Set([...national, ...expressway].map((r) => r.ref));
  for (const e of derived.extraRoads) {
    if (known.has(e.ref)) continue;
    known.add(e.ref);
    const row = {
      key: e.ref,
      ref: e.ref,
      name: e.name || undefined,
      class: e.class,
      provinces: e.provinces,
      fromPlace: '',
      toPlace: '',
      lengthKm: e.lengthKm,
      bbox: [0, 0, 0, 0],
      spotCount: 0,
      hasGeom: false,
      source: 'osm_only',
      status: 'unverified',
    };
    if (e.class === 'expressway') expressway.push(row);
    else national.push(row);
  }
  if (derived.extraRoads.length) {
    console.log('  ↳ 规划名录之外回收 G/E ' + derived.extraRoads.length + ' 条（source=osm_only）');
  }
}

// 标记"OSM 中真实出现过"的编号（门禁只对这类条目追责覆盖率）
if (fromNet && derived.osmRefs) {
  let inOsmCount = 0;
  for (const row of [...national, ...expressway, ...provincial]) {
    if (derived.osmRefs.has(row.ref)) {
      row.inOsm = true;
      inOsmCount += 1;
    }
  }
  console.log('  ↳ 其中 OSM 中真实存在的编号 ' + inOsmCount + ' 条（其余为官方规划在册、OSM 暂无该编号的路段）');
}

validateEntries(national, 'national');
validateEntries(expressway, 'expressway');
validateEntries(provincial, 'provincial');

// ── 并入已抓取的 L1 几何统计（bbox / 实测里程 / hasGeom） ─────────────────────
function mergeGeometry(rows) {
  if (!existsSync(GEOM_DIR)) return;
  const files = readdirSync(GEOM_DIR).filter((f) => f.endsWith('.json') && f !== '_meta.json');
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const f of files) {
    try {
      const g = JSON.parse(readFileSync(join(GEOM_DIR, f), 'utf8'));
      const entry = byKey.get(g.key);
      if (!entry || !Array.isArray(g.points) || g.points.length < 2) continue;
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const [lng, lat] of g.points) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      // bbox 取 points + segments 的并集（整条公路可能由多个连通分量组成）
      for (const seg of [g.points, ...(Array.isArray(g.segments) ? g.segments : [])]) {
        if (!Array.isArray(seg)) continue;
        for (const p of seg) {
          if (p[0] < minLng) minLng = p[0];
          if (p[0] > maxLng) maxLng = p[0];
          if (p[1] < minLat) minLat = p[1];
          if (p[1] > maxLat) maxLat = p[1];
        }
      }
      entry.bbox = [minLng, minLat, maxLng, maxLat];
      // v0.6.0：里程用"去重后里程"（双向分隔道路只计一条），与官方里程可比
      if (Number.isFinite(g.totalKm)) {
        entry.lengthKm = Math.round(g.totalKm * 10) / 10;
      } else {
        const cum = g.cumKm;
        if (Array.isArray(cum) && cum.length === g.points.length) {
          entry.lengthKm = Math.round(cum[cum.length - 1] * 10) / 10;
        }
      }
      if (g.precision) entry.precision = g.precision;
      if (Number.isFinite(g.componentCount)) entry.componentCount = g.componentCount;
      entry.hasGeom = true;
    } catch {
      /* skip broken geometry file */
    }
  }
}

if (mergeGeom) {
  mergeGeometry(national);
  mergeGeometry(expressway);
  mergeGeometry(provincial);
}

// ── 落盘 ─────────────────────────────────────────────────────────────────────
const updated = new Date().toISOString().slice(0, 10);
function writeIndex(file, rows) {
  mkdirSync(INDEX_DIR, { recursive: true });
  writeFileSync(
    join(INDEX_DIR, file),
    JSON.stringify({ version: 1, updated, count: rows.length, roads: rows }, null, 1),
    'utf8',
  );
  console.log(`data/roads/index/${file}  ← ${rows.length} 条`);
}
function writeAuth(file, rows) {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(join(AUTH_DIR, file), JSON.stringify({ version: 1, updated, roads: rows }, null, 1), 'utf8');
}

writeIndex('national.json', national);
writeIndex('expressway.json', expressway);
writeIndex('provincial.json', provincial);

// 原始层：规划表条目 + META 官方里程（verify-road-network 以此为里程比对基准）
writeAuth('national.json', national.map((r) => ({
  ref: r.ref, name: r.name, fromPlace: r.fromPlace, toPlace: r.toPlace, provinces: r.provinces, officialLengthKm: metaOf(NATIONAL_META, r.ref).lengthKm,
})));
writeAuth('expressway.json', expressway.map((r) => ({
  ref: r.ref, name: r.name, fromPlace: r.fromPlace, toPlace: r.toPlace, provinces: r.provinces, officialLengthKm: metaOf(EXPRESSWAY_META, r.ref).lengthKm,
})));
writeAuth('provincial.json', PROVINCIAL_SEED.map(([province, ref, name, fromPlace, toPlace, lengthKm]) => ({ province, ref, name, fromPlace, toPlace, officialLengthKm: lengthKm })));

// v0.6.0：按等级的覆盖 / 精度分布，写入 index/_summary.json 供前端诚实展示
const byClass = {};
for (const [cls, rows] of [['expressway', expressway], ['national', national], ['provincial', provincial]]) {
  const g = rows.filter((r) => r.hasGeom);
  const prec = { A: 0, B: 0, C: 0, X: 0 };
  for (const r of g) if (r.precision && prec[r.precision] !== undefined) prec[r.precision] += 1;
  byClass[cls] = {
    total: rows.length,
    withGeometry: g.length,
    coverage: rows.length ? Math.round((g.length / rows.length) * 1000) / 1000 : 0,
    lengthKm: Math.round(rows.reduce((s, r) => s + (r.hasGeom ? r.lengthKm : 0), 0)),
    precision: prec,
  };
}
writeFileSync(
  join(INDEX_DIR, '_summary.json'),
  JSON.stringify({ version: 1, updated, source: fromNet ? 'osm-pbf-elements' : 'authoritative', byClass }, null, 1),
  'utf8',
);
console.log('data/roads/index/_summary.json ← 按等级覆盖与精度分布');

const geomCount = [...national, ...expressway, ...provincial].filter((r) => r.hasGeom).length;
const metaNamed = national.filter((r) => r.name).length + expressway.filter((r) => r.name).length;
console.log('\n规模：国道 ' + national.length + '/301 · 高速 ' + expressway.length + '/278 · 省道及以下 ' + provincial.length + ' 条');
for (const [cls, s] of Object.entries(byClass)) {
  console.log('  ' + cls.padEnd(11) + ' ' + String(s.total).padStart(6) + ' 条 · 有几何 ' + String(s.withGeometry).padStart(6) +
    '（' + (s.coverage * 100).toFixed(1) + '%）· ' + String(s.lengthKm).padStart(7) + ' km · 精度 A' + s.precision.A + ' B' + s.precision.B + ' C' + s.precision.C + ' X' + s.precision.X);
}
console.log(`元数据：线名/官方里程已补 ${metaNamed} 条（其余 lengthKm=0 待核对，verify 跳过比对）`);
console.log(`已挂几何：${geomCount} 条${mergeGeom ? '' : '（未传 --merge，未扫描 geom/）'}`);
console.log('诚实边界：名录来自 2022 规划官方方案表（全量）；里程与线名仅经典线有参考值。');
