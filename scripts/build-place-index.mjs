/**
 * 万里路书 · 自驾 OD 端点地名索引（省 / 地级市 / 区县，含坐标）。
 *
 * 背景：data/roads/places-geo.json 只有 219 条（34 省 / 117 市 / 68 区县），
 * 「起点 / 终点」输入框联想不到绝大多数区县，只能靠运行时网络 geocode 兜底
 * （且 apps/api 配的 AMAP_KEY 是 Web 端 key，调 Web 服务接口恒返回
 * USERKEY_PLAT_NOMATCH，等于兜底也是断的）。
 *
 * 本脚本一次性拉取高德行政区划（v3/config/district，subdistrict=2）落盘为
 * data/roads/places-admin.json —— 离线可查、随 mtime 热重载，运行时不再依赖网络。
 *
 * 用法：node scripts/build-place-index.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../data/roads/places-admin.json');
const ENV_PATH = join(__dirname, '../apps/api/.env');

/** 本机有系统代理，Node fetch 直连外部必须关掉（NO_PROXY='*'） */
process.env.NO_PROXY = '*';
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) delete process.env[k];

function loadKey() {
  if (process.env.AMAP_SERVER_KEY) return process.env.AMAP_SERVER_KEY;
  if (existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(AMAP_SERVER_KEY|AMAP_KEY)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[2]) return m[2].replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

const KEY = loadKey();
if (!KEY) {
  console.error('缺少高德 Web 服务 key：请在 apps/api/.env 配置 AMAP_SERVER_KEY=…');
  process.exit(1);
}

/** GCJ-02 → WGS-84（与 @railvista/shared 的 gcj02ToWgs84 同算法） */
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}
function gcj02ToWgs84(lng, lat) {
  if (outOfChina(lng, lat)) return { lng, lat };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lng: lng - dLng, lat: lat - dLat };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round6 = (v) => Number(v.toFixed(6));

/** 高德 QPS 限制很紧（实测连发 3 次就 CUQPS_HAS_EXCEEDED_THE_LIMIT），必须限速 + 退避重试 */
async function district(keyword, subdistrict, tries = 4) {
  for (let i = 0; i < tries; i += 1) {
    const url =
      `https://restapi.amap.com/v3/config/district?key=${KEY}` +
      `&keywords=${encodeURIComponent(keyword)}&subdistrict=${subdistrict}&extensions=base&output=JSON`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const json = await res.json();
      if (json.status === '1') return json.districts ?? [];
      if (/CUQPS|OVER_LIMIT|USERKEY_PLAT_NOMATCH/.test(json.info ?? '')) {
        await sleep(1200 * (i + 1));
        continue;
      }
      return [];
    } catch {
      await sleep(800 * (i + 1));
    }
  }
  console.warn(`  ! 「${keyword}」拉取失败（已重试 ${tries} 次）`);
  return [];
}

function parseCenter(center) {
  if (!center) return null;
  const [gLng, gLat] = center.split(',').map(Number);
  if (!Number.isFinite(gLng) || !Number.isFinite(gLat)) return null;
  const w = gcj02ToWgs84(gLng, gLat);
  return { lng: round6(w.lng), lat: round6(w.lat) };
}

/**
 * 名称归一：只剥「纯行政类型后缀」，绝不伤及专名。
 *   西藏自治区 → 西藏 ；新疆维吾尔自治区 → 新疆 ；拉萨市 → 拉萨
 *   湘西土家族苗族自治州 / 神农架林区 之类**不剥**（"自治州""林区"是专名的一部分）
 *   区县级保留「区/县/市」后缀（"嘉定" 与 "嘉定区" 都能命中，"长沙县" 不丢）
 */
function normalizeName(raw, level) {
  const n = (raw ?? '').trim();
  if (!n) return '';
  if (level === 'province') {
    return (
      n
        .replace(/(省|市|自治区|特别行政区)$/, '')
        // 自治区剥完还剩民族名（新疆维吾尔 / 广西壮族 / 宁夏回族），再剥一层拿通用简称
        .replace(/(维吾尔|壮族|回族)$/, '') || n
    );
  }
  if (level === 'city') return n.replace(/市$/, '') || n;
  return n;
}

/** 高德 level → 本地 level（street 级不入库：OD 端点用不到，且会撑爆索引） */
const LEVEL_MAP = { province: 'province', city: 'city', district: 'county' };

/**
 * 高德会给直辖市塞「XX城区 / XX郊县」这类虚拟地级单元（上海城区、北京城区、重庆郊县），
 * 它们不是真实地名，且会被写成下属区县的 city 字段。地级层一律剔除，
 * 区县的 city 回落到省名。注意：区**县级**的「老城区/禅城区」是真区县，不能一起删。
 */
const PSEUDO_CITY_RE = /(城区|郊县)$/;

const places = [];
const seen = new Set(); // 全局按 name 去重：端点解析取 top-1，同名会造成错配

function add(level, name, province, city, center) {
  if (!name || seen.has(name)) return false;
  if (level === 'city' && PSEUDO_CITY_RE.test(name)) return false;
  const pt = parseCenter(center);
  if (!pt) return false;
  places.push({ name, lng: pt.lng, lat: pt.lat, province, city: city || undefined, level });
  seen.add(name);
  return true;
}

const t0 = Date.now();
const roots = await district('中国', 1);
const provinces = roots[0]?.districts ?? [];
console.log(`省级 ${provinces.length} 个`);

for (const p of provinces) {
  const pName = normalizeName(p.name, 'province');
  add('province', pName, pName, undefined, p.center);

  // subdistrict=2：一次拿到「地级市 + 其下区县」
  const kids = await district(p.adcode || p.name, 2);
  const cities = (kids[0]?.districts ?? kids) || [];
  let cityCount = 0;
  let countyCount = 0;
  for (const c of cities) {
    const cName = normalizeName(c.name, LEVEL_MAP[c.level] === 'county' ? 'district' : 'city');
    if (LEVEL_MAP[c.level] === 'county') {
      // 直辖市省本级下直接挂区（如北京市 → 东城区）：当作县级入库
      if (add('county', cName, pName, pName, c.center)) countyCount += 1;
      continue;
    }
    if (add('city', cName, pName, undefined, c.center)) cityCount += 1;
    // 直辖市下辖区县的 city 就是「上海城区」这类虚拟单元，回落到省名（"上海"）才是对的
    const cityLabel = cName && !PSEUDO_CITY_RE.test(cName) ? cName : pName;
    for (const d of c.districts ?? []) {
      if (LEVEL_MAP[d.level] !== 'county') continue; // 过滤 street
      if (add('county', normalizeName(d.name, 'district'), pName, cityLabel, d.center)) {
        countyCount += 1;
      }
    }
  }
  console.log(`  ${pName}: 地级 ${cityCount} / 区县 ${countyCount}`);
  await sleep(550); // 高德 QPS 限速
}

const counts = { province: 0, city: 0, county: 0 };
for (const p of places) counts[p.level] = (counts[p.level] ?? 0) + 1;
writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      version: 1,
      updated: new Date().toISOString().slice(0, 10),
      source: '高德 Web 服务 v3/config/district（GCJ-02 已转 WGS-84）',
      counts,
      places,
    },
    null,
    1,
  ),
  'utf8',
);
console.log(
  `\ndata/roads/places-admin.json ← ${places.length} 条（省 ${counts.province} / 地级 ${counts.city} / 区县 ${counts.county}），${Date.now() - t0}ms`,
);
