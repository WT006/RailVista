/**
 * 高德候选采集脚本（路线补全 · 数据抓取层）
 * ────────────────────────────────────────────────────────────
 * 对指定 L1 路线，沿其 nodes 的真实坐标，用高德「周边搜索」(v3/place/around)
 * 抓取路线沿线的真实景点候选（名称 / 精确坐标 / 类型 / 评分 / 地址 / 行政区划）。
 *
 * 设计纪律：
 *   - 本脚本【只抓取、不编造】。它把高德返回的真实 POI 落盘成候选清单，
 *     由人工/受控流程筛选可准确描述的重点景点再写进路线文件。
 *   - 带本地缓存 tmp/amap-cache/：同一查询不重复打 API，省配额、可离线复核。
 *   - 带限速（每次请求间隔 ~250ms），避免触发高德频控。
 *
 * 用法：
 *   node scripts/amap-enrich-candidates.mjs <routeId> [routeId ...]
 *   node scripts/amap-enrich-candidates.mjs --all-l1
 *
 * 输出：
 *   tmp/amap-candidates/<routeId>.json  —— 候选清单（已去重）
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 绕过本机系统代理，直连高德（避免 spawn curl 被安全策略 EBUSY 拦截）
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';
process.env.HTTPS_PROXY = '';
process.env.HTTP_PROXY = '';

const KEY = '5c4da48f09d20c88e18e51c252b65416';
const RB_DIR = 'data/presets/roadbooks';
const CACHE_DIR = 'tmp/amap-cache';
const OUT_DIR = 'tmp/amap-candidates';
mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 调高德接口，带缓存。返回已解析 JSON。 */
async function amap(path, params) {
  const cacheKey = path.replace(/\//g, '_') + '__' + params.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 120);
  const cf = join(CACHE_DIR, cacheKey + '.json');
  if (existsSync(cf)) return JSON.parse(readFileSync(cf, 'utf8'));
  const url = `https://restapi.amap.com${path}?key=${KEY}&${params}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status !== '1') {
    console.warn(`  [WARN] 高德返回非成功 status=${data.status} info=${data.info} url=${url}`);
  }
  writeFileSync(cf, JSON.stringify(data));
  return data;
}

/** 在全部路书文件里按 id 找路线 */
function findRoute(id) {
  for (const f of readdirSync(RB_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
    const data = JSON.parse(readFileSync(join(RB_DIR, f), 'utf8'));
    const r = data.routes.find((r) => r.id === id);
    if (r) return { file: f, route: r };
  }
  return null;
}

function listL1Routes() {
  const out = [];
  for (const f of readdirSync(RB_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
    const data = JSON.parse(readFileSync(join(RB_DIR, f), 'utf8'));
    for (const r of data.routes) {
      const layer = r.layer || (r.tier === 'national' ? 'L1' : r.tier === 'regional' ? 'L2' : r.days <= 2 ? 'L4' : 'L3');
      if (layer === 'L1') out.push({ id: r.id, file: f, name: r.name, days: r.days, poiCount: (r.pois || []).length });
    }
  }
  return out;
}

/** 把高德 typecode / type 粗映射到我们的 poiCategory（仅供初筛，写库时人工校正） */
function guessCategory(type, name) {
  const t = (type || '') + ' ' + (name || '');
  if (/寺|庙|教堂|清真寺|宫观|道观|庵|窟寺/.test(t)) return 'temple';
  if (/遗址|古迹|古城|长城|石窟|陵|墓|碑|故居|衙门|王府|城墙|关隘|烽燧/.test(t)) return 'ruin';
  if (/博物|展览|文化|非遗|民俗|纪念馆|艺术馆|书院|学堂/.test(t)) return 'culture';
  if (/湖|河|江|湿地|海|峡|瀑布|温泉|水库|湾|潭/.test(t)) return 'water';
  if (/山|峰|雪山|冰川|峰林|岗|岭/.test(t)) return 'mountain';
  if (/草原|草甸|牧场|绿洲/.test(t)) return 'grassland';
  if (/沙漠|戈壁|雅丹|丹霞/.test(t)) return 'desert';
  if (/林|谷|峡|竹海|原始森林/.test(t)) return 'forest';
  if (/村|镇|寨|屯|古城村|古村落/.test(t)) return 'village';
  if (/公园|广场|观景台|城市|街区|步行街/.test(t)) return 'cityview';
  if (/美食|小吃|餐厅|夜市/.test(t)) return 'food';
  return 'landform';
}

/** 沿单个节点周边搜索，翻页取全 */
async function searchAround(node, radius = 45000) {
  const loc = `${node.lng},${node.lat}`;
  const all = [];
  let page = 1;
  // 风景名胜大类 + 科教文化(博物馆等)
  for (const types of ['110000', '140000']) {
    page = 1;
    while (true) {
      const params = `location=${loc}&radius=${radius}&types=${types}&offset=25&page=${page}&sortrule=weight`;
      const data = await amap('/v3/place/around', params);
      if (data.status !== '1' || !data.pois) break;
      for (const p of data.pois) all.push(p);
      if (data.pois.length < 25) break;
      page += 1;
      if (page > 6) break; // 防御：单类型最多 150 条
      await sleep(220);
    }
    await sleep(220);
  }
  return all;
}

function dedupKey(p) {
  // 名称 + 坐标取整到 3 位小数（~100m）
  const [lng, lat] = (p.location || '').split(',').map((n) => (n ? +(+n).toFixed(3) : 0));
  return `${p.name}@${lng},${lat}`;
}

async function collectForRoute(routeId) {
  const found = findRoute(routeId);
  if (!found) {
    console.error(`未找到路线 ${routeId}`);
    process.exit(1);
  }
  const { file, route } = found;
  console.log(`\n=== ${routeId}（${route.name}，${file}）节点 ${route.nodes.length} 个，现有 POI ${route.pois.length} ===`);
  const seen = new Map();
  for (const node of route.nodes) {
    if (!Number.isFinite(node.lng) || !Number.isFinite(node.lat)) continue;
    console.log(`  节点 ${node.name} (${node.lng},${node.lat}) …`);
    const pois = await searchAround(node);
    for (const p of pois) {
      const k = dedupKey(p);
      if (seen.has(k)) {
        // 合并：保留评分更高 / 信息更全的
        const ex = seen.get(k);
        if ((+((p.biz_ext && p.biz_ext.rating) || 0)) > +((ex.rating) || 0)) seen.set(k, p);
        continue;
      }
      seen.set(k, p);
    }
    await sleep(120);
  }
  // 转成候选结构
  const candidates = [...seen.values()].map((p) => {
    const [lng, lat] = (p.location || '').split(',').map(Number);
    const rating = (p.biz_ext && p.biz_ext.rating) || '';
    const cost = (p.biz_ext && p.biz_ext.cost) || '';
    const openTime = (p.biz_ext && p.biz_ext.open_time) || '';
    const level = (p.biz_ext && p.biz_ext.level) || (p.keytag || '').split(',')[0] || '';
    return {
      name: p.name,
      lng: +lng.toFixed(5),
      lat: +lat.toFixed(5),
      amapType: p.type || '',
      typecode: p.typecode || '',
      category: guessCategory(p.type, p.name),
      rating: rating ? +rating : null,
      cost: cost ? String(cost) : null,
      level: level || null,
      openTime: openTime ? String(openTime).slice(0, 60) : null,
      adname: p.adname || '',
      cityname: p.cityname || '',
      pname: p.pname || '',
      address: p.address || '',
      amapId: p.id || '',
    };
  });
  // 按评分降序，便于人工优先挑重点
  candidates.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  const out = {
    routeId,
    routeName: route.name,
    file,
    collectedAt: new Date().toISOString().slice(0, 10),
    nodeCount: route.nodes.length,
    existingPoiCount: route.pois.length,
    candidateCount: candidates.length,
    candidates,
  };
  const outPath = join(OUT_DIR, `${routeId}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`  → 候选 ${candidates.length} 条，落盘 ${outPath}`);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--all-l1')) {
    const l1 = listL1Routes();
    console.log(`L1 路线共 ${l1.length} 条`);
    for (const r of l1) await collectForRoute(r.id);
  } else if (args.length) {
    for (const id of args) await collectForRoute(id);
  } else {
    console.error('用法: node scripts/amap-enrich-candidates.mjs <routeId> [routeId ...] | --all-l1');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
