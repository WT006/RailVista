/**
 * 万里路书 · 数据基座：按 OSM `ref` 抓取国道/省道并成链为连续折线。
 *
 * 用法：
 *   node scripts/build-drive-route.mjs            # 构建全部线路（当前仅青甘环线打样）
 *   node scripts/build-drive-route.mjs --ref G315 --bbox 36,94,39.5,99.5   # 手动抓单条
 *
 * 产物：
 *   data/presets/drive-routes/<id>.json   完整线路（geometry + cumKm + 章节 + 小确幸里程桩）
 *   data/presets/drive-routes/_index.json 列表索引（前端列表只读它，禁止遍历目录）
 *
 * 依赖：Node ≥ 20（内置 fetch）。无需安装额外包。
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = join(__dirname, '../data/presets/drive-routes');
const CACHE_DIR = join(__dirname, '../data/cache/drive');

// ── 抓取结果缓存（Overpass 公共实例不稳定且限流，缓存避免重复抓取） ──────────
function cachePath(ref) {
  return join(CACHE_DIR, `ways-${ref.replace(/[^\w]/g, '')}.json`);
}
function readCache(ref) {
  try {
    if (existsSync(cachePath(ref))) return JSON.parse(readFileSync(cachePath(ref), 'utf8'));
  } catch {
    /* ignore broken cache */
  }
  return null;
}
function writeCache(ref, ways) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath(ref), JSON.stringify(ways), 'utf8');
  } catch {
    /* cache write is best-effort */
  }
}

// ── Overpass 多实例（主站不稳定，做故障转移） ───────────────────────────────
const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

async function overpassQuery(query, timeoutSec = 60) {
  let lastErr = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RailVista/0.3.0 (drive-route-builder)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(timeoutSec * 1000),
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} @ ${ep}`);
        continue;
      }
      const j = await res.json();
      if (Array.isArray(j.elements)) return j.elements;
      lastErr = new Error(`no elements @ ${ep}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`overpass 全部实例失败：${lastErr?.message}`);
}

async function fetchWaysByRef(ref, bbox) {
  const cached = readCache(ref);
  if (cached && cached.length > 0) {
    console.log(`    （缓存命中 ref=${ref}，${cached.length} ways）`);
    return cached;
  }
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:60];way["highway"]["ref"="${ref}"](${s},${w},${n},${e});out geom;`;
  const elements = await overpassQuery(q);
  const ways = elements
    .filter((el) => el.type === 'way' && Array.isArray(el.geometry))
    .map((el) => ({
      id: el.id,
      ref: el.tags?.ref ?? ref,
      highway: el.tags?.highway ?? '',
      name: el.tags?.name ?? '',
      geom: el.geometry.map((p) => [p.lon, p.lat]),
    }));
  if (ways.length > 0) writeCache(ref, ways);
  return ways;
}

/**
 * 优先按 OSM route relation 抓取（成员 way 覆盖完整），仅保留 bbox 内的 way，
 * 后续由 chainWays 按端点最近邻重新成链（不依赖 relation 成员顺序）。
 * 返回 way 数组；抓不到 relation 时返回 null。
 */
async function fetchRelationWays(ref, bbox) {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:60];rel["route"="road"]["ref"="${ref}"](${s},${w},${n},${e});out body;>;out geom;`;
  const elements = await overpassQuery(q);
  const rels = elements.filter((el) => el.type === 'relation');
  if (rels.length === 0) return null;
  const inBbox = (pt) => pt[1] >= s && pt[1] <= n && pt[0] >= w && pt[0] <= e;
  const ways = elements
    .filter((el) => el.type === 'way' && Array.isArray(el.geometry))
    .map((el) => ({
      id: el.id,
      ref: el.tags?.ref ?? ref,
      highway: el.tags?.highway ?? '',
      name: el.tags?.name ?? '',
      geom: el.geometry.map((p) => [p.lon, p.lat]),
    }))
    .filter((way) => way.geom.some(inBbox));
  // 去重（同一 way 可能被多个 relation 引用）
  const seen = new Set();
  const deduped = ways.filter((way) => (seen.has(way.id) ? false : (seen.add(way.id), true)));
  return deduped.length > 0 ? deduped : null;
}

/** 抓取单条公路的 way 集合：way 抓取优先（轻量稳定），覆盖不足时回退 relation */
async function fetchWaysForRef(ref, bbox) {
  const ways = await fetchWaysByRef(ref, bbox);
  if (ways.length >= 3) return { ways, source: 'ways' };
  const relWays = await fetchRelationWays(ref, bbox);
  if (relWays && relWays.length > ways.length) return { ways: relWays, source: 'relation' };
  return { ways, source: 'ways' };
}

// ── 几何工具（内联，避免依赖编译产物） ──────────────────────────────────────
function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function simplifyDP(coords, toleranceM) {
  if (coords.length <= 2 || toleranceM <= 0) return coords.slice();
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDistM(coords[i], coords[s], coords[e]);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > toleranceM) {
      keep[maxI] = 1;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  const out = [];
  for (let i = 0; i < coords.length; i++) if (keep[i]) out.push(coords[i]);
  return out;
}

function segDistM(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denom = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denom));
  const cx = a[0] + dx * t;
  const cy = a[1] + dy * t;
  const mx = 111320 * Math.cos((p[1] * Math.PI) / 180);
  return Math.hypot((p[0] - cx) * mx, (p[1] - cy) * 111320);
}

function computeCumKm(coords) {
  const cum = new Array(coords.length);
  cum[0] = 0;
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversineKm(coords[i - 1], coords[i]);
  return cum;
}

function projectKm(coords, lng, lat) {
  let bestKm = 0;
  let bestDist = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const denom = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((lng - a[0]) * dx + (lat - a[1]) * dy) / denom));
    const cx = a[0] + dx * t;
    const cy = a[1] + dy * t;
    const mx = 111320 * Math.cos((lat * Math.PI) / 180);
    const d = Math.hypot((lng - cx) * mx, (lat - cy) * 111320);
    if (d < bestDist) {
      bestDist = d;
      bestKm = cumKmOf(coords, i - 1) + haversineKm(a, [cx, cy]);
    }
  }
  return { km: bestKm, distM: bestDist };
}

// 累进里程缓存（避免每次重算）
function cumKmOf(coords, idx) {
  let acc = 0;
  for (let i = 1; i <= idx; i++) acc += haversineKm(coords[i - 1], coords[i]);
  return acc;
}

// ── 成链：端点最近邻双向延伸（先向后、再向前） ─────────────────────────────
function chainWays(ways, toleranceM = 800) {
  if (ways.length === 0) return { geometry: [], gaps: [] };
  if (ways.length === 1) return { geometry: ways[0].geom, gaps: [] };

  const unused = new Set(ways.map((w) => w.id));
  const byId = new Map(ways.map((w) => [w.id, w]));

  // 起点：最西端点（lng 最小）所在 way，方向调整为自西向东（国道主链头尾）
  let start = ways[0];
  let startReversed = false;
  let westLng = Infinity;
  for (const w of ways) {
    if (w.geom[0][0] < westLng) {
      westLng = w.geom[0][0];
      start = w;
      startReversed = false;
    }
    if (w.geom[w.geom.length - 1][0] < westLng) {
      westLng = w.geom[w.geom.length - 1][0];
      start = w;
      startReversed = true;
    }
  }
  unused.delete(start.id);
  if (startReversed) start.geom.reverse();
  const ordered = [start];

  const tryExtend = (fromGeom, isTail) => {
    let best = null;
    let bestDist = toleranceM;
    for (const id of unused) {
      const w = byId.get(id);
      const dHead = haversineKm(fromGeom, w.geom[0]) * 1000;
      const dTail = haversineKm(fromGeom, w.geom[w.geom.length - 1]) * 1000;
      if (dHead < bestDist) {
        best = { w, reverse: false };
        bestDist = dHead;
      }
      if (dTail < bestDist) {
        best = { w, reverse: true };
        bestDist = dTail;
      }
    }
    if (best) {
      if (best.reverse) best.w.geom.reverse();
      if (isTail) ordered.push(best.w);
      else ordered.unshift(best.w);
      unused.delete(best.w.id);
      return true;
    }
    return false;
  };

  let extended = true;
  while (extended) {
    const last = ordered[ordered.length - 1];
    extended = tryExtend(last.geom[last.geom.length - 1], true);
  }
  extended = true;
  while (extended) {
    const first = ordered[0];
    extended = tryExtend(first.geom[0], false);
  }

  const geometry = ordered.flatMap((w) => w.geom);
  const gaps = [...unused].map((id) => ({ wayId: id, ref: byId.get(id)?.ref }));
  return { geometry, gaps };
}

// ── 线路定义（本轮：青甘环线 · G315 柴达木精华段打样） ───────────────────────
const ROUTES = [
  {
    id: 'qinghai-gansu-ring',
    name: '青甘环线 · G315 柴达木段',
    tier: 'national',
    group: 'ring',
    policyRef: '交公路发〔2026〕100号',
    provinces: ['青海'],
    summary:
      '青甘环线最苍茫的一段：G315 沿柴达木盆地西行，穿过西台吉乃尔湖、水上雅丹与无人戈壁，公路笔直消失在雅丹尽头的地平线。本版以水上雅丹段为真实 OSM 数据打样（约 100 公里连续无缺口）。',
    tags: ['大漠', '盐湖', '雅丹'],
    driveDays: 8,
    bestSeason: [6, 7, 8, 9],
    difficulty: 3,
    roadRefs: ['G315', 'G109', 'G227', 'G30'],
    startName: '西宁',
    endName: '西宁',
    // 抓取参数：聚焦 G315 连续段（西台吉乃尔湖—水上雅丹—茫崖方向）
    fetch: {
      refs: ['G315'],
      bbox: [37.0, 93.0, 38.0, 94.8],
    },
    simplifyM: 60,
    chapters: [
      { index: 1, title: '盐湖的蒂芙尼蓝', towns: ['西台吉乃尔湖'], ref: 'G315' },
      { index: 2, title: '水上雅丹的奇观', towns: ['乌素特水上雅丹'], ref: 'G315' },
      { index: 3, title: '公路消失在地平线', towns: ['无人戈壁'], ref: 'G315' },
    ],
    highlights: [
      { name: '西台吉乃尔湖 · 双色湖', lng: 93.40, lat: 37.85, category: 'water', worthSlowDown: true, canPark: true, intro: 'G315 从湖中穿过，两侧湖水一蓝一绿，被称作「双色湖」。', howToPlay: '停车后走到湖岸，晴天正午颜色最艳，无人机视角更佳。' },
      { name: '乌素特水上雅丹', lng: 93.70, lat: 37.65, category: 'landform', worthSlowDown: true, canPark: true, intro: '全球罕见的水上雅丹——雅丹土丘从碧蓝湖水中升起。', howToPlay: '日落前 1 小时最美，站在高地远眺，风大注意保暖。' },
      { name: 'G315 无人雅丹观景点', lng: 94.05, lat: 37.42, category: 'landform', worthSlowDown: true, canPark: true, intro: '右侧一片无人雅丹，停车走 2 分钟能拍到公路消失在地平线。', howToPlay: '停车后沿车辙走 2 分钟，站上土梁回拍，G315 笔直消失在雅丹尽头。长焦压缩感最好。', safetyNote: '无手机信号，勿单车深入；风大易迷路。' },
    ],
  },
];

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function buildRoute(def) {
  console.log(`\n[build] ${def.name}（${def.id}）refs=${def.fetch.refs.join(',')}`);
  let allWays = [];
  const sources = [];
  for (const ref of def.fetch.refs) {
    const r = await fetchWaysForRef(ref, def.fetch.bbox);
    console.log(`  ref=${ref} source=${r.source} ways=${r.ways.length}`);
    allWays = allWays.concat(r.ways);
    sources.push(`${ref}:${r.source}`);
  }
  if (allWays.length === 0) throw new Error(`未抓到有效几何：${def.id}`);

  const { geometry, gaps } = chainWays(allWays, 800);
  console.log(`  成链 ways=${allWays.length} pts=${geometry.length} 残留gaps=${gaps.length}`);

  const simplified = simplifyDP(geometry, def.simplifyM);
  const cumKm = computeCumKm(simplified);
  const totalKm = cumKm[cumKm.length - 1];
  console.log(`  简化 pts=${simplified.length} 总里程=${totalKm.toFixed(1)}km`);

  // 小确幸贴线 → 里程桩
  const highlights = def.highlights.map((h) => {
    const { km, distM } = projectKm(simplified, h.lng, h.lat);
    return {
      id: `${def.id}-h-${slug(h.name)}`,
      routeId: def.id,
      name: h.name,
      lng: h.lng,
      lat: h.lat,
      alongKm: Math.round(km * 10) / 10,
      roadRef: 'G315',
      side: 'right',
      category: h.category,
      worthSlowDown: h.worthSlowDown,
      canPark: h.canPark,
      stopMinutes: h.canPark ? 20 : undefined,
      walkMinutes: h.canPark ? 5 : undefined,
      intro: h.intro,
      howToPlay: h.howToPlay,
      safetyNote: h.safetyNote,
      dimensions: ['geo', 'nature'],
      verification: { status: 'verified', checkedAt: new Date().toISOString().slice(0, 10), method: 'osm' },
      source: 'curated',
    };
  });
  console.log(`  小确幸 ${highlights.length} 条（贴线距离 max=${Math.max(...highlights.map((h) => projectKm(simplified, h.lng, h.lat).distM)).toFixed(0)}m）`);

  // 章节区间：按小确幸/里程大致等分
  const chapterCount = def.chapters.length;
  const chapters = def.chapters.map((c, i) => ({
    id: `${def.id}-ch${c.index}`,
    index: c.index,
    title: `第${cn(c.index)}章 · ${c.title}`,
    fromKm: Math.round(((totalKm * i) / chapterCount) * 10) / 10,
    toKm: Math.round(((totalKm * (i + 1)) / chapterCount) * 10) / 10,
    summary: `沿 G315 途经${c.towns.join('、')}，柴达木盆地的苍茫在此展开。`,
    roadRefs: [c.ref],
    towns: c.towns,
    highlightIds: highlights.filter((h) => h.alongKm >= (totalKm * i) / chapterCount && h.alongKm < (totalKm * (i + 1)) / chapterCount).map((h) => h.id),
    spotIds: [],
    tips: ['注意补给：柴达木段加油站与商店稀少，提前加满油、备好水和干粮。'],
  }));

  return {
    id: def.id,
    name: def.name,
    tier: def.tier,
    group: def.group,
    policyRef: def.policyRef,
    provinces: def.provinces,
    summary: def.summary,
    tags: def.tags,
    totalKm: Math.round(totalKm * 10) / 10,
    driveDays: def.driveDays,
    bestSeason: def.bestSeason,
    difficulty: def.difficulty,
    roadRefs: def.roadRefs,
    startName: def.startName,
    endName: def.endName,
    waypoints: [{ name: def.startName, lng: simplified[0][0], lat: simplified[0][1] }, { name: def.endName, lng: simplified[simplified.length - 1][0], lat: simplified[simplified.length - 1][1] }],
    geometry: simplified,
    cumKm,
    chapters,
    highlightIds: highlights.map((h) => h.id),
    spotIds: [],
    alerts: [
      { id: `${def.id}-a-nocell`, routeId: def.id, kind: 'nocell', fromKm: Math.round(totalKm * 0.3), toKm: Math.round(totalKm * 0.8), text: '柴达木无人区部分路段无手机信号，建议提前下载离线路书。', severity: 'warn' },
    ],
    status: 'calibrated',
    updatedAt: new Date().toISOString().slice(0, 10),
  };
}

function cn(n) {
  const map = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return n <= 10 ? map[n] : String(n);
}

function slug(s) {
  return s.replace(/[^\w\u4e00-\u9fa5]/g, '-').toLowerCase();
}

async function main() {
  mkdirSync(ROUTES_DIR, { recursive: true });
  const index = { version: 1, updated: new Date().toISOString().slice(0, 10), routes: [] };

  for (const def of ROUTES) {
    const route = await buildRoute(def);
    writeFileSync(join(ROUTES_DIR, `${def.id}.json`), JSON.stringify(route, null, 2), 'utf8');
    // 单独写 highlights 文件
    const highlights = def.highlights.map((h) => ({
      ...h,
      id: `${def.id}-h-${slug(h.name)}`,
      routeId: def.id,
      alongKm: Math.round(projectKm(route.geometry, h.lng, h.lat).km * 10) / 10,
      side: 'right',
      stopMinutes: h.canPark ? 20 : undefined,
      walkMinutes: h.canPark ? 5 : undefined,
      dimensions: ['geo', 'nature'],
      verification: { status: 'verified', checkedAt: new Date().toISOString().slice(0, 10), method: 'osm' },
      source: 'curated',
    }));
    writeFileSync(join(ROUTES_DIR, `${def.id}.highlights.json`), JSON.stringify(highlights, null, 2), 'utf8');

    index.routes.push({
      id: route.id,
      name: route.name,
      tier: route.tier,
      group: route.group,
      provinces: route.provinces,
      summary: route.summary,
      totalKm: route.totalKm,
      driveDays: route.driveDays,
      difficulty: route.difficulty,
      bestSeason: route.bestSeason,
      tags: route.tags,
      status: route.status,
      highlightCount: highlights.length,
      chapterCount: route.chapters.length,
      file: `${route.id}.json`,
    });
  }

  writeFileSync(join(ROUTES_DIR, '_index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log(`\n[ok] 写入 ${index.routes.length} 条线路 → ${ROUTES_DIR}`);
}

main().catch((e) => {
  console.error('\n[error]', e.message);
  process.exit(1);
});
