/**
 * P0 第二批：OSM relation（hsr-rails 空/过短的线）
 * Overpass 探针已确认的 relation id；必须 --from/--to Dijkstra。
 *
 *   node scripts/build-phase-p0-osm.mjs
 *   node scripts/build-phase-p0-osm.mjs --only shitai,shiji,hebang
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const osm = join(__dirname, 'build-corridor-from-osm-relation.mjs');
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
 * [relationId, outId, ...flags]
 * 分类 A：探针确认主线 relation，可先入库
 */
const jobs = [
  // 石太客专 石家庄→太原南
  [
    '5399232',
    'shitai',
    '--name',
    '石太客专',
    '--from',
    '114.4849,38.0095',
    '--to',
    '112.5985,37.7362',
    '--tol',
    '0.012',
    '--hint',
    '石家庄,获鹿南,井陉北,阳泉北,寿阳,太原南',
  ],
  // 石济客专 石家庄→济南西
  [
    '8399952',
    'shiji',
    '--name',
    '石济客专',
    '--from',
    '114.4849,38.0095',
    '--to',
    '116.885,36.668',
    '--tol',
    '0.012',
    '--hint',
    '石家庄,藁城南,辛集南,衡水北,德州东,平原东,禹城东,齐河,济南西',
  ],
  // 合蚌高铁 合肥南→蚌埠南
  [
    '5916367',
    'hebang',
    '--name',
    '合蚌高铁',
    '--from',
    '117.316,31.798',
    '--to',
    '117.416,32.917',
    '--tol',
    '0.012',
    '--hint',
    '合肥南,水家湖,淮南东,蚌埠南',
  ],
  // 南广铁路 南宁东→广州南
  [
    '3999083',
    'nanguang',
    '--name',
    '南广铁路',
    '--from',
    '108.392623,22.852065',
    '--to',
    '113.2640375,22.9914143',
    '--tol',
    '0.015',
    '--hint',
    '南宁东,贵港,梧州南,郁南,云浮东,肇庆东,三水南,佛山西,广州南',
  ],
  // 渝万城际 重庆北→万州北
  [
    '4868613',
    'yuwan',
    '--name',
    '渝万城际',
    '--from',
    '106.461517,29.555794',
    '--to',
    '107.953112,30.749877',
    '--tol',
    '0.012',
    '--hint',
    '重庆北,长寿北,垫江,梁平南,万州北',
  ],
  // 甬台温铁路 宁波→温州南
  [
    '417230',
    'yongtaiwen',
    '--name',
    '甬台温铁路',
    '--from',
    '121.5326567,29.8646327',
    '--to',
    '120.681828,28.07198',
    '--tol',
    '0.015',
    '--hint',
    '宁波,宁海,三门县,临海,台州,温岭,雁荡山,绅坊,永嘉,温州南',
  ],
  // 连镇高铁 连云港→镇江南
  [
    '7047174',
    'lianzhen',
    '--name',
    '连镇高铁',
    '--from',
    '118.776316,34.521284',
    '--to',
    '119.201222,31.975645',
    '--tol',
    '0.015',
    '--hint',
    '连云港,灌云,灌南,涟水,淮安东,宝应,高邮北,扬州东,大港南,丹徒,镇江南',
  ],
  // 哈齐客专 哈尔滨西→齐齐哈尔
  [
    '8399169',
    'haqi',
    '--name',
    '哈齐高铁',
    '--from',
    '126.628595,45.762586',
    '--to',
    '123.990047,47.3384973',
    '--tol',
    '0.015',
    '--hint',
    '哈尔滨西,肇东,安达,大庆西,大庆东,杜尔伯特,红旗营东,齐齐哈尔南,齐齐哈尔',
  ],
];

const ok = [];
const fail = [];

for (const job of jobs) {
  const id = job[1];
  if (onlyArg && !onlyArg.has(id)) continue;
  console.log('\n======== osm extract', id, '========');
  const r = spawnSync(process.execPath, [osm, ...job], { stdio: 'inherit' });
  if (r.status !== 0) {
    fail.push({ id, step: 'osm', status: r.status });
    continue;
  }
  console.log('\n======== clean', id, '========');
  const c = spawnSync(process.execPath, [clean, '--write', '--id', id], {
    stdio: 'inherit',
  });
  if (c.status !== 0) {
    fail.push({ id, step: 'clean', status: c.status });
    continue;
  }
  // OD 进路（有则修，失败不阻断）
  spawnSync(process.execPath, [approaches, '--write', '--id', id], {
    stdio: 'inherit',
  });
  ok.push(id);
}

console.log('\n======== verify --strict ========');
const v = spawnSync(process.execPath, [verify, '--strict'], { stdio: 'inherit' });

console.log('\nP0 OSM batch done');
console.log('ok:', ok.join(', ') || '(none)');
console.log('fail:', fail.length ? JSON.stringify(fail) : '(none)');
console.log('verifyStatus:', v.status);
process.exit(fail.length ? 1 : 0);
