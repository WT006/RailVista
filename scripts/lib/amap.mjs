/**
 * 万里路书 · 高德 Web 服务工具库（scripts/lib/amap.mjs）
 *
 * 仅用于两类「补全」工作，且都做了防绕路约束：
 *   - geocode：官方控制点 → 坐标/省份（确定省序与密集锚点）
 *   - driving：在「很近的相邻锚点」间沿真实道路走线（每段都校验路名与走廊，禁止长距离两点连线）
 * 免费 key 有 QPS 限制，内置节流、退避与错误码处理。
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const AMAP_KEY = process.env.AMAP_KEY || '5c4da48f09d20c88e18e51c252b65416';
const REST = 'https://restapi.amap.com';
const CACHE_DIR = join('data', 'cache', 'amap');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 全局节流：无论多少并发，请求「发起」时刻至少间隔 minGapMs（令牌队列）
const MIN_GAP_MS = Number(process.env.AMAP_GAP_MS || 90);
let lastCallAt = 0;
let throttleChain = Promise.resolve();
function throttle() {
  const prev = throttleChain;
  let release;
  throttleChain = new Promise((r) => { release = r; });
  prev.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    release();
  });
  return prev; // 等到上一个令牌放行
}
async function pace() { await throttle(); }

async function getJson(url, { retries = 4 } = {}) {
  let last = null;
  for (let t = 0; t < retries; t += 1) {
    await pace();
    try {
      const res = await fetch(url);
      const j = await res.json();
      if (j.status === '1' && j.infocode === '10000') return j;
      last = new Error(j.info + ' [' + j.infocode + ']');
      // 限流：指数退避
      if (j.infocode === '10021' || j.infocode === '10020' || j.infocode === '10019') {
        await sleep(800 * (t + 1));
        continue;
      }
      // key/配额类错误不重试
      if (['10001', '10003', '10004', '10005', '10006', '10007', '10008', '10009', '10010', '10011', '10012', '10013', '10044'].includes(j.infocode)) {
        throw last;
      }
    } catch (e) {
      last = e;
    }
    await sleep(500 * (t + 1));
  }
  throw new Error('高德请求失败：' + last?.message);
}

function cachePath(name) {
  mkdirSync(CACHE_DIR, { recursive: true });
  return join(CACHE_DIR, name);
}

/** 地理编码（全部候选）：地址 → [{lng,lat,province,city,district,formatted}]，带磁盘缓存 */
export async function geocodeCandidates(address) {
  const safe = String(address).replace(/[\\/:*?"<>|\s]+/g, '_');
  const cp = cachePath('geoall-' + safe + '.json');
  if (existsSync(cp)) return JSON.parse(readFileSync(cp, 'utf8'));
  const url = `${REST}/v3/geocode/geo?address=${encodeURIComponent(address)}&key=${AMAP_KEY}&output=json`;
  const j = await getJson(url);
  const list = (j.geocodes ?? [])
    .filter((g) => g.location)
    .map((g) => {
      const [lng, lat] = g.location.split(',').map(Number);
      return {
        address,
        lng,
        lat,
        province: g.province || '',
        city: g.city || '',
        district: g.district || '',
        formatted: g.formatted_address || '',
      };
    });
  if (!list.length) throw new Error('地理编码无结果: ' + address);
  writeFileSync(cp, JSON.stringify(list));
  return list;
}

/**
 * 控制点地理编码（带消歧兜底）：
 * 裸名触发 30001（如方位词「南部」）或小口岸缺数据时，依次尝试变体，取首个有结果者。
 * hintProv 可传入省名做最后消歧。返回 candidates（附带 via 表示实际命中的查询名）。
 */
export async function geocodeControl(name, hintProv = '') {
  const variants = [
    name,
    name.replace(/[（(]口岸[）)]/g, '口岸'),
    name.replace(/[（(][^（）()]*[）)]/g, ''),
    name.replace(/[（(]口岸[）)]/g, ''),
    name + '县',
    name + '市',
    name + '区',
    name + '镇',
    name + '旗',
    name + '苏木',
    name + '景区',
    hintProv ? hintProv + name : null,
    hintProv ? hintProv + name.replace(/[（(][^（）()]*[）)]/g, '') : null,
  ].filter((v, i, a) => v && v.trim() && a.indexOf(v) === i);
  let lastErr = null;
  for (const v of variants) {
    try {
      const c = await geocodeCandidates(v);
      if (c?.length) return c.map((x) => ({ ...x, via: v === name ? undefined : v }));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('地理编码无结果: ' + name);
}

/**
 * POI 关键词检索（/v3/place/text）：比 geocode 更适合小地名/口岸/景区/乡镇。
 * city 可传 adcode 或城市名做范围限定；返回 [{name,lng,lat,province,city,district,adcode,address}]，带磁盘缓存。
 */
export async function searchPoi(keyword, { city = '', cityLimit = false } = {}) {
  const safe = String(keyword).replace(/[\\/:*?"<>|\s]+/g, '_');
  const cs = String(city).replace(/[\\/:*?"<>|\s]+/g, '_') || 'all';
  const cp = cachePath('poi-' + cs + '-' + safe + '.json');
  if (existsSync(cp)) return JSON.parse(readFileSync(cp, 'utf8'));
  let url = `${REST}/v3/place/text?keywords=${encodeURIComponent(keyword)}&key=${AMAP_KEY}&offset=20&page=1&output=json`;
  if (city) url += `&city=${encodeURIComponent(city)}&citylimit=${cityLimit}`;
  const j = await getJson(url);
  const list = (j.pois ?? [])
    .filter((p) => p.location && p.location.indexOf(',') > 0)
    .map((p) => {
      const [lng, lat] = p.location.split(',').map(Number);
      return {
        name: p.name, lng, lat,
        province: p.pname || '', city: p.cityname || '', district: p.adname || '',
        adcode: p.adcode || '', address: p.address || '', typecode: p.typecode || '',
      };
    });
  writeFileSync(cp, JSON.stringify(list));
  return list;
}

/** 地理编码（首个候选），向后兼容 */
export async function geocodeOne(address) {
  return (await geocodeCandidates(address))[0];
}

/**
 * 驾车走线：origin/dest 为 [lng,lat]。
 * 返回 {
 *   points:[[lng,lat]]（不含起点）, distanceM,
 *   roads:[{name,distanceM}],
 *   steps:[{name,distanceM,points:[[lng,lat]]}]   // 每个 step 自带点，便于按路名门控/切分
 * }
 */
export async function drivingLeg(origin, dest) {
  const o = `${origin[0]},${origin[1]}`;
  const d = `${dest[0]},${dest[1]}`;
  const url = `${REST}/v3/direction/driving?origin=${o}&destination=${d}&key=${AMAP_KEY}&extensions=all&output=json`;
  const j = await getJson(url);
  const path = j.route?.paths?.[0];
  if (!path) throw new Error('无路径');
  const points = [];
  const roads = [];
  const steps = [];
  for (const step of path.steps || []) {
    const spts = [];
    if (step.polyline) {
      for (const pair of step.polyline.split(';')) {
        const [lng, lat] = pair.split(',').map(Number);
        if (Number.isFinite(lng)) { const p = [lng, lat]; points.push(p); spts.push(p); }
      }
    }
    const name = step.road || '';
    const distanceM = Number(step.distance) || 0;
    roads.push({ name, distanceM });
    steps.push({ name, distanceM, points: spts });
  }
  return { points, distanceM: Number(path.distance) || 0, roads, steps };
}
