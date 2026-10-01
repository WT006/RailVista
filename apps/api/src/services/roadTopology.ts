/**
 * 万里路书 · 全国公路旅游网 —— 干线公路拓扑寻路服务（PRD §3.3 L2 层）。
 *
 * 格式完全沿用铁路 RVTP（apps/api/src/services/railTopology.ts），仅领域替换：
 *   magic 'RVRT'（Road Version Topology）
 *   CSR：nodeXY(F64) / edgeOffset(I32) / edgeTo(I32) / edgeW(F32) / edgeFlag(U8)
 *        / edgeLine(U16，roadKey id）+ 0.03° 网格索引 + 主分量 nodeFlag
 *   edgeFlag bit0=expressway bit1=national bit2=provincial（等级系数建图时已折进
 *   边权：高速 1.0 / 国道 1.15 / 省道 1.35，表示「同等距离下优先走高等级路」）
 *
 * 规模纪律（PRD §3.3，理由必须留档）：中国全境 OSM car 网络节点量级 3000 万+，
 * CSR 常驻 >1GB、单次 Dijkstra 无法进 500ms 预算。因此 L2 只建
 * 「国道 + 高速 + 省道主干」的干线可通行图，城市内部道路不入库；
 * OD 端点 0.03° 网格 snap 吸附最近干线节点，容差 5km，超限由调用方降级
 * （端点外接段 + 干线主段拼接，见 roadRouting.ts）。
 *
 * 二进制由 scripts/build-road-topology.mjs 生成，本服务只读。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOPO_DIR = join(__dirname, '../../../../data/roads');
const BIN_PATH = join(TOPO_DIR, 'china-road-topo.bin');
const META_PATH = join(TOPO_DIR, 'china-road-topo.meta.json');

const MAGIC = 'RVRT';
const CELL_DEG = 0.03;
const CELL_MAX_X = 4096;

/** OD 端点 snap 容差（PRD §5.1：5km） */
export const ROAD_SNAP_KM = 5;

/** 公路等级系数（PRD §3.3 Step 4：同等距离下优先走高等级路） */
export const ROAD_CLASS_COEF: Record<string, number> = {
  expressway: 1.0,
  national: 1.15,
  provincial: 1.35,
};

export type RoadTopoMeta = {
  version: number;
  nodeCount: number;
  edgeCount: number;
  roadKeys: string[];
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
  roadKeys: string[];
  roadIdByKey: Map<string, number>;
  cellSorted: Int32Array;
  cellOrder: Int32Array;
  nodeFlag: Uint8Array | null;
  // A* 工作区（时间戳惰性重置；dist 必须 float64，理由同铁路版）
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

export function loadRoadTopology(): boolean {
  if (state?.loaded) return true;
  if (state?.failed) return false;
  if (!existsSync(BIN_PATH) || !existsSync(META_PATH)) {
    state = Object.assign(state || {}, { loaded: false, failed: true }) as TopoState;
    return false;
  }
  const t0 = Date.now();
  try {
    const buf = readFileSync(BIN_PATH);
    if (buf.length < 24 || buf.toString('ascii', 0, 4) !== MAGIC) throw new Error('bad magic');
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
    const reserved = buf.readInt32LE(20);
    let nodeFlag: Uint8Array | null = null;
    if (reserved === 1 && buf.byteLength >= off + nodeCount) {
      nodeFlag = new Uint8Array(buf.buffer, buf.byteOffset + off, nodeCount);
    }

    const meta = JSON.parse(readFileSync(META_PATH, 'utf8')) as RoadTopoMeta;
    const roadIdByKey = new Map<string, number>();
    meta.roadKeys.forEach((key, id) => roadIdByKey.set(key, id));

    // 0.03° 网格索引：cellCode 排序平行数组 + 二分区间
    const cellOf = new Int32Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      cellOf[i] = cellCode(nodeXY[i * 2], nodeXY[i * 2 + 1]);
    }
    const paired = Array.from({ length: nodeCount }, (_, i) => i);
    paired.sort((a, b) => cellOf[a] - cellOf[b]);
    const cellSorted = new Int32Array(nodeCount);
    const cellOrder = new Int32Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      cellSorted[i] = cellOf[paired[i]!];
      cellOrder[i] = paired[i]!;
    }

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
      roadKeys: meta.roadKeys,
      roadIdByKey,
      cellSorted,
      cellOrder,
      nodeFlag,
      dist: new Float64Array(nodeCount),
      prev: new Int32Array(nodeCount),
      stamp: new Int32Array(nodeCount),
      curStamp: 0,
    };
    console.log(`[road-topology] loaded ${nodeCount} nodes / ${edgeCount} edges in ${Date.now() - t0}ms`);
    return true;
  } catch (e) {
    console.warn('[road-topology] load failed:', e instanceof Error ? e.message : e);
    state = Object.assign(state || {}, { loaded: false, failed: true }) as TopoState;
    return false;
  }
}

export function nearestRoadNode(lng: number, lat: number, maxKm = ROAD_SNAP_KM): number | null {
  const s = state;
  if (!s?.loaded) return null;
  const cx = Math.floor(lng / CELL_DEG);
  const cy = Math.floor(lat / CELL_DEG);

  function cellRange(c: number): [number, number] {
    let lo = 0;
    let hi = s!.cellSorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s!.cellSorted[mid]! < c) lo = mid + 1;
      else hi = mid;
    }
    const start = lo;
    let hi2 = s!.cellSorted.length;
    let lo2 = start;
    while (lo2 < hi2) {
      const mid = (lo2 + hi2) >> 1;
      if (s!.cellSorted[mid]! <= c) lo2 = mid + 1;
      else hi2 = mid;
    }
    return [start, lo2];
  }

  let best: { d2: number; idx: number } = { d2: Infinity, idx: -1 };
  let bestMain: { d2: number; idx: number } = { d2: Infinity, idx: -1 };
  const r = Math.max(1, Math.ceil(ROAD_SNAP_KM / 111 / CELL_DEG) + 1);

  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const c = (cy + dy) * CELL_MAX_X + (cx + dx);
      const [start, end] = cellRange(c);
      for (let p = start; p < end; p += 1) {
        const i = s.cellOrder[p]!;
        const dlng = s.nodeXY[i * 2]! - lng;
        const dlat = s.nodeXY[i * 2 + 1]! - lat;
        const d2 = dlng * dlng + dlat * dlat;
        if (d2 < best.d2) best = { d2, idx: i };
        if (s.nodeFlag && s.nodeFlag[i] === 1 && d2 < bestMain.d2) {
          bestMain = { d2, idx: i };
        }
      }
    }
  }
  const chosen = bestMain.idx >= 0 ? bestMain : best;
  if (chosen.idx < 0) return null;
  const dDeg = Math.sqrt(chosen.d2);
  const km = dDeg * 111 * Math.cos((lat * Math.PI) / 180);
  if (km > maxKm) return null;
  return chosen.idx;
}

export function roadNodeCoords(idx: number): { lng: number; lat: number } | null {
  const s = state;
  if (!s?.loaded || idx < 0 || idx >= s.nodeCount) return null;
  return { lng: s.nodeXY[idx * 2]!, lat: s.nodeXY[idx * 2 + 1]! };
}

/** 二叉堆（与铁路版相同实现） */
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
      if (this.d[p]! <= this.d[i]!) break;
      this.swap(p, i);
      i = p;
    }
  }

  pop(): { dist: number; node: number } | null {
    if (!this.d.length) return null;
    const top = { dist: this.d[0]!, node: this.n[0]! };
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
        if (l < len && this.d[l]! < this.d[m]!) m = l;
        if (r < len && this.d[r]! < this.d[m]!) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    const td = this.d[a]!;
    this.d[a] = this.d[b]!;
    this.d[b] = td;
    const tn = this.n[a]!;
    this.n[a] = this.n[b]!;
    this.n[b] = tn;
  }
}

export type RoadLegOpts = {
  /** 优先走的公路 key 集合（途经约束，命中边权打折） */
  preferRoadKeys?: Set<number>;
};

function preferBonus(): number {
  const v = Number(process.env.ROAD_TOPO_PREFER_BONUS);
  return Number.isFinite(v) ? v : 0.2;
}

/** 单段 A*：启发 = Haversine 直线距离 × H_SCALE（可采纳；默认 0.9） */
export function roadRouteLeg(fromNode: number, toNode: number, opts?: RoadLegOpts): number[] | null {
  const s = state;
  if (!s?.loaded || fromNode == null || toNode == null) return null;
  if (fromNode === toNode) return [fromNode];

  const prefer = opts?.preferRoadKeys;
  const pb = preferBonus();
  const stamp = ++s.curStamp;
  const { dist, prev, stamp: stamps, edgeOffset, edgeTo, edgeW, edgeLine, nodeXY } = s;

  const tLng = nodeXY[toNode * 2]!;
  const tLat = nodeXY[toNode * 2 + 1]!;
  const hScale = (() => {
    const v = Number(process.env.ROAD_TOPO_H_SCALE);
    return Number.isFinite(v) && v > 0 ? v : 0.9;
  })();
  const cosLat = Math.cos((tLat * Math.PI) / 180);
  const h = (node: number): number => {
    const dLng = (nodeXY[node * 2]! - tLng) * cosLat;
    const dLat = nodeXY[node * 2 + 1]! - tLat;
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
    if (stamps[u] === -stamp) continue;
    stamps[u] = -stamp;
    if (u === toNode) {
      const path: number[] = [];
      let cur = u;
      while (cur !== -1) {
        path.push(cur);
        cur = prev[cur]!;
      }
      path.reverse();
      return path;
    }
    const gu = dist[u]!;
    const start = edgeOffset[u]!;
    const end = edgeOffset[u + 1]!;
    for (let p = start; p < end; p += 1) {
      const v = edgeTo[p]!;
      const sv = stamps[v]!;
      if (sv === -stamp) continue;
      const km = edgeW[p]!;
      const lineId = edgeLine[p]!;
      const hit = prefer?.has(lineId) ? 1 : 0;
      const w = km * (1 - pb * hit);
      const nd = gu + w;
      if (sv !== stamp) {
        stamps[v] = stamp;
        dist[v] = nd;
        prev[v] = u;
        heap.push(nd + h(v), v);
      } else if (nd < dist[v]!) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(nd + h(v), v);
      }
    }
  }
  return null;
}

/** 公路 key（数组）→ edgeLine id 集合 */
export function roadKeyIds(keys: string[]): Set<number> {
  const s = state;
  const out = new Set<number>();
  if (!s?.loaded) return out;
  for (const k of keys) {
    const id = s.roadIdByKey.get(k);
    if (id != null) out.add(id);
  }
  return out;
}

/** 相邻两节点间的边属于哪条公路（roadKey id；找不到返回 -1）。供路由器回溯途经公路 */
export function edgeLineBetween(u: number, v: number): number {
  const s = state;
  if (!s?.loaded) return -1;
  const start = s.edgeOffset[u]!;
  const end = s.edgeOffset[u + 1]!;
  for (let p = start; p < end; p += 1) {
    if (s.edgeTo[p] === v) return s.edgeLine[p]!;
  }
  return -1;
}

/** edgeLine id → 公路 key */
export function roadKeyOfLine(lineId: number): string | undefined {
  return state?.roadKeys[lineId];
}

export function roadTopologyInfo(): { loaded: boolean; nodeCount: number; edgeCount: number; roadKeyCount: number } {
  return {
    loaded: !!state?.loaded,
    nodeCount: state?.nodeCount || 0,
    edgeCount: state?.edgeCount || 0,
    roadKeyCount: state?.roadKeys.length || 0,
  };
}
