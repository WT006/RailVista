/**
 * 公路景点库重建 · 第 1 步：按地级市拉取高德「风景名胜」POI。
 *
 * 为什么换成高德全量 POI 而不是继续用 OSM：
 *   现库 12254 条里 11043 条是 `osm_batch`（OSM 的 tourism=attraction 一把抓），
 *   抓进来的是「晶彩奇航（迪士尼游乐项目）」「高海拔宇宙线观测站」这类东西，
 *   被统一贴上 viewpoint.landmark + 固定 score 77 + 空 intro —— 这就是「毛坯」的来源。
 *   高德的风景名胜类目是运营数据，名称/坐标/地址/行政区划可信，可作为重建的地基。
 *
 * 落盘原始响应到 tmp/amap-scenic-v2/（gitignore），**不做任何字段加工** ——
 * 过滤规则要反复调，缓存住原始结果才能不重复消耗配额。
 *
 * ## 为什么必须 extensions=all
 * 需求要求公路景点带上「评分 / 开放时间」，而 base 模式一条都不给。实测同一批
 * 稻城县 POI：all 模式 6/6 有 rating、4/6 有 open_time、6/6 有照片；base 模式全空。
 * 内容红线：biz_ext.cost（票价）**一律不落库**，只取 rating / open_time / 首张照片。
 *
 * 用法：node scripts/harvest-amap-scenic.mjs [--maxPages 10] [--only 甘孜藏族自治州,张家界市]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../tmp/amap-scenic-v2');
const ADMIN_PATH = join(__dirname, '../data/roads/places-admin.json');
const ENV_PATH = join(__dirname, '../apps/api/.env');

process.env.NO_PROXY = '*';
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) delete process.env[k];

function loadKey() {
  if (process.env.AMAP_SERVER_KEY) return process.env.AMAP_SERVER_KEY;
  if (existsSync(ENV_PATH)) {
    const lines = readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
    // 必须**先找 AMAP_SERVER_KEY 再找 AMAP_KEY**：两个 key 都在 .env 里，
    // 用 `AMAP_SERVER_KEY|AMAP_KEY` 一条正则扫会先命中 AMAP_KEY（那是前端 JS API key，
    // 调 restapi 恒返回 USERKEY_PLAT_NOMATCH，静默把整轮采集变成空结果）。
    for (const name of ['AMAP_SERVER_KEY', 'AMAP_KEY']) {
      for (const line of lines) {
        const m = new RegExp(`^\\s*${name}\\s*=\\s*(.*)\\s*$`).exec(line);
        if (m && m[1]) return m[1].replace(/^["']|["']$/g, '');
      }
    }
  }
  return '';
}
const KEY = loadKey();
if (!KEY) {
  console.error('缺少 AMAP_SERVER_KEY');
  process.exit(1);
}

const argv = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const MAX_PAGES = Number(argv('maxPages', 10));
const ONLY = argv('only', '') ? argv('only', '').split(',') : null;
const PAGE_SIZE = 20;

/** 高德 QPS 很紧，必须限速 + 退避重试 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function placeText(city, page, tries = 4) {
  let lastErr = "";
  const url =
    `https://restapi.amap.com/v3/place/text?key=${KEY}` +
    `&keywords=&city=${encodeURIComponent(city)}&types=110000` +
    `&offset=${PAGE_SIZE}&page=${page}&extensions=all`;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const j = await res.json();
      // ⚠️ 高德 v3/place/text 的返回体**不统一**：命中时常常只给 infocode/count/pois
      // 而**没有 status 字段**（实测 阿坝州/阿克苏地区 命中时无 status，空结果时才带
      // status:"1"）。只认 status 会把大量有效响应当成失败。判据改为
      // 「pois 是数组」或 infocode=10000 视为成功。
      if (Array.isArray(j.pois)) return j;
      if (j.infocode === '10000' || j.status === '1') return j;
      const info = j.info ?? j.infocode ?? '';
      if (/CUQPS|OVER_LIMIT|USERKEY_PLAT_NOMATCH|TOO_FREQUENT|1002[0-9]/.test(String(info))) {
        await sleep(1500 * (i + 1));
        continue;
      }
      return { status: '0', info: String(info) || 'unknown' };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await sleep(900 * (i + 1));
    }
  }
  console.warn(`   ! ${city} p${page} 拉取失败${lastErr ? `（${lastErr}）` : ''}`);
  return null;
}

// ── 城市清单：行政区划库的地级市 + 四个直辖市 ─────────────────────────────────
const admin = JSON.parse(readFileSync(ADMIN_PATH, 'utf8'));
const SKIP_PROVINCE = new Set(['台湾', '香港', '澳门']); // 路网未覆盖，先不采
const cities = admin.places
  .filter((p) => p.level === 'city' && !SKIP_PROVINCE.has(p.province))
  .map((p) => p.name);
for (const m of ['北京', '上海', '天津', '重庆']) cities.push(m);
const list = ONLY ?? [...new Set(cities)].sort((a, b) => a.localeCompare(b, 'zh'));

mkdirSync(CACHE_DIR, { recursive: true });
console.log(`待采城市 ${list.length} 个，每城最多 ${MAX_PAGES} 页（${MAX_PAGES * PAGE_SIZE} 条）`);

const t0 = Date.now();
let apiCalls = 0;
let saved = 0;
let poiTotal = 0;

for (let ci = 0; ci < list.length; ci += 1) {
  const city = list[ci];
  const outFile = join(CACHE_DIR, `${city.replace(/[\\/:*?"<>|]/g, '_')}.json`);
  if (existsSync(outFile)) {
    try {
      const done = JSON.parse(readFileSync(outFile, 'utf8'));
      poiTotal += done.pois?.length ?? 0;
      saved += 1;
      continue;
    } catch {
      /* 缓存损坏则重采 */
    }
  }
  const pois = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const j = await placeText(city, page);
    apiCalls += 1;
    // ⚠️ 不能用 `j.status !== '1'` 判失败：高德命中时返回体常常只给
    // infocode/count/pois 而**没有 status**（实测 阿坝州 / 阿克苏地区），
    // 那样会在第 1 页之后就 break，整城只剩 20 条。统一按「pois 是数组」判成功。
    if (!j || !Array.isArray(j.pois)) break;
    const got = j.pois;
    pois.push(...got);
    if (got.length < PAGE_SIZE) break;
    page += 1;
    await sleep(420);
  }
  writeFileSync(
    outFile,
    JSON.stringify({ city, harvestedAt: new Date().toISOString().slice(0, 10), count: pois.length, pois }, null, 1),
    'utf8',
  );
  poiTotal += pois.length;
  saved += 1;
  if ((ci + 1) % 20 === 0 || ci === list.length - 1) {
    console.log(
      `  ${ci + 1}/${list.length}  累计城市 ${saved} / POI ${poiTotal} / API ${apiCalls} 次 / ${Math.round((Date.now() - t0) / 1000)}s`,
    );
  }
  await sleep(300);
}

console.log(`\n完成：${saved} 城 / ${poiTotal} 条 POI / ${apiCalls} 次请求 / ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`缓存目录：tmp/amap-scenic/`);
