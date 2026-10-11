process.env.NO_PROXY = '*';
process.env.no_proxy = '*';
process.env.HTTPS_PROXY = '';
process.env.HTTP_PROXY = '';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const KEY = '5c4da48f09d20c88e18e51c252b65416';
const CACHE_DIR = 'tmp/amap-cache';
mkdirSync(CACHE_DIR, { recursive: true });
const NAMES = ['海螺沟冰川地质公园', '磨西镇', '邦达', '嘎朗湖', '波密桃花沟', '纳木错圣象天门', '古乡湖'];
async function txt(name) {
  const cacheKey = `broad2__${name}.json`;
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
    const data = await txt(name);
    console.log(`\n=== ${name} ===`);
    if (data.status !== '1' || !data.pois) { console.log('  (无结果)'); continue; }
    data.pois.slice(0, 4).forEach((p, i) => console.log(`  [${i}] ${p.name} | ${p.location} | ${p.pname}/${p.cityname}/${p.adname} | ${p.type}`));
  }
}
main().catch((e) => console.error(e));
