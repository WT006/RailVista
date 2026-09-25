/**
 * 全图轨道拓扑寻路服务（S3 核心）：二进制 CSR 加载 + Dijkstra 逐段寻路。
 *
 * 依赖纪律：不 import corridors / localRails——线路名命中集合与车型口径
 * 由调用方注入（isHighspeedTrain / lineHitSet），保证本模块可被脚本独立复用。
 *
 * 性能预算：加载 <1s、常驻 <150MB、单段寻路 <500ms。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOPO_DIR = join(__dirname, '../../../../data/rails');
const BIN_PATH = join(TOPO_DIR, 'china-rail-topo.bin');
const META_PATH = join(TOPO_DIR, 'china-rail-topo.meta.json');

const MAGIC = 'RVTP';
const CELL_DEG = 0.03;
const CELL_MAX_X = 4096;

/** 边权系数（env 可调；0 即恢复纯最短路） */
function typePenalty(): number {
  const v = Number(process.env.RAIL_TOPO_TYPE_PENALTY);
  return Number.isFinite(v) ? v : 0.35;
}
function lineBonus(): number {
  const v = Number(process.env.RAIL_TOPO_LINE_BONUS);
  return Number.isFinite(v) ? v : 0.25;
}

export function isTopologyEnabled(): boolean {
  const v = String(process.env.RAIL_TOPOLOGY ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

export type TopoMeta = {
  version: number;
  nodeCount: number;
  edgeCount: number;
  lineNames: string[];
  ferryEdges: Array<Record<string, unknown>>;
  generatedAt: string;
};

type TopoState = {
  loaded: boolean;
  failed: boolean;
  nodeCount: number;
  edgeCount: number;
  nodeXY: Float64Array;
  edgeOffset: Int32Array;
  edgeTo: Int32Array;
  edgeW: Float32Array;
  edgeFlag: Uint8Array;
  edgeLine: Uint16Array;
  lineNames: string[];
  lineIdByName: Map<string, number>;
  lineIdLoose: Map<string, number[]>;
  // 0.03° 网格索引：按 cellCode 排序的平行数组 + 二分查找
  cellSorted: Int32Array; // cellCode sorted ascending
  cellOrder: Int32Array; // node idx aligned with cellSorted
  // 构建期连通分量标记（1=主分量/大分量节点，snap 优先）
  nodeFlag: Uint8Array | null;
  // Dijkstra 工作区（时间戳惰性重置；dist 必须为 float64——float32 精度损失
  // 会使「top.dist > dist[u]」惰性删除判断误跳过节点，导致大范围不可达）
  dist: Float64Array;
  prev: Int32Array;
  stamp: Int32Array;
  curStamp: number;
};

let state: TopoState | null = null;

function cellCode(lng: number, lat: number): number {
  const cx = Math.floor(lng / CELL_DEG);
  const cy = Math.floor(lat / CELL_DEG);
  return cy * CELL_MAX_X + cx;
}

export function loadTopology(): boolean {
  if (state?.loaded) return true;
  if (state?.failed) return false;
  if (!existsSync(BIN_PATH) || !existsSync(META_PATH)) {
    console.warn('[rail-topology] topo files missing, fallback to legacy chain');
    state = Object.assign(state || {}, { loaded: false, failed: true }) as TopoState;
    return false;
  }
  const t0 = Date.now();
  try {
    const buf = readFileSync(BIN_PATH);
    if (buf.length < 24 || buf.toString('ascii', 0, 4) !== MAGIC) {
      throw new Error('bad magic');
    }
    const version = buf.readInt32LE(4);
    const nodeCount = buf.readInt32LE(8);
    const edgeCount = buf.readInt32LE(12);
    if (version !== 1 || nodeCount <= 0 || edgeCount <= 0) throw new Error('bad header');

    let off = 24;
    const nodeXY = new Float64Array(buf.buffer, buf.byteOffset + off, nodeCount * 2);
    off += nodeCount * 2 * 8;
    const edgeOffset = new Int32Array(buf.buffer, buf.byteOffset + off, nodeCount + 1);
    off += (nodeCount + 1) * 4;
    const twoE = edgeCount * 2;
    const edgeTo = new Int32Array(buf.buffer, buf.byteOffset + off, twoE);
    off += twoE * 4;
    const edgeW = new Float32Array(buf.buffer, buf.byteOffset + off, twoE);
    off += twoE * 4;
    const edgeFlag = new Uint8Array(buf.buffer, buf.byteOffset + off, twoE);
    off += twoE;
    const edgeLine = new Uint16Array(buf.buffer, buf.byteOffset + off, twoE);
    off += twoE * 2;
    // reserved=1 → 尾部含 nodeFlag Uint8Array(N)（构建期连通分量标记）
    const reserved = buf.readInt32LE(20);
    let nodeFlag: Uint8Array | null = null;
    if (reserved === 1 && buf.byteLength >= off + nodeCount) {
      nodeFlag = new Uint8Array(buf.buffer, buf.byteOffset + off, nodeCount);
    }

    const meta = JSON.parse(readFileSync(META_PATH, 'utf8')) as TopoMeta;
    const lineIdByName = new Map<string, number>();
    const lineIdLoose = new Map<string, number[]>();
    meta.lineNames.forEach((name, id) => {
      if (!name) return;
      lineIdByName.set(name, id);
      // 宽松键：去「站」后缀 + 「X 线」包含「X 高速线」双向映射
      const loose = name.replace(/站$/, '');
      const base = loose.replace(/高速线$/, '').replace(/客专$/, '').replace(/线$/, '');
      for (const k of [loose, base]) {
        if (!k) continue;
        if (!lineIdLoose.has(k)) lineIdLoose.set(k, []);
        lineIdLoose.get(k)!.push(id);
      }
    });

    // 网格索引：按 cellCode 排序的平行数组 + 二分查找（简单且无稀疏边界问题）
    const cellOf = new Int32Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      cellOf[i] = cellCode(nodeXY[i * 2], nodeXY[i * 2 + 1]);
    }
    const cellOrder = new Int32Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) cellOrder[i] = i;
    const cellSorted = Int32Array.from(cellOf);
    // 按 cellCode 稳定排序 cellOrder（附带 cellSorted 同步重排）
    const paired = Array.from({ length: nodeCount }, (_, i) => i);
    paired.sort((a, b) => cellOf[a] - cellOf[b]);
    const cellSortedArr = new Int32Array(nodeCount);
    const cellOrderArr = new Int32Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      cellSortedArr[i] = cellOf[paired[i]];
      cellOrderArr[i] = paired[i];
    }
    void cellSorted;

    state = {
      loaded: true,
      failed: false,
      nodeCount,
      edgeCount,
      nodeXY,
      edgeOffset,
      edgeTo,
      edgeW,
      edgeFlag,
      edgeLine,
      lineNames: meta.lineNames,
      lineIdByName,
      lineIdLoose,
      cellSorted: cellSortedArr,
      cellOrder: cellOrderArr,
      nodeFlag,
      dist: new Float64Array(nodeCount),
      prev: new Int32Array(nodeCount),
      stamp: new Int32Array(nodeCount),
      curStamp: 0,
    };
    console.log(
      `[rail-topology] loaded ${nodeCount} nodes / ${edgeCount} edges in ${Date.now() - t0}ms`,
    );
    return true;
  } catch (e) {
    console.warn('[rail-topology] load failed:', e instanceof Error ? e.message : e);
    state = Object.assign(state || {}, { loaded: false, failed: true }) as TopoState;
    return false;
  }
}

export function nearestNode(lng: number, lat: number, maxKm = 3): number | null {
  const s = state;
  if (!s?.loaded) return null;
  const cx = Math.floor(lng / CELL_DEG);
  const cy = Math.floor(lat / CELL_DEG);

  // [cellCode, start, end) 区间二分
  function cellRange(c: number): [number, number] {
    let lo = 0;
    let hi = s!.cellSorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s!.cellSorted[mid] < c) lo = mid + 1;
      else hi = mid;
    }
    const start = lo;
    let hi2 = s!.cellSorted.length;
    let lo2 = start;
    while (lo2 < hi2) {
      const mid = (lo2 + hi2) >> 1;
      if (s!.cellSorted[mid] <= c) lo2 = mid + 1;
      else hi2 = mid;
    }
    return [start, lo2];
  }

  let best = { d2: Infinity, idx: -1 };
  let bestMain = { d2: Infinity, idx: -1 };
  const r = Math.max(1, Math.ceil(3 / 111 / CELL_DEG) + 1);

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const c = (cy + dy) * CELL_MAX_X + (cx + dx);
      const [start, end] = cellRange(c);
      for (let p = start; p < end; p++) {
        const i = s.cellOrder[p];
        const dlng = s.nodeXY[i * 2] - lng;
        const dlat = s.nodeXY[i * 2 + 1] - lat;
        const d2 = dlng * dlng + dlat * dlat;
        if (d2 < best.d2) best = { d2, idx: i };
        if (s.nodeFlag && s.nodeFlag[i] === 1 && d2 < bestMain.d2) {
          bestMain = { d2, idx: i };
        }
      }
    }
  }
  // 优先主分量节点（过滤量化碎片）；3km 内无主分量节点才退回最近任意节点
  const chosen = bestMain.idx >= 0 ? bestMain : best;
  if (chosen.idx < 0) return null;
  // 度距离近似 → km 校验（1°≈111km，经度按 cos(lat) 修正）
  const dDeg = Math.sqrt(chosen.d2);
  const km = dDeg * 111 * Math.cos((lat * Math.PI) / 180);
  if (km > maxKm) return null;
  return chosen.idx;
}

export function nodeCoords(idx: number): { lng: number; lat: number } | null {
  const s = state;
  if (!s?.loaded || idx < 0 || idx >= s.nodeCount) return null;
  return { lng: s.nodeXY[idx * 2], lat: s.nodeXY[idx * 2 + 1] };
}

export type RouteLegOpts = {
  highspeed?: boolean;
  lineHitSet?: Set<number>;
};

/** 二叉堆（数组实现，[dist, node] 平行） */
class MinHeap {
  private d: number[] = [];
  private n: number[] = [];

  get size() {
    return this.d.length;
  }

  push(dist: number, node: number) {
    this.d.push(dist);
    this.n.push(node);
    let i = this.d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  pop(): { dist: number; node: number } | null {
    if (!this.d.length) return null;
    const top = { dist: this.d[0], node: this.n[0] };
    const ld = this.d.pop()!;
    const ln = this.n.pop()!;
    if (this.d.length) {
      this.d[0] = ld;
      this.n[0] = ln;
      let i = 0;
      const len = this.d.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < len && this.d[l] < this.d[m]) m = l;
        if (r < len && this.d[r] < this.d[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    const td = this.d[a];
    this.d[a] = this.d[b];
    this.d[b] = td;
    const tn = this.n[a];
    this.n[a] = this.n[b];
    this.n[b] = tn;
  }
}

/**
 * 单段 A* 寻路：fromNode → toNode，返回节点 idx 序列（含端点）或 null。
 * 启发 = 目标直线距离 × (1 − LINE_BONUS)（可采纳：边权 ≥ 里程 × (1−lb)），
 * 相比纯 Dijkstra 大幅减少超长 OD 的扩散规模。
 */
export function routeLeg(fromNode: number, toNode: number, opts?: RouteLegOpts): number[] | null {
  const s = state;
  if (!s?.loaded || fromNode == null || toNode == null) return null;
  if (fromNode === toNode) return [fromNode];

  const hs = !!opts?.highspeed;
  const hit = opts?.lineHitSet;
  const tp = typePenalty();
  const lb = lineBonus();
  const stamp = ++s.curStamp;
  const { dist, prev, stamp: stamps, edgeOffset, edgeTo, edgeW, edgeFlag, edgeLine, nodeXY } = s;

  const tLng = nodeXY[toNode * 2];
  const tLat = nodeXY[toNode * 2 + 1];
  // 启发 = 直线距离(km) × H_SCALE。默认 0.9：略高于可采纳界(1−lb=0.75)换取
  // 超长 OD 的扩散收敛速度；路径代价最多高估 ~20%，RAIL_TOPO_H_SCALE 可调。
  const hScale = (() => {
    const v = Number(process.env.RAIL_TOPO_H_SCALE);
    return Number.isFinite(v) && v > 0 ? v : 0.9;
  })();
  const cosLat = Math.cos((tLat * Math.PI) / 180);
  const h = (node: number): number => {
    const dLng = (nodeXY[node * 2] - tLng) * cosLat;
    const dLat = nodeXY[node * 2 + 1] - tLat;
    // 1° lat ≈ 111km, 1° lng ≈ 111km × cos
    return Math.sqrt(dLng * dLng * 111 * 111 + dLat * dLat * 111 * 111) * hScale;
  };

  const heap = new MinHeap();
  dist[fromNode] = 0;
  stamps[fromNode] = stamp;
  prev[fromNode] = -1;
  heap.push(h(fromNode), fromNode);

  while (heap.size) {
    const top = heap.pop()!;
    const u = top.node;
    // closed 集：stamp 负值标记已处理（graph-search A*，稳定不误杀）
    if (stamps[u] === -stamp) continue;
    stamps[u] = -stamp;
    if (u === toNode) {
      // 回溯
      const path: number[] = [];
      let cur = u;
      while (cur !== -1) {
        path.push(cur);
        cur = prev[cur];
      }
      path.reverse();
      return path;
    }
    const gu = dist[u];
    const start = edgeOffset[u];
    const end = edgeOffset[u + 1];
    for (let p = start; p < end; p++) {
      const v = edgeTo[p];
      const sv = stamps[v];
      if (sv === -stamp) continue; // 已 closed
      const km = edgeW[p];
      const flag = edgeFlag[p];
      const isHsrEdge = (flag & 1) !== 0;
      const mismatch = hs !== isHsrEdge ? 1 : 0;
      const lineId = edgeLine[p];
      const lineHit = hit?.has(lineId) ? 1 : 0;
      const w = km * (1 + tp * mismatch) * (1 - lb * lineHit);
      const nd = gu + w;
      if (sv !== stamp) {
        stamps[v] = stamp;
        dist[v] = nd;
        prev[v] = u;
        heap.push(nd + h(v), v);
      } else if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(nd + h(v), v);
      }
    }
  }
  return null;
}

export type StopLike = { name?: string; lng: number; lat: number };

export type RouteStopsResult = {
  coords: [number, number][];
  segResults: Array<{ ok: boolean; reason?: string; km?: number; coords: [number, number][] }>;
  failures: Array<{ seg: number; reason: string }>;
};

const SNAP_KM = 3;

/**
 * 按经停站顺序逐段寻路 + 拼接 + 相邻段端点去重。
 * 构造性保证每个经停站都在折线上（段折线 = [站坐标, ...路径, 站坐标]）。
 */
export function routeStops(stops: StopLike[], opts?: RouteLegOpts): RouteStopsResult {
  const segResults: RouteStopsResult['segResults'] = [];
  const failures: RouteStopsResult['failures'] = [];
  const coords: [number, number][] = [];
  if (!state?.loaded || !stops || stops.length < 2) {
    return { coords, segResults, failures: [{ seg: -1, reason: 'topo_not_loaded' }] };
  }

  let prevEnd: { lng: number; lat: number } | null = null;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const na = nearestNode(a.lng, a.lat, SNAP_KM);
    const nb = nearestNode(b.lng, b.lat, SNAP_KM);
    if (na == null || nb == null) {
      segResults.push({ ok: false, reason: 'topo_snap_failed', coords: [] });
      failures.push({ seg: i, reason: na == null ? `snap_failed:${a.name || i}` : `snap_failed:${b.name || i + 1}` });
      continue;
    }
    const path = routeLeg(na, nb, opts);
    if (!path) {
      segResults.push({ ok: false, reason: 'topo_unreachable', coords: [] });
      failures.push({ seg: i, reason: `unreachable:${a.name || i}→${b.name || i + 1}` });
      continue;
    }
    // 段折线 = [站坐标, ...路径坐标（剔除距端站 <0.05km 的首尾点）, 站坐标]
    const segCoords: [number, number][] = [[a.lng, a.lat]];
    const km0 = (idx: number) => {
      const p = nodeCoords(idx)!;
      return Math.hypot((p.lng - a.lng) * 91, (p.lat - a.lat) * 111);
    };
    const km1 = (idx: number) => {
      const p = nodeCoords(idx)!;
      return Math.hypot((p.lng - b.lng) * 91, (p.lat - b.lat) * 111);
    };
    for (let k = 0; k < path.length; k++) {
      if (k === 0 && km0(path[k]) < 0.05) continue;
      if (k === path.length - 1 && km1(path[k]) < 0.05) continue;
      const p = nodeCoords(path[k])!;
      segCoords.push([p.lng, p.lat]);
    }
    segCoords.push([b.lng, b.lat]);

    segResults.push({ ok: true, coords: segCoords });

    // 相邻段端点去重（上一段终点 == 本段起点）
    const appendFrom = prevEnd && segCoords.length && segCoords[0][0] === prevEnd.lng && segCoords[0][1] === prevEnd.lat ? 1 : 0;
    for (let k = appendFrom; k < segCoords.length; k++) {
      coords.push(segCoords[k]);
    }
    prevEnd = { lng: b.lng, lat: b.lat };
  }

  return { coords, segResults, failures };
}

/** 线路名（数组）→ edgeLine id 集合（精确 + 宽松匹配） */
export function lineNameIds(names: string[]): Set<number> {
  const s = state;
  const out = new Set<number>();
  if (!s?.loaded) return out;
  for (const raw of names) {
    if (!raw) continue;
    const name = String(raw).trim();
    const exact = s.lineIdByName.get(name);
    if (exact != null) out.add(exact);
    const loose = s.lineIdLoose.get(name.replace(/站$/, ''));
    if (loose) for (const id of loose) out.add(id);
    // 「X 线」匹配「X 高速线」：基名反向查
    const base = name.replace(/站$/, '').replace(/高速线$/, '').replace(/客专$/, '').replace(/线$/, '');
    if (base) {
      const hit = s.lineIdLoose.get(base);
      if (hit) for (const id of hit) out.add(id);
    }
  }
  return out;
}

export function topologyInfo(): { loaded: boolean; failed: boolean; nodeCount: number } {
  return {
    loaded: !!state?.loaded,
    failed: !!state?.failed,
    nodeCount: state?.nodeCount || 0,
  };
}