/**
 * 风景线第五期：普速/客专 OSM relation 精确折线
 * node scripts/build-phase5-scenic-corridors.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const osm = join(__dirname, 'build-corridor-from-osm-relation.mjs');

function run(args) {
  console.log('\n========', args[1], '========');
  const r = spawnSync(process.execPath, [osm, ...args], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.warn('WARN failed', args[1], 'status', r.status);
  }
}

const jobs = [
  [
    '11325371',
    'heruo',
    '--name',
    '和若铁路',
    '--from',
    '79.92,37.11',
    '--to',
    '88.17,39.02',
    '--tol',
    '0.015',
    '--hint',
    '和田,洛浦,策勒,于田,民丰,且末,若羌',
  ],
  [
    '1912130',
    'baocheng',
    '--name',
    '宝成铁路',
    '--from',
    '107.15,34.37',
    '--to',
    '104.07,30.63',
    '--tol',
    '0.012',
    '--hint',
    '宝鸡,凤州,略阳,阳平关,广元,绵阳,成都',
  ],
  [
    '10286390',
    'chengkun',
    '--name',
    '成昆铁路',
    '--from',
    '104.07,30.63',
    '--to',
    '102.72,25.02',
    '--tol',
    '0.012',
    '--hint',
    '成都,峨眉,燕岗,汉源,甘洛,越西,喜德,西昌,德昌,米易,攀枝花,元谋,广通,昆明',
  ],
  [
    '163712',
    'nanjiang',
    '--name',
    '南疆铁路',
    '--from',
    '89.18,42.94',
    '--to',
    '75.99,39.49',
    '--tol',
    '0.015',
    '--hint',
    '吐鲁番,和硕,焉耆,库尔勒,轮台,库车,新和,阿克苏,巴楚,阿图什,喀什',
  ],
  [
    '1108853',
    'jitong',
    '--name',
    '集通铁路',
    '--from',
    '113.12,41.03',
    '--to',
    '122.26,43.61',
    '--tol',
    '0.015',
    '--hint',
    '集宁,化德,正镶白旗,克什克腾,大板,林西,查布嘎,通辽',
  ],
  [
    '3420812',
    'lari',
    '--name',
    '拉日铁路',
    '--from',
    '91.07,29.62',
    '--to',
    '88.88,29.25',
    '--tol',
    '0.015',
    '--hint',
    '拉萨,协荣,曲水,尼木,仁布,日喀则',
  ],
  [
    '7873545',
    'lanyu',
    '--name',
    '兰渝铁路',
    '--from',
    '103.75,36.07',
    '--to',
    '106.54,29.61',
    '--tol',
    '0.025',
    '--hint',
    '兰州,陇南,广元,南充北,重庆北',
  ],
];

for (const job of jobs) run(job);

console.log('\nphase-5 scenic corridors done');
spawnSync(process.execPath, [join(__dirname, 'seed-missing-stations-geo.mjs')], {
  stdio: 'inherit',
});
