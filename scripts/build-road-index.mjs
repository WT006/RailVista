/**
 * 万里路书 · 全国公路旅游网 —— L0 索引构建（PRD §3 Step 1 + §3.2 校验）。
 *
 * 用法：
 *   node scripts/build-road-index.mjs            # 权威种子 → data/roads/index/
 *   node scripts/build-road-index.mjs --merge    # 额外并入 data/roads/geom/*.json 的几何统计
 *
 * 产物（PRD §3.3 L0 索引层；按等级分片而非按省分片——种子规模下省分片无意义，
 * 目录约定与加载方式不变，后续扩容到全省道时再切省分片）：
 *   data/roads/index/national.json      普通国道（目标 301 条，当前为高置信子集）
 *   data/roads/index/expressway.json    国家高速（目标 278 条，当前为高置信子集）
 *   data/roads/index/provincial.json    省道（编号跨省重复，主键 省:编号）
 *   data/roads/authoritative/*.json     权威名录原始层（编号/线名/起终点/官方里程）
 *
 * 诚实边界（PRD §3.1，必须写进数据与 UI）：
 *   - 本脚本内置的种子名录为「高置信经典骨架 + 2013 规划已知新增」，未到 301/278 全量，
 *     全量名录需《国家公路网规划》附表逐条核对（待办，见报告）；
 *   - lengthKm 无几何时为官方里程参考值（估算），hasGeom=false 的条目不可画线；
 *   - 省道种子标记 status=unverified，几何来自 OSM 众包还原。
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX_DIR = join(ROOT, 'data/roads/index');
const GEOM_DIR = join(ROOT, 'data/roads/geom');
const AUTH_DIR = join(ROOT, 'data/roads/authoritative');
const mergeGeom = process.argv.includes('--merge');

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

// ── 普通国道种子（12 放射 + 经典纵线 + 经典横线 + 2013 已知新增） ─────────────
// 字段：[ref, 线名, 起点, 终点, 途经省(简), 官方里程参考值km(0=未核对)]
const NATIONAL_SEED = [
  // 首都放射线（12 条）
  ['G101', '京沈线', '北京', '沈阳', '北京,河北,辽宁', 909],
  ['G102', '京哈线', '北京', '抚远', '北京,河北,天津,辽宁,吉林,黑龙江', 1337],
  ['G103', '京塘线', '北京', '天津滨海新区', '北京,天津', 143],
  ['G104', '京福线', '北京', '福州', '北京,河北,天津,山东,江苏,安徽,浙江,福建', 2420],
  ['G105', '京珠线', '北京', '澳门', '北京,河北,山东,河南,安徽,湖北,江西,广东,澳门', 2285],
  ['G106', '京广线', '北京', '广州', '北京,河北,山东,河南,湖北,湖南,广东', 2292],
  ['G107', '京深线', '北京', '深圳', '北京,河北,河南,湖北,湖南,广东', 2490],
  ['G108', '京昆线', '北京', '昆明', '北京,河北,山西,陕西,四川,云南', 3228],
  ['G109', '京拉线', '北京', '拉萨', '北京,河北,山西,内蒙古,宁夏,甘肃,青海,西藏', 3901],
  ['G110', '京银线', '北京', '青铜峡', '北京,河北,内蒙古,宁夏', 1156],
  ['G111', '京加线', '北京', '漠河', '北京,河北,内蒙古,黑龙江', 1996],
  ['G112', '', '天津', '宣化', '天津,河北', 1085],
  // 北南纵线（经典 G201~G228 + 2013 已知新增）
  ['G201', '鹤大线', '鹤岗', '大连', '黑龙江,吉林,辽宁', 1964],
  ['G202', '黑大线', '黑河', '旅顺', '黑龙江,吉林,辽宁', 1818],
  ['G203', '明沈线', '明水', '沈阳', '黑龙江,吉林,辽宁,内蒙古', 700],
  ['G204', '烟上线', '烟台', '上海', '山东,江苏,上海', 966],
  ['G205', '山深线', '山海关', '深圳', '河北,天津,山东,江苏,安徽,浙江,福建,广东', 2984],
  ['G206', '烟汕线', '烟台', '汕头', '山东,江苏,安徽,江西,广东', 2324],
  ['G207', '锡海线', '锡林浩特', '徐闻', '内蒙古,河北,山西,河南,湖北,湖南,广西,广东', 3738],
  ['G208', '', '二连浩特', '淅川', '内蒙古,山西,河南', 990],
  ['G209', '呼北线', '呼和浩特', '北海', '内蒙古,山西,河南,湖北,湖南,广西', 3312],
  ['G210', '包南线', '包头', '南宁', '内蒙古,陕西,四川,重庆,贵州,广西', 3047],
  ['G211', '', '银川', '重庆', '宁夏,甘肃,陕西,重庆', 1000],
  ['G212', '兰渝线', '兰州', '龙邦', '甘肃,四川,重庆,贵州,广西', 1302],
  ['G213', '兰磨线', '兰州', '磨憨', '甘肃,四川,云南', 2800],
  ['G214', '西景线', '西宁', '勐腊', '青海,西藏,云南', 3256],
  ['G215', '柳格线', '马鬃山', '格尔木', '甘肃,青海', 660],
  ['G216', '', '阿勒泰', '库尔勒', '新疆', 970],
  ['G217', '阿库线', '阿勒泰', '库车', '新疆', 1079],
  ['G218', '伊若线', '伊宁', '若羌', '新疆', 1067],
  ['G219', '新藏线', '喀纳斯', '东兴', '新疆,西藏,云南,广西', 10065],
  ['G220', '', '东营', '深圳', '山东,河南,安徽,湖北,江西,广东', 2600],
  ['G221', '哈同线', '哈尔滨', '同江', '黑龙江', 558],
  ['G222', '哈伊线', '哈尔滨', '伊春', '黑龙江', 333],
  ['G223', '海榆东线', '海口', '三亚', '海南', 323],
  ['G224', '海榆中线', '海口', '三亚', '海南', 309],
  ['G225', '海榆西线', '海口', '三亚', '海南', 429],
  ['G227', '宁张线', '西宁', '张掖', '青海,甘肃', 341],
  ['G228', '', '丹东', '东兴', '辽宁,河北,天津,山东,江苏,上海,浙江,福建,广东,广西', 6800],
  ['G240', '', '保定', '台山', '河北,山东,河南,湖北,湖南,广东', 2200],
  ['G331', '丹阿线', '丹东', '阿勒泰', '辽宁,吉林,黑龙江,内蒙古,新疆', 9000],
  ['G332', '', '虎林', '额尔古纳', '黑龙江,内蒙古', 1000],
  // 东西横线（经典 G301~G330 + 2013 已知新增）
  ['G301', '绥满线', '绥芬河', '满洲里', '黑龙江,内蒙古', 1580],
  ['G302', '珲乌线', '珲春', '乌兰浩特', '吉林,内蒙古', 1000],
  ['G303', '集锡线', '集安', '锡林浩特', '吉林,辽宁,内蒙古', 1000],
  ['G304', '丹霍线', '丹东', '霍林郭勒', '辽宁,内蒙古', 850],
  ['G305', '', '庄河', '林西', '辽宁,内蒙古', 700],
  ['G306', '', '绥中', '克什克腾旗', '辽宁,内蒙古', 500],
  ['G307', '歧银线', '黄骅', '银川', '河北,山西,陕西,宁夏', 1350],
  ['G308', '青石线', '青岛', '石家庄', '山东,河北', 700],
  ['G309', '荣兰线', '荣成', '兰州', '山东,河北,山西,陕西,甘肃,宁夏', 2200],
  ['G310', '连天线', '连云港', '共和', '江苏,山东,河南,陕西,甘肃,青海', 1600],
  ['G311', '徐西线', '徐州', '西峡', '江苏,安徽,河南', 700],
  ['G312', '沪霍线', '上海', '霍尔果斯', '上海,江苏,安徽,河南,湖北,陕西,甘肃,宁夏,新疆', 4967],
  ['G314', '乌红线', '乌鲁木齐', '红其拉甫', '新疆', 1948],
  ['G315', '西莎线', '西宁', '喀什', '青海,新疆', 3063],
  ['G316', '福兰线', '福州', '同仁', '福建,江西,湖北,陕西,甘肃,青海', 2915],
  ['G317', '成那线', '成都', '噶尔', '四川,西藏', 2043],
  ['G318', '沪聂线', '上海', '聂拉木', '上海,江苏,浙江,安徽,湖北,重庆,四川,西藏', 5476],
  ['G319', '厦成线', '厦门', '成都', '福建,江西,湖南,重庆,四川', 2631],
  ['G320', '沪瑞线', '上海', '瑞丽', '上海,浙江,江西,湖南,贵州,云南', 3695],
  ['G321', '广成线', '广州', '成都', '广东,广西,贵州,四川', 2220],
  ['G322', '', '瑞安', '友谊关', '浙江,江西,湖南,广西', 2300],
  ['G323', '瑞临线', '瑞金', '清水河', '江西,广东,广西,云南', 2919],
  ['G324', '福昆线', '福州', '昆明', '福建,广东,广西,贵州,云南', 2800],
  ['G325', '广南线', '广州', '南宁', '广东,广西', 900],
  ['G326', '秀河线', '秀山', '河口', '重庆,贵州,云南', 1000],
  ['G327', '', '菏泽', '连云港', '山东,江苏', 500],
  ['G328', '宁启线', '南京', '启东', '江苏', 350],
  ['G329', '杭沈线', '杭州', '朱家尖', '浙江', 250],
  ['G330', '温寿线', '温州', '寿昌', '浙江', 330],
  ['G345', '', '启东', '那曲', '江苏,安徽,河南,湖北,陕西,甘肃,四川,青海,西藏', 3800],
  ['G346', '', '上海', '安康', '上海,江苏,安徽,湖北,陕西', 2000],
  ['G347', '', '南京', '德令哈', '江苏,安徽,河南,湖北,陕西,甘肃,青海', 2500],
  ['G348', '', '武汉', '大理', '湖北,重庆,四川,云南', 2500],
];

// ── 国家高速种子（7 放射 + 经典纵/横 + 已知并行/联络线） ────────────────────
const EXPRESSWAY_SEED = [
  // 首都放射线（7 条）
  ['G1', '京哈高速', '北京', '哈尔滨', '北京,河北,天津,辽宁,吉林,黑龙江', 1200],
  ['G2', '京沪高速', '北京', '上海', '北京,河北,天津,山东,江苏,上海', 1210],
  ['G3', '京台高速', '北京', '台北', '北京,河北,山东,江苏,安徽,浙江,江西,福建', 2030],
  ['G4', '京港澳高速', '北京', '澳门', '北京,河北,河南,湖北,湖南,广东,澳门', 2285],
  ['G5', '京昆高速', '北京', '昆明', '北京,河北,山西,陕西,四川,云南', 2865],
  ['G6', '京藏高速', '北京', '拉萨', '北京,河北,内蒙古,宁夏,甘肃,青海,西藏', 3710],
  ['G7', '京新高速', '北京', '乌鲁木齐', '北京,河北,内蒙古,甘肃,新疆', 2768],
  // 北南纵线
  ['G11', '鹤大高速', '鹤岗', '大连', '黑龙江,吉林,辽宁', 1390],
  ['G15', '沈海高速', '沈阳', '海口', '辽宁,山东,江苏,上海,浙江,福建,广东,海南', 3710],
  ['G25', '长深高速', '长春', '深圳', '吉林,辽宁,内蒙古,河北,天津,山东,江苏,浙江,福建,广东', 3585],
  ['G35', '济广高速', '济南', '广州', '山东,河南,安徽,江西,广东', 2100],
  ['G45', '大广高速', '大庆', '广州', '黑龙江,吉林,内蒙古,河北,北京,河南,湖北,江西,广东', 3550],
  ['G55', '二广高速', '二连浩特', '广州', '内蒙古,山西,河南,湖北,湖南,广东', 2685],
  ['G59', '呼北高速', '呼和浩特', '北海', '内蒙古,山西,河南,湖北,湖南,广西', 2600],
  ['G65', '包茂高速', '包头', '茂名', '内蒙古,陕西,四川,重庆,湖南,广西,广东', 3010],
  ['G75', '兰海高速', '兰州', '海口', '甘肃,四川,重庆,贵州,广西,广东,海南', 2650],
  ['G85', '渝昆高速', '重庆', '昆明', '重庆,四川,云南', 1100],
  // 东西横线
  ['G10', '绥满高速', '绥芬河', '满洲里', '黑龙江,内蒙古', 1300],
  ['G12', '珲乌高速', '珲春', '乌兰浩特', '吉林,内蒙古', 890],
  ['G16', '丹锡高速', '丹东', '锡林浩特', '辽宁,内蒙古', 600],
  ['G18', '荣乌高速', '荣成', '乌海', '山东,河北,天津,山西,内蒙古', 1800],
  ['G20', '青银高速', '青岛', '银川', '山东,河北,山西,陕西,宁夏', 1580],
  ['G22', '青兰高速', '青岛', '兰州', '山东,河北,山西,陕西,甘肃', 1800],
  ['G30', '连霍高速', '连云港', '霍尔果斯', '江苏,山东,河南,陕西,甘肃,新疆', 4395],
  ['G36', '宁洛高速', '南京', '洛阳', '江苏,安徽,河南', 720],
  ['G40', '沪陕高速', '上海', '西安', '上海,江苏,安徽,河南,湖北,陕西', 1490],
  ['G42', '沪蓉高速', '上海', '成都', '上海,江苏,安徽,湖北,重庆,四川', 1960],
  ['G50', '沪渝高速', '上海', '重庆', '上海,江苏,浙江,安徽,湖北,重庆', 1770],
  ['G56', '杭瑞高速', '杭州', '瑞丽', '浙江,安徽,江西,湖北,湖南,贵州,云南', 3405],
  ['G60', '沪昆高速', '上海', '昆明', '上海,浙江,江西,湖南,贵州,云南', 2730],
  ['G70', '福银高速', '福州', '银川', '福建,江西,湖北,陕西,甘肃,宁夏', 2445],
  ['G72', '泉南高速', '泉州', '南宁', '福建,江西,湖南,广西', 1500],
  ['G76', '厦蓉高速', '厦门', '成都', '福建,江西,湖南,广西,贵州,四川', 2300],
  ['G78', '汕昆高速', '汕头', '昆明', '广东,广西,贵州,云南', 1800],
  ['G80', '广昆高速', '广州', '昆明', '广东,广西,云南', 1600],
  ['G94', '珠三角环线', '深圳', '深圳', '广东', 200],
  ['G98', '海南环线', '海口', '海口', '海南', 613],
  // 并行线 / 联络线（4 位编号）
  ['G0321', '德上高速', '德州', '上饶', '山东,河南,安徽,江西', 1300],
  ['G0421', '许广高速', '许昌', '广州', '河南,湖北,湖南,广东', 1100],
  ['G1511', '日兰高速', '日照', '兰考', '山东,河南', 470],
  ['G1512', '甬金高速', '宁波', '金华', '浙江', 180],
  ['G15W', '常台高速', '常熟', '台州', '江苏,浙江', 400],
  ['G1811', '黄石高速', '黄骅', '石家庄', '河北', 300],
  ['G1812', '沧榆高速', '沧州', '榆林', '河北,山西,陕西', 600],
  ['G2012', '定武高速', '定边', '武威', '陕西,甘肃,宁夏', 400],
  ['G2513', '淮徐高速', '淮安', '徐州', '江苏', 200],
  ['G3011', '柳格高速', '柳园', '格尔木', '甘肃,青海', 400],
  ['G4211', '宁芜高速', '南京', '芜湖', '江苏,安徽', 60],
  ['G4215', '蓉遵高速', '成都', '遵义', '四川,贵州', 450],
  ['G4221', '沪武高速', '上海', '武汉', '上海,江苏,安徽,湖北', 800],
  ['G5011', '芜合高速', '芜湖', '合肥', '安徽', 100],
  ['G5013', '渝蓉高速', '重庆', '成都', '重庆,四川', 260],
  ['G5513', '长张高速', '长沙', '张家界', '湖南', 310],
  ['G5611', '大丽高速', '大理', '丽江', '云南', 260],
  ['G7211', '南友高速', '南宁', '友谊关', '广西', 180],
];

// ── 省道种子（主键 省:编号；几何与名录均为 OSM 众包，status=unverified） ─────
const PROVINCIAL_SEED = [
  // [省, ref, 线名, 起点, 终点, 里程估算]
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

// ── 种子 → RoadIndexEntry ────────────────────────────────────────────────────
function nationalEntry([ref, name, fromPlace, toPlace, provinces, lengthKm]) {
  return {
    key: ref,
    ref,
    name: name || undefined,
    class: 'national',
    provinces: provinces ? provinces.split(',') : [],
    fromPlace,
    toPlace,
    lengthKm,
    bbox: [0, 0, 0, 0],
    spotCount: 0,
    hasGeom: false,
    source: 'authoritative',
    status: 'ok',
  };
}

function expresswayEntry([ref, name, fromPlace, toPlace, provinces, lengthKm]) {
  return {
    key: ref,
    ref,
    name: name || undefined,
    class: 'expressway',
    provinces: provinces ? provinces.split(',') : [],
    fromPlace,
    toPlace,
    lengthKm,
    bbox: [0, 0, 0, 0],
    spotCount: 0,
    hasGeom: false,
    source: 'authoritative',
    status: 'ok',
  };
}

function provincialEntry([province, ref, name, fromPlace, toPlace, lengthKm]) {
  return {
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
  };
}

const national = NATIONAL_SEED.map(nationalEntry);
const expressway = EXPRESSWAY_SEED.map(expresswayEntry);
const provincial = PROVINCIAL_SEED.map(provincialEntry);

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
      entry.bbox = [minLng, minLat, maxLng, maxLat];
      const cum = g.cumKm;
      if (Array.isArray(cum) && cum.length === g.points.length) {
        entry.lengthKm = Math.round(cum[cum.length - 1] * 10) / 10;
      }
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
  writeFileSync(
    join(AUTH_DIR, file),
    JSON.stringify(
      {
        version: 1,
        updated,
        note: '高置信种子名录（经典 1981 骨架 + 2013 规划已知新增）；全量 301/278 需《国家公路网规划》附表核对',
        roads: rows,
      },
      null,
      1,
    ),
    'utf8',
  );
}

writeIndex('national.json', national);
writeIndex('expressway.json', expressway);
writeIndex('provincial.json', provincial);
writeAuth('national.json', NATIONAL_SEED.map(([ref, name, fromPlace, toPlace, provinces, lengthKm]) => ({ ref, name, fromPlace, toPlace, provinces, officialLengthKm: lengthKm })));
writeAuth('expressway.json', EXPRESSWAY_SEED.map(([ref, name, fromPlace, toPlace, provinces, lengthKm]) => ({ ref, name, fromPlace, toPlace, provinces, officialLengthKm: lengthKm })));
writeAuth('provincial.json', PROVINCIAL_SEED.map(([province, ref, name, fromPlace, toPlace, lengthKm]) => ({ province, ref, name, fromPlace, toPlace, officialLengthKm: lengthKm })));

const geomCount = [...national, ...expressway, ...provincial].filter((r) => r.hasGeom).length;
console.log(`\n种子规模：国道 ${national.length}/301 · 高速 ${expressway.length}/278 · 省道 ${provincial.length}/3000+`);
console.log(`已挂几何：${geomCount} 条${mergeGeom ? '' : '（未传 --merge，未扫描 geom/）'}`);
console.log('诚实边界：种子为高置信子集，非全量名录；见 PRD §3.1 与数据头注释。');
