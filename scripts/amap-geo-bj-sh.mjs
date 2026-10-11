/**
 * 高德批量取坐标（geocode/geo 优先，place/text 兜底），带本地缓存。
 * 用法: node scripts/amap-geo-bj-sh.mjs
 * 本副本目标：北京 + 上海 热门地标（segments-beijing-1 / segments-shanghai-1 用）。
 */
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';
process.env.HTTPS_PROXY = '';
process.env.HTTP_PROXY = '';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const KEY = '5c4da48f09d20c88e18e51c252b65416';
const CACHE_DIR = 'tmp/amap-cache';
mkdirSync(CACHE_DIR, { recursive: true });

function cacheFileFor(url) {
  return join(CACHE_DIR, 'req__' + createHash('sha256').update(url).digest('hex').slice(0, 32) + '.json');
}

const TARGETS = [
  // ── 北京：中轴线皇城 ──
  { key: 'tiananmen', name: '天安门广场', city: '北京', prov: '北京' },
  { key: 'gugong', name: '故宫博物院', city: '北京', prov: '北京' },
  { key: 'jingshan', name: '景山公园', city: '北京', prov: '北京' },
  { key: 'shichahai', name: '什刹海', city: '北京', prov: '北京' },
  { key: 'tiantan', name: '天坛公园', city: '北京', prov: '北京' },
  { key: 'qianmen', name: '前门大街', city: '北京', prov: '北京' },
  { key: 'nanluoguxiang', name: '南锣鼓巷', city: '北京', prov: '北京' },
  { key: 'yonghegong', name: '雍和宫', city: '北京', prov: '北京' },
  // ── 北京：长城明陵 ──
  { key: 'badaling', name: '八达岭长城', city: '北京', prov: '北京' },
  { key: 'juyongguan', name: '居庸关长城', city: '北京', prov: '北京' },
  { key: 'shisanling', name: '明十三陵', city: '北京', prov: '北京' },
  { key: 'mutianyu', name: '慕田峪长城', city: '北京', prov: '北京' },
  // ── 北京：皇家园林 ──
  { key: 'yiheyuan', name: '颐和园', city: '北京', prov: '北京' },
  { key: 'yuanmingyuan', name: '圆明园遗址公园', city: '北京', prov: '北京' },
  { key: 'xiangshan', name: '香山公园', city: '北京', prov: '北京' },
  { key: 'zhiwuyuan', name: '国家植物园', city: '北京', prov: '北京' },
  { key: 'tanzhesi', name: '潭柘寺', city: '北京', prov: '北京' },
  // ── 上海：外滩陆家嘴 ──
  { key: 'waitan', name: '外滩', city: '上海', prov: '上海' },
  { key: 'dongfangmingzhu', name: '东方明珠', city: '上海', prov: '上海' },
  { key: 'shanghaizhongxin', name: '上海中心大厦', city: '上海', prov: '上海' },
  { key: 'nanjinglu', name: '南京路步行街', city: '上海', prov: '上海' },
  { key: 'yuyuan', name: '豫园', city: '上海', prov: '上海' },
  { key: 'wukanglu', name: '武康路', city: '上海', prov: '上海' },
  // ── 上海：浦东亲子 ──
  { key: 'disney', name: '上海迪士尼乐园', city: '上海', prov: '上海' },
  { key: 'haichang', name: '上海海昌海洋公园', city: '上海', prov: '上海' },
  { key: 'dishuihu', name: '滴水湖', city: '上海', prov: '上海' },
  { key: 'hanghaibowuguan', name: '中国航海博物馆', city: '上海', prov: '上海' },
  // ── 上海：沪郊古镇佘山 ──
  { key: 'zhujiajiao', name: '朱家角古镇', city: '上海', prov: '上海' },
  { key: 'dianshanhu', name: '淀山湖', city: '上海', prov: '上海' },
  { key: 'sheshan', name: '佘山国家森林公园', city: '上海', prov: '上海' },
  { key: 'guangfulin', name: '广富林文化遗址', city: '上海', prov: '上海' },
  { key: 'fengjing', name: '枫泾古镇', city: '上海', prov: '上海' },
  { key: 'zuibaichi', name: '醉白池公园', city: '上海', prov: '上海' },
  // ── 上海：崇明环岛 ──
  { key: 'dongtan', name: '崇明东滩湿地公园', city: '上海', prov: '上海' },
  { key: 'xisha', name: '西沙湿地公园', city: '上海', prov: '上海' },
  { key: 'mingzhuhu', name: '明珠湖公园', city: '上海', prov: '上海' },
  { key: 'dongping', name: '东平国家森林公园', city: '上海', prov: '上海' },
  { key: 'chongmingxuegong', name: '崇明学宫', city: '上海', prov: '上海' },
];

async function get(url) {
  const cf = cacheFileFor(url);
  if (existsSync(cf)) return JSON.parse(readFileSync(cf, 'utf8'));
  const resp = await fetch(url);
  const data = await resp.json();
  writeFileSync(cf, JSON.stringify(data));
  return data;
}

async function amapGeo(name, city) {
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${KEY}&address=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}`;
  const data = await get(url);
  if (data.status === '1' && data.geocodes && data.geocodes.length) {
    const g = data.geocodes[0];
    return { loc: g.location, name: g.formatted_address, ad: g.province + '/' + g.city + '/' + g.district };
  }
  return null;
}

async function amapText(name, city) {
  const url = `https://restapi.amap.com/v3/place/text?key=${KEY}&keywords=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}&offset=5`;
  const data = await get(url);
  if (data.status === '1' && data.pois && data.pois.length) {
    const p = data.pois[0];
    return { loc: p.location, name: p.name, ad: (p.pname || '') + '/' + (p.cityname || '') + '/' + (p.adname || '') };
  }
  return null;
}

async function resolve(t) {
  let r = await amapGeo(t.name, t.city);
  if (!r) r = await amapText(t.name, t.city);
  if (!r) return { key: t.key, ok: false, note: 'NO RESULT' };
  const [lng, lat] = r.loc.split(',').map(Number);
  const inProv = r.ad.includes(t.prov);
  return { key: t.key, ok: true, lng, lat, name: r.name, ad: r.ad, inProv };
}

const out = {};
let fail = 0;
for (const t of TARGETS) {
  const r = await resolve(t);
  out[t.key] = r;
  if (r.ok) {
    const flag = r.inProv ? '✓' : '⚠省外';
    console.log(`${flag} ${t.key} → ${r.name} | ${r.lng},${r.lat} | ${r.ad}`);
  } else {
    fail++;
    console.log(`✗ ${t.key} → ${r.note}`);
  }
}
writeFileSync('tmp/amap-bj-sh-coords.json', JSON.stringify(out, null, 2));
console.log(`\n已写入 tmp/amap-bj-sh-coords.json（失败 ${fail} 个）`);
