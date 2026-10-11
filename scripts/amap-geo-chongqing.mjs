/**
 * 高德批量取坐标（geocode/geo 优先，place/text 兜底），带本地缓存。
 * 用法: node scripts/amap-geo-chongqing.mjs
 * 重庆路书专用目标清单。输出可直接抄进路书。
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

// 重庆首批目标：主城都市 + 武隆喀斯特 + 三峡奉节巫山
const TARGETS = [
  { key: 'yuzhong', name: '重庆市渝中区', city: '重庆', prov: '重庆' },
  { key: 'hongyadong', name: '洪崖洞', city: '重庆', prov: '重庆' },
  { key: 'jiefangbei', name: '解放碑步行街', city: '重庆', prov: '重庆' },
  { key: 'chaotianmen', name: '朝天门广场', city: '重庆', prov: '重庆' },
  { key: 'changjiangsuodao', name: '重庆长江索道北站', city: '重庆', prov: '重庆' },
  { key: 'ciqikou', name: '磁器口古镇', city: '重庆', prov: '重庆' },
  { key: 'nanshan-yikeshu', name: '南山一棵树', city: '重庆', prov: '重庆' },
  { key: 'wulong-city', name: '重庆市武隆区', city: '重庆', prov: '重庆' },
  { key: 'tianshengsanqiao', name: '天生三桥', city: '重庆', prov: '重庆' },
  { key: 'longshuixia', name: '龙水峡地缝', city: '重庆', prov: '重庆' },
  { key: 'xiannvshan', name: '仙女山国家森林公园', city: '重庆', prov: '重庆' },
  { key: 'furongdong', name: '武隆芙蓉洞', city: '重庆', prov: '重庆' },
  { key: 'furongjiang', name: '武隆芙蓉江', city: '重庆', prov: '重庆' },
  { key: 'yangjiao', name: '武隆羊角古镇', city: '重庆', prov: '重庆' },
  { key: 'wulong-baimashan', name: '武隆白马山', city: '重庆', prov: '重庆' },
  { key: 'wanzhou', name: '重庆市万州区', city: '重庆', prov: '重庆' },
  { key: 'fengjie', name: '重庆市奉节县', city: '重庆', prov: '重庆' },
  { key: 'wushan', name: '重庆市巫山县', city: '重庆', prov: '重庆' },
  { key: 'baidicheng', name: '白帝城·瞿塘峡景区', city: '重庆', prov: '重庆' },
  { key: 'sanxiazhidian', name: '三峡之巅', city: '重庆', prov: '重庆' },
  { key: 'tiankengdifeng', name: '奉节天坑地缝', city: '重庆', prov: '重庆' },
  { key: 'xiaosanzxia', name: '巫山小三峡', city: '重庆', prov: '重庆' },
  { key: 'shennv', name: '巫山神女景区', city: '重庆', prov: '重庆' },
  { key: 'dachang', name: '巫山大昌古镇', city: '重庆', prov: '重庆' },
  { key: 'wushan-bowuguan', name: '巫山博物馆', city: '重庆', prov: '重庆' },
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
writeFileSync('tmp/amap-chongqing-coords.json', JSON.stringify(out, null, 2));
console.log('\n已写入 tmp/amap-chongqing-coords.json');
