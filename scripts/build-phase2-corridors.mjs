/**
 * 一键重建第二期精品走廊（沿海 / 沿江分段；需已有 _hsr-rails.geojson，或加 --download）
 * node scripts/build-phase2-corridors.mjs
 * node scripts/build-phase2-corridors.mjs --download
 *
 * 说明：
 * - 连镇高铁在 china-hsr-simulation 中无完整线名，以徐连 + 盐通覆盖苏北沿海段
 * - 沪杭从一期沪昆走廊截取上海虹桥→杭州东（避免整条沪昆巨折线）
 * - 甬广/通苏嘉甬等源数据几乎为空，暂不入库
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = join(__dirname, 'extract-corridor-from-hsr.mjs');
const corridorsDir = join(__dirname, '../data/presets/corridors');
const extra = process.argv.includes('--download') ? ['--download'] : [];

/** @type {[string, string, ...string[]][]} */
const jobs = [
  // 沿海北段
  // 青荣：源数据东→西为荣成→青岛，reverse 成青岛→荣成
  ['青荣城际线|青荣城际铁路', 'qingrong', '--axis', 'ew', '--reverse'],
  // 徐连：源数据东→西为连云港→徐州，reverse 成徐州东→连云港
  ['徐连高速线', 'xulian', '--axis', 'ew', '--reverse'],
  ['盐通高速线|盐通高铁', 'yantong', '--axis', 'ns'],
  // 杭福深分段（不宜一条巨折线）
  ['杭台高速线|杭台高速铁路|杭台高铁', 'hangtai', '--axis', 'ns'],
  ['杭温高速线|杭温高速铁路', 'hangwen', '--axis', 'ns'],
  ['福厦高速铁路', 'fuxia', '--axis', 'ns'],
  ['广深港高速线|廣深港高速鐵路 Guangzhou–Shenzhen–Hong Kong Express Rail Link', 'guangshengang', '--axis', 'ns'],
  // 沿江相关：沪宁沿江东→西即上海侧→南京南
  ['沪宁沿江高速铁路', 'huningyanjiang', '--axis', 'ew'],
  ['郑渝高速线', 'zhengyu', '--axis', 'ns'],
  // 成渝：源数据东→西为重庆→成都，reverse 成成都东→重庆
  ['成渝高速线|成渝高铁|成渝客运专线', 'chengyu', '--axis', 'ew', '--reverse'],
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

function projectFrac(coords, lng, lat) {
  let best = { i: 0, d: Infinity, frac: 0 };
  let total = 0;
  const segLens = [0];
  for (let i = 1; i < coords.length; i++) {
    total += haversine(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
    segLens.push(total);
  }
  for (let i = 0; i < coords.length; i++) {
    const d = haversine(
      { lng: coords[i][0], lat: coords[i][1] },
      { lng, lat },
    );
    if (d < best.d) best = { i, d, frac: total > 0 ? segLens[i] / total : 0 };
  }
  return best;
}

/** 从一期沪昆截取上海虹桥→杭州东，作为沿海通道沪杭段 */
function buildHuhangFromHukun() {
  const hukunPath = join(corridorsDir, 'hukun.json');
  if (!existsSync(hukunPath)) {
    console.error('huhang: missing hukun.json — run phase1 first');
    process.exit(1);
  }
  const hukun = JSON.parse(readFileSync(hukunPath, 'utf8'));
  const railway = hukun.railway;
  // 沪昆折线东端≈上海虹桥，向西约 150–180 km 到杭州东附近
  const start = railway[0];
  let endIdx = 0;
  let best = Infinity;
  // 杭州东约 120.21, 30.29
  const hangzhou = { lng: 120.213, lat: 30.291 };
  for (let i = 0; i < railway.length; i++) {
    const d = haversine(
      { lng: railway[i][0], lat: railway[i][1] },
      hangzhou,
    );
    if (d < best) {
      best = d;
      endIdx = i;
    }
  }
  if (best > 25) {
    console.warn('huhang: Hangzhou East projection far', best.toFixed(1), 'km');
  }
  let sliced = railway.slice(0, endIdx + 1).map(([lng, lat]) => ({ lng, lat }));

  /** 与 extract-corridor-from-hsr 相同的去折返，避免沪杭段继承沪昆联络线毛刺 */
  function removeBacktracks(pts, dest) {
    if (pts.length < 3) return pts;
    const startToDest = haversine(pts[0], dest) || 1;
    const cleaned = [pts[0]];
    let maxProg = 0;
    for (let i = 1; i < pts.length; i++) {
      const prog = 1 - haversine(pts[i], dest) / startToDest;
      if (prog >= maxProg - 0.004) {
        cleaned.push(pts[i]);
        maxProg = Math.max(maxProg, prog);
      }
    }
    const last = pts.at(-1);
    if (
      Math.hypot(cleaned.at(-1).lng - last.lng, cleaned.at(-1).lat - last.lat) > 0.0001
    ) {
      cleaned.push(last);
    }
    return cleaned.length >= 2 ? cleaned : pts;
  }

  const destPt = sliced.at(-1);
  sliced = removeBacktracks(sliced, destPt);
  const coords = sliced.map((p) => [
    Number(p.lng.toFixed(6)),
    Number(p.lat.toFixed(6)),
  ]);

  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    km += haversine(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
  }
  const meta = {
    id: 'huhang',
    name: '沪杭高铁',
    source: 'china-hsr-simulation/hsr-rails.geojson#slice-from-hukun',
    sourceNames: ['沪昆高速线', '沪昆高速铁路'],
    stationsHint: [
      '上海虹桥',
      '松江南',
      '金山北',
      '嘉善南',
      '嘉兴南',
      '桐乡',
      '海宁西',
      '余杭',
      '杭州东',
    ],
    railway: coords,
  };
  const outPath = join(corridorsDir, 'huhang.json');
  writeFileSync(outPath, JSON.stringify(meta));
  const proj = projectFrac(coords, hangzhou.lng, hangzhou.lat);
  console.log(
    'huhang sliced pts',
    coords.length,
    'km',
    km.toFixed(1),
    'start',
    start,
    'end',
    coords.at(-1),
    'hangzhouDistKm',
    best.toFixed(1),
    'endFrac',
    proj.frac.toFixed(3),
  );
  console.log('written', outPath);
}

for (const [name, id, ...flags] of jobs) {
  console.log('\n========', id, '========');
  const r = spawnSync(process.execPath, [script, name, id, ...flags, ...extra], {
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log('\n======== huhang (slice from hukun) ========');
buildHuhangFromHukun();

console.log('\nphase-2 corridors done');
spawnSync(process.execPath, [join(__dirname, 'seed-corridor-stations-geo.mjs')], {
  stdio: 'inherit',
});
console.log('stations-geo seeded');
