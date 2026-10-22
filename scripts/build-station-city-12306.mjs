/**
 * 从 12306 官方站表提取「车站 → 地级市」归属，产出 data/stations-city-12306.json。
 *
 * 为什么要它：data/stations-geo.json 里不少站的经纬度是走廊折线投影的近似值，
 * 按坐标点面判定会把站归到邻市（实测：厦门站→漳州、永泰站→三明、晋江站→厦门）。
 * 12306 station_name.js 第 8 字段是售票系统自己的地市归属，与用户车票认知一致，作主源；
 * 坐标只用于 12306 站表里没有的站（走廊 stationsHint、境外站）。
 *
 * 运行：node scripts/build-station-city-12306.mjs            # 联网抓取
 *       node scripts/build-station-city-12306.mjs --from tmp/station_name.raw.js
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(R, 'data/stations-city-12306.json');
const URL_12306 = 'https://kyfw.12306.cn/otn/resources/js/framework/station_name.js';

const fromArg = process.argv.indexOf('--from');
let text = '';
if (fromArg > -1) {
  text = readFileSync(join(R, process.argv[fromArg + 1]), 'utf8');
  console.log(`读取本地文件 ${process.argv[fromArg + 1]}`);
} else {
  const res = await fetch(URL_12306, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Referer: 'https://kyfw.12306.cn/otn/leftTicket/init',
    },
  });
  if (!res.ok) {
    console.error(`✗ 拉取 station_name.js 失败：HTTP ${res.status}`);
    process.exit(1);
  }
  text = await res.text();
}

const quoted = text.match(/['"]([^'"]+)['"]/);
const parts = (quoted ? quoted[1] : text).split('@').filter(Boolean);
const stations = {};
let noCity = 0;
for (const part of parts) {
  const f = part.split('|').map((x) => String(x ?? '').trim());
  const name = f[1];
  const telecode = f[2];
  const city = f[7];
  if (!name || !telecode) continue;
  if (!city) {
    noCity++;
    continue;
  }
  stations[name] = { telecode, city };
}

if (Object.keys(stations).length < 3000) {
  console.error(`✗ 解析结果过少（${Object.keys(stations).length}），字段格式可能已变，已中止`);
  process.exit(1);
}

writeFileSync(
  OUT,
  JSON.stringify({
    source: 'kyfw.12306.cn station_name.js（字段 8 = 售票系统地市归属）',
    fetchedAt: new Date().toISOString().slice(0, 10),
    note: '火车站 → 地级市权威归属；站名不带「站」后缀。请由脚本重新生成，勿手工编辑',
    stations,
  }),
  'utf8',
);

const cities = new Set(Object.values(stations).map((s) => s.city));
console.log(`✓ ${Object.keys(stations).length} 个站 / ${cities.size} 个地市归属${noCity ? `（${noCity} 个站无市归属，已跳过）` : ''}`);
console.log('  产物：data/stations-city-12306.json');
