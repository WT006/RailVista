/**
 * 大批量补充公路侧景点（scripts/harvest-roadside-spots.mjs）。
 *
 * 背景：roadside-spots.json 原有 1035 条里 624 条是从铁路侧迁移来的，公路原生只有 411 条，
 * 数量少、类别集中在观景点、province 字段全空。本脚本从 OSM 按省分片批量抓取全国
 * 旅游/自然/史迹类 POI，分类映射到公路侧 category 体系，按到最近已绘公路的距离定
 * visibility，合并进 data/roads/roadside-spots.json（保留全部既有条目）。
 *
 * 抓取纪律（继承 scripts/lib/overpass.mjs）：
 *   - 多端点 failover + User-Agent；34 省分片，每片独立磁盘缓存，命中即跳过（断点续抓）
 *   - Overpass 的 geometry 是 {lat, lon} 对象，node 的 lat/lon 在元素顶层
 *   - 并发受控（默认 3），避免打爆公共实例；失败省份记入报告不中断
 *
 * 用法：
 *   node scripts/harvest-roadside-spots.mjs                 # 抓全部省（后台跑）
 *   node scripts/harvest-roadside-spots.mjs --prov 51,54    # 只抓指定省码
 *   node scripts/harvest-roadside-spots.mjs --dry           # 只统计不落盘
 *   node scripts/harvest-roadside-spots.mjs --merge-only    # 跳过抓取，直接用缓存合并
 *
 * 产出：data/roads/roadside-spots.json（原地合并）+ data/roads/harvest-report.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overpassQuery, haversineKm } from './lib/overpass.mjs';
import { PROVINCE_BBOXES, provinceOfPoint } from './lib/province-bbox.mjs';
import { isAdmissibleHarvestPoi } from './lib/china-land.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R = join(__dirname, '..');
const SPOTS_PATH = join(R, 'data/roads/roadside-spots.json');
const GEOM_DIR = join(R, 'data/roads/geom');
const CACHE_DIR = join(R, 'data/cache/roads');
const REPORT_PATH = join(R, 'data/roads/harvest-report.json');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const ONLY_PROV = arg('prov', '') ? arg('prov', '').split(',') : null;
const DRY = process.argv.includes('--dry');
const MERGE_ONLY = process.argv.includes('--merge-only');
const CONCURRENCY = Number(arg('concurrency', 3));

/**
 * 抓取类别：只取"会专程绕去看"的类。
 * 试跑实测：加上 artwork / memorial / tomb / place_of_worship 后北京+海南单两省就
 * 8872 条原始元素，其中绝大多数是城市雕塑、纪念碑、村庙，属噪音 —— 已剔除。
 */
const POI_FILTERS = [
  // theme_park 已移除：OSM 上它标记的是乐园**内部单个设施**（过山车、餐厅、商店），
  // 实测混进"狮门娱乐天地""晶彩奇航""七个小矮人矿山车"这类条目，对自驾毫无价值。
  { tag: 'tourism', values: ['viewpoint', 'attraction', 'museum', 'gallery', 'zoo', 'aquarium'] },
  { tag: 'historic', values: ['monument', 'castle', 'ruins', 'archaeological_site', 'fort', 'city_gate', 'manor', 'palace'] },
  { tag: 'natural', values: ['peak', 'volcano', 'cliff', 'dune', 'beach', 'spring', 'hot_spring', 'glacier', 'cave_entrance', 'rock'] },
  { tag: 'waterway', values: ['waterfall', 'dam'] },
  { tag: 'man_made', values: ['tower', 'lighthouse', 'observatory'] },
  { tag: 'leisure', values: ['park', 'nature_reserve'] },
];

/**
 * 设施名黑名单：乐园/景区**内部**的单个游乐设施、店铺、餐饮。
 * 这类点 OSM 分类与真实景点重叠，只能按名称语义剔除。
 */
const FACILITY_NAME_RE =
  /(过山车|摩天轮|旋转木马|碰碰车|矿山车|轨道车|小火车|观光车|游船|快艇|鬼屋|4D|动感影院|影城|影院|剧场|游乐|奇航|漂流|娱乐天地|Jump\s*360|餐厅|快餐|咖啡|商店|纪念品|服务中心|游客中心|售票|停车场|洗手间|卫生间|母婴室|医务室|加油站|充电站|服务区|观景台出口)/i;

/** 单 0.01° 格（≈1.1km）内最多保留几条：压掉城市密集区的爆量 */
const PER_CELL_KEEP = 2;
/** 距最近已绘公路的上限（km）：超过就不是"公路侧"了 */
const MAX_ROAD_KM = 35;
/** 最低入库分 */
const MIN_SCORE = 42;
/**
 * 全国入库总量上限（按 score 降序截断）。
 * 试跑实测北京单市 3520 条，全国不加闸会到 5 万+，前端加载过重；
 * 2 万条对应 gzip 约 0.5MB，是地图页可承受的量级。用 --cap 覆盖。
 */
const CAP = Number(arg('cap', 20000));

/**
 * 分类配额：首轮实测 nature.mountain 独占 13495 条（64%）—— OSM 里 natural=peak
 * 数量极大且多为无名小山，直接入库会让地图被山峰淹没。按类别设上限，
 * 保证各类均衡；未列出的类别走 DEFAULT_QUOTA。
 */
const CATEGORY_QUOTA = {
  'nature.mountain': 2500,
  'viewpoint.observation-deck': 3000,
  'viewpoint.landmark': 2500,
  'viewpoint.scenic-byway': 500,
  'viewpoint.sunrise': 200,
  'culture.heritage': 1500,
  'culture.ancient-town': 400,
  'culture.temple': 800,
  'culture.village': 500,
  'culture.ruin': 500,
  'culture.red': 200,
  'nature.forest': 800,
  'nature.lake': 800,
  'nature.river': 500,
  'nature.grassland': 400,
  'nature.desert': 300,
  'nature.canyon': 600,
  'nature.glacier': 200,
  'engineering.bridge': 300,
  'engineering.tunnel': 200,
  'engineering.dam': 300,
  'engineering.pass': 300,
  'engineering.spiral-road': 300,
  'engineering.service-area': 100,
  'experience.hot-spring': 400,
};
const DEFAULT_QUOTA = 400;

/** OSM (tag,value) → 公路侧 category（25 类体系内，不新增类以免前端图例缺失） */
const CATEGORY_MAP = {
  'tourism=viewpoint': 'viewpoint.observation-deck',
  'tourism=attraction': 'viewpoint.landmark',
  'tourism=artwork': 'viewpoint.landmark',
  'tourism=zoo': 'viewpoint.landmark',
  'tourism=theme_park': 'viewpoint.landmark',
  'tourism=aquarium': 'viewpoint.landmark',
  'tourism=museum': 'culture.heritage',
  'tourism=gallery': 'culture.heritage',
  'tourism=picnic_site': 'nature.grassland',
  'historic=monument': 'culture.heritage',
  'historic=memorial': 'culture.heritage',
  'historic=castle': 'culture.heritage',
  'historic=manor': 'culture.heritage',
  'historic=palace': 'culture.heritage',
  'historic=tomb': 'culture.heritage',
  'historic=fort': 'culture.heritage',
  'historic=ruins': 'culture.ruin',
  'historic=archaeological_site': 'culture.ruin',
  'historic=city_gate': 'culture.ancient-town',
  'historic=wayside_cross': 'culture.temple',
  'historic=wayside_shrine': 'culture.temple',
  'natural=peak': 'nature.mountain',
  'natural=volcano': 'nature.mountain',
  'natural=rock': 'nature.mountain',
  'natural=stone': 'nature.mountain',
  'natural=cliff': 'nature.canyon',
  'natural=cave_entrance': 'nature.canyon',
  'natural=sinkhole': 'nature.canyon',
  'natural=dune': 'nature.desert',
  'natural=beach': 'nature.river',
  'natural=spring': 'experience.hot-spring',
  'natural=hot_spring': 'experience.hot-spring',
  'natural=glacier': 'nature.glacier',
  'waterway=waterfall': 'nature.river',
  'waterway=dam': 'engineering.dam',
  'man_made=tower': 'viewpoint.landmark',
  'man_made=lighthouse': 'viewpoint.landmark',
  'man_made=observatory': 'viewpoint.landmark',
  'man_made=pier': 'viewpoint.observation-deck',
  'leisure=park': 'nature.forest',
  'leisure=nature_reserve': 'nature.forest',
  'leisure=scenic_point': 'viewpoint.observation-deck',
  'amenity=place_of_worship': 'culture.temple',
};

/** 基础分：类别的"专程去看"价值 */
const BASE_SCORE = {
  'viewpoint.observation-deck': 62,
  'viewpoint.landmark': 58,
  'viewpoint.scenic-byway': 56,
  'viewpoint.sunrise': 55,
  'nature.glacier': 66,
  'nature.mountain': 64,
  'nature.canyon': 63,
  'nature.lake': 62,
  'nature.desert': 61,
  'nature.grassland': 58,
  'nature.forest': 55,
  'nature.river': 54,
  'culture.heritage': 60,
  'culture.ancient-town': 62,
  'culture.ruin': 56,
  'culture.temple': 55,
  'culture.village': 54,
  'culture.red': 52,
  'engineering.pass': 64,
  'engineering.bridge': 56,
  'engineering.tunnel': 50,
  'engineering.dam': 52,
  'engineering.spiral-road': 58,
  'engineering.service-area': 30,
  'experience.hot-spring': 58,
};

/** visibility 分档（PRD §5.2 缓冲：roadside 0.3 / detour5 3 / detour20 12 / distant 35 km） */
function visibilityOf(km) {
  if (km <= 0.3) return 'roadside';
  if (km <= 3) return 'detour5';
  if (km <= 12) return 'detour20';
  return 'distant';
}

function tierOf(score) {
  if (score >= 78) return 'A';
  if (score >= 50) return 'B';
  return 'C';
}

// ── 已绘公路几何：用于算"到最近公路的距离" ────────────────────────────────────
const GRID_DEG = 0.25;
const roadGrid = new Map();
let roadPts = [];

function gridKey(x, y) {
  return `${Math.floor(x / GRID_DEG)},${Math.floor(y / GRID_DEG)}`;
}

function loadRoadGeometry() {
  if (!existsSync(GEOM_DIR)) return 0;
  for (const f of readdirSync(GEOM_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const g = JSON.parse(readFileSync(join(GEOM_DIR, f), 'utf8'));
      const lines = [];
      if (Array.isArray(g.points) && g.points.length) lines.push(g.points);
      if (Array.isArray(g.segments)) for (const s of g.segments) if (Array.isArray(s) && s.length) lines.push(s);
      for (const line of lines) {
        for (const p of line) {
          if (!Array.isArray(p) || p.length < 2) continue;
          const [lng, lat] = p;
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
          roadPts.push([lng, lat]);
          const k = gridKey(lng, lat);
          const list = roadGrid.get(k);
          if (list) list.push([lng, lat]);
          else roadGrid.set(k, [[lng, lat]]);
        }
      }
    } catch {
      /* 单个几何文件损坏不影响整体 */
    }
  }
  return roadPts.length;
}

/**
 * 到最近已绘公路点的距离（km）。
 * 网格 0.25° ≈ 25km，故最多向外扩 3 环（≈75km）即覆盖 distant 的 35km 分档；
 * 3 环内无公路点则返回 Infinity（detourKm 记为 null，visibility 落 distant）。
 */
const NEAREST_RING_MAX = 3;
function nearestRoadKm(lng, lat) {
  const target = [lng, lat];
  const bx = Math.floor(lng / GRID_DEG);
  const by = Math.floor(lat / GRID_DEG);
  let best = Infinity;
  for (let dx = -NEAREST_RING_MAX; dx <= NEAREST_RING_MAX; dx += 1) {
    for (let dy = -NEAREST_RING_MAX; dy <= NEAREST_RING_MAX; dy += 1) {
      const list = roadGrid.get(`${bx + dx},${by + dy}`);
      if (!list) continue;
      for (const c of list) {
        const d = haversineKm(target, c);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// ── 抓取 ────────────────────────────────────────────────────────────────────
function buildQuery(bbox) {
  const [s, w, n, e] = bbox;
  const parts = [];
  for (const f of POI_FILTERS) {
    const re = f.values.join('|');
    parts.push(`node["${f.tag}"~"^(${re})$"](${s},${w},${n},${e});`);
  }
  return `[out:json][timeout:180];(${parts.join('')});out body;`;
}

function cachePath(code) {
  return join(CACHE_DIR, `poi-${code}.json`);
}

async function fetchProvince(prov) {
  const cp = cachePath(prov.code);
  if (existsSync(cp)) {
    try {
      const cached = JSON.parse(readFileSync(cp, 'utf8'));
      if (Array.isArray(cached)) return { code: prov.code, name: prov.name, rows: cached, from: 'cache' };
    } catch {
      /* 坏缓存重抓 */
    }
  }
  const elements = await overpassQuery(buildQuery(prov.bbox), 200);
  const rows = elements
    .filter((el) => el && (el.type === 'node' || el.type === 'way'))
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      return { id: `${el.type}/${el.id}`, lat, lon, tags: el.tags ?? {} };
    })
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cp, JSON.stringify(rows), 'utf8');
  return { code: prov.code, name: prov.name, rows, from: 'net' };
}

/**
 * 取名优先级：中文名 → 本地名 → 英文名。
 * OSM 上大量点只有 `name:en` 而 `name` 缺失，若优先取 name 会让沿程景点显示成
 * "Kalinchowk Temple" 这种外国地名（实测 1066 条）。中文优先能显著提升可读性。
 */
function pickName(t) {
  const zh = String(t['name:zh'] ?? t['name:zh-Hans'] ?? '').trim();
  if (zh) return zh;
  const local = String(t.name ?? '').trim();
  if (local) return local;
  return String(t['name:en'] ?? '').trim();
}

/** 中国大陆大致范围（含海南、东北、西藏边境），用于剔除国境外的邻国景点 */
const CN_BOUNDS = { minLng: 73.4, maxLng: 135.1, minLat: 17.8, maxLat: 53.6 };

/** 元素 → 景点条目；返回 null 表示不合格（无名 / 无法分类 / 境外 / 超距） */
function toSpot(row, provName) {
  const t = row.tags ?? {};
  const name = pickName(t);
  if (!name || name.length < 2) return null;
  if (row.lon < CN_BOUNDS.minLng || row.lon > CN_BOUNDS.maxLng) return null;
  if (row.lat < CN_BOUNDS.minLat || row.lat > CN_BOUNDS.maxLat) return null;
  if (!isAdmissibleHarvestPoi({ lng: row.lon, lat: row.lat, name, tags: t })) return null;
  // 乐园/景区内部的单个游乐设施、店铺、餐饮：类别与真景点重叠，只能按名称剔除
  if (FACILITY_NAME_RE.test(name)) return null;
  if (/(坑道|砲陣|據點|据点|觀測所|观测所|碉堡|鐵漢堡|铁汉堡|鐵堡)/.test(name)) return null;
  let cat = null;
  for (const f of POI_FILTERS) {
    const v = t[f.tag];
    if (v && CATEGORY_MAP[`${f.tag}=${v}`]) {
      cat = CATEGORY_MAP[`${f.tag}=${v}`];
      break;
    }
  }
  if (!cat) return null;

  let score = BASE_SCORE[cat] ?? 50;
  if (t.wikipedia || t['wikipedia:zh']) score += 12;
  if (t.website || t.url) score += 4;
  if (t.image || t['image:zh']) score += 4;
  if (t['name:zh']) score += 3;
  if (t.description) score += 3;
  if (t.tourism === 'viewpoint' && t.fee === 'yes') score += 2;
  score = Math.max(20, Math.min(96, Math.round(score)));

  const km = nearestRoadKm(row.lon, row.lat);
  // 超过 MAX_ROAD_KM 的不算"公路侧"景点（路网补全后可重跑纳入）
  if (!Number.isFinite(km) || km > MAX_ROAD_KM) return null;
  if (score < MIN_SCORE) return null;
  const detourKm = Math.round(km * 100) / 100;

  const bits = [];
  if (t.description) bits.push(String(t.description).slice(0, 80));
  else if (t['description:zh']) bits.push(String(t['description:zh']).slice(0, 80));

  return {
    id: `osm-${row.id.replace('/', '-')}`,
    name,
    lng: Math.round(row.lon * 1e5) / 1e5,
    lat: Math.round(row.lat * 1e5) / 1e5,
    province: provinceOfPoint(row.lon, row.lat, provName) || provName,
    tier: tierOf(score),
    category: cat,
    score,
    visibility: visibilityOf(Number.isFinite(km) ? km : 99),
    detourKm,
    canPark: t.parking === 'yes' || t['parking:lane'] === 'yes' || false,
    intro: bits[0] ?? '',
    source: 'osm_batch',
    verified: false,
    // 优先保留中文相关键，避免 Object.entries 前 12 个把 name:zh 挤掉
    osmTags: (() => {
      const prefer = [
        'name:zh',
        'name:zh-Hans',
        'name:zh-Hant',
        'name',
        'name:en',
        'wikipedia:zh',
        'wikipedia',
        'wikidata',
        'tourism',
        'natural',
        'ele',
        'addr:country',
      ];
      const out = [];
      const seen = new Set();
      for (const k of prefer) {
        if (t[k] != null && t[k] !== '') {
          out.push([k, t[k]]);
          seen.add(k);
        }
      }
      for (const [k, v] of Object.entries(t)) {
        if (seen.has(k) || v == null || v === '') continue;
        out.push([k, v]);
        if (out.length >= 16) break;
      }
      return Object.fromEntries(out.slice(0, 16));
    })(),
  };
}

async function runHarvest() {
  const targets = ONLY_PROV ? PROVINCE_BBOXES.filter((p) => ONLY_PROV.includes(p.code)) : PROVINCE_BBOXES;
  console.log(`[harvest] 目标省份 ${targets.length} 个，并发 ${CONCURRENCY}`);
  const results = [];
  const queue = targets.slice();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const prov = queue.shift();
      if (!prov) return;
      try {
        const r = await fetchProvince(prov);
        results.push({ code: prov.code, name: prov.name, count: r.rows.length, from: r.from });
        console.log(`  ${prov.name} ${r.rows.length} 条（${r.from}）`);
      } catch (e) {
        results.push({ code: prov.code, name: prov.name, count: 0, error: e.message });
        console.log(`  ${prov.name} 失败：${e.message}`);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ── 合并 ────────────────────────────────────────────────────────────────────
function loadAllCached() {
  const out = [];
  for (const prov of PROVINCE_BBOXES) {
    const cp = cachePath(prov.code);
    if (!existsSync(cp)) continue;
    try {
      const rows = JSON.parse(readFileSync(cp, 'utf8'));
      if (Array.isArray(rows)) out.push({ prov, rows });
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const roadPtCount = loadRoadGeometry();
  console.log(`[harvest] 已绘公路点 ${roadPtCount} 个（用于距离分档）`);

  let fetchLog = [];
  if (!MERGE_ONLY) {
    fetchLog = await runHarvest();
  } else {
    console.log('[harvest] --merge-only：跳过抓取，直接读缓存');
    for (const prov of PROVINCE_BBOXES) {
      const cp = cachePath(prov.code);
      if (existsSync(cp)) fetchLog.push({ code: prov.code, name: prov.name, count: 0, from: 'cache' });
    }
  }

  const cached = loadAllCached();
  const seen = new Set();
  const candidates = [];
  for (const { prov, rows } of cached) {
    for (const row of rows) {
      const spot = toSpot(row, prov.name);
      if (!spot) continue;
      if (seen.has(spot.id)) continue;
      seen.add(spot.id);
      candidates.push(spot);
    }
  }
  // 密度抑制：同一 0.01° 格内只留分数最高的若干条，避免城市密集区一个商圈贡献几十条
  const cells = new Map();
  for (const s of candidates) {
    const k = `${Math.floor(s.lng * 100)},${Math.floor(s.lat * 100)}`;
    const list = cells.get(k);
    if (list) list.push(s);
    else cells.set(k, [s]);
  }
  const thinned = [];
  for (const list of cells.values()) {
    if (list.length <= PER_CELL_KEEP) {
      thinned.push(...list);
      continue;
    }
    list.sort((a, b) => b.score - a.score);
    thinned.push(...list.slice(0, PER_CELL_KEEP));
  }
  // 分类配额：各类别按分数取前 N，避免单一类别（如 natural=peak）淹没整张地图
  const quotaBuckets = new Map();
  for (const s of thinned) {
    const list = quotaBuckets.get(s.category);
    if (list) list.push(s);
    else quotaBuckets.set(s.category, [s]);
  }
  let kept = [];
  for (const [cat, list] of quotaBuckets) {
    const quota = CATEGORY_QUOTA[cat] ?? DEFAULT_QUOTA;
    if (list.length <= quota) {
      kept.push(...list);
      continue;
    }
    list.sort((a, b) => b.score - a.score || a.detourKm - b.detourKm);
    kept.push(...list.slice(0, quota));
  }
  if (CAP > 0 && kept.length > CAP) {
    kept.sort((a, b) => b.score - a.score || a.detourKm - b.detourKm);
    kept = kept.slice(0, CAP);
  }
  console.log(
    `[harvest] 候选 ${candidates.length} → 密度抑制 ${thinned.length} → 分类配额 ${kept.length} 条（cap=${CAP}）`,
  );
  candidates.length = 0;
  candidates.push(...kept);

  // 与既有库去重：同名且 800m 内视为同一处，既有优先
  const file = JSON.parse(readFileSync(SPOTS_PATH, 'utf8'));
  const existing = Array.isArray(file.spots) ? file.spots : [];
  const existingKeys = new Set();
  for (const s of existing) {
    existingKeys.add(`${s.name}@${Math.round((s.lng ?? 0) * 20)},${Math.round((s.lat ?? 0) * 20)}`);
    existingKeys.add(s.name);
  }
  const added = candidates.filter((s) => {
    const k = `${s.name}@${Math.round(s.lng * 20)},${Math.round(s.lat * 20)}`;
    return !existingKeys.has(k) && !existingKeys.has(s.name);
  });
  console.log(`[harvest] 去重后新增 ${added.length} 条（既有 ${existing.length} 条保留）`);

  const merged = existing.concat(added);
  const byCat = {};
  for (const s of merged) byCat[s.category] = (byCat[s.category] ?? 0) + 1;
  const native = merged.filter((s) => !String(s.source).startsWith('migrated'));
  const withProv = merged.filter((s) => s.province);

  const report = {
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    provinces: fetchLog,
    candidateCount: candidates.length,
    addedCount: added.length,
    beforeCount: existing.length,
    afterCount: merged.length,
    nativeCount: native.length,
    migratedCount: merged.length - native.length,
    withProvinceCount: withProv.length,
    byCategory: Object.fromEntries(Object.entries(byCat).sort((a, b) => b[1] - a[1])),
    roadPointCount: roadPtCount,
  };

  if (DRY) {
    console.log('[harvest] --dry：不落盘');
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  file.spots = merged;
  file.updated = new Date().toISOString().slice(0, 10);
  file.note =
    `公路侧景点库：既有手工种子 + OSM 全国批量抓取（${added.length} 条，source=osm_batch）；` +
    `另有 ${merged.length - native.length} 条早期从铁路侧迁移（source=migrated:*），公路网默认不展示。`;
  writeFileSync(SPOTS_PATH, JSON.stringify(file, null, 0), 'utf8');
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[harvest] 已写入 ${SPOTS_PATH}：${existing.length} → ${merged.length}`);
  console.log(`[harvest] 报告 ${REPORT_PATH}`);
  console.log(JSON.stringify(report.byCategory, null, 2));
}

main().catch((e) => {
  console.error('[harvest] 失败', e);
  process.exit(1);
});
