/**
 * 风景线第四期：可从 hsr-rails / 已校验 OSM 入库的高铁走廊
 * node scripts/build-phase4-scenic-corridors.mjs
 *
 * 本脚本不重复下载大文件；依赖：
 * - data/presets/corridors/_hsr-rails.geojson（张吉怀等）
 * - scripts/build-corridor-from-osm-relation.mjs（兰新/厦深/哈牡/成贵/渝贵/海南东）
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extract = join(__dirname, 'extract-corridor-from-hsr.mjs');
const osm = join(__dirname, 'build-corridor-from-osm-relation.mjs');
const corridorsDir = join(__dirname, '../data/presets/corridors');

function run(cmd, args) {
  console.log('\n========', args[1] || args[0], '========');
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

/** hsr-rails 可提取且质量可用 */
const hsrJobs = [
  ['张吉怀高速线', 'zhangjihuai', '--axis', 'ns'],
];

/** OSM relation（Wikidata P402 / OpenRailwayMap） */
const osmJobs = [
  [
    '1043244',
    'lanxin',
    '--name',
    '兰新高铁',
    '--from',
    '103.75,36.07',
    '--to',
    '87.43,43.84',
    '--tol',
    '0.012',
    '--hint',
    '兰州西,西宁,门源,民乐,张掖西,临泽南,高台南,清水北,酒泉南,嘉峪关南,玉门,柳园南,哈密,吐鲁番北,乌鲁木齐',
  ],
  [
    '2052885',
    'xiashen',
    '--name',
    '厦深铁路',
    '--from',
    '118.09,24.64',
    '--to',
    '114.03,22.61',
    '--hint',
    '厦门北,漳州,云霄,潮汕,揭阳,普宁,汕尾,惠州南,深圳北',
  ],
  [
    '7047176',
    'hamu',
    '--name',
    '哈牡高铁',
    '--from',
    '126.53,45.70',
    '--to',
    '129.57,44.58',
    '--hint',
    '哈尔滨,尚志南,亚布力西,海林北,牡丹江',
  ],
  [
    '7754722',
    'chenggui',
    '--name',
    '成贵高铁',
    '--from',
    '104.14,30.63',
    '--to',
    '106.67,26.65',
    '--hint',
    '成都东,乐山,犍为,宜宾西,长宁,兴文,毕节,贵阳北',
  ],
  [
    '7945163',
    'yugui',
    '--name',
    '渝贵铁路',
    '--from',
    '106.43,29.50',
    '--to',
    '106.67,26.65',
    '--hint',
    '重庆西,綦江东,桐梓东,遵义,息烽,贵阳北',
  ],
  [
    '2129275',
    'hainandong',
    '--name',
    '海南东环高铁',
    '--from',
    '110.34,20.03',
    '--to',
    '109.51,18.30',
    '--hint',
    '海口,海口东,文昌,琼海,万宁,陵水,三亚',
  ],
];

for (const [name, id, ...flags] of hsrJobs) {
  run(process.execPath, [extract, name, id, ...flags]);
}

for (const job of osmJobs) {
  run(process.execPath, [osm, ...job]);
}

/** 补 stationsHint 到 hsr 抽出的张吉怀 */
const zjPath = join(corridorsDir, 'zhangjihuai.json');
if (existsSync(zjPath)) {
  const c = JSON.parse(readFileSync(zjPath, 'utf8'));
  c.name = '张吉怀高铁';
  c.stationsHint = [
    '张家界西',
    '芙蓉镇',
    '古丈西',
    '吉首东',
    '凤凰古城',
    '麻阳西',
    '怀化南',
  ];
  writeFileSync(zjPath, JSON.stringify(c));
  console.log('patched stationsHint', zjPath);
}

console.log('\nphase-4 scenic corridors done');
spawnSync(process.execPath, [join(__dirname, 'seed-missing-stations-geo.mjs')], {
  stdio: 'inherit',
});
