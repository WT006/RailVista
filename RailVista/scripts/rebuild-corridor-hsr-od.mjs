/**
 * 用本地 _hsr-rails 按 OD 站 Dijkstra 重建走廊干线（非 member-order）。
 * 写回前与现网对比：里程过差 / medium·heavy → 拒绝并保留原文件。
 *
 *   node scripts/rebuild-corridor-hsr-od.mjs --id hangtai
 *   node scripts/rebuild-corridor-hsr-od.mjs --id hangtai --write
 *   node scripts/rebuild-corridor-hsr-od.mjs --write   # 对默认待修名单
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
const hsrPath = join(corrDir, '_hsr-rails.geojson');
const geoPath = join(root, 'data/stations-geo.json');
const logPath = join(root, 'docs/corridor-calibration-log.md');
const bakDir = join(root, 'tmp/corridor-od-rebuild-backup');

const wantWrite = process.argv.includes('--write');
const onlyId = (() => {
  const i = process.argv.indexOf('--id');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const DEFAULT_IDS = [
  'hangtai',
  'guiguang',
  'guinan',
  'daxi',
  'hefu',
  'zhengfu',
  'zhengtai',
  'zhengyu',
  'nankun',
  'yinlan',
  'yinxi',
  'xiashen',
  'chihuang',
  'hangchang',
];

const MERGE = 0.12;
const BRIDGE = 0.55;
const SIMPLIFY = 0.35;

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

function lookup(geo, name) {
  return geo[name] || geo[`${name}站`] || geo[name.replace(/站$/, '')] || null;
}

function nameMatch(featureName, sourceNames) {
  if (!featureName || !sourceNames?.length) return false;
  return sourceNames.some((s) => featureName === s || featureName.includes(s) || s.includes(featureName));
}

function metrics(railway) {
  let lengthKm = 0;
  let maxJump = 0;
  let sharpTurns = 0;
  for (let i = 1; i < railway.length; i++) {
    const d = haversine(
      { lng: railway[i - 1][0], lat: railway[i - 1][1] },
      { lng: railway[i][0], lat: railway[i][1] },
    );
    lengthKm += d;
    if (d > maxJump) maxJump = d;
  }
  for (let i = 1; i < railway.length - 1; i++) {
    const a = railway[i - 1];
    const b = railway[i];
    const c = railway[i + 1];
    const ab = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    const bc = haversine({ lng: b[0], lat: b[1] }, { lng: c[0], lat: c[1] });
    if (ab < 0.25 || bc < 0.25) continue;
    let deg =
      Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) *
      (180 / Math.PI);
    if (deg > 180) deg = 360 - deg;
    if (deg >= 150) sharpTurns += 1;
  }
  const end = { lng: railway.at(-1)[0], lat: railway.at(-1)[1] };
  const chord = haversine({ lng: railway[0][0], lat: railway[0][1] }, end) || 1;
  let maxProg = 0;
  let backtracks = 0;
  for (const p of railway) {
    const prog = 1 - haversine({ lng: p[0], lat: p[1] }, end) / chord;
    if (prog < maxProg - 0.01) backtracks += 1;
    maxProg = Math.max(maxProg, prog);
  }
  let tier = 'ok';
  if (sharpTurns >= 30 || backtracks >= 40 || maxJump > 40) tier = 'heavy';
  else if (sharpTurns >= 8 || backtracks >= 10 || maxJump > 15) tier = 'medium';
  else if (sharpTurns >= 1 || backtracks >= 3 || maxJump > 10) tier = 'light';
  return { lengthKm, maxJump, sharpTurns, backtracks, tier, pts: railway.length };
}

function buildGraph(ways, bridgeKm) {
  const nodes = [];
  const adj = new Map();
  function addNode(p) {
    for (let i = 0; i < nodes.length; i++) {
      if (haversine(nodes[i], p) < MERGE) return i;
    }
    nodes.push({ ...p });
    return nodes.length - 1;
  }
  function addEdge(a, b, w) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ b, w });
  }
  for (const pts of ways) {
    let prev = -1;
    for (const p of pts) {
      const i = addNode(p);
      if (prev >= 0 && prev !== i) {
        const w = haversine(nodes[prev], nodes[i]);
        addEdge(prev, i, w);
        addEdge(i, prev, w);
      }
      prev = i;
    }
  }
  const cell = Math.max(0.01, bridgeKm / 111);
  const grid = new Map();
  const key = (x, y) => `${x},${y}`;
  for (let i = 0; i < nodes.length; i++) {
    const gx = Math.floor(nodes[i].lng / cell);
    const gy = Math.floor(nodes[i].lat / cell);
    const k = key(gx, gy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const reach = Math.max(1, Math.ceil(bridgeKm / (cell * 111)) + 1);
  for (let i = 0; i < nodes.length; i++) {
    const gx = Math.floor(nodes[i].lng / cell);
    const gy = Math.floor(nodes[i].lat / cell);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const bucket = grid.get(key(gx + dx, gy + dy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const d = haversine(nodes[i], nodes[j]);
          if (d > 0 && d <= bridgeKm) {
            addEdge(i, j, d * 1.12);
            addEdge(j, i, d * 1.12);
          }
        }
      }
    }
  }
  return { nodes, adj };
}

function nearest(nodes, p) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = haversine(nodes[i], p);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return { i: bi, d: bd };
}

function dijkstra(nodes, adj, s, t) {
  const dist = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(-1);
  dist[s] = 0;
  const used = new Array(nodes.length).fill(false);
  for (let k = 0; k < nodes.length; k++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (!used[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u < 0 || best === Infinity) break;
    used[u] = true;
    if (u === t) break;
    for (const e of adj.get(u) || []) {
      if (dist[u] + e.w < dist[e.b]) {
        dist[e.b] = dist[u] + e.w;
        prev[e.b] = u;
      }
    }
  }
  if (!Number.isFinite(dist[t])) return null;
  const path = [];
  for (let u = t; u >= 0; u = prev[u]) path.push(nodes[u]);
  path.reverse();
  return { path, km: dist[t] };
}

function toPoly(path, from, to) {
  const pts = [[Number(from.lng.toFixed(6)), Number(from.lat.toFixed(6))]];
  for (const p of path) {
    const xy = [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))];
    if (haversine({ lng: pts.at(-1)[0], lat: pts.at(-1)[1] }, { lng: xy[0], lat: xy[1] }) >= SIMPLIFY) {
      pts.push(xy);
    }
  }
  const end = [Number(to.lng.toFixed(6)), Number(to.lat.toFixed(6))];
  if (haversine({ lng: pts.at(-1)[0], lat: pts.at(-1)[1] }, { lng: end[0], lat: end[1] }) >= 0.15) {
    pts.push(end);
  } else {
    pts[pts.length - 1] = end;
  }
  return pts;
}

function ensureLog() {
  if (!existsSync(dirname(logPath))) mkdirSync(dirname(logPath), { recursive: true });
  if (!existsSync(logPath)) {
    writeFileSync(
      logPath,
      '# 走廊校准日志\n\n| 时间 | 走廊 | 动作 | 结果 |\n|------|------|------|------|\n',
    );
  }
}
function logRow(id, action, result) {
  ensureLog();
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  appendFileSync(logPath, `| ${ts} | ${id} | ${action} | ${result} |\n`);
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const hsr = JSON.parse(readFileSync(hsrPath, 'utf8'));
const ids = onlyId ? [onlyId] : DEFAULT_IDS;

if (wantWrite && !existsSync(bakDir)) mkdirSync(bakDir, { recursive: true });

let ok = 0;
let rejected = 0;
let failed = 0;

for (const id of ids) {
  const path = join(corrDir, `${id}.json`);
  if (!existsSync(path)) {
    console.log(`SKIP ${id}: no file`);
    continue;
  }
  const c = JSON.parse(readFileSync(path, 'utf8'));
  const sourceNames = Array.isArray(c.sourceNames) ? c.sourceNames : [];
  const fromName = c.stationsHint?.[0];
  const toName = c.stationsHint?.at(-1);
  const from = lookup(geo, fromName);
  const to = lookup(geo, toName);
  if (!from || !to || !sourceNames.length) {
    console.log(`SKIP ${id}: missing OD/geo/names`);
    failed += 1;
    continue;
  }

  // 本线 ways + OD 枢纽附近 + 贴近现有走廊的 ways + **现有走廊脊线**（保证连通）
  const ways = [];
  const hubPadKm = 45;
  const alongPadKm = 12;
  function nearHub(p) {
    return haversine(p, from) <= hubPadKm || haversine(p, to) <= hubPadKm;
  }
  function nearExisting(p) {
    const step = Math.max(1, Math.floor(c.railway.length / 80));
    for (let i = 0; i < c.railway.length; i += step) {
      if (haversine(p, { lng: c.railway[i][0], lat: c.railway[i][1] }) <= alongPadKm) return true;
    }
    return false;
  }
  for (const f of hsr.features || []) {
    const name = f.properties?.name || '';
    const named = nameMatch(name, sourceNames);
    const g = f.geometry;
    const lines =
      g?.type === 'LineString'
        ? [g.coordinates]
        : g?.type === 'MultiLineString'
          ? g.coordinates
          : [];
    for (const line of lines) {
      const pts = line.map((xy) => ({ lng: xy[0], lat: xy[1] }));
      if (named || pts.some((p) => nearHub(p) || nearExisting(p))) ways.push(pts);
    }
  }
  // 脊线：现有走廊折线（保证 OD 能沿旧线连通，只补两端）
  ways.push(c.railway.map((xy) => ({ lng: xy[0], lat: xy[1] })));
  // 不把 OD 直线飞连到脊线（playbook 禁止穿城飞线）；靠 hsr 软桥接脊线
  if (!ways.length) {
    console.log(`FAIL ${id}: no ways for ${sourceNames.join('|')}`);
    logRow(id, 'hsr-od-rebuild', `fail no-ways ${sourceNames.join('|')}`);
    failed += 1;
    continue;
  }

  let best = null;
  for (const bridge of [0.45, 0.7, 1.0, 1.5]) {
    const { nodes, adj } = buildGraph(ways, bridge);
    const s = nearest(nodes, from);
    const t = nearest(nodes, to);
    if (s.d > 12 || t.d > 12) continue;
    const routed = dijkstra(nodes, adj, s.i, t.i);
    if (!routed) continue;
    const poly = toPoly(routed.path, from, to);
    const m = metrics(poly);
    if (m.tier === 'heavy' || m.tier === 'medium') continue;
    if (!best || m.lengthKm < best.m.lengthKm * 0.98 || (m.tier === 'ok' && best.m.tier !== 'ok')) {
      best = { poly, m, bridge, snap: { s: s.d, t: t.d }, pathKm: routed.km };
    }
  }

  if (!best) {
    console.log(`FAIL ${id}: no acceptable OD path`);
    logRow(id, 'hsr-od-rebuild', 'fail no-acceptable-path');
    failed += 1;
    continue;
  }

  const before = metrics(c.railway);
  const startD = haversine(from, { lng: best.poly[0][0], lat: best.poly[0][1] });
  const endD = haversine(to, { lng: best.poly.at(-1)[0], lat: best.poly.at(-1)[1] });
  const lenRatio = best.m.lengthKm / (before.lengthKm || 1);
  const lenBad = lenRatio < 0.7 || lenRatio > 1.35;

  const msg = `tier ${before.tier}->${best.m.tier} len ${before.lengthKm.toFixed(0)}->${best.m.lengthKm.toFixed(0)} (×${lenRatio.toFixed(2)}) od ${startD.toFixed(2)}/${endD.toFixed(2)}km bridge=${best.bridge}`;
  if (lenBad || best.m.tier === 'medium' || best.m.tier === 'heavy') {
    console.log(`REJECT ${id}: ${msg}`);
    logRow(id, 'hsr-od-rebuild-reject', msg);
    rejected += 1;
    continue;
  }

  // 仅当 OD 明显改善或尖刺改善才写
  const oldStart = haversine(from, { lng: c.railway[0][0], lat: c.railway[0][1] });
  const oldEnd = haversine(to, { lng: c.railway.at(-1)[0], lat: c.railway.at(-1)[1] });
  const odImproved = startD + endD < Math.min(oldStart, oldEnd) + Math.max(oldStart, oldEnd) - 3;
  // simpler: new OD sum much better
  const odSumNew = startD + endD;
  const odSumOld = Math.min(
    oldStart + oldEnd,
    haversine(from, { lng: c.railway.at(-1)[0], lat: c.railway.at(-1)[1] }) +
      haversine(to, { lng: c.railway[0][0], lat: c.railway[0][1] }),
  );
  if (odSumNew > 2 && odSumNew > odSumOld - 2) {
    console.log(`SKIP ${id}: OD not improved ${odSumOld.toFixed(1)}->${odSumNew.toFixed(1)} | ${msg}`);
    logRow(id, 'hsr-od-rebuild-skip', `od ${odSumOld.toFixed(1)}->${odSumNew.toFixed(1)}; ${msg}`);
    rejected += 1;
    continue;
  }

  console.log(`${wantWrite ? 'WRITE' : 'DRY'} ${id}: ${msg} odSum ${odSumOld.toFixed(1)}->${odSumNew.toFixed(1)}`);
  if (wantWrite) {
    copyFileSync(path, join(bakDir, `${id}.json`));
    c.railway = best.poly;
    const note = String(c.note || '');
    if (!note.includes('hsr OD rebuild')) {
      c.note = `${note} | hsr OD rebuild`.trim();
    }
    writeFileSync(path, JSON.stringify(c));
    logRow(id, 'hsr-od-rebuild', msg);
    ok += 1;
  }
}

console.log(`\nMODE ${wantWrite ? 'write' : 'dry-run'} ok=${ok} rejected=${rejected} failed=${failed}`);
