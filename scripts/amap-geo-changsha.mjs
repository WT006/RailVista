/**
 * 高德批量取坐标（geocode/geo 优先，place/text 兜底），带本地缓存。
 * 用法: node scripts/amap-geo-changsha.mjs
 * 改 TARGETS 数组即可复用。输出可直接抄进路书。
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

// 湖南首批目标：长沙都市美食 / 张家界经典 / 凤凰古城三条 L3 线
const TARGETS = [
  { key: 'changsha-city', name: '长沙市区', city: '长沙', prov: '湖南' },
  { key: 'juzizhou', name: '橘子洲景区', city: '长沙', prov: '湖南' },
  { key: 'yuelushan', name: '岳麓山', city: '长沙', prov: '湖南' },
  { key: 'yuelu-shuyuan', name: '岳麓书院', city: '长沙', prov: '湖南' },
  { key: 'hunan-bowuyuan', name: '湖南博物院', city: '长沙', prov: '湖南' },
  { key: 'taiping-laojie', name: '太平老街', city: '长沙', prov: '湖南' },
  { key: 'huogongdian', name: '火宫殿', city: '长沙', prov: '湖南' },
  { key: 'tianxinge', name: '天心阁', city: '长沙', prov: '湖南' },
  { key: 'zhangjiajie-city', name: '张家界市区', city: '张家界', prov: '湖南' },
  { key: 'wulingyuan', name: '武陵源标志门', city: '张家界', prov: '湖南' },
  { key: 'zjj-forest-park', name: '张家界国家森林公园', city: '张家界', prov: '湖南' },
  { key: 'yuanjiajie', name: '袁家界', city: '张家界', prov: '湖南' },
  { key: 'tianmenshan', name: '天门山国家森林公园', city: '张家界', prov: '湖南' },
  { key: 'daxiagu-boliqiao', name: '张家界大峡谷玻璃桥', city: '张家界', prov: '湖南' },
  { key: 'huanglongdong', name: '黄龙洞', city: '张家界', prov: '湖南' },
  { key: 'baofenghu', name: '宝峰湖', city: '张家界', prov: '湖南' },
  { key: 'fenghuang-gucheng', name: '凤凰古城', city: '湘西土家族苗族自治州', prov: '湖南' },
  { key: 'tuojiang-fanzhou', name: '沱江泛舟', city: '湘西土家族苗族自治州', prov: '湖南' },
  { key: 'shencongwen-guju', name: '沈从文故居', city: '湘西土家族苗族自治州', prov: '湖南' },
  { key: 'nanhua-shan', name: '南华山', city: '湘西土家族苗族自治州', prov: '湖南' },
  { key: 'qiliang-dong', name: '奇梁洞', city: '湘西土家族苗族自治州', prov: '湖南' },
  { key: 'nanfang-changcheng', name: '南方长城', city: '湘西土家族苗族自治州', prov: '湖南' },
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
for (const t of TARGETS) {
  const r = await resolve(t);
  out[t.key] = r;
  if (r.ok) {
    const flag = r.inProv ? '✓' : '⚠省外';
    console.log(`${flag} ${t.key} → ${r.name} | ${r.lng},${r.lat} | ${r.ad}`);
  } else {
    console.log(`✗ ${t.key} → ${r.note}`);
  }
}
writeFileSync('tmp/amap-hunan-changsha-coords.json', JSON.stringify(out, null, 2));
console.log('\n已写入 tmp/amap-hunan-changsha-coords.json');
