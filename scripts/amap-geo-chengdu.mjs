/**
 * 高德批量取坐标（geocode/geo 优先，place/text 兜底），带本地缓存。
 * 用法: node scripts/amap-geo-chengdu.mjs
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

// 成都及周边首批目标：市区经典 + 都江堰青城山 + 峨眉乐山
const TARGETS = [
  { key: 'chengdu-tianfu', name: '天府广场', city: '成都', prov: '四川' },
  { key: 'panda-base', name: '成都大熊猫繁育研究基地', city: '成都', prov: '四川' },
  { key: 'wuhouci', name: '成都武侯祠博物馆', city: '成都', prov: '四川' },
  { key: 'jinli', name: '锦里古街', city: '成都', prov: '四川' },
  { key: 'kuanzhai', name: '宽窄巷子', city: '成都', prov: '四川' },
  { key: 'dufu-caotang', name: '成都杜甫草堂博物馆', city: '成都', prov: '四川' },
  { key: 'renmin-park', name: '成都市人民公园', city: '成都', prov: '四川' },
  { key: 'chunxi', name: '春熙路', city: '成都', prov: '四川' },
  { key: 'wenshu-si', name: '文殊院', city: '成都', prov: '四川' },
  { key: 'qingyang-gong', name: '青羊宫', city: '成都', prov: '四川' },
  { key: 'dujiangyan', name: '都江堰景区', city: '成都', prov: '四川' },
  { key: 'guanxian-gucheng', name: '灌县古城', city: '成都', prov: '四川' },
  { key: 'nanqiao', name: '都江堰南桥', city: '成都', prov: '四川' },
  { key: 'qingcheng-front', name: '青城山', city: '成都', prov: '四川' },
  { key: 'qingcheng-rear', name: '青城后山', city: '成都', prov: '四川' },
  { key: 'jiezi', name: '街子古镇', city: '成都', prov: '四川' },
  { key: 'leshan-city', name: '乐山市', city: '乐山', prov: '四川' },
  { key: 'lesan-dafo', name: '乐山大佛', city: '乐山', prov: '四川' },
  { key: 'leshan-zhanggongqiao', name: '张公桥美食街', city: '乐山', prov: '四川' },
  { key: 'emei-baoguosi', name: '峨眉山报国寺', city: '乐山', prov: '四川' },
  { key: 'emei-wanniansi', name: '峨眉山万年寺', city: '乐山', prov: '四川' },
  { key: 'emei-qingyinge', name: '峨眉山清音阁', city: '乐山', prov: '四川' },
  { key: 'emei-leidongping', name: '峨眉山雷洞坪', city: '乐山', prov: '四川' },
  { key: 'emei-jinding', name: '峨眉山金顶', city: '乐山', prov: '四川' },
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
writeFileSync('tmp/amap-chengdu-coords.json', JSON.stringify(out, null, 2));
console.log('\n已写入 tmp/amap-chengdu-coords.json');
