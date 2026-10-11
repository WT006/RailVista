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

// 山东目标：经典 OTA 线 + 官方文旅口径
const TARGETS = [
  // R1 泰山 + 曲阜三孔
  { key: 'jinan-city', name: '济南市区', city: '济南', prov: '山东' },
  { key: 'taian-city', name: '泰安市', city: '泰安', prov: '山东' },
  { key: 'taishan', name: '泰山风景区', city: '泰安', prov: '山东' },
  { key: 'qufu-sankong', name: '曲阜三孔', city: '济宁', prov: '山东' },
  { key: 'daimiao', name: '岱庙', city: '泰安', prov: '山东' },
  { key: 'kongmiao', name: '孔庙', city: '济宁', prov: '山东' },
  { key: 'kongfu', name: '孔府', city: '济宁', prov: '山东' },
  { key: 'konglin', name: '孔林', city: '济宁', prov: '山东' },
  { key: 'baotuquan', name: '趵突泉', city: '济南', prov: '山东' },
  { key: 'daminghu', name: '大明湖', city: '济南', prov: '山东' },
  { key: 'qianfoshan', name: '千佛山', city: '济南', prov: '山东' },
  // R2 青岛—威海—烟台
  { key: 'qingdao-city', name: '青岛市区', city: '青岛', prov: '山东' },
  { key: 'zhanqiao', name: '栈桥', city: '青岛', prov: '山东' },
  { key: 'laoshan', name: '崂山风景区', city: '青岛', prov: '山东' },
  { key: 'weihai-city', name: '威海市区', city: '威海', prov: '山东' },
  { key: 'liugongdao', name: '刘公岛', city: '威海', prov: '山东' },
  { key: 'chengshantou', name: '成山头', city: '威海', prov: '山东' },
  { key: 'yantai-city', name: '烟台市区', city: '烟台', prov: '山东' },
  { key: 'penglaige', name: '蓬莱阁', city: '烟台', prov: '山东' },
  { key: 'yangmadang', name: '养马岛', city: '烟台', prov: '山东' },
  // R3 济南—淄博—潍坊
  { key: 'zibo-city', name: '淄博市区', city: '淄博', prov: '山东' },
  { key: 'zhoucun', name: '周村古商城', city: '淄博', prov: '山东' },
  { key: 'qiwenhua', name: '齐文化博物馆', city: '淄博', prov: '山东' },
  { key: 'weifang-city', name: '潍坊市区', city: '潍坊', prov: '山东' },
  { key: 'qingzhou', name: '青州古城', city: '潍坊', prov: '山东' },
  { key: 'fengzheng', name: '潍坊风筝博物馆', city: '潍坊', prov: '山东' },
  // R4 青岛—日照—临沂
  { key: 'rizhao-city', name: '日照市区', city: '日照', prov: '山东' },
  { key: 'wanpingkou', name: '万平口风景区', city: '日照', prov: '山东' },
  { key: 'linyi-city', name: '临沂市区', city: '临沂', prov: '山东' },
  { key: 'yimengshan', name: '沂蒙山旅游区', city: '临沂', prov: '山东' },
  { key: 'zhuquan', name: '竹泉村', city: '临沂', prov: '山东' },
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
writeFileSync('tmp/amap-shandong-coords.json', JSON.stringify(out, null, 2));
console.log('\n已写入 tmp/amap-shandong-coords.json');
