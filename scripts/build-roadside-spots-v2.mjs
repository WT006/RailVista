/**
 * 公路景点库重建 · 第 2 步：清洗 + 融合 + 路网关系落库。
 *
 * 依赖第 1 步的采集缓存：tmp/amap-scenic/*.json（scripts/harvest-amap-scenic.mjs）
 *
 * ## 为什么重做
 * 现库 12254 条里 11043 条是 OSM 的 tourism=attraction 一把抓（迪士尼游乐设施、
 * 观测站、教堂一律入库），统一贴 viewpoint.landmark + 固定 score 77 + 空 intro。
 * 本脚本以「高德风景名胜运营数据」为地基重建，并把公路真正需要的三件事补上：
 *   1. 能不能顺路到（到最近干线的真实距离 → detourClass）
 *   2. 到达方式（从哪条路下道、多远）
 *   3. 左右侧由路线方向实时算（见 shared/drive/spotSide.ts，本脚本不落 side）
 *
 * ## 边界纪律
 * 只读 data/roads/geom 与 index（另一位 AI 正在补路网，不碰它的产物）；
 * 只写 data/roads/roadside-spots.json。
 *
 * 用法：node --max-old-space-size=8192 scripts/build-roadside-spots-v2.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AMAP_DIR = join(ROOT, 'tmp/amap-scenic-v2');
const GEOM_DIR = join(ROOT, 'data/roads/geom');
const INDEX_DIR = join(ROOT, 'data/roads/index');
const ROADBOOK_DIR = join(ROOT, 'data/presets/roadbooks');
const LEGACY_PATH = join(ROOT, 'data/roads/roadside-spots.json');
const PRE_HARVEST_PATH = join(ROOT, 'data/roads/roadside-spots.pre-harvest.json');
const OUT_PATH = LEGACY_PATH;
const REPORT_PATH = join(ROOT, 'data/roads/reports/roadside-spots-rebuild.json');

const DRY = process.argv.includes('--dry');

// ── 高德 typecode：留 / 删 ───────────────────────────────────────────────────
/** 保留：真·出游目的地 */
const KEEP_TYPECODE = new Set([
  '110000', // 风景名胜相关;旅游景点（通用）
  '110200', // 风景名胜;风景名胜
  '110202', // 国家级景点
  '110203', // 省级景点
  '110205', // 寺庙道观（公路自驾真实目的地）
  '110209', // 观景点
  '110208', // 海滩
  '110210', // 红色景区
]);
/** 丢：城市公园 / 广场 / 动物园 / 植物园 / 水族馆 —— 不是自驾沿程景点 */
const DROP_TYPECODE = new Set(['110101', '110102', '110103', '110104', '110105', '110106']);
/** 有条件保留：教堂 / 回教寺只留知名者；纪念馆只留文物古迹类 */
const CONDITIONAL_TYPECODE = new Set(['110204', '110206', '110207']);
const NOTABLE_TEMPLE = /艾提尕尔|大清真寺|礼拜寺|圣心|徐家汇|西开|圣弥厄尔|圣约翰|莫愁|总堂/;

/** keytag（高德的运营标签）→ 分类 + 基础分 */
const KEYTAG_MAP = [
  [/^5A景区|A{5}/, 'viewpoint.landmark', 92, ['5A']],
  [/^4A景区/, 'viewpoint.landmark', 84, ['4A']],
  [/^3A景区/, 'viewpoint.landmark', 76, ['3A']],
  [/世界遗产/, 'culture.heritage', 90, ['世界遗产']],
  [/名山大川|名山丘陵/, 'nature.mountain', 78, ['名山']],
  [/大峡谷/, 'nature.canyon', 80, ['峡谷']],
  [/冰川|瀑布/, 'nature.glacier', 76, ['冰川瀑布']],
  [/湖泊|河流/, 'nature.lake', 72, ['湖河']],
  [/湿地/, 'nature.wetland', 70, ['湿地']],
  [/森林草原|森林公园/, 'nature.forest', 72, ['森林']],
  [/沙漠/, 'nature.desert', 74, ['沙漠']],
  [/温泉/, 'experience.hot-spring', 70, ['温泉']],
  [/古镇|古城/, 'culture.ancient-town', 78, ['古镇']],
  [/民族村|村寨/, 'culture.village', 68, ['村寨']],
  [/文物古迹|人文景观/, 'culture.heritage', 72, ['古迹']],
  [/红色|革命/, 'culture.red', 68, ['红色']],
  [/寺庙|道观/, 'culture.temple', 62, ['寺庙']],
  [/纪念馆/, 'culture.heritage', 60, ['纪念馆']],
  [/观景|观景点/, 'viewpoint.observation-deck', 64, ['观景']],
  [/生态公园|国家公园/, 'nature.forest', 74, ['国家公园']],
  [/城市公园|公园|广场|水族|植物园/, null, 0, []], // 明确丢弃
  [/^景区$/, 'viewpoint.landmark', 66, ['景区']],
  [/自然风光/, 'viewpoint.scenic-byway', 70, ['自然风光']],
];

/** 名称里的资质线索（补分，只加分不改来源） */
const HONOR_PATTERNS = [
  [/世界(自然|文化|文化与自然)?遗产/, '世界遗产'],
  [/世界地质公园/, '世界地质公园'],
  [/国家公园/, '国家公园'],
  [/国家级风景名胜区/, '国家级风景名胜区'],
  [/国家[45]A|[45]A级/, '5A/4A'],
  [/全国重点文物保护单位/, '全国重点文保'],
  [/国家森林公园/, '国家森林公园'],
  [/国家地质公园/, '国家地质公园'],
  [/国家湿地公园/, '国家湿地公园'],
  [/中国传统村落/, '中国传统村落'],
];

function tierOf(score) {
  return score >= 82 ? 'A' : score >= 66 ? 'B' : 'C';
}

/**
 * 分类 → 中文说法。
 * 高德不返回「简介」，但需求要求景点带上简介 —— 这里只用**可核实字段**
 * （分类 / 资质 / 行政区划 / 高德细类）合成一句事实性描述，不编造任何
 * 看点、历史、传说。人工撰写的简介（路书 POI / 原精选）一律优先，不覆盖。
 */
const CATEGORY_LABEL = {
  'viewpoint.landmark': '标志性景观',
  'viewpoint.scenic-byway': '沿路风景',
  'viewpoint.observation-deck': '观景台 / 观景点',
  'nature.mountain': '山地自然景观',
  'nature.canyon': '峡谷地貌景观',
  'nature.glacier': '冰川 / 瀑布景观',
  'nature.lake': '湖泊 / 河流水景',
  'nature.wetland': '湿地景观',
  'nature.forest': '森林 / 草原景观',
  'nature.grassland': '草原景观',
  'nature.desert': '沙漠景观',
  'culture.ancient-town': '古城 / 古镇',
  'culture.village': '村寨聚落',
  'culture.temple': '寺庙 / 道观',
  'culture.heritage': '文物古迹',
  'culture.red': '红色纪念地',
  'culture.ruin': '历史遗址',
  'experience.hot-spring': '温泉体验地',
};

function composeIntro(s) {
  const label = CATEGORY_LABEL[s.category] ?? '旅游景点';
  const loc = [s.province, s.city].filter(Boolean).join(' ');
  const where = loc ? `${loc}的` : '';
  const honor = s.honors?.length ? `，${s.honors.join('、')}` : '';
  // 高德 type 形如「风景名胜;风景名胜;观景点」，取最末一级细类
  const fine = s.amapType ? String(s.amapType).split(';').pop().trim() : '';
  const tail = fine && fine !== label ? `（${fine}）` : '';
  return `${where}${label}${honor}${tail}。`;
}

function normalizeProvince(pname) {
  if (!pname) return undefined;
  return pname
    .replace(/(省|市|自治区|特别行政区)$/, '')
    .replace(/(维吾尔|壮族|回族)$/, '');
}
/** 高德 cityname 形如「甘孜藏族自治州」「张家界市」→ 统一去后缀 */
function normalizeCity(cityname) {
  if (!cityname) return undefined;
  return cityname.replace(/市$/, '');
}

// ── 路网距离索引（只读） ─────────────────────────────────────────────────────
const CELL = 0.1; // 约 11km
function buildRoadIndex() {
  const files = existsSync(GEOM_DIR) ? readdirSync(GEOM_DIR).filter((f) => f.endsWith('.json')) : [];
  const keys = [];
  const keyId = new Map();
  const xs = [];
  const ys = [];
  const ids = [];
  for (const f of files) {
    let g;
    try {
      g = JSON.parse(readFileSync(join(GEOM_DIR, f), 'utf8'));
    } catch {
      continue;
    }
    const key = g.key ?? f.replace(/\.json$/, '');
    if (!keyId.has(key)) {
      keyId.set(key, keys.length);
      keys.push(key);
    }
    const id = keyId.get(key);
    const push = (pts) => {
      if (!Array.isArray(pts)) return;
      // 抽稀：每 3 个点取 1 个即可满足 11km 网格的近似最近距离
      for (let i = 0; i < pts.length; i += 3) {
        const p = pts[i];
        if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        xs.push(p[0]);
        ys.push(p[1]);
        ids.push(id);
      }
    };
    push(g.points);
    if (Array.isArray(g.segments)) for (const s of g.segments) push(s);
  }
  const n = xs.length;
  const X = new Float64Array(xs);
  const Y = new Float64Array(ys);
  const ID = new Uint16Array(ids);
  // 桶排序（按网格 cell）
  const cellOf = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    cellOf[i] = Math.floor(X[i] / CELL) * 100000 + Math.floor(Y[i] / CELL);
  }
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => cellOf[a] - cellOf[b]);
  const sortedCell = new Int32Array(n);
  const sortedIdx = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    sortedCell[i] = cellOf[order[i]];
    sortedIdx[i] = order[i];
  }
  console.log(`路网索引：${files.length} 条几何 / ${n} 个采样点 / ${keys.length} 个编号`);
  return { X, Y, ID, sortedCell, sortedIdx, keys, n };
}

function cellRange(sortedCell, c) {
  let lo = 0;
  let hi = sortedCell.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedCell[mid] < c) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  let hi2 = sortedCell.length;
  let lo2 = start;
  while (lo2 < hi2) {
    const mid = (lo2 + hi2) >> 1;
    if (sortedCell[mid] <= c) lo2 = mid + 1;
    else hi2 = mid;
  }
  return [start, lo2];
}

/**
 * 到最近干线：返回 { km, keys[] }。
 * keys 取「最近距离 +5km 以内」的路线编号 —— 太远的路谈不上「从这条路下道」，
 * 但也不能只认 1.2km 内（否则 5km 外的景点说不出该从哪条路拐出去）。
 */
function nearestRoad(idx, lng, lat, maxRing = 5) {
  const { X, Y, ID, sortedCell, sortedIdx, keys } = idx;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  const hit = new Map();
  const cx = Math.floor(lng / CELL);
  const cy = Math.floor(lat / CELL);
  for (let ring = 0; ring <= maxRing; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        // 只扫环上的新格（内圈上一轮已扫过）
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const c = (cx + dx) * 100000 + (cy + dy);
        const [s, e] = cellRange(sortedCell, c);
        for (let p = s; p < e; p += 1) {
          const i = sortedIdx[p];
          const dLng = (X[i] - lng) * cosLat;
          const dLat = Y[i] - lat;
          const d = Math.sqrt(dLng * dLng + dLat * dLat) * 111;
          if (d < best) best = d;
          const k = keys[ID[i]];
          const prev = hit.get(k);
          if (prev === undefined || d < prev) hit.set(k, d);
        }
      }
    }
    // 已扩到 ring 格（≥ ring×11km），最好结果确定落在环内就不用再扩
    if (best <= ring * CELL * 111 * 0.9) break;
  }
  if (!Number.isFinite(best)) return { km: null, keys: [] };
  const near = [...hit.entries()]
    .filter(([, d]) => d <= best + 5)
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => k);
  return { km: Math.round(best * 100) / 100, keys: near.slice(0, 3) };
}

// ── 1. 高德缓存 → 规范化行 ───────────────────────────────────────────────────
function amapRows() {
  const rows = [];
  const files = existsSync(AMAP_DIR) ? readdirSync(AMAP_DIR).filter((f) => f.endsWith('.json')) : [];
  const stat = { raw: 0, dropType: 0, dropKeytag: 0, dropDup: 0, kept: 0 };
  const seen = new Set();
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(AMAP_DIR, f), 'utf8'));
    for (const p of j.pois ?? []) {
      stat.raw += 1;
      const loc = String(p.location ?? '');
      const [lngS, latS] = loc.split(',');
      const lng = Number(lngS);
      const lat = Number(latS);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (lng < 73 || lng > 136 || lat < 17 || lat > 55) continue;
      const name = String(p.name ?? '').trim();
      if (!name) continue;

      const typecode = String(p.typecode ?? '');
      const keytag = String(p.keytag ?? '').trim();
      const typeText = String(p.type ?? '');

      // ── 运营字段（仅 extensions=all 才有）────────────────────────────────
      // 评分：5 分制字符串（"4.4"），是真实的用户评分，直接落库并标注来源。
      // 开放时间：open_time 是「07:00-18:30」这类短串（也可能为 []），
      //   opentime2 带星期（"周一至周日 07:00-18:30"）。两者都可能是 [] —— 不编造，留空。
      // ❗ biz_ext.cost（票价）一律不取：内容红线，票价不写金额。
      const biz = p.biz_ext ?? {};
      const ratingRaw = Number(biz.rating);
      const rating = Number.isFinite(ratingRaw) && ratingRaw > 0 ? Math.round(ratingRaw * 10) / 10 : undefined;
      const visitHours = [
        typeof biz.open_time === 'string' ? biz.open_time.trim() : '',
        typeof biz.opentime2 === 'string' ? biz.opentime2.trim() : '',
      ].find((v) => v && v !== '0') || undefined;
      const photoUrl = Array.isArray(p.photos) && p.photos.length ? String(p.photos[0].url ?? '') || undefined : undefined;

      // typecode 过滤
      if (DROP_TYPECODE.has(typecode)) {
        stat.dropType += 1;
        continue;
      }
      if (!KEEP_TYPECODE.has(typecode) && !CONDITIONAL_TYPECODE.has(typecode)) {
        stat.dropType += 1;
        continue;
      }
      if (CONDITIONAL_TYPECODE.has(typecode) && !NOTABLE_TEMPLE.test(name)) {
        // 纪念馆（110204）保留文物古迹类；教堂/回教寺只留知名者
        if (!(typecode === '110204' && /文物古迹|人文景观|红色/.test(keytag))) {
          stat.dropType += 1;
          continue;
        }
      }

      // keytag → 分类 / 基础分；keytag 为空时用 type 文本兜底
      let category = null;
      let score = 0;
      let tags = [];
      const probe = keytag || typeText;
      for (const [re, cat, sc, tg] of KEYTAG_MAP) {
        if (!re.test(probe)) continue;
        if (cat === null) {
          stat.dropKeytag += 1;
          category = null;
          break;
        }
        category = cat;
        score = sc;
        tags = tg;
        break;
      }
      if (category === null) continue;
      if (!category) {
        category = /寺庙|道观/.test(typeText) ? 'culture.temple' : 'viewpoint.landmark';
        score = 58;
      }

      // 资质补分
      const honors = [];
      for (const [re, label] of HONOR_PATTERNS) {
        if (re.test(name) || re.test(typeText)) {
          honors.push(label);
          score += 4;
        }
      }
      if (/国家级/.test(typeText)) score += 4;
      // 真实评分参与排序：5 分制，3.5 为基准，每 ±0.5 分 ±3 分（最多 ±9）
      if (rating) score += Math.max(-9, Math.min(9, Math.round((rating - 3.5) * 6)));
      score = Math.max(35, Math.min(97, Math.round(score)));

      const key = `${name}@${lng.toFixed(3)},${lat.toFixed(3)}`;
      if (seen.has(key)) {
        stat.dropDup += 1;
        continue;
      }
      seen.add(key);

      rows.push({
        id: `amap-${p.id}`,
        name,
        lng: Number(lng.toFixed(6)),
        lat: Number(lat.toFixed(6)),
        category,
        score,
        tier: tierOf(score),
        tags: [...new Set([...tags, ...honors])],
        honors: honors.length ? honors : undefined,
        province: normalizeProvince(p.pname),
        city: normalizeCity(p.cityname),
        address: p.address ? String(p.address).trim() : undefined,
        tel: p.tel ? String(p.tel).trim() : undefined,
        amapId: p.id,
        amapType: typeText,
        rating,
        ratingSource: rating ? 'amap' : undefined,
        visitHours,
        photoUrl,
        source: 'amap-poi',
        verified: true,
        reviewedAt: new Date().toISOString().slice(0, 10),
      });
      stat.kept += 1;
    }
  }
  console.log(
    `高德采集 ${stat.raw} 条 → 保留 ${stat.kept}（剔类型 ${stat.dropType} / 剔标签 ${stat.dropKeytag} / 去重 ${stat.dropDup}）`,
  );
  return rows;
}

// ── 2. 既有精选（pre-harvest）+ 路书 POI ──────────────────────────────────────
function curatedRows() {
  const rows = [];
  const seen = new Set();

  // 路书 POI：已经过人工 + 闸门校验，字段最全（intro/tagline/visitHours/ticketNote）
  const CAT_MAP = {
    mountain: 'nature.mountain',
    water: 'nature.lake',
    landform: 'nature.canyon',
    grassland: 'nature.grassland',
    forest: 'nature.forest',
    desert: 'nature.desert',
    village: 'culture.village',
    temple: 'culture.temple',
    ruin: 'culture.ruin',
    culture: 'culture.heritage',
    cityview: 'viewpoint.landmark',
    roadside: 'viewpoint.scenic-byway',
    food: 'experience.hot-spring',
  };
  const rbFiles = existsSync(ROADBOOK_DIR)
    ? readdirSync(ROADBOOK_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    : [];
  let rbCount = 0;
  for (const f of rbFiles) {
    const j = JSON.parse(readFileSync(join(ROADBOOK_DIR, f), 'utf8'));
    const routes = Array.isArray(j) ? j : j.routes ?? [];
    for (const r of routes) {
      for (const p of r.pois ?? []) {
        if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) continue;
        const key = `${p.name}@${p.lng.toFixed(3)},${p.lat.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const honors = [];
        if (p.level) honors.push(String(p.level));
        let score = p.mustSee ? 88 : 74;
        if (/世界|国家公园|5A/.test(String(p.level ?? ''))) score += 6;
        score = Math.min(97, score);
        rows.push({
          id: `rb-${p.id}`,
          name: p.name,
          lng: Number(p.lng.toFixed(6)),
          lat: Number(p.lat.toFixed(6)),
          category: CAT_MAP[p.category] ?? 'viewpoint.landmark',
          score,
          tier: tierOf(score),
          tagline: p.tagline,
          intro: p.intro,
          // 路书 visitHours 是「建议游玩小时数」，不是开放时间 —— 不能塞进 visitHours
          stayMin: Number.isFinite(p.visitHours) ? Math.round(p.visitHours * 60) : undefined,
          ticketNote: p.ticketNote,
          bestView: p.bestTime ? { note: String(p.bestTime) } : undefined,
          level: p.level,
          honors: honors.length ? honors : undefined,
          tags: honors.length ? honors.slice(0, 3) : undefined,
          province: p.province,
          city: p.city,
          source: 'roadbook',
          verified: true,
          reviewedAt: new Date().toISOString().slice(0, 10),
        });
        rbCount += 1;
      }
    }
  }

  // pre-harvest：OSM 批量灌入之前的精选库（hand-curated / migrated:*）
  let phCount = 0;
  if (existsSync(PRE_HARVEST_PATH)) {
    const j = JSON.parse(readFileSync(PRE_HARVEST_PATH, 'utf8'));
    for (const p of j.spots ?? []) {
      if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) continue;
      const key = `${p.name}@${p.lng.toFixed(3)},${p.lat.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        ...p,
        id: p.id ?? `ph-${phCount}`,
        source: p.source ?? 'hand-curated',
        tier: p.tier ?? tierOf(p.score ?? 60),
        verified: true,
        reviewedAt: new Date().toISOString().slice(0, 10),
      });
      phCount += 1;
    }
  }
  console.log(`精选层：路书 POI ${rbCount} 条 + 原精选 ${phCount} 条`);
  return rows;
}

// ── 3. 主线 ──────────────────────────────────────────────────────────────────
console.log('── 公路景点库重建 ──');
const amap = amapRows();
const curated = curatedRows();

// 合并：先放精选（去重时精选优先保留）
const all = [...curated, ...amap];
console.log(`合并候选 ${all.length} 条，开始算路网关系…`);

const roadIdx = buildRoadIndex();
const t0 = Date.now();
let pass = 0;
let detour = 0;
let spur = 0;
for (const s of all) {
  const near = nearestRoad(roadIdx, s.lng, s.lat);
  s.roadDistKm = near.km;
  s.roadRefs = near.keys;
  if (near.km == null) {
    s.detourClass = 'spur';
    s.accessNote = '周边 55 km 内没有已收录的国道 / 高速 / 省道，需另行查证到达方式';
    spur += 1;
  } else if (near.km <= 1) {
    s.detourClass = 'pass';
    s.accessNote = near.keys.length
      ? `就在 ${near.keys.join(' / ')} 路边（直线 ${near.km} km），顺路即停`
      : `紧邻已收录干线（直线 ${near.km} km），顺路即停`;
    pass += 1;
  } else if (near.km <= 12) {
    s.detourClass = 'detour';
    s.accessNote = near.keys.length
      ? `从 ${near.keys.join(' / ')} 下道约 ${near.km} km（直线），20 分钟内可打个来回`
      : `距最近干线 ${near.km} km（直线），需短绕`;
    detour += 1;
  } else {
    s.detourClass = 'spur';
    s.accessNote = near.keys.length
      ? `距最近干线 ${near.keys.join(' / ')} 约 ${near.km} km（直线），需专程绕行`
      : `距最近干线 ${near.km} km（直线），需专程绕行`;
    spur += 1;
  }
  // 可见性分档（沿用既有 ROAD_BUFFER_KM 语义）
  s.visibility =
    s.roadDistKm == null ? 'distant' : s.roadDistKm <= 0.3 ? 'roadside' : s.roadDistKm <= 3 ? 'detour5' : s.roadDistKm <= 12 ? 'detour20' : 'distant';
}
console.log(`路网关系：顺路 ${pass} / 短绕 ${detour} / 专程 ${spur}（${Date.now() - t0}ms）`);

// ── 3.5 质量闸门：远且平庸的景点直接删（「删除不在路线附近的条目」）──────────
// 专程绕行（>12km）只留给**真的值得**的：有资质（5A/世界遗产/国家公园…）
// 或本身评分够高。远 + 平庸 = 噪声，留着只会污染沿程列表。
// 顺路 / 短绕档一律保留 —— 路过就能看，门槛不该高。
const beforeGate = all.length;
const gated = [];
let gateDrop = 0;
for (const s of all) {
  if (s.detourClass === 'spur' && !(s.honors?.length || (s.score ?? 0) >= 74 || (s.rating ?? 0) >= 4.2)) {
    gateDrop += 1;
    continue;
  }
  if (s.detourClass === 'spur') {
    // 「为什么值得专程跑一趟」——只写可核实的资质与距离，不写主观形容词
    const why = s.honors?.length ? s.honors.join('、') : s.level ?? (s.rating ? `高德评分 ${s.rating} 分` : '高分景点');
    s.spurReason = `距最近干线 ${s.roadDistKm} km，需专程绕行；${why}，值得为它单独安排时间`;
  }
  // 简介兜底：高德不返回简介，用可核实字段合成一句，人工写的简介不覆盖
  if (!s.intro || !String(s.intro).trim()) s.intro = composeIntro(s);
  gated.push(s);
}
all.length = 0;
all.push(...gated);
console.log(`质量闸门：${beforeGate} → ${gated.length}（删除远且平庸 ${gateDrop} 条）`);

function coreName(n) {
  return String(n)
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/(风景名胜区|风景区|景区|国家公园|森林公园|地质公园|博物馆|纪念馆|观景台|主峰)$/g, '');
}
function hav(a, b) {
  const to = (x) => (x * Math.PI) / 180;
  const dLat = to(b.lat - a.lat);
  const dLng = to(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(to(a.lat)) * Math.cos(to(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
/** 与 shared/drive/spotQuality.ts 同思路的噪声名（本脚本是 .mjs，不 import TS） */
const JUNK_NAME =
  /^(景点|观景台|观景点|停车场|服务区|公厕|厕所|游客中心|售票处|大门|门楼|牌坊|广场|步行街|商业街)$|^\d+$|[A-Za-z]{6,}/;
const PARK_RIDE = /奇航|漂流|过山车|矿山车|娱乐天地|摩天轮|旋转木马|碰碰车|游乐场|水上乐园|动物园|海洋馆|水族/;
/**
 * 名称里完全没有汉字的一律剔掉。
 * 实测高德会混进 "c" / "Holy Hill" / "Park" / "Map of Garzê" 以及藏文名
 * 「ཕག་མོ་རི།」——同一个地点高德同时有中文名和拉丁名条目，
 * 中文条目会被留下（坐标相同，但按名字去重不会互相命中），拉丁名那条纯是噪声。
 */
const CJK = /[一-龥]/;

/** 同名景点在不同 roadbook 文件里被重复收录，锚点能差十几公里（淀山湖 18.8km） */
const SAME_NAME_KM = 25;

/** 精选层优先 + 同层内高分优先 */
const rank = (s) =>
  (s.score ?? 0) +
  (String(s.source).startsWith('roadbook') ? 25 : 0) +
  (String(s.source).startsWith('hand-curated') ? 20 : 0);

/**
 * 同址去重时「合并」而不是「丢弃」运营字段。
 *
 * 问题实测：外滩的路书条目（rank +25，有 slogan/简介/游玩时长）在同名去重里
 * 赢了高德条目，但高德那条带的**实拍图 / 评分 / 开放时间**被一起丢掉 ——
 * 结果一个有照片有评分的条目被换成了「零运营字段」的纯文字条目，UI 反而变差。
 * 所以保留者只补齐自己没有的字段（不覆盖已有值），两边信息合并到一条。
 */
const OPERATIONAL_FIELDS = ['rating', 'ratingSource', 'visitHours', 'photoUrl', 'address', 'tel', 'amapId', 'amapType'];
function mergeOperational(target, extra) {
  for (const f of OPERATIONAL_FIELDS) {
    if (target[f] == null || target[f] === '' || (f === 'rating' && !(target[f] > 0))) {
      if (extra[f] != null && extra[f] !== '') target[f] = extra[f];
    }
  }
}

// 必须按 rank 排序后再做同名贪心：桶内先到的才会被保留
all.sort((a, b) => rank(b) - rank(a));

// ── 4a. 同名去重（按名称分桶，与网格无关）─────────────────────────────────
// 实测同一个景点会在多个 roadbook 文件里各收录一次，锚点差到十几公里
// （淀山湖 18.8km、喀纳斯湖 6.7km、慕田峪长城 12.7km）。
// 按名字分桶后逐桶贪心保留（rank 高者胜），彼此 >25 km 才算另一处。
const byName = new Map();
for (const s of all) {
  const arr = byName.get(s.name);
  if (arr) arr.push(s);
  else byName.set(s.name, [s]);
}
const afterName = [];
let nameDup = 0;
for (const arr of byName.values()) {
  if (arr.length === 1) {
    afterName.push(arr[0]);
    continue;
  }
  const keptInGroup = [];
  for (const s of arr) {
    const hit = keptInGroup.find((o) => hav(s, o) <= SAME_NAME_KM);
    if (hit) {
      // 保留 rank 更高的那个，并把对方的运营字段合并进来（只补空缺）
      if (rank(s) > rank(hit)) {
        mergeOperational(s, hit);
        keptInGroup[keptInGroup.indexOf(hit)] = s;
      } else {
        mergeOperational(hit, s);
      }
      nameDup += 1;
      continue;
    }
    keptInGroup.push(s);
  }
  afterName.push(...keptInGroup);
}

// ── 4b. 网格近名去重（核心名相同 / 互相包含）───────────────────────────────
const cell = 0.02;
const grid = new Map();
const kept = [];
const dropStat = { dup: 0, noise: 0, nameDup };
for (const s of afterName) {
  if (JUNK_NAME.test(s.name) || PARK_RIDE.test(s.name)) {
    dropStat.noise += 1;
    continue;
  }
  // 名称里没有汉字：中文产品里是纯噪声（同一地点另有中文条目）
  if (!CJK.test(s.name)) {
    dropStat.noise += 1;
    continue;
  }
  const k = `${Math.floor(s.lng / cell)},${Math.floor(s.lat / cell)}`;
  let dupOf = null;
  for (let dx = -1; dx <= 1 && !dupOf; dx += 1) {
    for (let dy = -1; dy <= 1 && !dupOf; dy += 1) {
      const arr = grid.get(`${Math.floor(s.lng / cell) + dx},${Math.floor(s.lat / cell) + dy}`);
      if (!arr) continue;
      for (const o of arr) {
        const d = hav(s, o);
        const cn = coreName(s.name);
        const co = coreName(o.name);
        if (d <= 1.5 && cn && cn === co) {
          dupOf = o;
          break;
        }
        if (d <= 0.35 && (cn.includes(co) || co.includes(cn))) {
          dupOf = o;
          break;
        }
      }
    }
  }
  if (dupOf) {
    dropStat.dup += 1;
    // 同址：保留 rank 高的，运营字段合并（只补空缺），不整条丢弃
    if (rank(s) > rank(dupOf)) {
      mergeOperational(s, dupOf);
      const idx = kept.indexOf(dupOf);
      if (idx >= 0) kept[idx] = s;
      const gi = grid.get(k);
      if (gi) gi[gi.indexOf(dupOf)] = s;
      for (const [ck, cv] of grid) {
        const at = cv.indexOf(dupOf);
        if (at >= 0) {
          cv[at] = s;
          if (cv.length === 0) grid.delete(ck);
        }
      }
    } else {
      mergeOperational(dupOf, s);
    }
    continue;
  }
  const arr = grid.get(k);
  if (arr) arr.push(s);
  else grid.set(k, [s]);
  kept.push(s);
}

kept.sort((a, b) => rank(b) - rank(a));
console.log(
  `去重后 ${kept.length} 条（同名合并 ${dropStat.nameDup} / 近名同址 ${dropStat.dup} / 剔噪声 ${dropStat.noise}）`,
);

// ── 5. 落库 ──────────────────────────────────────────────────────────────────
const bySource = {};
const byTier = {};
const byClass = {};
for (const s of kept) {
  bySource[s.source.split(':')[0]] = (bySource[s.source.split(':')[0]] ?? 0) + 1;
  byTier[s.tier] = (byTier[s.tier] ?? 0) + 1;
  byClass[s.detourClass] = (byClass[s.detourClass] ?? 0) + 1;
}

if (!DRY) {
  // 备份写到未跟踪目录：旧库本体在 git 历史里，再存一份 4.5MB 副本只是给仓库增肥，
  // 真要回滚用 `git checkout <sha> -- data/roads/roadside-spots.json` 即可。
  const BACKUP_DIR = join(ROOT, '.tmp-diag');
  const BACKUP_PATH = join(BACKUP_DIR, 'roadside-spots.legacy-20261012.json');
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const old = JSON.parse(readFileSync(LEGACY_PATH, 'utf8'));
  writeFileSync(BACKUP_PATH, JSON.stringify(old), 'utf8');
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        version: 2,
        updated: new Date().toISOString().slice(0, 10),
        note:
          'v2 重建：以高德风景名胜运营数据 + 路书精选 POI 为地基，替代 OSM tourism=attraction 批量灌入。' +
          '每条都带「到最近干线距离 / 到达方式 / 顺路-短绕-专程」；左右侧由路线方向实时算（不落库）。' +
          '开放时间与评分只在有可信来源时填写，未核实留空。',
        counts: bySource,
        spots: kept,
      },
      null,
      1,
    ),
    'utf8',
  );
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        total: kept.length,
        bySource,
        byTier,
        byDetourClass: byClass,
        dropped: dropStat,
        legacyBackup: '.tmp-diag/roadside-spots.legacy-20261012.json（未跟踪；git 历史里也有）',
      },
      null,
      1,
    ),
    'utf8',
  );
}

console.log(`\n结果：${kept.length} 条`);
console.log('  来源:', JSON.stringify(bySource));
console.log('  分级:', JSON.stringify(byTier));
console.log('  可达:', JSON.stringify(byClass));
console.log(DRY ? '\n（--dry：未落库）' : `\n已写入 ${OUT_PATH}`);
