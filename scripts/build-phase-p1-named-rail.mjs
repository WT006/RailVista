/**
 * P1 普速：名称过滤 china-rail.graph → clean → densify → verify --strict
 *   node --max-old-space-size=8192 scripts/build-phase-p1-named-rail.mjs
 *   node --max-old-space-size=8192 scripts/build-phase-p1-named-rail.mjs --only shide,lanyan
 */
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorridorFromGraph, haversine } from './lib/build-local-corridor-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
const geoPath = join(root, 'data/stations-geo.json');
const graphPath = join(root, 'data/rails/china-rail.graph');

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0
    ? new Set(process.argv[i + 1].split(/[,，]/).map((s) => s.trim()).filter(Boolean))
    : null;
})();

function want(id) {
  return !onlyArg || onlyArg.has(id);
}

function run(args) {
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  return r.status === 0;
}

function densifyAny(id, maxKeep = 8) {
  const p = join(corrDir, `${id}.json`);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  function hv(a, b) {
    const R = 6371;
    const t = Math.PI / 180;
    const dLat = (b[1] - a[1]) * t;
    const dLng = (b[0] - a[0]) * t;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const out = [c.railway[0]];
  let added = 0;
  for (let i = 1; i < c.railway.length; i++) {
    const a = out.at(-1);
    const b = c.railway[i];
    const d = hv(a, b);
    if (d > maxKeep) {
      const n = Math.ceil(d / maxKeep);
      for (let k = 1; k < n; k++) {
        out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
        added += 1;
      }
    }
    out.push(b);
  }
  c.railway = out;
  c.note = `${c.note || ''} | densify>${maxKeep}km`.trim();
  writeFileSync(p, JSON.stringify(c));
  console.log('densify', id, '+', added);
}

function pipeline(id) {
  if (!run(['scripts/clean-corridors.mjs', '--write', '--id', id])) return false;
  densifyAny(id, 8);
  run(['scripts/clean-corridors.mjs', '--write', '--id', id]);
  run(['scripts/patch-corridor-od-approaches.mjs', '--write', '--id', id]);
  densifyAny(id, 8);
  if (!run(['scripts/verify-corridor-geometry.mjs', '--strict', '--id', id])) {
    const p = join(corrDir, `${id}.json`);
    if (existsSync(p)) unlinkSync(p);
    console.log('REMOVED', id);
    return false;
  }
  return true;
}

function filterWays(full, re) {
  return { ...full, ways: (full.ways || []).filter((w) => re.test(String(w.name || ''))) };
}

function buildOd(g, from, to, tol = 0.12) {
  return buildCorridorFromGraph(g, {
    from,
    to,
    connectTol: tol,
    noPrefer: true,
    log: (...a) => console.log(...a),
  });
}

function stitch(parts) {
  const all = [];
  for (const coords of parts) {
    if (!coords?.length) throw new Error('empty part');
    if (!all.length) {
      all.push(...coords);
      continue;
    }
    const gap = haversine(
      { lng: all.at(-1)[0], lat: all.at(-1)[1] },
      { lng: coords[0][0], lat: coords[0][1] },
    );
    console.log('stitch gap km', gap.toFixed(2));
    all.push(...coords.slice(1));
  }
  return all;
}

function writeCorr(id, name, hint, coords, note, sourceNames) {
  writeFileSync(
    join(corrDir, `${id}.json`),
    JSON.stringify({
      id,
      name,
      source: 'local-rail-graph-named',
      sourceNames: sourceNames || [name],
      stationsHint: hint,
      railway: coords,
      note,
    }),
  );
  console.log('written', id, 'pts', coords.length);
}

/** 枢纽串：命名 ways 优先，失败则全图短桥（末/首段） */
function buildViaHubs(full, nameRe, hubs, { allowFullEnds = true } = {}) {
  const g = filterWays(full, nameRe);
  console.log('ways', g.ways.length, String(nameRe));
  if (g.ways.length < 5) throw new Error(`too few ways ${nameRe}`);
  const parts = [];
  for (let i = 0; i < hubs.length - 1; i++) {
    let r;
    try {
      r = buildOd(
        g,
        { lng: hubs[i][0], lat: hubs[i][1] },
        { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
        0.22,
      );
    } catch {
      const isEnd = i === 0 || i === hubs.length - 2;
      if (!allowFullEnds && !isEnd) throw new Error(`leg ${i} failed`);
      r = buildOd(
        full,
        { lng: hubs[i][0], lat: hubs[i][1] },
        { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
        0.25,
      );
    }
    parts.push(r.coords);
  }
  return stitch(parts);
}

function pinOd(geo, fromName, toName, fromLL, toLL, source) {
  geo[fromName] = { lng: fromLL[0], lat: fromLL[1], source };
  geo[toName] = { lng: toLL[0], lat: toLL[1], source };
}

console.log('loading graph…');
const full = JSON.parse(readFileSync(graphPath, 'utf8'));
const geo = JSON.parse(readFileSync(geoPath, 'utf8'));

// 锚点（wiki/既有走廊），禁止用错误走廊投影覆盖枢纽站
const NJ = [118.792, 32.087];
const XA = [108.9578972, 34.2799595];
const BJ = [116.421, 39.9011];
const CD = [104.0678, 30.6999];
const CQ = [106.547, 29.55]; // 重庆站 approx（普速成渝，非重庆北）

const ok = [];
const fail = [];

// —— 先修宁西：南京被钉到合肥附近 ——
if (want('ningxi-fix') || want('ningxi')) {
  console.log('\n######## ningxi-fix ########');
  try {
    const hubs = [
      NJ,
      [117.285, 31.885], // 合肥
      [116.51, 31.74], // 六安
      [114.07, 32.14], // 信阳
      [112.54, 33.0], // 南阳
      XA,
    ];
    // 首末段全图接轨（宁西命名 ways 不到南京城站/西安站）
    const g = filterWays(full, /^宁西线$/);
    const parts = [];
    for (let i = 0; i < hubs.length - 1; i++) {
      const named = i > 0 && i < hubs.length - 2;
      let r;
      try {
        r = buildOd(
          named ? g : full,
          { lng: hubs[i][0], lat: hubs[i][1] },
          { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
          named ? 0.22 : 0.2,
        );
      } catch {
        r = buildOd(
          full,
          { lng: hubs[i][0], lat: hubs[i][1] },
          { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
          0.28,
        );
      }
      parts.push(r.coords);
    }
    const coords = stitch(parts);
    pinOd(geo, '南京', '西安', NJ, XA, 'anchor:wiki');
    writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
    writeCorr(
      'ningxi',
      '宁西线',
      ['南京', '西安'],
      coords,
      'name-filter 宁西线 | full-graph OD legs to 南京/西安',
    );
    if (pipeline('ningxi')) ok.push('ningxi');
    else fail.push('ningxi');
  } catch (e) {
    console.error('ningxi-fix', e.message || e);
    fail.push('ningxi');
  }
}

const jobs = [
  {
    id: 'shide',
    name: '石德线',
    re: /^石德线$/,
    hint: ['石家庄', '德州'],
    hubs: [
      [114.4849, 38.0095],
      [115.4, 37.8],
      [116.2827, 37.4487],
    ],
    pin: [
      ['石家庄', [114.4849, 38.0095]],
      ['德州', [116.2827, 37.4487]],
    ],
  },
  {
    id: 'lanyan',
    name: '蓝烟线',
    re: /^蓝烟线$/,
    hint: ['蓝村', '烟台'],
    hubs: [
      [120.024, 36.395], // 蓝村站
      [120.45, 36.75],
      [121.0, 37.2],
      [121.3917, 37.537], // 烟台站
    ],
    pin: [
      ['蓝村', [120.024, 36.395]],
      ['烟台', [121.3917, 37.537]],
    ],
    fullEnds: true,
  },
  {
    id: 'jingyuan',
    name: '京原线',
    re: /^京原线$/,
    hint: ['北京', '原平'],
    hubs: [BJ, [115.5, 39.5], [113.5, 39.0], [112.72, 38.73]],
    pin: [
      ['北京', BJ],
      ['原平', [112.72, 38.73]],
    ],
  },
  {
    id: 'handan',
    name: '汉丹线',
    re: /^汉丹线$/,
    hint: ['汉口', '襄阳'],
    hubs: [
      [114.2494, 30.6217],
      [113.8, 30.9],
      [113.0, 31.4],
      [112.5, 31.8],
      [111.734848, 32.225322], // 襄阳（xiangyu）
    ],
    pin: [['汉口', [114.2494, 30.6217]]],
    fullEnds: true,
  },
  {
    id: 'xuanhang',
    name: '宣杭线',
    re: /^宣杭线$/,
    hint: ['宣城', '杭州'],
    hubs: [
      [118.758, 30.945], // 宣城站更准
      [119.2, 30.7],
      [119.6, 30.5],
      [120.0, 30.35],
      [120.1784, 30.246],
    ],
    pin: [
      ['宣城', [118.758, 30.945]],
      ['杭州', [120.1784, 30.246]],
    ],
    fullEnds: true,
  },
  {
    id: 'ningwu',
    name: '宁芜线',
    re: /^宁芜线$/,
    hint: ['南京', '芜湖'],
    hubs: [
      NJ,
      [118.55, 31.85],
      [118.3, 31.5],
      [118.1, 31.3],
      [118.376, 31.333], // 芜湖站 approx
    ],
    pin: [
      ['南京', NJ],
      ['芜湖', [118.376, 31.333]],
    ],
    fullEnds: true,
  },
  {
    id: 'houxi',
    name: '侯西线',
    re: /^侯西线$/,
    hint: ['侯马', '西安'],
    hubs: [
      [111.37, 35.62],
      [110.8, 35.2],
      [110.2, 34.9],
      [109.5, 34.5],
      XA,
    ],
    pin: [
      ['侯马', [111.37, 35.62]],
      ['西安', XA],
    ],
    fullEnds: true,
  },
  {
    id: 'yangan',
    name: '阳安线',
    re: /^阳安线$/,
    hint: ['阳平关', '安康'],
    hubs: [
      [105.98, 32.95],
      [107.0, 32.95],
      [108.0, 32.85],
      [109.02, 32.69],
    ],
    pin: [
      ['阳平关', [105.98, 32.95]],
      ['安康', [109.02, 32.69]],
    ],
    fullEnds: true,
  },
  {
    id: 'xikang',
    name: '西康线',
    re: /^西康线$/,
    hint: ['西安', '安康'],
    hubs: [XA, [109.2, 33.8], [109.1, 33.2], [109.02, 32.69]],
    pin: [
      ['西安', XA],
      ['安康', [109.02, 32.69]],
    ],
    fullEnds: true,
  },
  {
    id: 'chengyuxian',
    name: '成渝线',
    re: /^成渝线$/,
    hint: ['成都', '重庆'],
    hubs: [CD, [104.8, 30.0], [105.5, 29.6], [106.2, 29.5], CQ],
    pin: [
      ['成都', CD],
      ['重庆', CQ],
    ],
    fullEnds: true,
  },
  {
    id: 'chuanqian',
    name: '川黔线',
    re: /^川黔线$/,
    hint: ['重庆', '贵阳'],
    hubs: [CQ, [106.8, 28.5], [106.9, 27.5], [106.67, 26.58]],
    pin: [
      ['重庆', CQ],
      ['贵阳', [106.67, 26.58]],
    ],
    fullEnds: true,
  },
  {
    id: 'guangmao',
    name: '广茂线',
    re: /^广茂线$/,
    hint: ['广州', '茂名'],
    hubs: [
      [113.2644, 23.1291],
      [112.5, 22.9],
      [111.5, 22.5],
      [110.92, 21.66],
    ],
    pin: [
      ['广州', [113.2644, 23.1291]],
      ['茂名', [110.92, 21.66]],
    ],
    fullEnds: true,
  },
  {
    id: 'lizhan',
    name: '黎湛线',
    re: /^黎湛线$/,
    hint: ['黎塘', '湛江'],
    hubs: [
      [109.22, 23.2],
      [109.8, 22.5],
      [110.2, 21.8],
      [110.403, 21.19],
    ],
    pin: [
      ['黎塘', [109.22, 23.2]],
      ['湛江', [110.403, 21.19]],
    ],
    fullEnds: true,
  },
  {
    id: 'huainan',
    name: '淮南线',
    re: /^淮南线$/,
    hint: ['芜湖', '淮南'],
    hubs: [
      [118.376, 31.333],
      [117.8, 32.0],
      [117.02, 32.63],
    ],
    pin: [
      ['芜湖', [118.376, 31.333]],
      ['淮南', [117.02, 32.63]],
    ],
    fullEnds: true,
  },
  {
    id: 'fuhuai',
    name: '阜淮线',
    re: /^阜淮线$/,
    hint: ['阜阳', '淮南'],
    hubs: [
      [115.864, 32.9167],
      [116.5, 32.8],
      [117.02, 32.63],
    ],
    pin: [
      ['阜阳', [115.864, 32.9167]],
      ['淮南', [117.02, 32.63]],
    ],
    fullEnds: true,
  },
  {
    id: 'wujiu',
    name: '武九线',
    re: /^武九线$/,
    hint: ['武昌', '九江'],
    hubs: [
      [114.3162, 30.535],
      [115.2, 29.9],
      [115.992, 29.704],
    ],
    pin: [
      ['武昌', [114.3162, 30.535]],
      ['九江', [115.992, 29.704]],
    ],
    fullEnds: true,
  },
  {
    id: 'dacheng',
    name: '达成铁路',
    re: /^达成线$/,
    hint: ['达州', '成都'],
    hubs: [
      [107.5, 31.22],
      [106.5, 30.8],
      [105.5, 30.6],
      CD,
    ],
    pin: [
      ['达州', [107.5, 31.22]],
      ['成都', CD],
    ],
    fullEnds: true,
  },
  {
    id: 'jiaojixian',
    name: '胶济线',
    re: /^胶济线$/,
    hint: ['青岛', '济南'],
    hubs: [
      [120.314, 36.065],
      [119.5, 36.5],
      [118.5, 36.7],
      [117.0, 36.67],
    ],
    pin: [
      ['青岛', [120.314, 36.065]],
      ['济南', [117.0, 36.67]],
    ],
    fullEnds: true,
  },
  {
    id: 'wanggan',
    name: '皖赣线',
    re: /^皖赣线$/,
    hint: ['芜湖', '贵溪'],
    hubs: [
      [118.376, 31.333],
      [118.0, 30.5],
      [117.5, 29.5],
      [117.22, 28.29],
    ],
    pin: [
      ['芜湖', [118.376, 31.333]],
      ['贵溪', [117.22, 28.29]],
    ],
    fullEnds: true,
  },
  {
    id: 'tongjiu',
    name: '铜九铁路',
    re: /^铜九线$/,
    hint: ['铜陵', '九江'],
    hubs: [
      [117.85, 30.93],
      [116.8, 30.3],
      [115.992, 29.704],
    ],
    pin: [
      ['铜陵', [117.85, 30.93]],
      ['九江', [115.992, 29.704]],
    ],
    fullEnds: true,
  },
  {
    id: 'shendan',
    name: '沈丹线',
    re: /^沈丹线$/,
    hint: ['沈阳', '丹东'],
    hubs: [
      [123.429, 41.795],
      [124.2, 41.3],
      [124.38, 40.13],
    ],
    pin: [
      ['沈阳', [123.429, 41.795]],
      ['丹东', [124.38, 40.13]],
    ],
    fullEnds: true,
  },
  {
    id: 'pingqi',
    name: '平齐线',
    re: /^平齐线$/,
    hint: ['四平', '齐齐哈尔'],
    hubs: [
      [124.37, 43.17],
      [124.0, 45.0],
      [123.92, 47.35],
    ],
    pin: [
      ['四平', [124.37, 43.17]],
      ['齐齐哈尔', [123.92, 47.35]],
    ],
    fullEnds: true,
  },
  {
    id: 'binsui',
    name: '滨绥线',
    re: /^滨绥线$/,
    hint: ['哈尔滨', '绥芬河'],
    hubs: [
      [126.63, 45.76],
      [128.5, 44.5],
      [131.15, 44.38],
    ],
    pin: [
      ['哈尔滨', [126.63, 45.76]],
      ['绥芬河', [131.15, 44.38]],
    ],
    fullEnds: true,
  },
  {
    id: 'changtu',
    name: '长图线',
    re: /^长图线$/,
    hint: ['长春', '图们'],
    hubs: [
      [125.32, 43.91],
      [127.0, 43.5],
      [129.85, 42.97],
    ],
    pin: [
      ['长春', [125.32, 43.91]],
      ['图们', [129.85, 42.97]],
    ],
    fullEnds: true,
  },
  {
    id: 'xinchang',
    name: '新长线',
    re: /^新长线$/,
    hint: ['新沂', '长兴'],
    hubs: [
      [118.35, 34.37],
      [119.0, 33.5],
      [119.5, 32.5],
      [119.7, 31.5],
      [119.9, 31.0],
    ],
    pin: [
      ['新沂', [118.35, 34.37]],
      ['长兴', [119.9, 31.0]],
    ],
    fullEnds: true,
  },
  {
    id: 'baozhong',
    name: '宝中线',
    re: /^宝中线$/,
    hint: ['宝鸡', '中卫'],
    hubs: [
      [107.15, 34.38],
      [106.5, 35.0],
      [105.5, 36.0],
      [105.18, 37.45],
    ],
    pin: [
      ['宝鸡', [107.15, 34.38]],
      ['中卫', [105.18, 37.45]],
    ],
    fullEnds: true,
  },
  {
    id: 'dunhuang',
    name: '敦煌线',
    re: /^敦煌线$/,
    hint: ['柳园', '敦煌'],
    hubs: [
      [95.37, 41.1],
      [94.8, 40.5],
      [94.68, 40.13],
    ],
    pin: [
      ['柳园', [95.37, 41.1]],
      ['敦煌', [94.68, 40.13]],
    ],
    fullEnds: true,
  },
  {
    id: 'ganwu',
    name: '干武线',
    re: /^干武线$/,
    hint: ['干塘', '武威'],
    hubs: [
      [104.5, 37.5],
      [103.5, 37.8],
      [102.63, 37.93],
    ],
    pin: [
      ['干塘', [104.5, 37.5]],
      ['武威', [102.63, 37.93]],
    ],
    fullEnds: true,
  },
  {
    id: 'jingtong',
    name: '京通线',
    re: /^京通线$/,
    hint: ['北京', '通辽'],
    hubs: [
      [116.421, 39.9011],
      [117.5, 41.0],
      [119.5, 42.5],
      [122.26, 43.61],
    ],
    pin: [
      ['北京', [116.421, 39.9011]],
      ['通辽', [122.26, 43.61]],
    ],
    fullEnds: true,
  },
  {
    id: 'nankunxian',
    name: '南昆线',
    re: /^南昆线$/,
    hint: ['南宁', '昆明'],
    hubs: [
      [108.31, 22.83],
      [106.5, 24.0],
      [104.5, 25.0],
      [102.72, 25.04],
    ],
    pin: [
      ['南宁', [108.31, 22.83]],
      ['昆明', [102.72, 25.04]],
    ],
    fullEnds: true,
  },
  {
    id: 'qiangui',
    name: '黔桂铁路',
    re: /^黔桂线$/,
    hint: ['贵阳', '柳州'],
    hubs: [
      [106.67, 26.58],
      [107.5, 25.5],
      [108.5, 24.8],
      [109.4, 24.3],
    ],
    pin: [
      ['贵阳', [106.67, 26.58]],
      ['柳州', [109.4, 24.3]],
    ],
    fullEnds: true,
  },
  {
    id: 'hemao',
    name: '河茂线',
    re: /^河茂线$/,
    hint: ['河唇', '茂名'],
    hubs: [
      [110.05, 21.55],
      [110.5, 21.6],
      [110.92, 21.66],
    ],
    pin: [
      ['河唇', [110.05, 21.55]],
      ['茂名', [110.92, 21.66]],
    ],
    fullEnds: true,
  },
  {
    id: 'jier',
    name: '集二线',
    re: /^集二线$/,
    hint: ['集宁', '二连'],
    hubs: [
      [113.1, 41.03],
      [112.5, 42.5],
      [111.96, 43.65],
    ],
    pin: [
      ['集宁', [113.1, 41.03]],
      ['二连', [111.96, 43.65]],
    ],
    fullEnds: true,
  },
  {
    id: 'dawan',
    name: '达万线',
    re: /^达万铁路$/,
    hint: ['达州', '万州'],
    hubs: [
      [107.5, 31.22],
      [107.8, 30.9],
      [108.4, 30.8],
    ],
    pin: [
      ['达州', [107.5, 31.22]],
      ['万州', [108.4, 30.8]],
    ],
    fullEnds: true,
  },
  {
    id: 'hanhuang',
    name: '邯黄铁路',
    re: /^邯黄线$/,
    hint: ['邯郸', '黄骅港'],
    hubs: [
      [114.48, 36.6],
      [116.0, 37.5],
      [117.5, 38.3],
      [117.85, 38.35],
    ],
    pin: [
      ['邯郸', [114.48, 36.6]],
      ['黄骅港', [117.85, 38.35]],
    ],
    fullEnds: true,
  },
  {
    id: 'fengsha',
    name: '丰沙线',
    re: /^丰沙线$/,
    hint: ['丰台', '沙城'],
    hubs: [
      [116.3, 39.85],
      [115.8, 40.1],
      [115.52, 40.4],
    ],
    pin: [
      ['丰台', [116.3, 39.85]],
      ['沙城', [115.52, 40.4]],
    ],
    fullEnds: true,
  },
  {
    id: 'houyue',
    name: '侯月线',
    re: /^侯月线$/,
    hint: ['侯马', '月山'],
    hubs: [
      [111.37, 35.62],
      [112.2, 35.3],
      [113.05, 35.2],
    ],
    pin: [
      ['侯马', [111.37, 35.62]],
      ['月山', [113.05, 35.2]],
    ],
    fullEnds: true,
  },
  {
    id: 'hanchang',
    name: '邯长线',
    re: /^邯长线$/,
    hint: ['邯郸', '长治'],
    hubs: [
      [114.48, 36.6],
      [113.5, 36.4],
      [113.12, 36.2],
    ],
    pin: [
      ['邯郸', [114.48, 36.6]],
      ['长治', [113.12, 36.2]],
    ],
    fullEnds: true,
  },
  {
    id: 'yanshi',
    name: '兖石线',
    re: /^兖石线$/,
    hint: ['兖州', '石臼所'],
    hubs: [
      [116.85, 35.55],
      [118.0, 35.3],
      [119.35, 35.12],
    ],
    pin: [
      ['兖州', [116.85, 35.55]],
      ['石臼所', [119.35, 35.12]],
    ],
    fullEnds: true,
  },
  {
    id: 'jiaoxin',
    name: '胶新线',
    re: /^胶新线$/,
    hint: ['胶州', '新沂'],
    hubs: [
      [120.0, 36.27],
      [119.2, 35.5],
      [118.35, 34.37],
    ],
    pin: [
      ['胶州', [120.0, 36.27]],
      ['新沂', [118.35, 34.37]],
    ],
    fullEnds: true,
  },
  {
    id: 'labin',
    name: '拉滨线',
    re: /^拉滨线$/,
    hint: ['哈尔滨', '拉法'],
    hubs: [
      [126.63, 45.76],
      [127.2, 44.8],
      [127.3, 43.85],
    ],
    pin: [
      ['哈尔滨', [126.63, 45.76]],
      ['拉法', [127.3, 43.85]],
    ],
    fullEnds: true,
  },
  {
    id: 'xiping',
    name: '西平线',
    re: /^西平线$/,
    hint: ['西安', '平凉'],
    hubs: [
      [108.9578972, 34.2799595],
      [107.5, 34.8],
      [106.68, 35.54],
    ],
    pin: [
      ['西安', [108.9578972, 34.2799595]],
      ['平凉', [106.68, 35.54]],
    ],
    fullEnds: true,
  },
  {
    id: 'baoxi',
    name: '包西线',
    re: /^包西线$/,
    hint: ['包头', '西安'],
    hubs: [
      [109.85, 40.6],
      [109.5, 38.5],
      [109.0, 36.5],
      [108.9578972, 34.2799595],
    ],
    pin: [
      ['包头', [109.85, 40.6]],
      ['西安', [108.9578972, 34.2799595]],
    ],
    fullEnds: true,
  },
  {
    id: 'pingqi',
    name: '平齐线',
    re: /^平齐线$/,
    hint: ['四平', '齐齐哈尔'],
    hubs: [
      [124.37, 43.17],
      [123.8, 44.0],
      [123.5, 45.5],
      [123.7, 46.5],
      [123.92, 47.35],
    ],
    pin: [
      ['四平', [124.37, 43.17]],
      ['齐齐哈尔', [123.92, 47.35]],
    ],
    fullEnds: true,
  },
  {
    id: 'changtu',
    name: '长图线',
    re: /^长图线$/,
    hint: ['长春', '图们'],
    hubs: [
      [125.32, 43.91],
      [126.2, 43.7],
      [127.5, 43.5],
      [128.5, 43.2],
      [129.85, 42.97],
    ],
    pin: [
      ['长春', [125.32, 43.91]],
      ['图们', [129.85, 42.97]],
    ],
    fullEnds: true,
  },
];

for (const job of jobs) {
  if (!want(job.id)) continue;
  console.log('\n########', job.id, '########');
  try {
    const coords = job.fullEnds
      ? (() => {
          const g = filterWays(full, job.re);
          const parts = [];
          for (let i = 0; i < job.hubs.length - 1; i++) {
            const endLeg = i === 0 || i === job.hubs.length - 2;
            let r;
            try {
              r = buildOd(
                endLeg ? full : g,
                { lng: job.hubs[i][0], lat: job.hubs[i][1] },
                { lng: job.hubs[i + 1][0], lat: job.hubs[i + 1][1] },
                endLeg ? 0.2 : 0.22,
              );
            } catch {
              r = buildOd(
                full,
                { lng: job.hubs[i][0], lat: job.hubs[i][1] },
                { lng: job.hubs[i + 1][0], lat: job.hubs[i + 1][1] },
                0.28,
              );
            }
            parts.push(r.coords);
          }
          return stitch(parts);
        })()
      : buildViaHubs(full, job.re, job.hubs);
    for (const [name, ll] of job.pin || []) {
      // 枢纽站已有可靠锚则保留（南京/西安/重庆北等）
      const keep =
        (name === '南京' && geo[name]?.source === 'anchor:wiki') ||
        (name === '西安' && geo[name]?.source === 'anchor:wiki') ||
        (name === '襄阳' && geo[name]?.source?.startsWith('corridor:xiangyu')) ||
        (name === '重庆北' && geo[name]?.source === 'anchor:yuwan');
      if (!keep) {
        geo[name] = { lng: ll[0], lat: ll[1], source: `corridor:${job.id}` };
      }
    }
    // OD 端强制用 pin（或已有锚）贴合
    const fromN = job.hint[0];
    const toN = job.hint[1];
    if (job.pin?.find(([n]) => n === fromN) && geo[fromN]) {
      /* keep */
    }
    writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
    writeCorr(job.id, job.name, job.hint, coords, `name-filter ${job.name}`);
    if (pipeline(job.id)) ok.push(job.id);
    else fail.push(job.id);
  } catch (e) {
    console.error(job.id, e.message || e);
    fail.push(job.id);
  }
}

console.log('\nOK', ok.join(', ') || '(none)');
console.log('FAIL', fail.join(', ') || '(none)');
process.exit(fail.length ? 1 : 0);
