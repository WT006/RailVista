/**
 * P0 batch2 remaining: local HSR graph extract + clean
 *   node scripts/build-phase-p0-local-batch2.mjs
 *   node scripts/build-phase-p0-local-batch2.mjs --only hanyi,wenfu
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const build = join(__dirname, 'build-corridor-from-local-graph.mjs');
const clean = join(__dirname, 'clean-corridors.mjs');
const approaches = join(__dirname, 'patch-corridor-od-approaches.mjs');
const bridge = join(__dirname, 'bridge-corridor-gaps-local.mjs');
const densify = join(__dirname, 'densify-corridor-jumps.mjs');

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0
    ? new Set(
        process.argv[i + 1]
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
})();

/** [outId, ...flags] */
const jobs = [
  [
    'hanyi',
    '--name',
    '汉宜铁路',
    '--from',
    '114.2494144,30.6216514',
    '--to',
    '111.4608,30.6586',
    '--hint',
    '汉口,汉川,天门南,仙桃,潜江,荆州,枝江北,宜昌东',
  ],
  [
    'wenfu',
    '--name',
    '温福铁路',
    '--from',
    '120.681828,28.07198',
    '--to',
    '119.386113,25.994224',
    '--hint',
    '温州南,瑞安,鳌江,苍南,霞浦,福安,宁德,罗源,连江,福州南',
  ],
  [
    'qinshen',
    '--name',
    '秦沈客专',
    '--from',
    '119.5863191,39.9648614',
    '--to',
    '123.440455,41.820572',
    '--hint',
    '秦皇岛,山海关,葫芦岛北,锦州南,盘锦北,台安,辽中,沈阳',
  ],
  [
    'longxia',
    '--name',
    '龙厦铁路',
    '--from',
    '117.017,25.098',
    '--to',
    '118.004482,24.597728',
    '--hint',
    '龙岩,南靖,漳州,角美,厦门北',
  ],
  [
    'qingyan',
    '--name',
    '青盐铁路',
    '--from',
    '120.396217,36.520397',
    '--to',
    '120.1797161,33.3745035',
    '--hint',
    '青岛北,日照西,连云港,灌云,盐城',
  ],
  [
    'shenmao',
    '--name',
    '深茂铁路',
    '--from',
    '114.3221962,22.7103736',
    '--to',
    '110.9241263,21.6453937',
    '--hint',
    '深圳坪山,江门,开平南,阳江,茂名',
  ],
  [
    'maozhan',
    '--name',
    '茂湛铁路',
    '--from',
    '110.9241263,21.6453937',
    '--to',
    '110.2838474,21.2456349',
    '--hint',
    '茂名,吴川,湛江西',
  ],
  [
    'qinglian',
    '--name',
    '青连铁路',
    '--from',
    '120.329167,36.335764',
    '--to',
    '118.776316,34.521284',
    '--hint',
    '青岛,青岛西,董家口,日照西,连云港',
  ],
  [
    'zhengjiao',
    '--name',
    '郑焦城际',
    '--from',
    '113.6536663,34.7475076',
    '--to',
    '113.2287096,35.2225958',
    '--hint',
    '郑州,南阳寨,黄河景区,武陟,修武西,焦作',
  ],
  [
    'taijiao',
    '--name',
    '太焦高铁',
    '--from',
    '112.5985,37.7362',
    '--to',
    '113.0553526,35.2088802',
    '--hint',
    '太原南,晋中,长治东,晋城东,焦作西',
  ],
  [
    'dazhang',
    '--name',
    '大张高铁',
    '--from',
    '113.3581164,40.0435567',
    '--to',
    '114.8766144,40.749518',
    '--hint',
    '大同南,阳高南,天镇,怀安,张家口',
  ],
  [
    'jingshen',
    '--name',
    '京沈高铁',
    '--from',
    '116.503,39.939936',
    '--to',
    '123.440455,41.820572',
    '--hint',
    '北京朝阳,承德南,朝阳,阜新,沈阳',
  ],
  [
    'qianzhangchang',
    '--name',
    '黔张常铁路',
    '--from',
    '108.768,29.528',
    '--to',
    '111.703668,29.071628',
    '--hint',
    '黔江,酉阳,张家界西,常德',
  ],
  [
    'musui',
    '--name',
    '牡绥铁路',
    '--from',
    '129.6062222,44.589775',
    '--to',
    '131.152,44.394',
    '--rail',
    '--hint',
    '牡丹江,穆棱,绥芬河',
  ],
  [
    'guangxiyanhai',
    '--name',
    '广西沿海铁路',
    '--from',
    '108.392623,22.852065',
    '--to',
    '108.344,21.737',
    '--hint',
    '南宁东,钦州东,防城港北',
  ],
  [
    'xiangguikuoneng',
    '--name',
    '湘桂铁路扩能',
    '--from',
    '112.7044896,26.8996964',
    '--to',
    '108.392623,22.852065',
    '--hint',
    '衡阳东,永州,桂林北,柳州,来宾北,南宁东',
  ],
  [
    'huzhune',
    '--name',
    '呼准鄂铁路',
    '--from',
    '111.7582244,40.8497206',
    '--to',
    '109.997,39.612',
    '--hint',
    '呼和浩特东,准格尔,鄂尔多斯',
  ],
];

const ok = [];
const fail = [];

for (const job of jobs) {
  const id = job[0];
  if (onlyArg && !onlyArg.has(id)) continue;
  console.log('\n======== local graph', id, '========');
  const r = spawnSync(process.execPath, [build, ...job], { stdio: 'inherit' });
  if (r.status !== 0) {
    fail.push({ id, step: 'build', status: r.status });
    continue;
  }
  spawnSync(process.execPath, [clean, '--write', '--id', id], { stdio: 'inherit' });
  spawnSync(process.execPath, [bridge, '--id', id, '--max', '8', '--write'], {
    stdio: 'inherit',
  });
  spawnSync(process.execPath, [clean, '--write', '--id', id], { stdio: 'inherit' });
  spawnSync(process.execPath, [approaches, '--write', '--id', id], { stdio: 'inherit' });
  ok.push(id);
}

console.log('\nok:', ok.join(', ') || '(none)');
console.log('fail:', fail.length ? JSON.stringify(fail) : '(none)');
process.exit(fail.length ? 1 : 0);
