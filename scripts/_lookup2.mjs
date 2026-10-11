process.env.NO_PROXY = '*';
process.env.no_proxy = '*';
process.env.HTTPS_PROXY = '';
process.env.HTTP_PROXY = '';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const KEY = '5c4da48f09d20c88e18e51c252b65416';
const CACHE_DIR = 'tmp/amap-cache';
mkdirSync(CACHE_DIR, { recursive: true });

// 待查（放宽：不带 citylimit，城市限定仅靠返回结果的 adname 判断）
const NAMES = [
  '喀拉库勒湖', '慕士塔格峰', '塔什库尔干石头城', '红其拉甫口岸',
  '羊卓雍措', '希夏邦马峰', '圣象天门', '巴木措',
  '波密岗云杉林', '海螺沟冰川森林公园', '邦达草原',
];

async function amapText(name) {
  const cacheKey = `broad__${name}.json`;
  const cf = join(CACHE_DIR, cacheKey);
  if (existsSync(cf)) return JSON.parse(readFileSync(cf, 'utf8'));
  const params = `keywords=${encodeURIComponent(name)}&offset=5`;
  const url = `https://restapi.amap.com/v3/place/text?key=${KEY}&${params}`;
  const resp = await fetch(url);
  const data = await resp.json();
  writeFileSync(cf, JSON.stringify(data));
  return data;
}

async function main() {
  for (const name of NAMES) {
    const data = await amapText(name);
    console.log(`\n=== ${name} ===`);
    if (data.status !== '1' || !data.pois) { console.log('  (无结果)'); continue; }
    data.pois.slice(0, 4).forEach((p, i) => {
      console.log(`  [${i}] ${p.name} | ${p.location} | ${p.pname}/${p.cityname}/${p.adname} | ${p.type}`);
    });
  }
}
main().catch((e) => console.error(e));
