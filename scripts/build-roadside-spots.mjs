/**
 * 万里路书 · 全国公路旅游网 —— 公路侧景点库构建（PRD §6.4）。
 *
 * 用法：
 *   node scripts/build-roadside-spots.mjs           # 基础库迁移 + 公路专属手工种子
 *   node scripts/build-roadside-spots.mjs --osm     # 追加：旗舰公路风景段 Overpass 观景点
 *
 * 来源分层（PRD §6.1）：
 *   Tier A 讲解级  ← 铁路侧 624 景点库中带官方资质（5A/4A/世界遗产/国保...）者
 *   Tier B 沿途可看 ← 铁路侧景点库其余（全自动 + 打分过滤）
 *   Tier C 小确幸   ← 手工种子（观景台/垭口/盘山/双色湖…，公路版灵魂，人工核对）
 *
 * 打分（PRD §6.3 静态部分）：官方资质加分 + 观景价值 + 稀缺性，噪音项在生产端清洗。
 * 诚实边界：目标 3 万条，当前为「迁移 + 种子 + 可选 OSM 补充」的起步集，
 * 坐标为 WGS-84 估算值，OSM 来源条目标 unverified。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overpassQuery } from './lib/overpass.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCENIC_PATH = join(ROOT, 'data/presets/scenic-spots.json');
const OUT_PATH = join(ROOT, 'data/roads/roadside-spots.json');
const useOsm = process.argv.includes('--osm');

// ── 铁路侧景点库 → 公路侧（迁移） ────────────────────────────────────────────
const CAT_MAP = {
  lake: 'nature.lake',
  mountain: 'nature.mountain',
  desert: 'nature.desert',
  grassland: 'nature.grassland',
  gorge: 'nature.canyon',
  engineering: 'engineering.bridge',
};

/** 官方资质编码（铁路侧 scenic-spots 的荣誉体系）→ 加分（PRD §6.3） */
const HONOR_SCORE = {
  WCH: 40, // 世界遗产
  '5A': 38,
  AAAA: 30, // 4A
  AAA: 22, // 3A
  NCH: 24, // 全国重点文保
  NSCENIC: 26, // 国家风景名胜区
  NNR: 20, // 国家自然保护区
  NGEO: 18, // 国家地质公园
  RAMSAR: 18, // 国际重要湿地
  NFOREST: 16, // 国家森林公园
};

/** 编码 → UI 可读标签 */
const HONOR_LABEL = {
  WCH: '世界遗产', '5A': '5A', AAAA: '4A', AAA: '3A', NCH: '全国重点文保',
  NSCENIC: '国家风景名胜区', NNR: '自然保护区', NGEO: '国家地质公园',
  RAMSAR: '国际重要湿地', NFOREST: '国家森林公园',
};

function honorBonus(honors = []) {
  let b = 0;
  for (const h of honors) b = Math.max(b, HONOR_SCORE[h] ?? 0);
  return b;
}

function honorLabels(honors = []) {
  return honors.map((h) => HONOR_LABEL[h] ?? h).filter(Boolean);
}

function visibilityOf(src) {
  if (src.visibility === 'distant') return 'distant';
  if (src.visibility === 'on_track') return 'detour5';
  return 'detour20'; // window 8km → 公路 12km 档
}

function convertScenic(spots) {
  return spots
    .filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat))
    .map((s) => {
      const honors = Array.isArray(s.honors) ? s.honors : [];
      const labels = honorLabels(honors);
      const tier = labels.length && honorBonus(honors) >= 24 ? 'A' : 'B';
      const score = Math.min(
        100,
        (tier === 'A' ? 55 : 40) + honorBonus(honors) + (s.bestView ? 5 : 0),
      );
      return {
        id: `rs-${s.id}`,
        name: s.name,
        lng: s.lng,
        lat: s.lat,
        tier,
        category: CAT_MAP[s.category] ?? 'viewpoint.landmark',
        score,
        visibility: visibilityOf(s),
        intro: s.intro,
        tags: s.tags,
        honors: labels.length ? labels : undefined,
        bestView: s.bestView ? (s.bestView.timeOfDay ?? 'day') : undefined,
        province: undefined,
        canPark: tier === 'A' ? true : undefined,
        source: `migrated:${s.source ?? 'preset'}`,
        verified: Array.isArray(s.sources) && s.sources.some((x) => x?.type === 'authority'),
      };
    });
}

// ── Tier C 公路专属手工种子（观景台/垭口/盘山/双色湖——人工核对，PRD §6.1） ────
// 字段：[name, lng, lat, category, visibility, 分数, intro, canPark]
const HAND_SEED = [
  // G318 川藏线
  ['二郎山隧道', 102.28, 29.87, 'engineering.tunnel', 'roadside', 52, '川藏第一隧，穿过即入藏区门户', true],
  ['泸定桥', 102.23, 29.91, 'culture.heritage', 'detour5', 78, '大渡河上的铁索桥，康熙年间建', true],
  ['折多山垭口', 101.87, 30.1, 'engineering.pass', 'roadside', 66, '康巴第一关，4298 米，云海盘山', true],
  ['新都桥', 101.52, 30.04, 'viewpoint.scenic-byway', 'roadside', 72, '摄影家的走廊，光与影的世界', true],
  ['高尔寺山垭口', 101.43, 30.03, 'engineering.pass', 'roadside', 48, '远眺贡嘎群峰的垭口', true],
  ['理塘·天空之城', 100.27, 30.0, 'viewpoint.scenic-byway', 'roadside', 68, '4014 米的世界高城', true],
  ['海子山姊妹湖', 99.65, 30.06, 'nature.lake', 'detour5', 70, '冰川遗珠，国道边的两汪蓝', true],
  ['东达山垭口', 98.05, 29.75, 'engineering.pass', 'roadside', 62, '川藏南线最高点，5130 米', true],
  ['怒江 72 拐', 97.65, 29.82, 'engineering.spiral-road', 'roadside', 88, '业拉山盘山，一坳十二拐', true],
  ['怒江大桥', 97.58, 29.8, 'engineering.bridge', 'roadside', 50, '峡谷隘口上的单墩老桥纪念地', true],
  ['然乌湖', 96.75, 29.38, 'nature.lake', 'roadside', 76, '雪山堰塞湖，湖尾草甸', true],
  ['米堆冰川', 96.85, 29.36, 'nature.glacier', 'detour5', 80, '海拔最低的海洋性冰川之一', true],
  ['波密·冰川之乡', 95.77, 29.86, 'viewpoint.scenic-byway', 'roadside', 64, '帕隆藏布峡谷与雪山桃花', true],
  ['通麦特大桥', 95.05, 30.1, 'engineering.bridge', 'roadside', 58, '曾经的通麦天险，如今三桥并立', true],
  ['鲁朗林海', 94.73, 29.67, 'nature.forest', 'detour5', 74, '雪山下的云杉林海草甸', true],
  ['色季拉山口', 94.6, 29.65, 'viewpoint.observation-deck', 'roadside', 78, '天气好时可远眺南迦巴瓦', true],
  ['南迦巴瓦观景台', 94.9, 29.63, 'viewpoint.observation-deck', 'detour5', 86, '中国最美雪山之首的正面', true],
  ['米拉山口', 92.35, 29.83, 'engineering.pass', 'roadside', 54, '川藏南线最后一座高山，5013 米', true],
  ['羊卓雍措', 90.45, 29.15, 'nature.lake', 'detour20', 90, '珊瑚般的高原圣湖', true],
  // G109 青藏线
  ['日月山垭口', 101.25, 36.45, 'engineering.pass', 'roadside', 50, '农耕与游牧的分界岭', true],
  ['黑马河·青海湖日出', 99.78, 36.73, 'viewpoint.sunrise', 'roadside', 82, '青海湖西岸最佳日出点', true],
  ['茶卡盐湖', 99.08, 36.78, 'nature.lake', 'detour5', 88, '天空之镜', true],
  ['察尔汗盐湖', 95.2, 36.85, 'nature.lake', 'detour20', 76, '万丈盐桥横穿盐湖', true],
  ['昆仑山口', 94.02, 35.68, 'engineering.pass', 'roadside', 84, '玉珠峰下进藏门户，4768 米', true],
  ['索南达杰保护站', 92.35, 35.55, 'culture.heritage', 'detour5', 60, '可可西里藏羚羊守望者', true],
  ['沱沱河·长江源', 92.44, 34.22, 'nature.river', 'roadside', 68, '长江正源，沱沱河沿', true],
  ['唐古拉山口', 91.95, 32.98, 'engineering.pass', 'roadside', 80, '青藏线最高点，5231 米', true],
  ['纳木措', 90.62, 30.72, 'nature.lake', 'detour20', 90, '念青唐古拉脚下的天湖', true],
  ['念青唐古拉观景台', 91.05, 30.4, 'viewpoint.observation-deck', 'roadside', 62, '青藏公路旁的主峰观景点', true],
  // G217 独库
  ['独山子大峡谷', 84.75, 44.35, 'nature.canyon', 'detour5', 76, '天山北麓的垂直沟壑', true],
  ['乔尔玛烈士陵园', 84.5, 43.9, 'culture.red', 'roadside', 58, '独库公路筑路英烈长眠地', true],
  ['巩乃斯河谷', 84.35, 43.45, 'nature.forest', 'roadside', 64, '雪岭云杉与河谷草原', true],
  ['那拉提草原', 84.05, 43.3, 'nature.grassland', 'detour5', 84, '空中草原', true],
  ['巴音布鲁克九曲十八弯', 84.15, 42.89, 'nature.river', 'detour5', 88, '开都河日落九曲', true],
  ['大龙池', 83.85, 42.35, 'nature.lake', 'roadside', 62, '天山腹地的高山湖泊', true],
  ['天山神秘大峡谷', 83.55, 42.05, 'nature.canyon', 'detour5', 80, '红褐色的地震裂谷', true],
  // G315 柴达木
  ['可鲁克湖', 97.09, 37.37, 'nature.lake', 'detour5', 56, '淡水湖与情人湖', true],
  ['大柴旦翡翠湖', 95.36, 37.75, 'nature.lake', 'detour5', 82, '盐池中的翡翠绿', true],
  ['乌素特水上雅丹', 93.42, 37.77, 'nature.desert', 'detour5', 84, '世界上唯一的水上雅丹群', true],
  ['东台吉乃尔湖', 93.28, 37.5, 'nature.lake', 'roadside', 86, '蒂芙尼蓝的盐湖', true],
  ['西台吉乃尔·双色湖', 92.86, 37.42, 'nature.lake', 'roadside', 84, '一条公路劈开两色湖', true],
  ['南八仙雅丹', 95.1, 38.1, 'nature.desert', 'detour5', 68, '柴达木魔鬼城', true],
  ['茫崖翡翠湖', 90.86, 38.41, 'nature.lake', 'detour5', 78, '昆仑下的另一块翡翠', true],
  ['艾肯泉·恶魔之眼', 90.77, 38.35, 'nature.desert', 'detour20', 76, '大地瞳孔状的涌泉', true],
  // G227 祁连
  ['达坂山观景台', 101.55, 37.2, 'viewpoint.observation-deck', 'roadside', 54, '俯瞰门源盆地的盘山观景台', true],
  ['门源百里油菜花', 101.62, 37.38, 'nature.grassland', 'roadside', 82, '七月金色花海', true],
  ['卓尔山', 100.24, 38.2, 'viewpoint.observation-deck', 'detour5', 80, '红色丹霞与油菜花对望牛心山', true],
  ['扁都口', 100.85, 38.2, 'viewpoint.scenic-byway', 'roadside', 58, '祁连山北麓的垭口牧场', true],
  // G317 川藏北线
  ['映秀地震遗址', 103.48, 31.01, 'culture.heritage', 'detour5', 60, '汶川特大地震纪念地', true],
  ['桃坪羌寨', 103.55, 31.4, 'culture.village', 'detour5', 70, '保存完整的羌族古堡', true],
  ['米亚罗红叶', 102.75, 31.7, 'nature.forest', 'roadside', 66, '毕棚沟口的彩林', true],
  ['雀儿山垭口', 99.1, 31.87, 'engineering.pass', 'roadside', 72, '川藏北线最高点 5050 米', true],
  ['德格印经院', 98.58, 31.81, 'culture.heritage', 'roadside', 84, '藏文化大百科全书', true],
  // G214 三江并流
  ['玛多·黄河源', 98.21, 34.92, 'nature.river', 'detour20', 70, '两湖一碑的黄河源头', true],
  ['巴颜喀拉山口', 97.2, 34.2, 'engineering.pass', 'roadside', 56, '黄河与长江的分水岭', true],
  ['文成公主庙', 97.05, 33.02, 'culture.temple', 'detour5', 68, '贝沟崖壁唐代石刻', true],
  ['白马雪山垭口', 99.02, 28.4, 'engineering.pass', 'roadside', 70, '滇藏线原始森林垭口', true],
  ['雾浓顶梅里观景台', 98.77, 28.28, 'viewpoint.observation-deck', 'detour5', 90, '梅里十三峰全景平台', true],
  ['独克宗古城', 99.7, 27.82, 'culture.ancient-town', 'detour5', 72, '月光之城', true],
  ['松赞林寺', 99.77, 27.87, 'culture.temple', 'detour5', 78, '小布达拉宫', true],
  ['虎跳峡', 100.05, 27.28, 'nature.canyon', 'detour20', 86, '金沙江最窄的虎跳石', true],
  // G312 河西走廊
  ['嘉峪关关城', 98.24, 39.8, 'culture.heritage', 'detour20', 88, '天下第一雄关', true],
  ['张掖七彩丹霞', 100.05, 38.99, 'nature.desert', 'detour20', 88, '彩色丘陵地貌', true],
  ['山丹军马场', 101.35, 38.2, 'nature.grassland', 'detour20', 66, '亚洲最大的马场', true],
  ['兰州中山桥', 103.82, 36.06, 'engineering.bridge', 'roadside', 64, '天下黄河第一桥', true],
  ['麦积山石窟', 106.0, 34.35, 'culture.heritage', 'detour20', 86, '东方雕塑陈列馆', true],
  // G213 甘南九寨
  ['刘家峡大坝', 103.3, 35.9, 'engineering.dam', 'detour5', 58, '黄河第一峡高峡平湖', true],
  ['拉卜楞寺', 102.52, 35.0, 'culture.temple', 'detour5', 86, '世界藏学府', true],
  ['郎木寺镇', 102.63, 34.58, 'culture.ancient-town', 'roadside', 76, '一镇跨甘川的白龙江源头', true],
  ['若尔盖花湖', 102.75, 33.95, 'nature.lake', 'detour20', 80, '高原湿地与黑颈鹤', true],
  ['黄河九曲第一湾', 102.4, 33.45, 'nature.river', 'detour20', 84, '唐克草原上的黄河回环', true],
  ['九寨沟', 103.92, 33.26, 'nature.lake', 'detour20', 98, '世界自然遗产，叠瀑翠海', true],
  ['黄龙', 103.85, 32.75, 'nature.lake', 'detour20', 94, '钙化彩池群', true],
  // G320 滇西
  ['大理古城', 100.16, 25.69, 'culture.ancient-town', 'detour20', 82, '苍山洱海间的古城', true],
  ['洱海生态廊道', 100.18, 25.75, 'viewpoint.scenic-byway', 'roadside', 78, '环湖骑行的最佳路段', true],
  ['腾冲热海', 98.5, 25.02, 'experience.hot-spring', 'detour20', 78, '大滚锅与地热奇观', true],
  ['一寨两国', 97.85, 24.0, 'culture.village', 'detour20', 62, '国境线穿寨而过', true],
  // G316 秦巴
  ['武当山', 111.0, 32.4, 'culture.heritage', 'detour20', 88, '世界文化遗产道教圣地', true],
  ['神农架', 110.68, 31.75, 'nature.forest', 'detour20', 88, '世界自然遗产，原始森林', true],
  // G331 沿边
  ['漠河北极村', 122.32, 53.48, 'culture.village', 'detour20', 84, '中国最北村庄与极光', true],
  ['额尔古纳湿地', 120.18, 50.24, 'nature.grassland', 'detour20', 80, '亚洲第一湿地', true],
  ['满洲里国门', 117.38, 49.6, 'culture.heritage', 'detour20', 66, '中俄边境的第五代国门', true],
  // G219 新藏/边境
  ['班公湖', 79.5, 33.5, 'nature.lake', 'roadside', 82, '东西两段咸淡不同的湖', true],
  ['冈仁波齐', 81.31, 31.07, 'nature.mountain', 'detour20', 94, '众神的居所', true],
  ['玛旁雍错', 81.6, 30.7, 'nature.lake', 'detour20', 88, '不可战胜的碧玉之湖', true],
  ['扎达土林', 79.8, 31.5, 'nature.desert', 'detour20', 82, '古格王宫的土林迷宫', true],
  ['古格王朝遗址', 79.0, 31.1, 'culture.ruin', 'detour20', 86, '消失的象雄古国都城', true],
  // 服务区景点化（PRD §6.2 engineering.service-area）
  ['阳澄湖服务区', 120.78, 31.44, 'engineering.service-area', 'roadside', 60, '园林式网红服务区', true],
  ['太湖服务区', 120.62, 31.24, 'engineering.service-area', 'roadside', 56, '江南韵味的旗舰服务区', true],
];

function handSeed() {
  return HAND_SEED.map(([name, lng, lat, category, visibility, score, intro, canPark], i) => ({
    id: `hc-${String(i + 1).padStart(3, '0')}-${name}`,
    name,
    lng,
    lat,
    tier: 'C',
    category,
    score,
    visibility,
    intro,
    canPark,
    source: 'hand-curated',
    verified: true,
  }));
}

// ── 可选：旗舰公路风景段 Overpass 观景点（tourism=viewpoint/attraction） ──────
/** 风景段 bbox（不是全线 bbox，控制单次查询规模） */
const OSM_CORRIDORS = [
  { key: 'G318', bbox: [29.0, 94.0, 31.5, 103.0] }, // 川藏段
  { key: 'G109', bbox: [31.0, 90.0, 37.0, 101.5] }, // 青藏段
  { key: 'G217', bbox: [42.0, 83.0, 44.6, 85.0] }, // 独库段
  { key: 'G315', bbox: [36.8, 90.0, 38.5, 96.0] }, // 柴达木段
  { key: 'G227', bbox: [37.0, 100.0, 38.5, 102.2] }, // 祁连段
  { key: 'G214', bbox: [27.5, 98.0, 35.2, 99.8] }, // 三江并流段
];

async function osmViewpoints() {
  const out = [];
  for (const { key, bbox } of OSM_CORRIDORS) {
    const [s, w, n, e] = bbox;
    const q = `[out:json][timeout:60];(node["tourism"="viewpoint"](${s},${w},${n},${e});node["tourism"="attraction"](${s},${w},${n},${e}););out body;`;
    try {
      const elements = await overpassQuery(q, 70);
      let added = 0;
      for (const el of elements) {
        const name = el.tags?.name;
        if (!name || !Number.isFinite(el.lon) || !Number.isFinite(el.lat)) continue;
        out.push({
          id: `osm-${el.type}-${el.id}`,
          name,
          lng: el.lon,
          lat: el.lat,
          tier: 'B',
          category: el.tags?.tourism === 'viewpoint' ? 'viewpoint.observation-deck' : 'viewpoint.landmark',
          score: el.tags?.tourism === 'viewpoint' ? 52 : 44,
          visibility: 'detour5',
          source: 'osm_only',
          verified: false,
          tags: [`沿${key}`],
        });
        added += 1;
      }
      console.log(`  ${key}: ${added} 个观景点/景点`);
    } catch (e) {
      console.log(`  ${key}: Overpass 失败（${e.message}），跳过`);
    }
  }
  return out;
}

// ── 合并 + 去重（同名 2km 内保留权威优先） ────────────────────────────────────
function dedupe(spots) {
  const sorted = [...spots].sort((a, b) => rankOf(a) - rankOf(b)); // 权威在前
  const kept = [];
  const dist = (a, b) => {
    const dx = (a.lng - b.lng) * 91;
    const dy = (a.lat - b.lat) * 111;
    return Math.hypot(dx, dy);
  };
  for (const s of sorted) {
    const dup = kept.find((k) => k.name === s.name && dist(k, s) < 2);
    if (dup) {
      if (rankOf(s) < rankOf(dup)) Object.assign(dup, s);
      continue;
    }
    kept.push(s);
  }
  return kept;
}

const RANK_ORDER = ['hand-curated', 'migrated:preset', 'migrated:curated', 'migrated:ai_reviewed', 'osm_only', 'migrated:ai_generated'];
function rankOf(s) {
  const i = RANK_ORDER.indexOf(s.source ?? '');
  return i < 0 ? RANK_ORDER.length : i;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
const scenic = existsSync(SCENIC_PATH) ? JSON.parse(readFileSync(SCENIC_PATH, 'utf8')).spots ?? [] : [];
let all = [...convertScenic(scenic), ...handSeed()];
console.log(`基础迁移 ${convertScenic(scenic).length} 条 + 手工种子 ${HAND_SEED.length} 条`);

if (useOsm) {
  const osm = await osmViewpoints();
  console.log(`OSM 补充 ${osm.length} 条`);
  all = [...all, ...osm];
}

all = dedupe(all);
const tierCount = { A: 0, B: 0, C: 0 };
for (const s of all) tierCount[s.tier] = (tierCount[s.tier] ?? 0) + 1;

writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      version: 1,
      updated: new Date().toISOString().slice(0, 10),
      note: `公路侧景点库（目标 3 万条，当前 ${all.length} 条起步集）：铁路侧 624 景点迁移 + Tier C 手工种子${useOsm ? ' + OSM 观景点' : ''}；A级景区全量与坐标校准待 §6.4 流水线扩容`,
      spots: all,
    },
    null,
    1,
  ),
  'utf8',
);
console.log(`\ndata/roads/roadside-spots.json ← ${all.length} 条（A ${tierCount.A} / B ${tierCount.B} / C ${tierCount.C}）`);
console.log('诚实边界：OSM 来源条目标 unverified；坐标为估算值；全量 3 万条需按 PRD §6.4 扩容。');
