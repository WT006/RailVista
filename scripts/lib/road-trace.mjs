/**
 * 万里路书 · 国道「真实走廊」走线库（scripts/lib/road-trace.mjs）
 *
 * 思路：把 assembleComponents 得到的真实分量并成一张坐标图（边=真实道路段），
 * 再以官方控制点为必经节点，分段做 Dijkstra 最短路。
 *   - 最短路在真实道路图上：不绕路、不重复、不产生平行双线
 *   - 图不连通（控制点间无真实道路）= 真实缺口，精确给出两端，交补线阶段
 */
import { haversineM } from './road-assemble.mjs';

const KEYDEC = 6;
const finite = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
export const keyOf = (p) => p[0].toFixed(KEYDEC) + '_' + p[1].toFixed(KEYDEC);

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a; a.push(x); let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i;
      if (l < a.length && a[l][0] < a[s][0]) s = l; if (r < a.length && a[r][0] < a[s][0]) s = r;
      if (s === i) break; [a[s], a[i]] = [a[i], a[s]]; i = s; } }
    return top;
  }
}

/** 由分量构建坐标图 + 4km 空间网格（用于最近节点查询） */
export function buildGraph(components) {
  const idByKey = new Map();
  const coords = [];
  const adj = new Map();
  const nodeId = (p) => {
    const k = keyOf(p); let i = idByKey.get(k);
    if (i === undefined) { i = coords.length; idByKey.set(k, i); coords.push(p); }
    return i;
  };
  const link = (u, v, w) => {
    let m = adj.get(u); if (!m) { m = new Map(); adj.set(u, m); }
    const e = m.get(v);
    if (e === undefined || w < e) m.set(v, w);
  };
  for (const c of components) {
    const penalty = c.penalty || 1;
    let prev = null;
    for (const p of c.points) {
      if (!finite(p)) continue;
      const id = nodeId(p);
      if (prev !== null && id !== prev) {
        const w = haversineM(coords[prev][0], coords[prev][1], p[0], p[1]) * penalty;
        if (Number.isFinite(w) && w > 0) { link(prev, id, w); link(id, prev, w); }
      }
      prev = id;
    }
  }
  // 空间网格 cell ≈ 4km
  const cellM = 4000;
  const grid = new Map();
  const cellKey = (lng, lat) =>
    Math.floor((lng * 111320 * Math.cos(lat * Math.PI / 180)) / cellM) + ',' +
    Math.floor((lat * 111320) / cellM);
  for (let i = 0; i < coords.length; i += 1) {
    const k = cellKey(coords[i][0], coords[i][1]);
    let l = grid.get(k); if (!l) { l = []; grid.set(k, l); }
    l.push(i);
  }
  /** 最近图节点（搜索半径内） */
  function nearest(lng, lat, { radiusCells = Number(process.env.NEAREST_CELLS || 4) } = {}) {
    const [cx, cy] = cellKey(lng, lat).split(',').map(Number);
    let best = null, bestD = Infinity;
    for (let dx = -radiusCells; dx <= radiusCells; dx += 1) for (let dy = -radiusCells; dy <= radiusCells; dy += 1) {
      for (const i of grid.get((cx + dx) + ',' + (cy + dy)) ?? []) {
        const d = haversineM(lng, lat, coords[i][0], coords[i][1]);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best === null ? null : { node: best, d: bestD };
  }
  return { coords, adj, nearest };
}

function segmentBox(c0, c1) {
  const minX = Math.min(c0.lng, c1.lng), maxX = Math.max(c0.lng, c1.lng);
  const minY = Math.min(c0.lat, c1.lat), maxY = Math.max(c0.lat, c1.lat);
  const span = Math.max(maxX - minX, maxY - minY);
  const m = Math.max(0.25, span * 0.5);
  return { minX: minX - m, maxX: maxX + m, minY: minY - m, maxY: maxY + m };
}

/** Dijkstra 最短路径树；给 stopAt 时在该节点弹出后即停（搜索范围≈到目标距离） */
function dijkstraTree(graph, s, stopAt = null) {
  const dist = new Map([[s, 0]]);
  const prev = new Map();
  const heap = new Heap();
  heap.push([0, s]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d !== dist.get(u)) continue;
    if (stopAt !== null && u === stopAt) break;
    for (const [v, w] of graph.adj.get(u) ?? []) {
      const nd = d + w;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); heap.push([nd, v]); }
    }
  }
  return { dist, prev };
}

/** 从最短路径树重建 s→target 节点序列 */
function treePath(prev, s, target) {
  const path = [];
  let cur = target;
  while (cur !== undefined) { path.push(cur); if (cur === s) break; cur = prev.get(cur); }
  path.reverse();
  return path[0] === s ? path : null;
}

/**
 * 缺口的本地地面短连接：在「走廊盒」内做 Dijkstra（只走盒内节点），
 * 仅当真实路径长度 ≤ straight×ratio 才返回节点序列，否则返回 null（交高德补真实线）。
 * 因纳入的地面 way 已排除高速，物理上不会走高速；盒与里程比杜绝长距离绕行。
 */
export function surfaceConnector(graph, gap, { ratio = 2.5 } = {}) {
  const from = gap.from, to = gap.to;
  const sN = graph.nearest(from[0], from[1]);
  const gN = graph.nearest(to[0], to[1]);
  if (!sN || !gN) return null;
  const straight = haversineM(from[0], from[1], to[0], to[1]);
  // 走廊盒：经纬度边界 + 余量（约 straight 的 0.6，且 ≥0.2°）
  const padLng = Math.max(0.2, (straight / 111320 / Math.cos(((from[1] + to[1]) / 2) * Math.PI / 180)) * 0.7);
  const padLat = Math.max(0.2, (straight / 111320) * 0.7);
  const minX = Math.min(from[0], to[0]) - padLng, maxX = Math.max(from[0], to[0]) + padLng;
  const minY = Math.min(from[1], to[1]) - padLat, maxY = Math.max(from[1], to[1]) + padLat;
  const inside = (id) => {
    const p = graph.coords[id];
    return p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;
  };
  const dist = new Map([[sN.node, 0]]);
  const prev = new Map();
  const heap = new Heap();
  heap.push([0, sN.node]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d !== dist.get(u)) continue;
    if (u === gN.node) break;
    for (const [v, w] of graph.adj.get(u) ?? []) {
      if (!inside(v)) continue;
      const nd = d + w;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); heap.push([nd, v]); }
    }
  }
  const path = treePath(prev, sN.node, gN.node);
  if (!path) return null;
  let real = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = graph.coords[path[i - 1]], b = graph.coords[path[i]];
    real += haversineM(a[0], a[1], b[0], b[1]);
  }
  if (real > straight * ratio) return null;
  return { nodes: path, lengthM: real };
}

/**
 * 以控制点走线（逐控制点推进，保证「每个控制点都经过」，闭环也能完整走一圈）：
 *   从当前点对下一控制点做 Dijkstra（目标弹出即停，搜索范围≈相邻点间距）：
 *     可达 → 输出该段节点（不含起点，避免重复）；
 *     不可达 → 输出 gap（跨缺口不直连），当前点跳到下一控制点继续。
 *   返回有序 stream：{nodes} 为连通真实走线，{gap} 为相邻分量缺口。
 */
export function buildTraceStream(graph, controls) {
  const stream = [];
  // 从首个能吸附到图的控制点起步（个别端点地理编码偏差不应导致整条路无几何）
  let startJ = 0, curNode = null;
  for (; startJ < controls.length; startJ += 1) {
    const n0 = graph.nearest(controls[startJ].lng, controls[startJ].lat);
    if (n0) { curNode = n0.node; break; }
  }
  if (curNode === null) return stream;
  stream.push({ nodes: [curNode] });
  for (let j = startJ + 1; j < controls.length; j += 1) {
    const gN = graph.nearest(controls[j].lng, controls[j].lat);
    if (!gN) continue;
    const { dist, prev } = dijkstraTree(graph, curNode, gN.node);
    if (dist.has(gN.node)) {
      const path = treePath(prev, curNode, gN.node);
      if (path && path.length > 1) stream.push({ nodes: path.slice(1) });
      curNode = gN.node;
    } else {
      // 不可达：取离目标最近的可达节点作为缺口起点，gap 后跳到目标
      let endNode = null, bd = Infinity;
      for (const [node] of dist) {
        const d = haversineM(controls[j].lng, controls[j].lat, graph.coords[node][0], graph.coords[node][1]);
        if (d < bd) { bd = d; endNode = node; }
      }
      if (endNode !== null) {
        // 先输出「当前点→可达末点」的真实片段（不丢弃已建路），再输出到目标的缺口
        const reachPath = treePath(prev, curNode, endNode);
        if (reachPath && reachPath.length > 1) stream.push({ nodes: reachPath.slice(1) });
        stream.push({ gap: { from: graph.coords[endNode].slice(), to: graph.coords[gN.node].slice() } });
      }
      curNode = gN.node;
    }
  }
  return stream;
}

/**
 * 对每个缺口，在走廊内做「增强图最短路」：
 *   组件 = 两端点间边（权重=真实长度）；不同组件端点 ≤BRIDGE 才允许桥接（权重=直线距离）。
 * 最短路选走廊主件、弃平行复线；路径上的桥接边即真实小缺口（≤BRIDGE，交给高德短腿）。
 */
export function stitchGapsWithComponents(stream, graph, allComponents, { bridgeM = 20000 } = {}) {
  const usedKeys = new Set();
  for (const el of stream) if (el.nodes) for (const n of el.nodes) usedKeys.add(keyOf(graph.coords[n]));
  const comps = allComponents
    .map((c) => ({ points: c.points, lengthM: c.lengthM ?? polyLen(c.points) }))
    .filter((c) => c.points.length >= 2);
  const shareUsed = (c) => {
    let n = 0;
    for (const p of c.points) if (usedKeys.has(keyOf(p))) n += 1;
    return n / c.points.length;
  };

  function gapBox(g) {
    const minX = Math.min(g.from[0], g.to[0]), maxX = Math.max(g.from[0], g.to[0]);
    const minY = Math.min(g.from[1], g.to[1]), maxY = Math.max(g.from[1], g.to[1]);
    const span = Math.max(maxX - minX, maxY - minY);
    const m = Math.max(0.2, span * 0.4);
    return { minX: minX - m, maxX: maxX + m, minY: minY - m, maxY: maxY + m };
  }
  const inBox = (p, b) => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;

  for (const el of stream) {
    if (!el.gap) continue;
    const g = el.gap;
    const box = gapBox(g);
    // 候选组件：主线未大量覆盖，且端点落在走廊
    const cand = comps.filter((c) => shareUsed(c) <= 0.5 &&
      (inBox(c.points[0], box) || inBox(c.points[c.points.length - 1], box)));

    // 节点登记：start/goal + 每个组件两端点
    const nodeCoord = [];
    const idByKey = new Map();
    const reg = (p) => {
      const k = keyOf(p); let i = idByKey.get(k);
      if (i === undefined) { i = nodeCoord.length; idByKey.set(k, i); nodeCoord.push(p); }
      return i;
    };
    const sNode = reg(g.from);
    const gNode = reg(g.to);
    const compEnds = cand.map((c) => {
      const u = reg(c.points[0]);
      const v = reg(c.points[c.points.length - 1]);
      return { c, u, v };
    });
    const adj = new Map();
    const link = (u, v, w, meta) => {
      let m = adj.get(u); if (!m) { m = new Map(); adj.set(u, m); }
      const e = m.get(v);
      if (!e || w < e.w) m.set(v, { w, meta });
    };
    // 组件边（双向），meta 标记为组件并携带定向点
    for (const e of compEnds) {
      const w = Math.max(1, e.c.lengthM);
      link(e.u, e.v, w, { kind: 'comp', points: e.c.points });
      link(e.v, e.u, w, { kind: 'comp', points: [...e.c.points].reverse() });
    }
    // 桥接边：任意两端点（含 start/goal）直线 ≤bridgeM
    const N = nodeCoord.length;
    for (let i = 0; i < N; i += 1) for (let j = i + 1; j < N; j += 1) {
      // 跳过同一组件两端点（已有组件边）
      const sameComp = compEnds.some((e) => (e.u === i && e.v === j) || (e.u === j && e.v === i));
      if (sameComp) continue;
      const d = haversineM(nodeCoord[i][0], nodeCoord[i][1], nodeCoord[j][0], nodeCoord[j][1]);
      if (d <= bridgeM) {
        link(i, j, d, { kind: 'bridge' });
        link(j, i, d, { kind: 'bridge' });
      }
    }
    // Dijkstra
    const dist = new Map([[sNode, 0]]);
    const prev = new Map();
    const heap = new Heap();
    heap.push([0, sNode]);
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d !== dist.get(u)) continue;
      if (u === gNode) break;
      for (const [v, e] of adj.get(u) ?? []) {
        const nd = d + e.w;
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); heap.push([nd, v]); }
      }
    }
    // 目标可达性；不可达取离 goal 最近的可达节点
    let endNode = gNode;
    if (!dist.has(gNode)) {
      let bd = Infinity;
      for (const [node] of dist) {
        const d = haversineM(nodeCoord[gNode][0], nodeCoord[gNode][1], nodeCoord[node][0], nodeCoord[node][1]);
        if (d < bd) { bd = d; endNode = node; }
      }
    }
    // 重建并按边类型产出：组件点 / 桥接小缺口
    const pathNodes = [];
    let cur = endNode;
    while (cur !== undefined) { pathNodes.push(cur); if (cur === sNode) break; cur = prev.get(cur); }
    pathNodes.reverse();
    const pieces = [];
    if (pathNodes[0] === sNode) {
      for (let i = 0; i < pathNodes.length - 1; i += 1) {
        const u = pathNodes[i], v = pathNodes[i + 1];
        const meta = adj.get(u)?.get(v);
        if (!meta) continue;
        if (meta.meta.kind === 'comp') pieces.push({ compPoints: meta.meta.points });
        else pieces.push({ bridgeGap: { from: nodeCoord[u].slice(), to: nodeCoord[v].slice() } });
      }
    }
    let residual = null;
    if (endNode !== gNode) {
      residual = { from: nodeCoord[endNode].slice(), to: g.to.slice(),
        gapKm: Math.round((haversineM(nodeCoord[endNode][0], nodeCoord[endNode][1], g.to[0], g.to[1]) / 1000) * 100) / 100 };
    }
    el.pieces = pieces;
    el.residual = residual;
  }
  return stream;
}

function polyLen(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) s += haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return s;
}

/** 展平 stream（含 insert），接缝去重；返回最终 points / 残余 gaps / 真实里程 */
export function flattenStream(stream, graph) {
  const points = [];
  const gaps = [];
  let drawnM = 0;
  const addP = (p) => {
    const last = points[points.length - 1];
    if (last && keyOf(last) === keyOf(p)) return;
    if (last) drawnM += haversineM(last[0], last[1], p[0], p[1]);
    points.push(p);
  };
  const addGap = (from, to) => {
    gaps.push({ from: from.slice(), to: to.slice(),
      gapKm: Math.round((haversineM(from[0], from[1], to[0], to[1]) / 1000) * 100) / 100 });
  };
  for (const el of stream) {
    if (el.gap) {
      for (const pc of el.pieces ?? []) {
        if (pc.compPoints) { for (const p of pc.compPoints) addP(p); }
        else if (pc.bridgeGap) {
          // 桥接小缺口：先把缺口起点（=当前末点）对齐，再记录
          addP(pc.bridgeGap.from);
          addGap(pc.bridgeGap.from, pc.bridgeGap.to);
        }
      }
      if (el.residual) gaps.push(el.residual);
      continue;
    }
    for (const n of el.nodes) addP(graph.coords[n]);
  }
  return { points, gaps, drawnKm: drawnM / 1000 };
}

export function traceThroughControls(graph, controls, allComponents) {
  let stream = buildTraceStream(graph, controls);
  stream = stitchGapsWithComponents(stream, graph, allComponents);
  const flat = flattenStream(stream, graph);
  return { ...flat, runs: stream.filter((x) => x.nodes).length };
}

/**
 * 把 stream 展开为有序「绘制段 / 待补缺口」：
 *   [{draw:[pts]} | {fill:{from,to}}]
 * 缺口里的真实组件给 draw，桥接小缺口与残余缺口给 fill（交高德补线）。
 */
export function streamToItems(stream, graph) {
  const items = [];
  const draw = (pts) => {
    const list = pts.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (list.length) items.push({ draw: list });
  };
  for (const el of stream) {
    if (el.nodes) {
      draw(el.nodes.map((n) => graph.coords[n]));
      continue;
    }
    for (const pc of el.pieces ?? []) {
      if (pc.compPoints) draw(pc.compPoints);
      else if (pc.bridgeGap) items.push({ fill: pc.bridgeGap });
    }
    if (el.residual) items.push({ fill: el.residual });
  }
  return items;
}
