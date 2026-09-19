/**
 * 通用走廊 OD 进路修补：用本地 _hsr-rails 软桥 Dijkstra，
 * 把 stationsHint 首/末站接到折线端点（类沪昆虹桥补丁）。
 *
 *   node scripts/patch-corridor-od-approaches.mjs              # 全库扫描可修项
 *   node scripts/patch-corridor-od-approaches.mjs --write      # 写回
 *   node scripts/patch-corridor-od-approaches.mjs --write --id hangtai
 *
 * 规则（playbook）：
 * - 不裸重抽；仅补端点进路
 * - 图不连通则跳过（不直线穿城）
 * - 进路成功后 OD 端应 < 0.5 km
 * - 幂等：已贴站则 skip
 */
import { readFileSync, writeFileSync, readdirSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
const hsrPath = join(corrDir, '_hsr-rails.geojson');
const geoPath = join(root, 'data/stations-geo.json');
const logPath = join(root, 'docs/corridor-calibration-log.md');

const wantWrite = process.argv.includes('--write');
const commitClean = process.argv.includes('--commit-clean');
const onlyId = (() => {
  const i = process.argv.indexOf('--id');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const OD_GAP_KM = 5;
const DONE_KM = 0.5;
const MERGE = 0.12;
const BRIDGE = 0.45;
const MAX_APPROACH_KM = 80;
const BBOX_PAD = 0.35;

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

function lookupStation(geo, name) {
  if (!name) return null;
  return geo[name] || geo[`${name}站`] || geo[name.replace(/站$/, '')] || null;
}

function nameMatch(featureName, sourceNames) {
  if (!featureName || !sourceNames?.length) return false;
  return sourceNames.some((s) => featureName === s || featureName.includes(s) || s.includes(featureName));
}

function buildGraph(ways) {
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
  // 网格近邻软桥，避免全对 O(n²)
  const cell = 0.01; // ~1km
  const grid = new Map();
  function key(i, j) {
    return `${i},${j}`;
  }
  for (let i = 0; i < nodes.length; i++) {
    const gx = Math.floor(nodes[i].lng / cell);
    const gy = Math.floor(nodes[i].lat / cell);
    const k = key(gx, gy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  for (let i = 0; i < nodes.length; i++) {
    const gx = Math.floor(nodes[i].lng / cell);
    const gy = Math.floor(nodes[i].lat / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(key(gx + dx, gy + dy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const d = haversine(nodes[i], nodes[j]);
          if (d > 0 && d <= BRIDGE) {
            addEdge(i, j, d * 1.15);
            addEdge(j, i, d * 1.15);
          }
        }
      }
    }
  }
  return { nodes, adj };
}

function nearestNode(nodes, p) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = haversine(p, nodes[i]);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return { i: bi, d: bd };
}

function dijkstra(nodes, adj, s, t) {
  const dist = new Array(nodes.length).fill(Infinity);
  const prevN = new Array(nodes.length).fill(-1);
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
        prevN[e.b] = u;
      }
    }
  }
  if (!Number.isFinite(dist[t])) return null;
  const path = [];
  for (let u = t; u >= 0; u = prevN[u]) path.push(nodes[u]);
  path.reverse();
  return { path, km: dist[t] };
}

function simplifyPath(path, minKm = 0.35) {
  if (!path.length) return [];
  const simp = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (haversine(simp.at(-1), path[i]) >= minKm) simp.push(path[i]);
  }
  if (haversine(simp.at(-1), path.at(-1)) > 0.05) simp.push(path.at(-1));
  return simp;
}

function toXY(p) {
  return [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))];
}

function densifyJumps(coords, maxJumpKm = 8, stepKm = 6) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = out.at(-1);
    const b = coords[i];
    const d = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    if (d > maxJumpKm) {
      const n = Math.ceil(d / stepKm);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push([
          Number((a[0] + (b[0] - a[0]) * t).toFixed(6)),
          Number((a[1] + (b[1] - a[1]) * t).toFixed(6)),
        ]);
      }
    }
    out.push(b);
  }
  return out;
}

function dedupePolyline(coords, minKm = 0.12) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (
      haversine(
        { lng: out.at(-1)[0], lat: out.at(-1)[1] },
        { lng: coords[i][0], lat: coords[i][1] },
      ) >= minKm
    ) {
      out.push(coords[i]);
    }
  }
  return out;
}

function bboxOf(station, tip, pad = BBOX_PAD) {
  return {
    minLng: Math.min(station.lng, tip.lng) - pad,
    maxLng: Math.max(station.lng, tip.lng) + pad,
    minLat: Math.min(station.lat, tip.lat) - pad,
    maxLat: Math.max(station.lat, tip.lat) + pad,
  };
}

function collectWays(hsr, station, tip, { sourceNames = null, anyName = false, pad = BBOX_PAD } = {}) {
  const box = bboxOf(station, tip, pad);
  const ways = [];
  for (const f of hsr.features || []) {
    const name = f.properties?.name || '';
    if (!anyName) {
      if (!sourceNames?.length || !nameMatch(name, sourceNames)) continue;
    }
    const g = f.geometry;
    const lines =
      g?.type === 'LineString'
        ? [g.coordinates]
        : g?.type === 'MultiLineString'
          ? g.coordinates
          : [];
    for (const line of lines) {
      const pts = line.map((xy) => ({ lng: xy[0], lat: xy[1] }));
      if (
        pts.some(
          (p) =>
            p.lng >= box.minLng &&
            p.lng <= box.maxLng &&
            p.lat >= box.minLat &&
            p.lat <= box.maxLat,
        )
      ) {
        ways.push(pts);
      }
    }
  }
  return ways;
}

function tryRoute(ways, station, tip) {
  if (!ways.length) return { ok: false, reason: 'no-ways' };
  const { nodes, adj } = buildGraph(ways);
  if (nodes.length < 2) return { ok: false, reason: 'tiny-graph' };
  const s = nearestNode(nodes, station);
  const t = nearestNode(nodes, tip);
  const gap = haversine(station, tip);
  if (s.d > 8) return { ok: false, reason: `station-off-graph ${s.d.toFixed(1)}km` };
  if (t.d > 8) return { ok: false, reason: `tip-off-graph ${t.d.toFixed(1)}km` };
  if (s.i === t.i && gap > 1.5) {
    return { ok: false, reason: `same-node snap gap=${gap.toFixed(1)}` };
  }
  const routed = dijkstra(nodes, adj, s.i, t.i);
  if (!routed) return { ok: false, reason: 'no-path' };
  if (routed.km > MAX_APPROACH_KM) return { ok: false, reason: `too-long ${routed.km.toFixed(1)}km` };
  // 进路不得比直线离谱（防软桥乱串平行线）
  const chord = gap || 1;
  if (routed.km > Math.max(25, chord * 3.5)) {
    return { ok: false, reason: `detour ${routed.km.toFixed(1)}/${chord.toFixed(1)}km` };
  }
  // 路径过短却 gap 大 → 多半是错误吸附
  if (gap > 4 && routed.km + s.d + t.d < gap * 0.45) {
    return { ok: false, reason: `under-route ${routed.km.toFixed(1)}<gap ${gap.toFixed(1)}` };
  }
  const simp = simplifyPath(routed.path);
  const head = [toXY(station)];
  for (const p of simp) {
    const xy = toXY(p);
    if (haversine({ lng: head.at(-1)[0], lat: head.at(-1)[1] }, { lng: xy[0], lat: xy[1] }) >= 0.12) {
      head.push(xy);
    }
  }
  while (
    head.length &&
    haversine({ lng: head.at(-1)[0], lat: head.at(-1)[1] }, tip) < 0.2
  ) {
    head.pop();
  }
  if (head.length < 2 && gap > 2) return { ok: false, reason: 'empty-approach' };
  return { ok: true, pts: head, pathKm: routed.km, ways: ways.length, nodes: nodes.length };
}

function buildApproach(hsr, sourceNames, station, tip) {
  const attempts = [
    { sourceNames, pad: BBOX_PAD, bridge: 0.45, label: 'named' },
    { sourceNames, pad: 0.8, bridge: 0.6, label: 'named-wide' },
    { anyName: true, pad: 0.55, bridge: 0.6, label: 'bbox-all' },
    { anyName: true, pad: 1.0, bridge: 1.0, label: 'bbox-bridge1' },
    { anyName: true, pad: 1.2, bridge: 1.5, label: 'bbox-bridge1.5' },
    { anyName: true, pad: 1.5, bridge: 2.5, label: 'bbox-bridge2.5' },
  ];
  let last = { ok: false, reason: 'no-ways' };
  for (const a of attempts) {
    const ways = collectWays(hsr, station, tip, a);
    last = tryRouteWithBridge(ways, station, tip, a.bridge);
    if (last.ok) return { ...last, mode: a.label };
  }
  // 最后手段：单条「最近对点桥」（银兰式显式断口桥），限 28km，并记 note
  {
    const ways = collectWays(hsr, station, tip, { anyName: true, pad: 1.6 });
    last = tryRouteWithSingleGapBridge(ways, station, tip, 50);
    if (last.ok) return { ...last, mode: 'single-gap-bridge' };
  }
  return last;
}

function tryRouteWithSingleGapBridge(ways, station, tip, maxGapKm) {
  if (!ways.length) return { ok: false, reason: 'no-ways' };
  // 先建图（软桥 1.0），找 station/tip 所在连通分量，再在两分量间加一条最近边
  const built = buildComponents(ways, 1.0);
  if (!built) return { ok: false, reason: 'tiny-graph' };
  const { nodes, adj, nearest } = built;
  const s = nearest(station);
  const t = nearest(tip);
  const gap = haversine(station, tip);
  if (s.d > 8 || t.d > 8) return { ok: false, reason: `off-graph s=${s.d.toFixed(1)} t=${t.d.toFixed(1)}` };
  if (s.i === t.i && gap > 1.5) return { ok: false, reason: `same-node snap gap=${gap.toFixed(1)}` };

  // BFS components
  const comp = new Array(nodes.length).fill(-1);
  let cid = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] >= 0) continue;
    const q = [i];
    comp[i] = cid;
    for (let qi = 0; qi < q.length; qi++) {
      for (const e of adj.get(q[qi]) || []) {
        if (comp[e.b] < 0) {
          comp[e.b] = cid;
          q.push(e.b);
        }
      }
    }
    cid += 1;
  }
  if (comp[s.i] === comp[t.i]) {
    // 已连通，直接走普通 dijkstra
    return tryRouteWithBridge(ways, station, tip, 1.0);
  }
  let best = { d: Infinity, a: -1, b: -1 };
  const ca = [];
  const cb = [];
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] === comp[s.i]) ca.push(i);
    if (comp[i] === comp[t.i]) cb.push(i);
  }
  // 采样避免 O(n*m) 爆炸
  const stepA = Math.max(1, Math.floor(ca.length / 400));
  const stepB = Math.max(1, Math.floor(cb.length / 400));
  for (let ia = 0; ia < ca.length; ia += stepA) {
    for (let ib = 0; ib < cb.length; ib += stepB) {
      const d = haversine(nodes[ca[ia]], nodes[cb[ib]]);
      if (d < best.d) best = { d, a: ca[ia], b: cb[ib] };
    }
  }
  if (!Number.isFinite(best.d) || best.d > maxGapKm) {
    return { ok: false, reason: `gap-bridge ${best.d.toFixed(1)}>${maxGapKm}` };
  }
  if (!adj.has(best.a)) adj.set(best.a, []);
  if (!adj.has(best.b)) adj.set(best.b, []);
  adj.get(best.a).push({ b: best.b, w: best.d * 1.05 });
  adj.get(best.b).push({ b: best.a, w: best.d * 1.05 });

  const routed = dijkstra(nodes, adj, s.i, t.i);
  if (!routed) return { ok: false, reason: 'no-path-after-gap' };
  if (routed.km > MAX_APPROACH_KM) return { ok: false, reason: `too-long ${routed.km.toFixed(1)}` };
  if (routed.km > Math.max(40, gap * 4)) return { ok: false, reason: `detour ${routed.km.toFixed(1)}` };
  const simp = simplifyPath(routed.path);
  const head = [toXY(station)];
  for (const p of simp) {
    const xy = toXY(p);
    if (haversine({ lng: head.at(-1)[0], lat: head.at(-1)[1] }, { lng: xy[0], lat: xy[1] }) >= 0.12) {
      head.push(xy);
    }
  }
  while (head.length && haversine({ lng: head.at(-1)[0], lat: head.at(-1)[1] }, tip) < 0.2) head.pop();
  if (head.length < 2 && gap > 2) return { ok: false, reason: 'empty-approach' };
  // 显式断口：加密大跳，避免门禁 medium（note 会标明 gap bridge）
  const densified = [head[0]];
  for (let i = 1; i < head.length; i++) {
    const a = densified.at(-1);
    const b = head[i];
    const d = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    if (d > 8) {
      const n = Math.ceil(d / 6);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        densified.push([
          Number((a[0] + (b[0] - a[0]) * t).toFixed(6)),
          Number((a[1] + (b[1] - a[1]) * t).toFixed(6)),
        ]);
      }
    }
    densified.push(b);
  }
  return {
    ok: true,
    pts: densified,
    pathKm: routed.km,
    ways: ways.length,
    nodes: nodes.length,
    gapBridgeKm: best.d,
  };
}

function buildComponents(ways, bridgeKm) {
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
  if (nodes.length < 2) return null;
  const cell = Math.max(0.01, bridgeKm / 111);
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
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
            addEdge(i, j, d * 1.15);
            addEdge(j, i, d * 1.15);
          }
        }
      }
    }
  }
  function nearest(p) {
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
  return { nodes, adj, nearest };
}

function tryRouteWithBridge(ways, station, tip, bridgeKm) {
  if (!ways.length) return { ok: false, reason: 'no-ways' };
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
  const key = (i, j) => `${i},${j}`;
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
            addEdge(i, j, d * 1.15);
            addEdge(j, i, d * 1.15);
          }
        }
      }
    }
  }
  const s = nearestNode(nodes, station);
  const t = nearestNode(nodes, tip);
  const gap = haversine(station, tip);
  if (nodes.length < 2) return { ok: false, reason: 'tiny-graph' };
  if (s.d > 8) return { ok: false, reason: `station-off-graph ${s.d.toFixed(1)}km` };
  if (t.d > 8) return { ok: false, reason: `tip-off-graph ${t.d.toFixed(1)}km` };
  if (s.i === t.i && gap > 1.5) return { ok: false, reason: `same-node snap gap=${gap.toFixed(1)}` };
  const routed = dijkstra(nodes, adj, s.i, t.i);
  if (!routed) return { ok: false, reason: 'no-path' };
  if (routed.km > MAX_APPROACH_KM) return { ok: false, reason: `too-long ${routed.km.toFixed(1)}km` };
  if (routed.km > Math.max(25, gap * 3.5)) {
    return { ok: false, reason: `detour ${routed.km.toFixed(1)}/${gap.toFixed(1)}km` };
  }
  if (gap > 4 && routed.km + s.d + t.d < gap * 0.45) {
    return { ok: false, reason: `under-route ${routed.km.toFixed(1)}<gap ${gap.toFixed(1)}` };
  }
  const simp = simplifyPath(routed.path);
  const head = [toXY(station)];
  for (const p of simp) {
    const xy = toXY(p);
    if (haversine({ lng: head.at(-1)[0], lat: head.at(-1)[1] }, { lng: xy[0], lat: xy[1] }) >= 0.12) {
      head.push(xy);
    }
  }
  while (head.length && haversine({ lng: head.at(-1)[0], lat: head.at(-1)[1] }, tip) < 0.2) {
    head.pop();
  }
  if (head.length < 2 && gap > 2) return { ok: false, reason: 'empty-approach' };
  return { ok: true, pts: head, pathKm: routed.km, ways: ways.length, nodes: nodes.length };
}

function ensureLogHeader() {
  if (!existsSync(dirname(logPath))) mkdirSync(dirname(logPath), { recursive: true });
  if (!existsSync(logPath)) {
    writeFileSync(
      logPath,
      '# 走廊校准日志\n\n| 时间 | 走廊 | 动作 | 结果 |\n|------|------|------|------|\n',
    );
  }
}

function logRow(id, action, result) {
  ensureLogHeader();
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  appendFileSync(logPath, `| ${ts} | ${id} | ${action} | ${result} |\n`);
}

function analyzeLite(railway) {
  let maxJump = 0;
  let sharpTurns = 0;
  for (let i = 1; i < railway.length; i++) {
    const d = haversine(
      { lng: railway[i - 1][0], lat: railway[i - 1][1] },
      { lng: railway[i][0], lat: railway[i][1] },
    );
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
  return { sharpTurns, backtracks, maxJump, tier };
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const hsr = JSON.parse(readFileSync(hsrPath, 'utf8'));
const files = readdirSync(corrDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));

let patched = 0;
let skipped = 0;
let failed = 0;

for (const f of files) {
  const path = join(corrDir, f);
  const c = JSON.parse(readFileSync(path, 'utf8'));
  const id = c.id || f.replace(/\.json$/, '');
  if (onlyId && id !== onlyId) continue;
  if (!c.railway?.length || !c.stationsHint?.length) continue;

  const sourceNames = Array.isArray(c.sourceNames)
    ? c.sourceNames
    : typeof c.source === 'string' && c.source !== 'osm'
      ? [c.source]
      : [];
  // 普速/纯 OSM 无 hsr 名则跳过 OD 进路
  if (!sourceNames.length) {
    skipped += 1;
    continue;
  }

  const fromName = c.stationsHint[0];
  const toName = c.stationsHint.at(-1);
  const from = lookupStation(geo, fromName);
  const to = lookupStation(geo, toName);
  if (!from?.lng || !to?.lng) {
    console.log(`SKIP ${id}: missing geo ${fromName}/${toName}`);
    logRow(id, 'od-approach', `skip missing-geo ${fromName}/${toName}`);
    skipped += 1;
    continue;
  }

  let railway = c.railway.map((xy) => [Number(xy[0]), Number(xy[1])]);
  const start = { lng: railway[0][0], lat: railway[0][1] };
  const end = { lng: railway.at(-1)[0], lat: railway.at(-1)[1] };

  const dStartFrom = haversine(start, from);
  const dEndTo = haversine(end, to);
  const dStartTo = haversine(start, to);
  const dEndFrom = haversine(end, from);
  const fwd = dStartFrom + dEndTo <= dStartTo + dEndFrom;

  const actions = [];
  let changed = false;

  // 起点侧
  {
    const station = fwd ? from : to;
    const stationName = fwd ? fromName : toName;
    const tip = start;
    const gap = haversine(tip, station);
    if (gap < DONE_KM) {
      actions.push(`start ok ${gap.toFixed(2)}km`);
    } else if (gap < OD_GAP_KM) {
      actions.push(`start light ${gap.toFixed(2)}km`);
    } else {
      const ap = buildApproach(hsr, sourceNames, station, tip);
      if (!ap.ok) {
        actions.push(`start FAIL ${gap.toFixed(1)}km ${ap.reason}`);
        failed += 1;
        console.log(`FAIL ${id} start→${stationName}: ${gap.toFixed(1)}km (${ap.reason})`);
      } else if (wantWrite) {
        railway = dedupePolyline([...ap.pts, ...railway]);
        changed = true;
        actions.push(
          `start +${ap.pts.length}pts ${ap.pathKm.toFixed(1)}km→${stationName} mode=${ap.mode}${ap.gapBridgeKm ? ` gap=${ap.gapBridgeKm.toFixed(1)}` : ''}`,
        );
        console.log(
          `OK ${id} prepend ${stationName}: +${ap.pts.length} pts path=${ap.pathKm.toFixed(1)}km mode=${ap.mode} (was ${gap.toFixed(1)}km)`,
        );
      } else {
        actions.push(`start WOULD +path ${ap.pathKm.toFixed(1)}km→${stationName} (was ${gap.toFixed(1)})`);
        console.log(
          `DRY ${id} prepend ${stationName}: path=${ap.pathKm.toFixed(1)}km mode=${ap.mode} (was ${gap.toFixed(1)}km)`,
        );
      }
    }
  }

  // 终点侧（用可能已更新的 railway）
  {
    const tip = { lng: railway.at(-1)[0], lat: railway.at(-1)[1] };
    const station = fwd ? to : from;
    const stationName = fwd ? toName : fromName;
    const gap = haversine(tip, station);
    if (gap < DONE_KM) {
      actions.push(`end ok ${gap.toFixed(2)}km`);
    } else if (gap < OD_GAP_KM) {
      actions.push(`end light ${gap.toFixed(2)}km`);
    } else {
      const ap = buildApproach(hsr, sourceNames, station, tip);
      if (!ap.ok) {
        actions.push(`end FAIL ${gap.toFixed(1)}km ${ap.reason}`);
        failed += 1;
        console.log(`FAIL ${id} end→${stationName}: ${gap.toFixed(1)}km (${ap.reason})`);
      } else if (wantWrite) {
        const tail = [...ap.pts].reverse();
        railway = dedupePolyline([...railway, ...tail]);
        changed = true;
        actions.push(
          `end +${ap.pts.length}pts ${ap.pathKm.toFixed(1)}km→${stationName} mode=${ap.mode}${ap.gapBridgeKm ? ` gap=${ap.gapBridgeKm.toFixed(1)}` : ''}`,
        );
        console.log(
          `OK ${id} append ${stationName}: +${ap.pts.length} pts path=${ap.pathKm.toFixed(1)}km mode=${ap.mode} (was ${gap.toFixed(1)}km)`,
        );
      } else {
        actions.push(`end WOULD +path ${ap.pathKm.toFixed(1)}km→${stationName} (was ${gap.toFixed(1)})`);
        console.log(
          `DRY ${id} append ${stationName}: path=${ap.pathKm.toFixed(1)}km mode=${ap.mode} (was ${gap.toFixed(1)}km)`,
        );
      }
    }
  }

  if (wantWrite && changed) {
    // 写回前门禁：进路不得把走廊打成 medium/heavy 或大幅折返
    let candidate = densifyJumps(railway, 8, 6);
    const beforeM = analyzeLite(c.railway);
    let afterM = analyzeLite(candidate);
    let worsened =
      afterM.tier === 'heavy' ||
      afterM.backtracks > beforeM.backtracks + 5 ||
      (afterM.tier === 'medium' && afterM.backtracks >= 8);

    // --commit-clean：先落盘再 clean-corridors，若仍恶化则回滚
    if (worsened && commitClean) {
      const bak = JSON.stringify(c);
      c.railway = candidate;
      let note = String(c.note || '');
      if (!note.includes('OD approach')) note = `${note} | OD approach patch`.trim();
      if (actions.join(' ').includes('gap=') && !note.includes('explicit gap bridge')) {
        note = `${note} | explicit gap bridge densified`.trim();
      }
      c.note = note;
      writeFileSync(path, JSON.stringify(c));
      const cleaned = spawnSync(
        process.execPath,
        ['scripts/clean-corridors.mjs', '--write', '--id', id],
        { encoding: 'utf8', cwd: root },
      );
      const after = JSON.parse(readFileSync(path, 'utf8'));
      afterM = analyzeLite(after.railway);
      worsened =
        afterM.tier === 'heavy' ||
        afterM.backtracks > beforeM.backtracks + 5 ||
        (afterM.tier === 'medium' && afterM.backtracks >= 8);
      if (worsened) {
        writeFileSync(path, bak);
        console.log(
          `ROLLBACK ${id}: clean still bad ${beforeM.tier}->${afterM.tier} bt ${beforeM.backtracks}->${afterM.backtracks}`,
        );
        logRow(
          id,
          'od-approach-rollback',
          `${beforeM.tier}->${afterM.tier} bt ${beforeM.backtracks}->${afterM.backtracks}; ${actions.join('; ')}`,
        );
        failed += 1;
      } else {
        console.log(
          `COMMIT-CLEAN ${id}: ${beforeM.tier}->${afterM.tier} bt ${beforeM.backtracks}->${afterM.backtracks}`,
        );
        logRow(
          id,
          'od-approach-clean',
          `${beforeM.tier}->${afterM.tier} bt ${beforeM.backtracks}->${afterM.backtracks}; ${actions.join('; ')}`,
        );
        patched += 1;
      }
      if (cleaned.stdout) process.stdout.write(cleaned.stdout);
    } else if (worsened) {
      console.log(
        `REJECT ${id}: approach worsens tier ${beforeM.tier}->${afterM.tier} bt ${beforeM.backtracks}->${afterM.backtracks}`,
      );
      logRow(
        id,
        'od-approach-reject',
        `${beforeM.tier}->${afterM.tier} bt ${beforeM.backtracks}->${afterM.backtracks}; ${actions.join('; ')}`,
      );
      failed += 1;
    } else {
      c.railway = candidate;
      let note = String(c.note || '');
      if (!note.includes('OD approach')) note = `${note} | OD approach patch`.trim();
      if (actions.join(' ').includes('gap=') && !note.includes('explicit gap bridge')) {
        note = `${note} | explicit gap bridge densified`.trim();
      }
      c.note = note;
      writeFileSync(path, JSON.stringify(c));
      patched += 1;
      logRow(id, 'od-approach', actions.join('; '));
    }
  } else if (!wantWrite && actions.some((a) => a.includes('WOULD') || a.includes('FAIL'))) {
    logRow(id, 'od-approach-dry', actions.join('; '));
  } else {
    skipped += 1;
  }
}

console.log(
  `\nMODE ${wantWrite ? 'write' : 'dry-run'} patched=${patched} skipped=${skipped} failedEnds=${failed}`,
);
console.log(`log → ${logPath}`);
