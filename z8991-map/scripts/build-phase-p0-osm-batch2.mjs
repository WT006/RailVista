/**
 * P0 第三批 OSM：已探针确认的 relation + 京港切片
 *
 *   node scripts/build-phase-p0-osm-batch2.mjs
 *   node scripts/build-phase-p0-osm-batch2.mjs --only xiangpu,ganlong,anjiu
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const osm = join(__dirname, 'build-corridor-from-osm-relation.mjs');
const bbox = join(__dirname, 'build-corridor-from-osm-bbox.mjs');
const clean = join(__dirname, 'clean-corridors.mjs');
const verify = join(__dirname, 'verify-corridor-geometry.mjs');
const approaches = join(__dirname, 'patch-corridor-od-approaches.mjs');

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

/**
 * relation jobs: [relationId, outId, ...flags]
 * 坐标来自 stations-geo / wiki 近似
 */
const relationJobs = [
  // 向莆 ≈ 昌福线 南昌西→莆田（主线至福州，OD 切至莆田）
  [
    '3189831',
    'xiangpu',
    '--name',
    '向莆铁路',
    '--from',
    '115.852077,28.586017',
    '--to',
    '119.066314,25.372404',
    '--tol',
    '0.015',
    '--hint',
    '南昌西,抚州,三明北,永泰,莆田',
  ],
  // 赣龙 ≈ 赣瑞龙线 赣州→龙岩
  [
    '4552429',
    'ganlong',
    '--name',
    '赣龙铁路',
    '--from',
    '114.960344,25.8223836',
    '--to',
    '117.017,25.098',
    '--tol',
    '0.015',
    '--hint',
    '赣州,于都,瑞金,长汀南,冠豸山,龙岩',
  ],
  // 安九：京港高速线切片 安庆西→九江
  [
    '11589056',
    'anjiu',
    '--name',
    '安九高铁',
    '--from',
    '116.946,30.564',
    '--to',
    '116.001671,29.7066051',
    '--tol',
    '0.02',
    '--hint',
    '安庆西,池州,九江',
  ],
  // 昌赣：京港 南昌西→赣州西
  [
    '11589056',
    'changgan',
    '--name',
    '昌赣高铁',
    '--from',
    '115.852077,28.586017',
    '--to',
    '114.821,25.861',
    '--tol',
    '0.02',
    '--hint',
    '南昌西,樟树东,吉安西,泰和,兴国西,赣州西',
  ],
  // 赣深：京港 赣州西→深圳北
  [
    '11589056',
    'ganshen',
    '--name',
    '赣深高铁',
    '--from',
    '114.821,25.861',
    '--to',
    '114.0256839,22.6134699',
    '--tol',
    '0.02',
    '--hint',
    '赣州西,信丰西,龙南东,和平,河源北,博罗北,惠州北,仲恺,东莞南,光明城,深圳北',
  ],
];

/** bbox highspeed jobs for lines without clean dedicated relation */
const bboxJobs = [
  // 汉宜 汉口→宜昌东
  [
    'hanyi',
    '--name',
    '汉宜铁路',
    '--from',
    '114.2494144,30.6216514',
    '--to',
    '111.4608,30.6586',
    '--highspeed',
    '--pad',
    '0.45',
    '--tol',
    '0.012',
    '--hint',
    '汉口,汉川,天门南,仙桃,潜江,荆州,枝江北,宜昌东',
  ],
  // 温福 温州南→福州南
  [
    'wenfu',
    '--name',
    '温福铁路',
    '--from',
    '120.681828,28.07198',
    '--to',
    '119.386113,25.994224',
    '--highspeed',
    '--pad',
    '0.4',
    '--tol',
    '0.012',
    '--hint',
    '温州南,瑞安,鳌江,苍南,霞浦,福安,宁德,罗源,连江,福州南',
  ],
  // 秦沈 秦皇岛→沈阳
  [
    'qinshen',
    '--name',
    '秦沈客专',
    '--from',
    '119.5863191,39.9648614',
    '--to',
    '123.440455,41.820572',
    '--highspeed',
    '--pad',
    '0.5',
    '--tol',
    '0.015',
    '--hint',
    '秦皇岛,山海关,葫芦岛北,锦州南,盘锦北,台安,辽中,沈阳',
  ],
  // 龙厦 龙岩→厦门北
  [
    'longxia',
    '--name',
    '龙厦铁路',
    '--from',
    '117.017,25.098',
    '--to',
    '118.004482,24.597728',
    '--highspeed',
    '--pad',
    '0.35',
    '--tol',
    '0.012',
    '--hint',
    '龙岩,南靖,漳州,角美,厦门北',
  ],
  // 青盐 青岛北→盐城
  [
    'qingyan',
    '--name',
    '青盐铁路',
    '--from',
    '120.396217,36.520397',
    '--to',
    '120.1797161,33.3745035',
    '--highspeed',
    '--pad',
    '0.45',
    '--tol',
    '0.012',
    '--hint',
    '青岛北,青岛机场,董家口,日照西,岚山西,赣榆北,连云港,灌云,灌南,盐城',
  ],
  // 深茂 深圳北/江门→茂名（取深圳坪山→茂名）
  [
    'shenmao',
    '--name',
    '深茂铁路',
    '--from',
    '114.3221962,22.7103736',
    '--to',
    '110.9241263,21.6453937',
    '--highspeed',
    '--pad',
    '0.5',
    '--tol',
    '0.015',
    '--hint',
    '深圳坪山,惠阳,深圳机场,江门,开平南,阳江,茂名',
  ],
  // 茂湛 茂名→湛江西
  [
    'maozhan',
    '--name',
    '茂湛铁路',
    '--from',
    '110.9241263,21.6453937',
    '--to',
    '110.2838474,21.2456349',
    '--highspeed',
    '--pad',
    '0.3',
    '--tol',
    '0.01',
    '--hint',
    '茂名,吴川,湛江西',
  ],
  // 青连 青岛→连云港
  [
    'qinglian',
    '--name',
    '青连铁路',
    '--from',
    '120.329167,36.335764',
    '--to',
    '118.776316,34.521284',
    '--highspeed',
    '--pad',
    '0.45',
    '--tol',
    '0.012',
    '--hint',
    '青岛,青岛西,董家口,日照西,连云港',
  ],
  // 郑焦 郑州→焦作
  [
    'zhengjiao',
    '--name',
    '郑焦城际',
    '--from',
    '113.6536663,34.7475076',
    '--to',
    '113.2287096,35.2225958',
    '--highspeed',
    '--pad',
    '0.25',
    '--tol',
    '0.01',
    '--hint',
    '郑州,南阳寨,黄河景区,武陟,修武西,焦作',
  ],
  // 太焦 太原南→焦作西（郑太南段）
  [
    'taijiao',
    '--name',
    '太焦高铁',
    '--from',
    '112.5985,37.7362',
    '--to',
    '113.0553526,35.2088802',
    '--highspeed',
    '--pad',
    '0.45',
    '--tol',
    '0.015',
    '--hint',
    '太原南,晋中,长治东,晋城东,焦作西',
  ],
  // 大张 大同南→张家口
  [
    'dazhang',
    '--name',
    '大张高铁',
    '--from',
    '113.3581164,40.0435567',
    '--to',
    '114.8766144,40.749518',
    '--highspeed',
    '--pad',
    '0.4',
    '--tol',
    '0.012',
    '--hint',
    '大同南,阳高南,天镇,怀安,张家口',
  ],
  // 京沈 北京朝阳→沈阳（与 jingha 重叠，独立切片便于命中）
  [
    'jingshen',
    '--name',
    '京沈高铁',
    '--from',
    '116.503,39.939936',
    '--to',
    '123.440455,41.820572',
    '--highspeed',
    '--pad',
    '0.6',
    '--tol',
    '0.02',
    '--hint',
    '北京朝阳,承德南,朝阳,阜新,沈阳',
  ],
  // 黔张常 黔江→常德
  [
    'qianzhangchang',
    '--name',
    '黔张常铁路',
    '--from',
    '108.768,29.528',
    '--to',
    '111.703668,29.071628',
    '--highspeed',
    '--pad',
    '0.5',
    '--tol',
    '0.015',
    '--hint',
    '黔江,酉阳,永顺,张家界西,牛车河,常德',
  ],
  // 牡绥 牡丹江→绥芬河
  [
    'musui',
    '--name',
    '牡绥铁路',
    '--from',
    '129.6062222,44.589775',
    '--to',
    '131.152,44.394',
    '--pad',
    '0.35',
    '--tol',
    '0.012',
    '--hint',
    '牡丹江,穆棱,绥芬河',
  ],
  // 广西沿海：南宁东→防城港北（南钦+钦防主干）
  [
    'guangxiyanhai',
    '--name',
    '广西沿海铁路',
    '--from',
    '108.392623,22.852065',
    '--to',
    '108.344,21.737',
    '--highspeed',
    '--pad',
    '0.4',
    '--tol',
    '0.012',
    '--hint',
    '南宁东,钦州东,防城港北',
  ],
  // 湘桂扩能：衡阳东→南宁东（衡柳+柳南客专）
  [
    'xiangguikuoneng',
    '--name',
    '湘桂铁路扩能',
    '--from',
    '112.7044896,26.8996964',
    '--to',
    '108.392623,22.852065',
    '--highspeed',
    '--pad',
    '0.55',
    '--tol',
    '0.015',
    '--hint',
    '衡阳东,永州,桂林北,柳州,来宾北,南宁东',
  ],
  // 呼准鄂：呼和浩特东→鄂尔多斯方向（准格尔）
  [
    'huzhune',
    '--name',
    '呼准鄂铁路',
    '--from',
    '111.7582244,40.8497206',
    '--to',
    '110.0,39.6',
    '--pad',
    '0.5',
    '--tol',
    '0.015',
    '--hint',
    '呼和浩特东,准格尔,鄂尔多斯',
  ],
];

const ok = [];
const fail = [];

function runRelation(job) {
  const id = job[1];
  if (onlyArg && !onlyArg.has(id)) return;
  console.log('\n======== osm relation', id, '========');
  const r = spawnSync(process.execPath, [osm, ...job], { stdio: 'inherit' });
  if (r.status !== 0) {
    fail.push({ id, step: 'osm', status: r.status });
    return;
  }
  post(id);
}

function runBbox(job) {
  const id = job[0];
  if (onlyArg && !onlyArg.has(id)) return;
  console.log('\n======== osm bbox', id, '========');
  const r = spawnSync(process.execPath, [bbox, ...job], { stdio: 'inherit' });
  if (r.status !== 0) {
    fail.push({ id, step: 'bbox', status: r.status });
    return;
  }
  post(id);
}

function post(id) {
  console.log('\n======== clean', id, '========');
  const c = spawnSync(process.execPath, [clean, '--write', '--id', id], {
    stdio: 'inherit',
  });
  if (c.status !== 0) {
    fail.push({ id, step: 'clean', status: c.status });
    return;
  }
  spawnSync(process.execPath, [approaches, '--write', '--id', id], {
    stdio: 'inherit',
  });
  ok.push(id);
}

for (const job of relationJobs) runRelation(job);
for (const job of bboxJobs) runBbox(job);

console.log('\n======== verify --strict ========');
const v = spawnSync(process.execPath, [verify, '--strict'], { stdio: 'inherit' });

console.log('\nP0 OSM batch2 done');
console.log('ok:', ok.join(', ') || '(none)');
console.log('fail:', fail.length ? JSON.stringify(fail) : '(none)');
console.log('verifyStatus:', v.status);
process.exit(fail.length ? 1 : 0);
