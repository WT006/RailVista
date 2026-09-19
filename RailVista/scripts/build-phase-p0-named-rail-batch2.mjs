/**
 * P0 普速续批：同蒲/宁西/襄渝/鹰厦/渝怀
 *   node --max-old-space-size=8192 scripts/build-phase-p0-named-rail-batch2.mjs
 *   node --max-old-space-size=8192 scripts/build-phase-p0-named-rail-batch2.mjs --only tongpu,ningxi
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

function ensureStations(entries) {
  const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
  let n = 0;
  for (const [name, ll] of Object.entries(entries)) {
    if (!geo[name]?.lng) {
      geo[name] = { lng: ll[0], lat: ll[1], source: 'manual:wiki-approx' };
      n += 1;
    }
  }
  writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
  if (n) console.log('seeded', n);
  return geo;
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
  console.log('written', id, 'pts', coords.length);
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

const geo = ensureStations({
  大同: [113.2963381, 40.1190975],
  太原: [112.586, 37.859],
  朔州: [112.756554, 38.969347],
  临汾: [111.51, 36.08],
  运城: [111.0, 35.03],
  风陵渡: [110.35, 34.83],
  南京: [118.792, 32.087],
  合肥: [117.285, 31.885],
  六安: [116.51, 31.74],
  信阳: [114.07, 32.14],
  南阳: [112.54, 33.0],
  西安: [108.9578972, 34.2799595],
  襄阳: [112.15, 32.05],
  安康: [109.02, 32.69],
  达州: [107.5, 31.22],
  重庆北: [106.461517, 29.555794],
  鹰潭: [117.0228762, 28.2385765],
  邵武: [117.48, 27.34],
  三明: [117.62, 26.26],
  漳平: [117.42, 25.29],
  厦门: [117.769233, 24.482563],
  涪陵: [107.38, 29.7],
  黔江: [108.78, 29.53],
  铜仁: [109.18, 27.72],
  怀化: [109.96333, 27.56083],
});

console.log('loading graph…');
const full = JSON.parse(readFileSync(graphPath, 'utf8'));
const ok = [];
const fail = [];

function want(id) {
  return !onlyArg || onlyArg.has(id);
}

// —— 同蒲：北同蒲 大同→太原 + 南同蒲 太原→风陵渡 ——
if (want('tongpu')) {
  console.log('\n######## tongpu ########');
  try {
    const north = filterWays(full, /北同蒲/);
    const south = filterWays(full, /南同蒲/);
    console.log('north ways', north.ways.length, 'south', south.ways.length);
    const a = buildOd(north, { lng: 113.2963381, lat: 40.1190975 }, { lng: 112.586, lat: 37.859 }, 0.15);
    const b = buildOd(south, { lng: 112.586, lat: 37.859 }, { lng: 110.35, lat: 34.83 }, 0.15);
    const coords = stitch([a.coords, b.coords]);
    // snap OD hints to ends
    geo['大同'] = { lng: coords[0][0], lat: coords[0][1], source: 'corridor:tongpu' };
    geo['风陵渡'] = {
      lng: coords.at(-1)[0],
      lat: coords.at(-1)[1],
      source: 'corridor:tongpu',
    };
    writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
    writeCorr('tongpu', '同蒲线', ['大同', '风陵渡'], coords, '北同蒲+南同蒲 stitch');
    if (pipeline('tongpu')) ok.push('tongpu');
    else fail.push('tongpu');
  } catch (e) {
    console.error('tongpu', e.message || e);
    fail.push('tongpu');
  }
}

// —— 宁西：名过滤；必要时枢纽分段 ——
if (want('ningxi')) {
  console.log('\n######## ningxi ########');
  try {
    const g = filterWays(full, /^宁西线$/);
    console.log('ways', g.ways.length);
    let coords;
    try {
      const r = buildOd(
        g,
        { lng: 118.792, lat: 32.087 },
        { lng: 108.9578972, lat: 34.2799595 },
        0.15,
      );
      coords = r.coords;
    } catch {
      console.log('full OD miss → via hubs');
      const hubs = [
        [118.792, 32.087],
        [117.285, 31.885],
        [116.51, 31.74],
        [114.07, 32.14],
        [112.54, 33.0],
        [108.9578972, 34.2799595],
      ];
      const parts = [];
      for (let i = 0; i < hubs.length - 1; i++) {
        const r = buildOd(
          g,
          { lng: hubs[i][0], lat: hubs[i][1] },
          { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
          0.18,
        );
        parts.push(r.coords);
      }
      coords = stitch(parts);
    }
    geo['南京'] = { lng: coords[0][0], lat: coords[0][1], source: 'corridor:ningxi' };
    geo['西安'] = {
      lng: coords.at(-1)[0],
      lat: coords.at(-1)[1],
      source: 'corridor:ningxi',
    };
    writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
    writeCorr('ningxi', '宁西线', ['南京', '西安'], coords, 'name-filter 宁西线');
    if (pipeline('ningxi')) ok.push('ningxi');
    else fail.push('ningxi');
  } catch (e) {
    console.error('ningxi', e.message || e);
    fail.push('ningxi');
  }
}

const CQ_BEI = [106.461517, 29.555794];

// —— 襄渝 ——
// 重庆北用 yuwan/yuli 锚点；襄渝命名 ways 止于北碚一带，末段用全图桥接（真轨，非飞线）
if (want('xiangyu')) {
  console.log('\n######## xiangyu ########');
  try {
    const g = filterWays(full, /^襄渝线$/);
    console.log('ways', g.ways.length);
    const hubs = [
      [112.15, 32.05], // 襄阳
      [110.78, 32.65],
      [109.02, 32.69], // 安康
      [108.0, 32.05],
      [107.5, 31.22], // 达州
      [106.9, 30.4],
      [106.393543, 29.724354], // 北碚咽喉（命名 ways 可达端）
    ];
    const parts = [];
    for (let i = 0; i < hubs.length - 1; i++) {
      const r = buildOd(
        g,
        { lng: hubs[i][0], lat: hubs[i][1] },
        { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
        0.22,
      );
      parts.push(r.coords);
    }
    // 末段：全图真实接轨至重庆北（~20km，禁止直线飞线）
    const tail = buildOd(
      full,
      { lng: hubs.at(-1)[0], lat: hubs.at(-1)[1] },
      { lng: CQ_BEI[0], lat: CQ_BEI[1] },
      0.15,
    );
    parts.push(tail.coords);
    const coords = stitch(parts);
    geo['襄阳'] = { lng: coords[0][0], lat: coords[0][1], source: 'corridor:xiangyu' };
    geo['重庆北'] = { lng: CQ_BEI[0], lat: CQ_BEI[1], source: 'anchor:yuwan' };
    writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
    writeCorr(
      'xiangyu',
      '襄渝线',
      ['襄阳', '重庆北'],
      coords,
      'name-filter 襄渝线 | full-graph last-leg bridge 北碚→重庆北 (~20km)',
    );
    if (pipeline('xiangyu')) ok.push('xiangyu');
    else fail.push('xiangyu');
  } catch (e) {
    console.error('xiangyu', e.message || e);
    fail.push('xiangyu');
  }
}

// —— 鹰厦 ——
if (want('yingxia')) {
  console.log('\n######## yingxia ########');
  try {
    const g = filterWays(full, /^鹰厦线$/);
    console.log('ways', g.ways.length);
    let coords;
    try {
      const r = buildOd(
        g,
        { lng: 117.0228762, lat: 28.2385765 },
        { lng: 117.769233, lat: 24.482563 },
        0.15,
      );
      coords = r.coords;
    } catch {
      const hubs = [
        [117.0228762, 28.2385765],
        [117.48, 27.34],
        [117.62, 26.26],
        [117.42, 25.29],
        [117.769233, 24.482563],
      ];
      const parts = [];
      for (let i = 0; i < hubs.length - 1; i++) {
        let r;
        try {
          r = buildOd(
            g,
            { lng: hubs[i][0], lat: hubs[i][1] },
            { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
            0.2,
          );
        } catch {
          // east gap: allow unnamed near last legs
          const pool = {
            ...full,
            ways: (full.ways || []).filter((w) => {
              const n = w.name || '';
              return /^鹰厦线$/.test(n) || n === '' || /鹰厦联络/.test(n);
            }),
          };
          r = buildOd(
            pool,
            { lng: hubs[i][0], lat: hubs[i][1] },
            { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
            0.25,
          );
        }
        parts.push(r.coords);
      }
      coords = stitch(parts);
    }
    geo['鹰潭'] = { lng: coords[0][0], lat: coords[0][1], source: 'corridor:yingxia' };
    geo['厦门'] = {
      lng: coords.at(-1)[0],
      lat: coords.at(-1)[1],
      source: 'corridor:yingxia',
    };
    writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
    writeCorr('yingxia', '鹰厦线', ['鹰潭', '厦门'], coords, 'name-filter 鹰厦线');
    if (pipeline('yingxia')) ok.push('yingxia');
    else fail.push('yingxia');
  } catch (e) {
    console.error('yingxia', e.message || e);
    fail.push('yingxia');
  }
}

// —— 渝怀 ——
if (want('yuhuai')) {
  console.log('\n######## yuhuai ########');
  try {
    const g = filterWays(full, /^渝怀线$/);
    console.log('ways', g.ways.length);
    const hubs = [
      CQ_BEI,
      [106.9, 29.7],
      [107.38, 29.7],
      [107.9, 29.5],
      [108.4, 29.4],
      [108.78, 29.53],
      [108.95, 28.9],
      [109.1, 28.3],
      [109.18, 27.72],
      [109.55, 27.6],
      [109.96333, 27.56083],
    ];
    const parts = [];
    for (let i = 0; i < hubs.length - 1; i++) {
      let r;
      try {
        r = buildOd(
          g,
          { lng: hubs[i][0], lat: hubs[i][1] },
          { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
          0.2,
        );
      } catch {
        // 首段贴重庆北 / 缺口段：全图或无名/联络线
        const pool =
          i === 0
            ? full
            : {
                ...full,
                ways: (full.ways || []).filter((w) => {
                  const n = w.name || '';
                  return /^渝怀线$/.test(n) || n === '' || /渝怀联络/.test(n);
                }),
              };
        r = buildOd(
          pool,
          { lng: hubs[i][0], lat: hubs[i][1] },
          { lng: hubs[i + 1][0], lat: hubs[i + 1][1] },
          0.25,
        );
      }
      parts.push(r.coords);
    }
    const coords = stitch(parts);
    geo['重庆北'] = { lng: CQ_BEI[0], lat: CQ_BEI[1], source: 'anchor:yuwan' };
    geo['怀化'] = {
      lng: coords.at(-1)[0],
      lat: coords.at(-1)[1],
      source: 'corridor:yuhuai',
    };
    writeFileSync(geoPath, `${JSON.stringify(geo)}\n`);
    writeCorr(
      'yuhuai',
      '渝怀铁路',
      ['重庆北', '怀化'],
      coords,
      'name-filter 渝怀线 | OD 重庆北=yuwan anchor',
    );
    if (pipeline('yuhuai')) ok.push('yuhuai');
    else fail.push('yuhuai');
  } catch (e) {
    console.error('yuhuai', e.message || e);
    fail.push('yuhuai');
  }
}

console.log('\nOK', ok.join(', ') || '(none)');
console.log('FAIL', fail.join(', ') || '(none)');
process.exit(fail.length ? 1 : 0);
