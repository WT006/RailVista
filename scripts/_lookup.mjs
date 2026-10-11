/**
 * 高德文本搜索取坐标（一次性核验/补坐标用）。带缓存。
 * 用法: node scripts/_lookup.mjs
 */
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';
process.env.HTTPS_PROXY = '';
process.env.HTTP_PROXY = '';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const KEY = '5c4da48f09d20c88e18e51c252b65416';
const CACHE_DIR = 'tmp/amap-cache';
mkdirSync(CACHE_DIR, { recursive: true });

const TARGETS = [
  { name: '慕士塔格峰', city: '喀什地区' },
  { name: '卡拉库里湖', city: '喀什地区' },
  { name: '喀拉库勒湖', city: '喀什地区' },
  { name: '塔什库尔干石头城', city: '喀什地区' },
  { name: '红其拉甫口岸', city: '喀什地区' },
  { name: '羊卓雍措', city: '山南' },
  { name: '卡若拉冰川', city: '日喀则' },
  { name: '珠穆朗玛峰大本营', city: '日喀则' },
  { name: '珠峰大本营', city: '日喀则' },
  { name: '希夏邦马峰', city: '日喀则' },
  { name: '圣象天门', city: '拉萨' },
  { name: '巴木措', city: '那曲' },
  { name: '南迦巴瓦峰', city: '林芝' },
  { name: '雅鲁藏布大峡谷', city: '林芝' },
  { name: '巴松措', city: '林芝' },
  { name: '波密岗云杉林', city: '林芝' },
  { name: '海螺沟', city: '甘孜藏族自治州' },
  { name: '邦达草原', city: '昌都' },
];

async function amapText(name, city) {
  const cacheKey = `text__${name}__${city}.json`;
  const cf = join(CACHE_DIR, cacheKey);
  if (existsSync(cf)) return JSON.parse(readFileSync(cf, 'utf8'));
  const params = `keywords=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}&citylimit=true&offset=5`;
  const url = `https://restapi.amap.com/v3/place/text?key=${KEY}&${params}`;
  const resp = await fetch(url);
  const data = await resp.json();
  writeFileSync(cf, JSON.stringify(data));
  return data;
}

async function main() {
  for (const t of TARGETS) {
    const data = await amapText(t.name, t.city);
    if (data.status !== '1' || !data.pois || !data.pois.length) {
      console.log(`✗ ${t.name} @${t.city} → 无结果 (status=${data.status})`);
      continue;
    }
    // 取第一个（citylimit 已限定城市，通常最匹配）
    const p = data.pois[0];
    const level = (p.biz_ext && p.biz_ext.level) || (p.keytag || '').split(',')[0] || '';
    const rating = (p.biz_ext && p.biz_ext.rating) || '';
    console.log(`✓ ${t.name} @${t.city} → ${p.name} | ${p.location} | ${p.type} | ${p.pname}/${p.cityname}/${p.adname} | lv=${level} rt=${rating}`);
  }
}
main().catch((e) => console.error(e));
