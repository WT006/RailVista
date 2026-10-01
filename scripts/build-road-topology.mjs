/**
 * 万里路书 · 全国公路旅游网 —— L2 干线拓扑构建（PRD §3.3 Step 4）。
 *
 * 读取全部 L1 几何（data/roads/geom/*.json）：
 *   - 端点/交叉点去重（1e-5 度量化）→ node id
 *   - 相邻节点成边，权重 = 距离 × 等级系数（高速 1.0 / 国道 1.15 / 省道 1.35）
 *   - 不同公路节点距离 ≤1km 时加跨线边（换乘/共线），权重 = 距离 × 1.5
 *   - 写入 RVRT 二进制（格式沿用铁路 RVTP，magic 换 RVRT）+ meta.json
 *
 * 规模纪律（PRD §3.3）：只建国道+高速+省道干线的可通行图，城市内部道路不入库。
 * 用法：node scripts/build-road-topology.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineKm } from './lib/overpass.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEOM_DIR = join(__dirname, '../data/roads/geom');
const INDEX_DIR = join(__dirname, '../data/roads/index');
const OUT_BIN = join(__dirname, '../data/roads/china-road-topo.bin');
const OUT_META = join(__dirname, '../data/roads/china-road-topo.meta.json');

const CLASS_COEF = { expressway: 1.0, national: 1.15, provincial: 1.35 };
const QUANT = 1e-5; // 节点去重量化（度）
const CROSS_LINK_KM = 1.0; // 跨线边阈值（km）
const CROSS_PENALTY = 1.5;

// ── L0 索引：key → class ─────────────────────────────────────────────────────
const classByKey = new Map();
for (const f of ['national.json', 'expressway.json', 'provincial.json']) {
  const p = join(INDEX_DIR, f);
  if (!existsSync(p)) continue;
  const idx = JSON.parse(readFileSync(p, 'utf8'));
  for (const r of idx.roads) classByKey.set(r.key, r.class);
}

// ── 读几何 → 节点/边 ─────────────────────────────────────────────────────────
const nodeMap = new Map(); // "qx,qy" → node id
const nodeXY = []; // [lng, lat][]
const roadKeys = []; // edgeLine id → key
const roadIdByKey = new Map();

function nodeIdOf(lng, lat) {
  const qx = Math.round(lng / QUANT);
  const qy = Math.round(lat / QUANT);
  const k = `${qx},${qy}`;
  let id = nodeMap.get(k);
  if (id == null) {
    id = nodeXY.length;
    nodeXY.push([lng, lat]);
    nodeMap.set(k, id);
  }
  return id;
}

const edges = []; // {u, v, wKm, flag, line}

function addEdge(u, v, km, flag, line) {
  if (u === v || km <= 0) return;
  edges.push({ u, v, wKm: km, flag, line });
}

const files = existsSync(GEOM_DIR) ? readdirSync(GEOM_DIR).filter((f) => f.endsWith('.json')) : [];
let roadsUsed = 0;
for (const f of files) {
  let g;
  try {
    g = JSON.parse(readFileSync(join(GEOM_DIR, f), 'utf8'));
  } catch {
    continue;
  }
  if (!Array.isArray(g.points) || g.points.length < 2) continue;
  const key = g.key ?? f.replace(/\.json$/, '');
  const cls = classByKey.get(key) ?? 'national';
  const coef = CLASS_COEF[cls] ?? 1.15;
  if (!roadIdByKey.has(key)) {
    roadIdByKey.set(key, roadKeys.length);
    roadKeys.push(key);
  }
  const line = roadIdByKey.get(key);
  const flag = cls === 'expressway' ? 1 : cls === 'national' ? 2 : 4;

  // 采样建链：逐点，但跳过过密点（≥200m 才成边，控制边数）
  let prev = nodeIdOf(g.points[0][0], g.points[0][1]);
  let prevPt = g.points[0];
  for (let i = 1; i < g.points.length; i += 1) {
    const p = g.points[i];
    const d = haversineKm([prevPt[0], prevPt[1]], [p[0], p[1]]);
    if (d < 0.2 && i !== g.points.length - 1) continue;
    const id = nodeIdOf(p[0], p[1]);
    addEdge(prev, id, d * coef, flag, line);
    prev = id;
    prevPt = p;
  }
  roadsUsed += 1;
}
console.log(`几何 ${files.length} 份 → 使用 ${roadsUsed} 条 / 节点 ${nodeXY.length} / 边 ${edges.length}`);

// ── 跨线边：不同公路的节点 ≤1km 时连接（换乘/共线） ──────────────────────────
// 用 0.02° 网格分桶加速（O(N²) 不可接受）
const GRID = 0.02;
const buckets = new Map();
function bucketKey(x, y) {
  return `${Math.floor(x / GRID)},${Math.floor(y / GRID)}`;
}
const nodeRoads = new Map(); // node id → Set<line>
for (const e of edges) {
  if (!nodeRoads.has(e.u)) nodeRoads.set(e.u, new Set());
  if (!nodeRoads.has(e.v)) nodeRoads.set(e.v, new Set());
  nodeRoads.get(e.u).add(e.line);
  nodeRoads.get(e.v).add(e.line);
}
for (let id = 0; id < nodeXY.length; id += 1) {
  const [x, y] = nodeXY[id];
  const k = bucketKey(x, y);
  const list = buckets.get(k);
  if (list) list.push(id);
  else buckets.set(k, [id]);
}
let crossLinks = 0;
for (let id = 0; id < nodeXY.length; id += 1) {
  const [x, y] = nodeXY[id];
  const cx = Math.floor(x / GRID);
  const cy = Math.floor(y / GRID);
  const myRoads = nodeRoads.get(id) ?? new Set();
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const list = buckets.get(`${cx + dx},${cy + dy}`);
      if (!list) continue;
      for (const other of list) {
        if (other <= id) continue;
        const otherRoads = nodeRoads.get(other) ?? new Set();
        if (otherRoads.size === 1 && myRoads.size === 1 && [...otherRoads][0] === [...myRoads][0]) continue;
        const [ox, oy] = nodeXY[other];
        const d = haversineKm([x, y], [ox, oy]);
        if (d > 0 && d <= CROSS_LINK_KM) {
          addEdge(id, other, d * CROSS_PENALTY, 0, 65535);
          crossLinks += 1;
        }
      }
    }
  }
}
console.log(`跨线边 ${crossLinks} 条`);

// ── 主连通分量标记（snap 优先） ──────────────────────────────────────────────
const adj = new Map();
for (const e of edges) {
  if (!adj.has(e.u)) adj.set(e.u, []);
  if (!adj.has(e.v)) adj.set(e.v, []);
  adj.get(e.u).push(e.v);
  adj.get(e.v).push(e.u);
}
const comp = new Int32Array(nodeXY.length).fill(-1);
let compId = 0;
const compSizes = [];
for (let s = 0; s < nodeXY.length; s += 1) {
  if (comp[s] !== -1 || !adj.has(s)) continue;
  const stack = [s];
  comp[s] = compId;
  let size = 1;
  while (stack.length) {
    const u = stack.pop();
    for (const v of adj.get(u) ?? []) {
      if (comp[v] === -1) {
        comp[v] = compId;
        size += 1;
        stack.push(v);
      }
    }
  }
  compSizes.push(size);
  compId += 1;
}
const mainComp = compSizes.indexOf(Math.max(...compSizes));
const nodeFlag = new Uint8Array(nodeXY.length);
for (let i = 0; i < nodeXY.length; i += 1) nodeFlag[i] = comp[i] === mainComp ? 1 : 0;
console.log(`连通分量 ${compId} 个，主分量 #${mainComp}（${compSizes[mainComp]} 节点）`);

// ── 写 RVRT 二进制（布局与铁路 RVTP 完全一致：各数组独立成块，magic 换 RVRT） ──
const N = nodeXY.length;
const E = edges.length;
const twoE = E * 2;
const buf = Buffer.alloc(24 + N * 2 * 8 + (N + 1) * 4 + twoE * 4 + twoE * 4 + twoE * 1 + twoE * 2 + N);
buf.write('RVRT', 0, 'ascii');
buf.writeInt32LE(1, 4); // version
buf.writeInt32LE(N, 8);
buf.writeInt32LE(E, 12);
buf.writeInt32LE(1, 16); // reserved=1：尾部含 nodeFlag
buf.writeInt32LE(0, 20);

// CSR：edgeOffset + 双向边（u 的邻接里存 (v)，v 的邻接里存 (u)）
const byNode = new Map();
for (let i = 0; i < edges.length; i += 1) {
  const e = edges[i];
  if (!byNode.has(e.u)) byNode.set(e.u, []);
  if (!byNode.has(e.v)) byNode.set(e.v, []);
  byNode.get(e.u).push(e);
  byNode.get(e.v).push(e);
}
let off = 24;
for (let i = 0; i < N; i += 1) {
  buf.writeDoubleLE(nodeXY[i][0], off);
  buf.writeDoubleLE(nodeXY[i][1], off + 8);
  off += 16;
}
let acc = 0;
for (let i = 0; i < N; i += 1) {
  buf.writeInt32LE(acc, off);
  off += 4;
  acc += (byNode.get(i)?.length ?? 0);
}
buf.writeInt32LE(acc, off); // = E*2
off += 4;

// edgeTo / edgeW / edgeFlag / edgeLine 各自成块（与 railTopology.ts 读取端一致）
const edgeTo = new Int32Array(twoE);
const edgeW = new Float32Array(twoE);
const edgeFlag = new Uint8Array(twoE);
const edgeLine = new Uint16Array(twoE);
let k = 0;
for (let i = 0; i < N; i += 1) {
  for (const e of byNode.get(i) ?? []) {
    edgeTo[k] = e.u === i ? e.v : e.u;
    edgeW[k] = e.wKm;
    edgeFlag[k] = e.flag;
    edgeLine[k] = e.line;
    k += 1;
  }
}
buf.set(Buffer.from(edgeTo.buffer, edgeTo.byteOffset, edgeTo.byteLength), off);
off += twoE * 4;
buf.set(Buffer.from(edgeW.buffer, edgeW.byteOffset, edgeW.byteLength), off);
off += twoE * 4;
buf.set(Buffer.from(edgeFlag.buffer, edgeFlag.byteOffset, edgeFlag.byteLength), off);
off += twoE;
buf.set(Buffer.from(edgeLine.buffer, edgeLine.byteOffset, edgeLine.byteLength), off);
off += twoE * 2;

// nodeFlag 尾部
for (let i = 0; i < N; i += 1) {
  buf.writeUInt8(nodeFlag[i], off);
  off += 1;
}
if (off !== buf.length) throw new Error(`二进制长度不匹配：${off} != ${buf.length}`);
writeFileSync(OUT_BIN, buf);

writeFileSync(
  OUT_META,
  JSON.stringify(
    {
      version: 1,
      nodeCount: N,
      edgeCount: E,
      roadKeys,
      crossLinks,
      mainCompNodes: compSizes[mainComp],
      generatedAt: new Date().toISOString().slice(0, 10),
      note: '干线可通行图（国道+高速+省道主干，城市内部道路不入库）；边权含等级系数（高速1.0/国道1.15/省道1.35），跨线边含换乘惩罚 1.5',
    },
    null,
    1,
  ),
  'utf8',
);
console.log(`\ndata/roads/china-road-topo.bin ← ${N} 节点 / ${E} 边（${(buf.length / 1024 / 1024).toFixed(2)} MB）`);
console.log(`roadKeys: ${roadKeys.length} 条 → ${roadKeys.slice(0, 8).join(', ')}${roadKeys.length > 8 ? ' …' : ''}`);
