/**
 * 全图轨道拓扑构建（S3 核心）：graph JSON → 二进制 CSR（邻接表）。
 *
 * 产物：
 *   data/rails/china-rail-topo.bin       二进制 CSR（小端）
 *   data/rails/china-rail-topo.meta.json lineNames / ferryEdges / sourceVersions
 *
 * 二进制格式（design.md §CSR）：
 *   header 24B: magic 'RVTP'(4) + version Int32 + nodeCount Int32 + edgeCount Int32
 *               + generatedAtSec Int32(恒 0) + reserved Int32(0)
 *   nodeXY     Float64 × 2N
 *   edgeOffset Int32  × (N+1)
 *   edgeTo     Int32  × 2E
 *   edgeW      Float32 × 2E   （基准里程 km）
 *   edgeFlag   Uint8  × 2E   （bit0=高铁 bit1=轮渡）
 *   edgeLine   Uint16 × 2E   （meta.lineNames 下标）
 *
 * 幂等：节点按量化 key 字典序排列；时间戳只写 meta 不写 bin；重复构建 bin 字节数稳定。
 * 性能目标：<30s、bin <100MB。
 *
 * 用法：
 *   node scripts/build-rail-topology.mjs [--out data/rails]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const railPath = join(root, 'data/rails/china-rail.graph');
const hsrPath = join(root, 'data/rails/china-hsr.graph');
const geoPath = join(root, 'data/stations-geo.json');

const MAGIC = 'RVTP';
const VERSION = 1;
/**
 * 轮渡边：海安南（广东徐闻，湛海线南端）↔海口（海南环岛），固定 37km。
 * 坐标硬编码（stations-geo 的「海安」是江苏海安站，不可用）；
 * 端点吸附到轨网量化节点（≤2km 内最近节点），保证与主干连通。
 */
const FERRY_EDGES = [
  {
    a: '海安南',
    b: '海口',
    coordA: [110.186, 20.27],
    coordB: [110.17, 19.99],
    km: 37,
  },
];
const FERRY_SNAP_KM = 2;

function haversine(a, b) {
  const t = (d) => (d * Math.PI) / 180;
  const dLat = t(b[1] - a[1]);
  const dLng = t(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(t(a[1])) * Math.cos(t(b[1])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function quantKey(lng, lat) {
  return `${Math.round(lng * 1e4)},${Math.round(lat * 1e4)}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  return { outDir: outIdx >= 0 ? args[outIdx + 1] : join(root, 'data/rails') };
}

function main() {
  const t0 = Date.now();
  const { outDir } = parseArgs();

  const graphs = [];
  const sourceVersions = {};
  if (existsSync(railPath)) {
    const g = JSON.parse(readFileSync(railPath, 'utf8'));
    graphs.push({ g, hsr: false });
    sourceVersions.rail = g.generatedAt || '';
  }
  if (existsSync(hsrPath)) {
    const g = JSON.parse(readFileSync(hsrPath, 'utf8'));
    graphs.push({ g, hsr: true });
    sourceVersions.hsr = g.generatedAt || '';
  }
  if (!graphs.length) {
    console.error('no graph files found');
    process.exit(1);
  }

  // ── 1) 节点量化合并 ──
  const nodeMap = new Map(); // quantKey -> nodeIdx
  const nodeXY = []; // [lng, lat] flat push
  const nodes = []; // {lng, lat}
  function nodeOf(lng, lat) {
    const k = quantKey(lng, lat);
    let idx = nodeMap.get(k);
    if (idx == null) {
      idx = nodes.length;
      nodeMap.set(k, idx);
      nodes.push([lng, lat]);
    }
    return idx;
  }

  // ── 2) 边收集：way 相邻点 → 无向边；重复边保留最小里程并合并线路名 ──
  const lineNameToId = new Map();
  function lineId(name) {
    if (!name) return 0;
    let id = lineNameToId.get(name);
    if (id == null) {
      id = lineNameToId.size + 1; // 0 保留为未知线路
      lineNameToId.set(name, id);
    }
    return id;
  }

  const edgeMap = new Map(); // "min|max" -> { w, hsr, ferry, lineId, lineIds:Set }
  function addEdge(u, v, wKm, hsr, lineName) {
    if (u === v) return;
    const key = u < v ? `${u}|${v}` : `${v}|${u}`;
    const lid = lineId(lineName);
    const prev = edgeMap.get(key);
    if (prev) {
      if (wKm < prev.w) prev.w = wKm;
      if (hsr) prev.hsr = true;
      if (lid) prev.lineIds.add(lid);
      return;
    }
    edgeMap.set(key, { u, v, w: wKm, hsr, ferry: false, lineIds: new Set(lid ? [lid] : []) });
  }

  for (const { g, hsr } of graphs) {
    for (const w of g.ways || []) {
      const pts = w.points || [];
      if (pts.length < 2) continue;
      const name = w.name || '';
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const u = nodeOf(a[0], a[1]);
        const v = nodeOf(b[0], b[1]);
        const d = haversine(a, b);
        addEdge(u, v, d, hsr || !!w.highspeed, name);
      }
    }
  }

  // ── 3) 轮渡边（海安南↔海口，bit1=1；端点吸附轨网最近节点保证连通） ──
  const ferryLog = [];
  function nearestExistingNode(lng, lat) {
    // 线性扫描 nodes（构建期一次性，205 万点约 1-2s）
    let best = { d: Infinity, idx: -1 };
    for (let i = 0; i < nodes.length; i++) {
      const [nlng, nlat] = nodes[i];
      if (Math.abs(nlng - lng) > 0.05 || Math.abs(nlat - lat) > 0.05) continue;
      const d = haversine([lng, lat], [nlng, nlat]);
      if (d < best.d) {
        best = { d, idx: i };
      }
    }
    return best;
  }
  for (const f of FERRY_EDGES) {
    // 端点接入：≤0.5km 直接用轨网节点；>0.5km 建站节点 + 引入边接入主干
    // （必须保证轮渡端点节点与主干连通，否则跨海路径断裂）
    function attachEndpoint(coord) {
      const snap = nearestExistingNode(coord[0], coord[1]);
      if (snap.idx >= 0 && snap.d <= 0.5) {
        return { node: snap.idx, leadIn: snap.d };
      }
      const stationNode = nodeOf(coord[0], coord[1]);
      if (snap.idx >= 0) {
        const key =
          stationNode < snap.idx ? `${stationNode}|${snap.idx}` : `${snap.idx}|${stationNode}`;
        edgeMap.set(key, {
          u: Math.min(stationNode, snap.idx),
          v: Math.max(stationNode, snap.idx),
          w: snap.d,
          hsr: false,
          ferry: false,
          lineIds: new Set(),
        });
        return { node: stationNode, leadIn: snap.d };
      }
      return { node: stationNode, leadIn: -1 };
    }
    const endA = attachEndpoint(f.coordA);
    const endB = attachEndpoint(f.coordB);
    if (endA.node == null || endB.node == null || endA.leadIn < 0 || endB.leadIn < 0) {
      console.error(
        `FERRY FAIL-FAST: ${f.a} leadIn=${endA.leadIn} ${f.b} leadIn=${endB.leadIn} (no rail nodes nearby)`,
      );
      process.exit(1);
    }
    const u = endA.node;
    const v = endB.node;
    const key = u < v ? `${u}|${v}` : `${v}|${u}`;
    const prev = edgeMap.get(key);
    if (prev) {
      prev.ferry = true;
      prev.w = Math.max(prev.w, f.km);
    } else {
      edgeMap.set(key, { u, v, w: f.km, hsr: false, ferry: true, lineIds: new Set() });
    }
    ferryLog.push({
      a: f.a,
      b: f.b,
      km: f.km,
      nodes: [u, v],
      leadInKm: [Number(endA.leadIn.toFixed(2)), Number(endB.leadIn.toFixed(2))],
    });
    console.log(
      `ferry edge: ${f.a}(node ${u}, leadIn ${endA.leadIn.toFixed(1)}km) <-> ${f.b}(node ${v}, leadIn ${endB.leadIn.toFixed(1)}km) ${f.km}km`,
    );
  }

  // ── 4) CSR 组装：节点按量化 key 字典序排列 ──
  const sortedKeys = [...nodeMap.keys()].sort();
  const oldToNew = new Int32Array(nodes.length);
  sortedKeys.forEach((k, newIdx) => {
    oldToNew[nodeMap.get(k)] = newIdx;
  });
  const N = sortedKeys.length;
  const xy = new Float64Array(N * 2);
  sortedKeys.forEach((k, newIdx) => {
    const [lng, lat] = nodes[nodeMap.get(k)];
    xy[newIdx * 2] = lng;
    xy[newIdx * 2 + 1] = lat;
  });

  const edges = [...edgeMap.values()];
  const E = edges.length;
  // 出边列表（每条无向边两个方向）
  const outEdges = Array.from({ length: N }, () => []);
  for (const e of edges) {
    const u = oldToNew[e.u];
    const v = oldToNew[e.v];
    const w = e.w;
    const flag = (e.hsr ? 1 : 0) | (e.ferry ? 2 : 0);
    const line = e.lineIds.size ? Math.min(...e.lineIds) : 0;
    outEdges[u].push({ to: v, w, flag, line });
    outEdges[v].push({ to: u, w, flag, line });
  }

  const edgeOffset = new Int32Array(N + 1);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    edgeOffset[i] = acc;
    acc += outEdges[i].length;
  }
  edgeOffset[N] = acc;
  const twoE = acc;
  const edgeTo = new Int32Array(twoE);
  const edgeW = new Float32Array(twoE);
  const edgeFlag = new Uint8Array(twoE);
  const edgeLine = new Uint16Array(twoE);
  let p = 0;
  for (let i = 0; i < N; i++) {
    for (const e of outEdges[i]) {
      edgeTo[p] = e.to;
      edgeW[p] = e.w;
      edgeFlag[p] = e.flag;
      edgeLine[p] = e.line;
      p++;
    }
  }

  // ── 5) 连通分量标记：过滤量化碎片（孤立小分量节点不可作为 snap 目标） ──
  const compId = new Int32Array(N).fill(-1);
  const compSize = new Int32Array(N);
  const stack = new Int32Array(N);
  let compCount = 0;
  for (let start = 0; start < N; start++) {
    if (compId[start] !== -1) continue;
    let sp = 0;
    stack[sp++] = start;
    compId[start] = compCount;
    let size = 0;
    while (sp > 0) {
      const u = stack[--sp];
      size++;
      for (let p = edgeOffset[u]; p < edgeOffset[u + 1]; p++) {
        const v = edgeTo[p];
        if (compId[v] === -1) {
          compId[v] = compCount;
          stack[sp++] = v;
        }
      }
    }
    compSize[compCount] = size;
    compCount++;
  }
  const MIN_COMP_NODES = 32;
  const nodeFlag = new Uint8Array(N);
  let flagged = 0;
  for (let i = 0; i < N; i++) {
    if (compSize[compId[i]] >= MIN_COMP_NODES) {
      nodeFlag[i] = 1;
      flagged++;
    }
  }
  console.log(
    `components: ${compCount}, main-flagged nodes: ${flagged}/${N} (comp >= ${MIN_COMP_NODES})`,
  );

  // ── 6) 写 bin（nodeFlag 追加在尾部） ──
  const header = Buffer.alloc(24);
  header.write(MAGIC, 0, 'ascii');
  header.writeInt32LE(VERSION, 4);
  header.writeInt32LE(N, 8);
  header.writeInt32LE(E, 12);
  header.writeInt32LE(0, 16); // generatedAtSec 恒 0（幂等）
  header.writeInt32LE(1, 20); // reserved=1: 尾部含 nodeFlag Uint8Array(N)

  const bin = Buffer.concat([
    header,
    Buffer.from(xy.buffer),
    Buffer.from(edgeOffset.buffer),
    Buffer.from(edgeTo.buffer),
    Buffer.from(edgeW.buffer),
    Buffer.from(edgeFlag.buffer),
    Buffer.from(edgeLine.buffer),
    Buffer.from(nodeFlag.buffer),
  ]);

  const lineNames = [''];
  for (const [name, id] of [...lineNameToId.entries()].sort((a, b) => a[1] - b[1])) {
    lineNames[id] = name;
  }
  if (lineNames.length > 65535) {
    console.error(`too many line names: ${lineNames.length} > 65535`);
    process.exit(1);
  }

  writeFileSync(join(outDir, 'china-rail-topo.bin'), bin);
  writeFileSync(
    join(outDir, 'china-rail-topo.meta.json'),
    JSON.stringify(
      {
        version: VERSION,
        nodeCount: N,
        edgeCount: E,
        hasNodeFlags: true,
        minCompNodes: MIN_COMP_NODES,
        lineNames,
        ferryEdges: ferryLog,
        sourceVersions,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  const mb = bin.length / 1024 / 1024;
  console.log(`\ntopology built: nodes=${N} edges=${E} (${twoE} directed) lines=${lineNames.length}`);
  console.log(`bin: ${mb.toFixed(1)} MB -> ${join(outDir, 'china-rail-topo.bin')}`);
  console.log(`time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (mb >= 100) {
    console.error('bin >= 100MB, exceeds budget');
    process.exit(1);
  }
}

main();