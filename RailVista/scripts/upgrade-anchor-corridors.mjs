/**
 * 批量把剩余锚点走廊升级为 OSM bbox 精确轨
 * node scripts/upgrade-anchor-corridors.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = join(__dirname, 'build-corridor-from-osm-bbox.mjs');
const corridorsDir = join(__dirname, '../data/presets/corridors');

/** @type {{id:string, args:string[]}[]} */
const jobs = [
  // 已成功过的可重跑（带去折返）
  {
    id: 'hanghuang',
    args: [
      'hanghuang',
      '--name',
      '杭黄高铁',
      '--from',
      '120.21,30.29',
      '--to',
      '118.23,29.78',
      '--highspeed',
      '--pad',
      '0.35',
      '--hint',
      '杭州东,富阳,桐庐,建德,千岛湖,三阳,绩溪北,歙县北,黄山北',
    ],
  },
  {
    id: 'jingzhang',
    args: [
      'jingzhang',
      '--name',
      '京张高铁',
      '--from',
      '116.35,39.95',
      '--to',
      '114.88,40.75',
      '--highspeed',
      '--pad',
      '0.3',
      '--hint',
      '北京北,清河,八达岭长城,怀来,张家口',
    ],
  },
  {
    id: 'zhanghu',
    args: [
      'zhanghu',
      '--name',
      '张呼高铁',
      '--from',
      '114.88,40.75',
      '--to',
      '111.76,40.85',
      '--highspeed',
      '--pad',
      '0.35',
      '--hint',
      '张家口,怀安,兴和北,乌兰察布,卓资东,呼和浩特东',
    ],
  },
  {
    id: 'yiwan',
    args: [
      'yiwan',
      '--name',
      '宜万铁路',
      '--from',
      '111.46,30.66',
      '--to',
      '108.40,30.80',
      '--pad',
      '0.35',
      '--tol',
      '0.01',
      '--hint',
      '宜昌东,巴东,建始,恩施,利川,万州',
    ],
  },
  {
    id: 'yuli',
    args: [
      'yuli',
      '--name',
      '渝利铁路',
      '--from',
      '106.55,29.61',
      '--to',
      '108.94,30.29',
      '--highspeed',
      '--pad',
      '0.35',
      '--hint',
      '重庆北,涪陵北,丰都,石柱县,利川',
    ],
  },
  {
    id: 'zhonglao',
    args: [
      'zhonglao',
      '--name',
      '中老铁路国内段',
      '--from',
      '102.85,24.89',
      '--to',
      '101.68,21.18',
      '--pad',
      '0.4',
      '--tol',
      '0.012',
      '--hint',
      '昆明南,玉溪,峨山,元江,墨江,宁洱,普洱,西双版纳,橄榄坝,勐腊,磨憨',
    ],
  },
  {
    id: 'chuanqing',
    args: [
      'chuanqing',
      '--name',
      '川青铁路',
      '--from',
      '104.12,30.59',
      '--to',
      '103.78,33.05',
      '--pad',
      '0.4',
      '--tol',
      '0.012',
      '--hint',
      '成都东,青白江东,三星堆,什邡西,绵竹南,安州,高川,茂县,镇江关,松潘,黄龙九寨,黄胜关',
    ],
  },
  {
    id: 'dunge',
    args: [
      'dunge',
      '--name',
      '敦格铁路',
      '--from',
      '94.78,40.17',
      '--to',
      '94.91,36.38',
      '--pad',
      '0.6',
      '--tol',
      '0.015',
      '--hint',
      '敦煌,阿克塞,肃北,马海,鱼卡,大柴旦,饮马峡,格尔木',
    ],
  },
  {
    id: 'geku',
    args: [
      'geku',
      '--name',
      '格库铁路',
      '--from',
      '94.91,36.38',
      '--to',
      '86.15,41.73',
      '--pad',
      '0.8',
      '--tol',
      '0.02',
      '--hint',
      '格尔木,花土沟,若羌,尉犁,库尔勒',
    ],
  },
  {
    id: 'xiangqian',
    args: [
      'xiangqian',
      '--name',
      '湘黔铁路',
      '--from',
      '113.15,27.84',
      '--to',
      '106.67,26.58',
      '--pad',
      '0.5',
      '--tol',
      '0.012',
      '--hint',
      '株洲,湘潭,娄底,冷水江东,新化,溆浦,怀化,凯里,贵定,贵阳',
    ],
  },
  {
    id: 'linha',
    args: [
      'linha',
      '--name',
      '临哈铁路',
      '--from',
      '111.66,40.85',
      '--to',
      '101.07,41.96',
      '--pad',
      '0.7',
      '--tol',
      '0.02',
      '--hint',
      '呼和浩特,包头,临河,额济纳',
    ],
  },
];

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function lineKm(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) {
    s += haversine(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
  }
  return s;
}

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]?.split(',')
  : null;

for (const job of jobs) {
  if (only && !only.includes(job.id)) continue;
  console.log('\n========', job.id, '========');
  const r = spawnSync(process.execPath, [script, ...job.args], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.warn('FAILED', job.id, 'keep previous file');
    continue;
  }
  const path = join(corridorsDir, `${job.id}.json`);
  if (!existsSync(path)) continue;
  const c = JSON.parse(readFileSync(path, 'utf8'));
  console.log('OK', job.id, 'pts', c.railway?.length, 'km', lineKm(c.railway || []).toFixed(0), c.source);
}

console.log('\nupgrade batch done');
