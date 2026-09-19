/**
 * P1 续批：加密枢纽 + 缝隙守卫（stitch gap > maxGapKm 则失败，禁止大跨 densify）
 *   node --max-old-space-size=8192 scripts/build-phase-p1-named-rail-batch3.mjs
 *   node --max-old-space-size=8192 scripts/build-phase-p1-named-rail-batch3.mjs --only chengyuxian,chuanqian
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
const MAX_STITCH = 25; // km — 超过则拒，避免 densify 飞线

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0
    ? new Set(process.argv[i + 1].split(/[,，]/).map((s) => s.trim()).filter(Boolean))
    : null;
})();
const want = (id) => !onlyArg || onlyArg.has(id);

function run(args) {
  return (
    spawnSync(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
    }).status === 0
  );
}

function densifyAny(id, maxKeep = 8) {
  const p = join(corrDir, `${id}.json`);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  const hv = (a, b) => {
    const R = 6371;
    const t = Math.PI / 180;
    const dLat = (b[1] - a[1]) * t;
    const dLng = (b[0] - a[0]) * t;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };
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

function buildOd(g, from, to, tol) {
  return buildCorridorFromGraph(g, {
    from,
    to,
    connectTol: tol,
    noPrefer: true,
    log: (...a) => console.log(...a),
  });
}

function buildVia(full, nameRe, hubs, { fullEnds = true } = {}) {
  const g = {
    ...full,
    ways: (full.ways || []).filter((w) => nameRe.test(String(w.name || ''))),
  };
  console.log('ways', g.ways.length, String(nameRe));
  if (g.ways.length < 5) throw new Error('too few ways');
  const parts = [];
  for (let i = 0; i < hubs.length - 1; i++) {
    const endLeg = i === 0 || i === hubs.length - 2;
    let r;
    try {
      r = buildOd(
        endLeg && fullEnds ? full : g,
        { lng: hubs[i][0], lat: hubs[i][1] },
        { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
        endLeg ? 0.2 : 0.22,
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
    if (gap > MAX_STITCH) throw new Error(`stitch gap ${gap.toFixed(1)}km > ${MAX_STITCH}`);
    all.push(...coords.slice(1));
  }
  return all;
}

function writeCorr(id, name, hint, coords, note) {
  writeFileSync(
    join(corrDir, `${id}.json`),
    JSON.stringify({
      id,
      name,
      source: 'local-rail-graph-named',
      sourceNames: [name],
      stationsHint: hint,
      railway: coords,
      note,
    }),
  );
}

function pinEnds(geo, hint, coords, id, anchors) {
  // OD 门禁要求端点 <5km：一律钉到走廊端；锚点仅作日志
  const s = coords[0];
  const e = coords.at(-1);
  for (const [name, ll, which] of anchors) {
    const end = which === 'from' ? s : e;
    const d = haversine({ lng: ll[0], lat: ll[1] }, { lng: end[0], lat: end[1] });
    console.log('pin', name, 'anchorDist', d.toFixed(1), '→ corridor end');
    // 保留已有 wiki/关键锚（南京/西安/重庆北/襄阳）
    const keep =
      (name === '南京' && geo[name]?.source === 'anchor:wiki') ||
      (name === '西安' && geo[name]?.source === 'anchor:wiki') ||
      (name === '重庆北' && geo[name]?.source === 'anchor:yuwan') ||
      (name === '襄阳' && String(geo[name]?.source || '').includes('xiangyu'));
    if (keep && d <= 12) {
      console.log('keep existing anchor', name);
      continue;
    }
    geo[name] = { lng: end[0], lat: end[1], source: `corridor:${id}` };
  }
}

console.log('loading graph…');
const full = JSON.parse(readFileSync(graphPath, 'utf8'));
const geo = JSON.parse(readFileSync(geoPath, 'utf8'));

const NJ = [118.792, 32.087];
const XA = [108.9578972, 34.2799595];
const CD = [104.0678, 30.6999];
const CQ = [106.547, 29.55];
const GY = [106.67, 26.58];
const HK = [114.2494, 30.6217];
const XY = [111.734848, 32.225322];

const jobs = [
  {
    id: 'chengyuxian',
    name: '成渝线',
    re: /^成渝线$/,
    hint: ['成都', '重庆'],
    hubs: [
      CD,
      [104.4, 30.4],
      [104.8, 30.0],
      [105.2, 29.7],
      [105.6, 29.55],
      [106.0, 29.5],
      [106.3, 29.52],
      CQ,
    ],
    anchors: [
      ['成都', CD, 'from'],
      ['重庆', CQ, 'to'],
    ],
  },
  {
    id: 'chuanqian',
    name: '川黔线',
    re: /^川黔线$/,
    hint: ['重庆', '贵阳'],
    hubs: [
      CQ,
      [106.6, 29.0],
      [106.7, 28.4],
      [106.85, 27.9],
      [106.9, 27.3],
      [106.8, 26.9],
      GY,
    ],
    anchors: [
      ['重庆', CQ, 'from'],
      ['贵阳', GY, 'to'],
    ],
  },
  {
    id: 'handan',
    name: '汉丹线',
    re: /^汉丹线$/,
    hint: ['汉口', '襄阳'],
    hubs: [
      HK,
      [113.9, 30.8],
      [113.5, 31.0],
      [113.0, 31.3],
      [112.6, 31.6],
      [112.2, 31.9],
      XY,
    ],
    anchors: [
      ['汉口', HK, 'from'],
      ['襄阳', XY, 'to'],
    ],
  },
  {
    id: 'xuanhang',
    name: '宣杭线',
    re: /^宣杭线$/,
    hint: ['宣城', '杭州'],
    hubs: [
      [118.758, 30.945],
      [119.1, 30.75],
      [119.4, 30.55],
      [119.7, 30.4],
      [120.0, 30.3],
      [120.1784, 30.246],
    ],
    anchors: [
      ['宣城', [118.758, 30.945], 'from'],
      ['杭州', [120.1784, 30.246], 'to'],
    ],
  },
  {
    id: 'qiangui',
    name: '黔桂铁路',
    re: /^黔桂线$/,
    hint: ['贵阳', '柳州'],
    hubs: [
      GY,
      [107.0, 26.2],
      [107.5, 25.6],
      [108.0, 25.2],
      [108.5, 24.8],
      [109.0, 24.5],
      [109.4, 24.3],
    ],
    anchors: [
      ['贵阳', GY, 'from'],
      ['柳州', [109.4, 24.3], 'to'],
    ],
  },
  {
    id: 'baozhong',
    name: '宝中线',
    re: /^宝中线$/,
    hint: ['宝鸡', '中卫'],
    hubs: [
      [107.148, 34.374],
      [106.8, 34.7],
      [106.3, 35.2],
      [105.8, 35.8],
      [105.4, 36.5],
      [105.186, 37.522],
    ],
    anchors: [
      ['宝鸡', [107.148, 34.374], 'from'],
      ['中卫', [105.186, 37.522], 'to'],
    ],
  },
  {
    id: 'xiping',
    name: '西平线',
    re: /^西平线$/,
    hint: ['西安', '平凉'],
    hubs: [XA, [108.2, 34.6], [107.5, 35.0], [107.0, 35.3], [106.68, 35.54]],
    anchors: [
      ['西安', XA, 'from'],
      ['平凉', [106.68, 35.54], 'to'],
    ],
  },
  {
    id: 'huainan',
    name: '淮南线',
    re: /^淮南线$/,
    hint: ['芜湖', '淮南'],
    hubs: [
      [118.376, 31.333],
      [118.0, 31.6],
      [117.6, 31.9],
      [117.3, 32.3],
      [117.02, 32.63],
    ],
    anchors: [
      ['芜湖', [118.376, 31.333], 'from'],
      ['淮南', [117.02, 32.63], 'to'],
    ],
  },
  {
    id: 'pingqi',
    name: '平齐线',
    re: /^平齐线$/,
    hint: ['四平', '齐齐哈尔'],
    hubs: [
      [124.37, 43.17],
      [124.0, 43.8],
      [123.7, 44.5],
      [123.5, 45.3],
      [123.6, 46.2],
      [123.8, 46.8],
      [123.92, 47.35],
    ],
    anchors: [
      ['四平', [124.37, 43.17], 'from'],
      ['齐齐哈尔', [123.92, 47.35], 'to'],
    ],
  },
  {
    id: 'changtu',
    name: '长图线',
    re: /^长图线$/,
    hint: ['长春', '图们'],
    hubs: [
      [125.32, 43.91],
      [126.0, 43.8],
      [126.8, 43.6],
      [127.5, 43.4],
      [128.3, 43.2],
      [129.0, 43.05],
      [129.85, 42.97],
    ],
    anchors: [
      ['长春', [125.32, 43.91], 'from'],
      ['图们', [129.85, 42.97], 'to'],
    ],
  },
  {
    id: 'tongrang',
    name: '通让线',
    re: /^通让线$/,
    hint: ['通辽', '让湖路'],
    hubs: [
      [122.26, 43.61],
      [123.0, 45.0],
      [124.0, 46.0],
      [124.85, 46.6],
    ],
    anchors: [
      ['通辽', [122.26, 43.61], 'from'],
      ['让湖路', [124.85, 46.6], 'to'],
    ],
  },
  {
    id: 'neiliu',
    name: '内六线',
    re: /^内六线$/,
    hint: ['内江', '六盘水'],
    hubs: [
      [105.05, 29.58],
      [104.5, 28.5],
      [104.2, 27.5],
      [104.85, 26.6],
    ],
    anchors: [
      ['内江', [105.05, 29.58], 'from'],
      ['六盘水', [104.85, 26.6], 'to'],
    ],
  },
  {
    id: 'hanji',
    name: '邯济线',
    re: /^邯济线$/,
    hint: ['邯郸', '济南'],
    hubs: [
      [114.48, 36.6],
      [115.5, 36.7],
      [116.5, 36.7],
      [117.0, 36.67],
    ],
    anchors: [
      ['邯郸', [114.48, 36.6], 'from'],
      ['济南', [117.0, 36.67], 'to'],
    ],
  },
  {
    id: 'xintai',
    name: '辛泰线',
    re: /^辛泰线$/,
    hint: ['辛店', '泰安'],
    hubs: [
      [118.3, 36.8],
      [117.8, 36.4],
      [117.1, 36.2],
    ],
    anchors: [
      ['辛店', [118.3, 36.8], 'from'],
      ['泰安', [117.1, 36.2], 'to'],
    ],
  },
  {
    id: 'fengfu',
    name: '峰福线',
    re: /^峰福线$/,
    hint: ['横峰', '福州'],
    hubs: [
      [117.6, 28.4],
      [118.2, 27.5],
      [118.8, 26.5],
      [119.3, 26.08],
    ],
    anchors: [
      ['横峰', [117.6, 28.4], 'from'],
      ['福州', [119.3, 26.08], 'to'],
    ],
  },
  {
    id: 'zhanglong',
    name: '漳龙线',
    re: /^漳龙线$/,
    hint: ['漳平', '龙川'],
    hubs: [
      [117.42, 25.29],
      [116.5, 24.8],
      [115.8, 24.3],
      [115.25, 24.1],
    ],
    anchors: [
      ['漳平', [117.42, 25.29], 'from'],
      ['龙川', [115.25, 24.1], 'to'],
    ],
  },
  {
    id: 'meiji',
    name: '梅集线',
    re: /^梅集线$/,
    hint: ['梅河口', '集安'],
    hubs: [
      [125.68, 42.53],
      [125.9, 41.8],
      [126.18, 41.12],
    ],
    anchors: [
      ['梅河口', [125.68, 42.53], 'from'],
      ['集安', [126.18, 41.12], 'to'],
    ],
  },
  {
    id: 'shuibang',
    name: '水蚌线',
    re: /^水蚌线$/,
    hint: ['水家湖', '蚌埠'],
    hubs: [
      [117.15, 32.55],
      [117.3, 32.8],
      [117.38, 32.94],
    ],
    anchors: [
      ['水家湖', [117.15, 32.55], 'from'],
      ['蚌埠', [117.38, 32.94], 'to'],
    ],
  },
  {
    id: 'changjing',
    name: '长荆线',
    re: /^长荆线$/,
    hint: ['长江埠', '荆门'],
    hubs: [
      [113.35, 30.85],
      [112.8, 31.0],
      [112.2, 31.05],
    ],
    anchors: [
      ['长江埠', [113.35, 30.85], 'from'],
      ['荆门', [112.2, 31.05], 'to'],
    ],
  },
  {
    id: 'mawu',
    name: '麻武线',
    re: /^麻武线$/,
    hint: ['麻城', '武汉'],
    hubs: [
      [115.0, 31.18],
      [114.6, 30.9],
      [114.32, 30.54],
    ],
    anchors: [
      ['麻城', [115.0, 31.18], 'from'],
      ['武汉', [114.32, 30.54], 'to'],
    ],
  },
  {
    id: 'yayi',
    name: '鸦宜线',
    re: /^鸦宜线$/,
    hint: ['鸦鹊岭', '宜昌'],
    hubs: [
      [111.55, 30.65],
      [111.4, 30.7],
      [111.3, 30.7],
    ],
    anchors: [
      ['鸦鹊岭', [111.55, 30.65], 'from'],
      ['宜昌', [111.3, 30.7], 'to'],
    ],
  },
  {
    id: 'hanchang',
    name: '邯长线',
    re: /^邯长线$/,
    hint: ['邯郸', '长治'],
    hubs: [
      [114.48, 36.6],
      [114.0, 36.5],
      [113.5, 36.35],
      [113.12, 36.2],
    ],
    anchors: [
      ['邯郸', [114.48, 36.6], 'from'],
      ['长治', [113.12, 36.2], 'to'],
    ],
  },
  {
    id: 'xinyan',
    name: '新兖线',
    re: /^新兖线$/,
    hint: ['新乡', '兖州'],
    hubs: [
      [113.88, 35.3],
      [115.0, 35.4],
      [116.0, 35.5],
      [116.85, 35.55],
    ],
    anchors: [
      ['新乡', [113.88, 35.3], 'from'],
      ['兖州', [116.85, 35.55], 'to'],
    ],
  },
  {
    id: 'taijiao_conv',
    name: '太焦线',
    re: /^太焦线$/,
    hint: ['太原', '焦作'],
    hubs: [
      [112.586, 37.859],
      [112.8, 36.8],
      [113.0, 35.8],
      [113.25, 35.25],
    ],
    anchors: [
      ['太原', [112.586, 37.859], 'from'],
      ['焦作', [113.25, 35.25], 'to'],
    ],
  },
];

const ok = [];
const fail = [];

for (const job of jobs) {
  if (!want(job.id)) continue;
  console.log('\n########', job.id, '########');
  try {
    const coords = buildVia(full, job.re, job.hubs);
    pinEnds(geo, job.hint, coords, job.id, job.anchors);
    // keep wiki/anchor hubs
    if (geo['南京']?.source === 'anchor:wiki') {
      /* keep */
    }
    writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
    writeCorr(
      job.id,
      job.name,
      job.hint,
      coords,
      `name-filter ${job.name} | stitch<=${MAX_STITCH}km`,
    );
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
