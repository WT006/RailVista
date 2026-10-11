process.env.NO_PROXY = '*';
process.env.no_proxy = '*';
process.env.HTTPS_PROXY = '';
process.env.HTTP_PROXY = '';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const KEY = '5c4da48f09d20c88e18e51c252b65416';
const CACHE_DIR = 'tmp/amap-cache';
mkdirSync(CACHE_DIR, { recursive: true });

// 地理编码兜底：对 POI 文本搜索无果的自然/小众景点，用地址地理编码再试
const ITEMS = [
  { name: '希夏邦马峰', city: '日喀则市' },
  { name: '圣象天门', city: '拉萨市' },
  { name: '巴木措', city: '那曲市' },
  { name: '岗云杉林', city: '林芝市' },
  { name: '海螺沟', city: '甘孜藏族自治州' },
  { name: '邦达草原', city: '昌都市' },
  { name: '海螺沟景区', city: '甘孜藏族自治州' },
  { name: '邦达镇', city: '昌都市' },
];

async function geo(name, city) {
  const cacheKey = `geo__${name}__${city}.json`;
  const cf = join(CACHE_DIR, cacheKey);
  if (existsSync(cf)) return JSON.parse(readFileSync(cf, 'utf8'));
  const params = `address=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}`;
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${KEY}&${params}`;
  const resp = await fetch(url);
  const data = await resp.json();
  writeFileSync(cf, JSON.stringify(data));
  return data;
}

async function main() {
  for (const it of ITEMS) {
    const data = await geo(it.name, it.city);
    const gc = (data.geocodes || [])[0];
    console.log(`=== ${it.name} @${it.city} === status=${data.status} count=${data.count}`);
    if (gc) console.log(`   ${gc.formatted_address} | ${gc.location} | ${gc.level}`);
    else console.log('   (无地理编码结果)');
  }
}
main().catch((e) => console.error(e));
