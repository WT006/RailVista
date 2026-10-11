/**
 * 高德批量取坐标（geocode/geo 优先，place/text 兜底），带本地缓存。
 * 用法: node scripts/amap-geo-batch.mjs
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

// 贵州首批目标：经典 OTA 线 + 官方文旅口径
const TARGETS = [
  { key: 'guiyang-city', name: '贵阳市', city: '贵阳', prov: '贵州' },
  { key: 'huangguoshu', name: '黄果树瀑布', city: '安顺', prov: '贵州' },
  { key: 'libo-xiaoqikong', name: '荔波小七孔景区', city: '黔南布依族苗族自治州', prov: '贵州' },
  { key: 'xijiang-miao', name: '西江千户苗寨', city: '黔东南苗族侗族自治州', prov: '贵州' },
  { key: 'zhenyuan', name: '镇远古城', city: '黔东南苗族侗族自治州', prov: '贵州' },
  { key: 'qingyan', name: '青岩古镇', city: '贵阳', prov: '贵州' },
  { key: 'jiaxiu', name: '甲秀楼', city: '贵阳', prov: '贵州' },
  { key: 'tongren-city', name: '铜仁市', city: '铜仁', prov: '贵州' },
  { key: 'fanjingshan', name: '梵净山', city: '铜仁', prov: '贵州' },
  { key: 'kaili', name: '凯里市', city: '黔东南苗族侗族自治州', prov: '贵州' },
  { key: 'zhaoxing', name: '肇兴侗寨', city: '黔东南苗族侗族自治州', prov: '贵州' },
  { key: 'tang-an', name: '堂安梯田', city: '黔东南苗族侗族自治州', prov: '贵州' },
  { key: 'xiasi', name: '下司古镇', city: '黔东南苗族侗族自治州', prov: '贵州' },
  { key: 'yamugou', name: '亚木沟风景区', city: '铜仁', prov: '贵州' },
  { key: 'zhongnanmen', name: '铜仁中南门古城', city: '铜仁', prov: '贵州' },
  { key: 'langde', name: '朗德上寨', city: '黔东南苗族侗族自治州', prov: '贵州' },
  { key: 'zhaisha', name: '寨沙侗寨', city: '铜仁', prov: '贵州' },
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
writeFileSync('tmp/amap-guizhou-coords.json', JSON.stringify(out, null, 2));
console.log('\n已写入 tmp/amap-guizhou-coords.json');
