/**
 * 万里路书 · 公路几何装配（scripts/lib/road-assemble.mjs）
 *
 * 取代旧的"端点最近邻贪心 + 5km 容差拼链"：
 *   旧法用"距离"猜两段是不是同一条路，于是把不相关的段硬拼成主链
 *   （G318 主链落在西藏、"上海"被贴在错的端点上），拼不上的段丢进 segments。
 *   新法只用 OSM 的真实拓扑：**共享 node id 才是连通**，距离不参与连通判定。
 *
 * 算法：
 *   1. 并查集：同一编号的所有 way，共享任一 node id 即属同一连通分量
 *   2. 分量内把 way 当作"以两端节点为端点的边"，从度为 1 的节点出发走链；
 *      在度 ≥3 的交叉口按"直行优先"（与来向夹角最小）选择下一段，避免拐进支线
 *   3. 输出若干条有序折线（连通分量）；最长者为 points，其余为 segments
 *   4. 平行重复剔除：双向分隔式道路在 OSM 里是两条 oneway 平行线，
 *      按采样点邻近度判定重复，只保留较长的一条（否则 G98 里程会翻倍）
 *
 * 纯函数、零依赖，便于单测与在多进程里复用。
 */

const R = 6371000;
const RAD = Math.PI / 180;

export function haversineM(lng1, lat1, lng2, lat2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function polylineM(pts) {
  let acc = 0;
  for (let i = 1; i < pts.length; i += 1) acc += haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return acc;
}

/** 来向 bearing（度，-180~180），用于"直行优先"判定 */
export function bearingDeg(lng1, lat1, lng2, lat2) {
  const dLng = (lng2 - lng1) * RAD;
  const y = Math.sin(dLng) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos(dLng);
  return (Math.atan2(y, x) / RAD);
}

export function angleDiffDeg(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Douglas-Peucker（米容差），保留首尾 */
export function simplifyDP(pts, toleranceM) {
  if (pts.length <= 2 || toleranceM <= 0) return pts.map((p) => [p[0], p[1]]);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const dist = (p, a, b) => {
    const metersPerLng = 111320 * Math.cos((p[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * metersPerLng;
    const dy = (b[1] - a[1]) * 111320;
    const px = (p[0] - a[0]) * metersPerLng;
    const py = (p[1] - a[1]) * 111320;
    const denom = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / denom));
    const ex = px - dx * t;
    const ey = py - dy * t;
    return Math.sqrt(ex * ex + ey * ey);
  };
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let maxI = -1;
    for (let i = s + 1; i < e; i += 1) {
      const d = dist(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > toleranceM) {
      keep[maxI] = 1;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i += 1) if (keep[i]) out.push([pts[i][0], pts[i][1]]);
  return out;
}

/**
 * 按固定间距沿折线重采样（沿线插值）。
 * 关键：不能只取折线顶点 —— 顶点间距可能远大于比较阈值，
 * 会把"平行相距 17m"的两条线测成"最近顶点相距 159m"，从而判不出重复。
 */
export function resamplePolyline(pts, spacingM) {
  if (!pts || pts.length < 2) return pts ? pts.slice() : [];
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = haversineM(a[0], a[1], b[0], b[1]);
    if (seg <= 0) continue;
    let t = 0;
    while (acc + seg * (1 - t) >= spacingM) {
      const need = spacingM - acc;
      t += need / seg;
      if (t > 1) break;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      acc = 0;
      if (out.length > 400000) return out;
    }
    acc += seg * (1 - t);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

/** 折线上按间隔采样（取折线顶点，用于粗筛） */
export function sampleAlong(pts, intervalM) {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i += 1) {
    acc += haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (acc >= intervalM) {
      out.push(pts[i]);
      acc = 0;
    }
  }
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

/**
 * A 的每个采样点到 B 的最近距离的中位数（米）。
 * 双向分隔式道路（上下行两条 oneway）平行相距 10~30m，中位数极小；
 * 而"同编号的两条真实不同路段"中位数通常在公里级 —— 这个统计量比
 * "固定半径命中率"稳健得多（后者会被互通立交处的分离拉低）。
 */
export function medianNearestM(samplesA, samplesB, searchM = 2000) {
  if (!samplesA.length || !samplesB.length) return Infinity;
  const cell = 500;
  const grid = new Map();
  const cellOf = (p) => Math.floor((p[0] * 111320 * Math.cos(p[1] * RAD)) / cell) + ',' + Math.floor((p[1] * 111320) / cell);
  for (const q of samplesB) {
    const k = cellOf(q);
    let list = grid.get(k);
    if (!list) { list = []; grid.set(k, list); }
    list.push(q);
  }
  // 注意：这里必须把邻域扫完再取最小值。曾经写成"找到 <cell 的点就提前跳出"，
  // 结果取到的是"500m 内的某个点"而不是最近点，中位数被抬高 → 上下行两条线判不出重复。
  const r = Math.max(1, Math.min(6, Math.ceil(searchM / cell)));
  const out = [];
  for (const p of samplesA) {
    const cx = Math.floor((p[0] * 111320 * Math.cos(p[1] * RAD)) / cell);
    const cy = Math.floor((p[1] * 111320) / cell);
    let best = Infinity;
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (const q of grid.get((cx + dx) + ',' + (cy + dy)) ?? []) {
          const d = haversineM(p[0], p[1], q[0], q[1]);
          if (d < best) best = d;
        }
      }
    }
    out.push(best);
  }
  out.sort((a, b) => a - b);
  return out[out.length >> 1];
}

/**
 * 去掉"上下行平行 oneway 对"中的一条。
 *
 * 中国的高速/快速路绝大多数是双向分隔式：上行一条 way、下行一条 way，
 * 各自标 oneway=yes，几何平行相距 10~30m。如果不先去掉一条，
 * 走链时很容易在互通处从上行切到下行再切回来，里程直接翻倍（实测 G98 1226km vs 官方 613km）。
 *
 * 只对"双方都是 oneway、长度接近、双向最近距离中位数都很小"的 way 对生效 ——
 * 山区回头弯（非 oneway）不会被误删，这是必须守住的安全边界。
 */
function buildPartnerMap(ways, tolM = 45, maxSamples = 60) {
  const ONEWAY = 1;
  const partners = new Map();
  const idxOneway = [];
  for (let i = 0; i < ways.length; i += 1) if (ways[i].flag & ONEWAY) idxOneway.push(i);
  if (idxOneway.length < 2) return partners;

  // 采样必须"沿几何等距插值"，不能只取折线顶点：
  // 顶点之间可能相距几百米，两个方向的车道顶点错开时，
  // "顶点最近距离"会大于 45m，导致明明平行的两条 oneway 判不出配对（G104 曾因此翻倍）。
  const sampleOf = (w) => {
    const n = w.lngs.length;
    if (n < 2) return [];
    const pts = new Array(n);
    for (let i = 0; i < n; i += 1) pts[i] = [w.lngs[i], w.lats[i]];
    const lenM = w.lenM || polylineM(pts);
    const spacing = Math.max(15, lenM / maxSamples);
    return resamplePolyline(pts, spacing);
  };

  const cell = 500;
  const grid = new Map();
  const gridCache = new Map();
  const cellOf = (p) => Math.floor((p[0] * 111320 * Math.cos(p[1] * RAD)) / cell) + ',' + Math.floor((p[1] * 111320) / cell);
  const samples = new Map();
  for (const i of idxOneway) {
    const s = sampleOf(ways[i]);
    samples.set(i, s);
    for (const p of s) {
      const k = cellOf(p);
      let list = grid.get(k);
      if (!list) { list = []; grid.set(k, list); }
      list.push(i);
    }
  }

  const nearFrac = (a, sb, tol) => {
    const sa = samples.get(a);
    if (!sa || !sa.length || !sb.length) return 0;
    // 用网格取近邻，避免 O(n·m)
    const cell = Math.max(tol * 2, 30);
    let grid = null;
    for (const [k, v] of gridCache) if (v === sb) { grid = k; break; }
    if (!grid) {
      grid = new Map();
      for (const q of sb) {
        const kk = Math.floor((q[0] * 111320 * Math.cos(q[1] * RAD)) / cell) + ',' + Math.floor((q[1] * 111320) / cell);
        let list = grid.get(kk);
        if (!list) { list = []; grid.set(kk, list); }
        list.push(q);
      }
      gridCache.set(grid, sb);
      if (gridCache.size > 8) gridCache.delete(gridCache.keys().next().value);
    }
    let hit = 0;
    for (const p of sa) {
      const cx = Math.floor((p[0] * 111320 * Math.cos(p[1] * RAD)) / cell);
      const cy = Math.floor((p[1] * 111320) / cell);
      let found = false;
      for (let dx = -1; dx <= 1 && !found; dx += 1) {
        for (let dy = -1; dy <= 1 && !found; dy += 1) {
          for (const q of grid.get((cx + dx) + ',' + (cy + dy)) ?? []) {
            if (haversineM(p[0], p[1], q[0], q[1]) <= tol) { found = true; break; }
          }
        }
      }
      if (found) hit += 1;
    }
    return hit / sa.length;
  };

  for (const i of idxOneway) {
    const ci = cellOf(samples.get(i)[0] ?? [0, 0]);
    const cand = new Set();
    const [cx, cy] = ci.split(',').map(Number);
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (const j of grid.get((cx + dx) + ',' + (cy + dy)) ?? []) if (j !== i) cand.add(j);
      }
    }
    for (const j of cand) {
      if (j === i) continue;
      const la = ways[i].lenM || 0;
      const lb = ways[j].lenM || 0;
      if (la > 0 && lb > 0) {
        const ratio = Math.min(la, lb) / Math.max(la, lb);
        if (ratio < 0.6) continue;
      }
      const sa = samples.get(i);
      const sb = samples.get(j);
      if (!sa.length || !sb.length) continue;
      // 两个方向都要贴合（避免"一条主路 + 一条短匝道"被误判）
      if (nearFrac(i, sb, tolM) < 0.7) continue;
      if (nearFrac(j, sa, tolM) < 0.7) continue;
      let si = partners.get(i);
      if (!si) { si = new Set(); partners.set(i, si); }
      si.add(j);
      let sj = partners.get(j);
      if (!sj) { sj = new Set(); partners.set(j, sj); }
      sj.add(i);
    }
  }
  return partners;
}

/**
 * 剔除"自平行折返"：同一条走链里，同一段路被来回走了两遍。
 *
 * 这是双向分隔式道路（上下行各一条 oneway）最真实的故障形态：
 * 走链在互通处从上行切到下行，沿着对向车道折回来，里程直接翻倍。
 * 只对 **oneway 段**上的采样点做配对 —— 山区回头弯（双向通行）绝不参与判定，
 * 这是"修好高速里程"与"不毁掉盘山路"之间的安全边界。
 *
 * 做法：先按 50m 等距重采样（带源 way 索引），网格找互相在 60m 内、且沿线里程
 * 相差 300m 以上的样本对，保留先出现的一遍，把后一遍的原始点标记为移除，
 * 最后按未移除的连续片段重建折线。连通性不受影响（不删 way，只删重复的折返）。
 */
function detectParallelDrop(pts, pw, ways, cum, opts = {}) {
  const tolM = opts.tolM ?? 60;
  const minGapM = opts.minGapM ?? 300;
  const spacingM = opts.spacingM ?? 50;
  const n = pts.length;
  const sIdx = [];
  const sCum = [];
  let nextAt = 0;
  for (let i = 0; i < n; i += 1) {
    if (cum[i] >= nextAt) {
      sIdx.push(i);
      sCum.push(cum[i]);
      nextAt = cum[i] + spacingM;
    }
  }
  const dropSample = new Uint8Array(sIdx.length);
  if (sIdx.length < 4 || sIdx.length > 400000) return { sIdx, sCum, dropSample };

  const cell = Math.max(tolM * 2, 80);
  const grid = new Map();
  const cellKey = (p) => Math.floor((p[0] * 111320 * Math.cos(p[1] * RAD)) / cell) + ',' + Math.floor((p[1] * 111320) / cell);
  for (let s = 0; s < sIdx.length; s += 1) {
    const p = pts[sIdx[s]];
    const k = cellKey(p);
    let list = grid.get(k);
    if (!list) { list = []; grid.set(k, list); }
    list.push(s);
  }

  const removable = dropSample;
  for (let s = 0; s < sIdx.length; s += 1) {
    const i = sIdx[s];
    if (!(ways[pw[i]].flag & 1)) continue;   // 只处理 oneway 段
    const p = pts[i];
    const cx = Math.floor((p[0] * 111320 * Math.cos(p[1] * RAD)) / cell);
    const cy = Math.floor((p[1] * 111320) / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const t of grid.get((cx + dx) + ',' + (cy + dy)) ?? []) {
          if (t === s) continue;
          const j = sIdx[t];
          if (!(ways[pw[j]].flag & 1)) continue;
          if (Math.abs(sCum[s] - sCum[t]) < minGapM) continue;
          if (haversineM(p[0], p[1], pts[j][0], pts[j][1]) > tolM) continue;
          // 保留先走的那一遍，标记后走的那一遍（含其覆盖的原始点区间）
          if (sCum[s] > sCum[t]) removable[s] = 1;
          else removable[t] = 1;
        }
      }
    }
  }
  return { sIdx, sCum, dropSample };
}

/** 分量内剔除折返：重建为若干连续折线 */
function stripParallelReturn(c, ways, opts = {}) {
  const pts = c.points;
  const pw = c.pointWay;
  const n = pts.length;
  if (!pw || n < 6 || c.lengthM < 1500) return [c];
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i += 1) cum[i] = cum[i - 1] + haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);

  const { sIdx, dropSample } = detectParallelDrop(pts, pw, ways, cum, opts);
  let removedCount = 0;
  for (let s = 0; s < dropSample.length; s += 1) if (dropSample[s]) removedCount += 1;
  if (removedCount < sIdx.length * 0.03) return [c]; // 折返比例过低，不动它

  const dropPoint = new Uint8Array(n);
  for (let s = 0; s < sIdx.length; s += 1) {
    if (!dropSample[s]) continue;
    const from = sIdx[s];
    const to = s + 1 < sIdx.length ? sIdx[s + 1] : n;
    for (let i = from; i < to; i += 1) dropPoint[i] = 1;
  }

  // 按未移除的连续片段重建
  const out = [];
  let run = [];
  let runWays = [];
  let runPointWay = [];
  const flush = () => {
    if (run.length >= 2) {
      const lengthM = polylineM(run);
      if (lengthM >= (opts.minComponentM ?? 30)) out.push({ points: run, lengthM, wayCount: new Set(runWays).size, wayIds: [...new Set(runWays)], pointWay: runPointWay });
    }
    run = [];
    runWays = [];
    runPointWay = [];
  };
  for (let i = 0; i < n; i += 1) {
    if (dropPoint[i]) { flush(); continue; }
    run.push(pts[i]);
    runPointWay.push(pw[i]);
    if (runWays[runWays.length - 1] !== ways[pw[i]].id) runWays.push(ways[pw[i]].id);
  }
  flush();
  if (!out.length) return [c];
  // 保留原有 wayIds（保证 wayCount 语义不丢）
  for (const o of out) if (!o.wayIds.length) o.wayIds = c.wayIds;
  return out;
}

/**
 * 主装配入口。
 * @param {Array<{id:number, ref:string, name:string, highway:string, cls:string, flag:number,
 *                nodeIds:Float64Array, lngs:Float64Array, lats:Float64Array}>} ways
 * @param {{toleranceDuplicateM?:number, minComponentM?:number}} [opts]
 * @returns {{components:Array<{points:number[][], lengthM:number, wayCount:number, wayIds:number[]}>,
 *            totalM:number, duplicateDropped:number}}
 */
export function assembleComponents(ways, opts = {}) {
  const tolDup = opts.toleranceDuplicateM ?? 75;
  const minComp = opts.minComponentM ?? 30;
  const n = ways.length;
  if (!n) return { components: [], totalM: 0, dedupM: null, duplicateDropped: 0 };
  const partners = opts.dedupeOnewayPairs === false ? new Map() : buildPartnerMap(ways);
  // 先按"上下行平行 oneway 对"去掉一条：这是里程不翻倍的关键一步。
  // 只删"双方都是 oneway 且几何平行贴合"的 way —— 单幅双向路（绝大多数国道）不受影响。
  const onewayDropped = 0;

  // ── 1. 并查集：共享 node id 即连通 ────────────────────────────────────────
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (x) => { let r = x; while (parent[r] !== r) r = parent[r]; while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx; } return r; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; };

  const firstSeen = new Map();     // nodeId → wayIdx
  for (let i = 0; i < n; i += 1) {
    const ids = ways[i].nodeIds;
    for (let k = 0; k < ids.length; k += 1) {
      const id = ids[k];
      const seen = firstSeen.get(id);
      if (seen === undefined) firstSeen.set(id, i);
      else if (seen !== i) union(seen, i);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) { g = []; groups.set(r, g); }
    g.push(i);
  }

  // ── 2. 分量内走链（直行优先） ─────────────────────────────────────────────
  const components = [];
  const blockSwitch = opts.blockPartnerSwitch === true;
  for (const idxs of groups.values()) {
    const traced = traceGroup(idxs, ways, minComp, blockSwitch ? partners : new Map());
    for (const t of traced) {
      // 走链里可能存在"沿对向车道折回来"的重复遍历：先剔除，再进入重复分量判定
      const stripped = opts.stripReturns === false ? [t] : stripParallelReturn(t, ways, { minComponentM: minComp });
      for (const s of stripped) components.push(s);
    }
  }

  // ── 3. 平行重复剔除（双向分隔道路） ───────────────────────────────────────
  components.sort((a, b) => b.lengthM - a.lengthM);
  const bboxOf = (c) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of c.points) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
  };
  const kept = [];
  let dropped = 0;
  // 性能护栏：碎片化严重（分量极多）时不做 O(k²) 的两两重复判定 ——
  // 那种情况下"上下行重复"本来也不是主要误差来源，而两两比较会直接卡死（G208 曾卡住）。
  const allowDedupe = components.length <= 120;
  for (const c of components) {
    let dup = false;
    if (allowDedupe) {
      // 采样间距随长度自适应：超长线最多 ~2500 个采样点，避免 O(采样数×邻域) 爆炸
      const spacing = Math.max(60, c.lengthM / 2500);
      const cb = bboxOf(c);
      const samp = kept.length ? resamplePolyline(c.points, spacing) : null;
      for (const k of kept) {
        // 长度比是强先验：上下行两条线长度几乎相等（实测 G98 两条 613.2 / 612.4 km）
        const ratio = Math.min(k.lengthM, c.lengthM) / Math.max(k.lengthM, c.lengthM);
        if (ratio < 0.75) continue;
        // 包围盒粗筛：相距 >2km 的组合直接跳过（绝大多数组合在此被排除）
        const kb = k._bbox || (k._bbox = bboxOf(k));
        if (cb.minX > kb.maxX + 0.02 || cb.maxX < kb.minX - 0.02) continue;
        if (cb.minY > kb.maxY + 0.02 || cb.maxY < kb.minY - 0.02) continue;
        const other = k._samples || (k._samples = resamplePolyline(k.points, spacing));
        const m1 = medianNearestM(samp, other, 800);
        if (m1 > tolDup) continue;
        const m2 = medianNearestM(other, samp, 800);
        if (m2 <= tolDup) { dup = true; break; }
      }
    }
    if (dup) dropped += 1;
    else kept.push(c);
  }
  for (const k of kept) { delete k._samples; delete k._bbox; }

  // ── 4. 里程口径：去掉"平行对向车道"后的路网长度 ──────────────────────────
  // 几何保留全部走链（连通性最好、画出来最完整），但**报出的里程**必须去重：
  // 双向分隔道路在 OSM 里是两条平行 oneway，按 way 长度求和会翻倍
  // （G107 5085km vs 官方 2490km，实测）。
  // 口径说明：每对"平行反向 oneway"只计一条 —— 这是"这条路有多长"的正解，
  // 也是与官方里程可比的口径。几何仍按全部走链绘制（两条车道在图上本就重合）。
  let totalM = kept.reduce((s, c) => s + c.lengthM, 0);
  let dedupM = totalM;
  if (partners.size) {
    const drop = new Set();
    for (const [i, set] of partners) {
      if (drop.has(i)) continue;
      for (const j of set) {
        if (drop.has(j) || drop.has(i)) continue;
        const li = ways[i].lenM || 0;
        const lj = ways[j].lenM || 0;
        drop.add(lj <= li ? j : i);
      }
    }
    if (drop.size) {
      let keptLenM = 0;
      for (let i = 0; i < ways.length; i += 1) {
        if (drop.has(i)) continue;
        const w = ways[i];
        keptLenM += w.lenM || polylineM(Array.from({ length: w.lngs.length }, (_, k) => [w.lngs[k], w.lats[k]]));
      }
      if (keptLenM > 0) dedupM = keptLenM;
    }
  }
  return { components: kept, totalM, dedupM, duplicateDropped: dropped };
}

/** 在给定 way 子集内走来链，返回该分量的 1..k 条折线 */
function traceGroup(wayIdxs, ways, minCompM, partners = new Map()) {
  const nodes = new Map(); // nodeId → [{wi, other}]
  const push = (node, e) => {
    let list = nodes.get(node);
    if (!list) { list = []; nodes.set(node, list); }
    list.push(e);
  };
  for (const wi of wayIdxs) {
    const w = ways[wi];
    const a = w.nodeIds[0];
    const b = w.nodeIds[w.nodeIds.length - 1];
    push(a, { wi, other: b });
    push(b, { wi, other: a });
  }

  const used = new Set();
  const results = [];

  const coordsOf = (wi, fromNode) => {
    const w = ways[wi];
    const fwd = w.nodeIds[0] === fromNode;
    const pts = [];
    if (fwd) for (let i = 0; i < w.nodeIds.length; i += 1) pts.push([w.lngs[i], w.lats[i]]);
    else for (let i = w.nodeIds.length - 1; i >= 0; i -= 1) pts.push([w.lngs[i], w.lats[i]]);
    return pts;
  };

  // 起点优先取度为 1 的节点（真正的路端），其次任意
  const sortedNodes = [...nodes.keys()].sort((a, b) => nodes.get(a).length - nodes.get(b).length);
  for (const start of sortedNodes) {
    for (;;) {
      const avail = (nodes.get(start) || []).filter((e) => !used.has(e.wi));
      if (!avail.length) break;
      const pts = [];
      const wayIds = [];
      const pointWay = [];
      let cur = start;
      let edge = avail[0];
      for (;;) {
        used.add(edge.wi);
        wayIds.push(ways[edge.wi].id);
        const seg = coordsOf(edge.wi, cur);
        const startIdx = pts.length ? 1 : 0;
        if (!pts.length) pts.push(...seg);
        else pts.push(...seg.slice(1));
        for (let k = startIdx; k < seg.length; k += 1) pointWay.push(edge.wi);
        cur = edge.other;
        const allCands = (nodes.get(cur) || []).filter((e) => !used.has(e.wi));
        if (!allCands.length) break;
        // 关键：不切换到"对向车道"（与刚走过的 way 平行反向的那条），
        // 否则双向分隔道路会被来回走两遍，里程翻倍（G98 曾出现 1226km vs 官方 613km）
        const pset = partners.get(edge.wi);
        let cands = pset ? allCands.filter((e) => !pset.has(e.wi)) : allCands;
        if (!cands.length) cands = allCands;
        let next = cands[0];
        if (cands.length > 1 && pts.length >= 2) {
          const inDir = bearingDeg(pts[pts.length - 2][0], pts[pts.length - 2][1], pts[pts.length - 1][0], pts[pts.length - 1][1]);
          let best = Infinity;
          for (const e of cands) {
            const w = ways[e.wi];
            if (w.nodeIds.length < 2) continue;
            const fwd = w.nodeIds[0] === cur;
            const p1 = fwd ? [w.lngs[0], w.lats[0]] : [w.lngs[w.nodeIds.length - 1], w.lats[w.nodeIds.length - 1]];
            const p2 = fwd ? [w.lngs[1], w.lats[1]] : [w.lngs[w.nodeIds.length - 2], w.lats[w.nodeIds.length - 2]];
            const outDir = bearingDeg(p1[0], p1[1], p2[0], p2[1]);
            const turn = angleDiffDeg(inDir, outDir);
            if (turn < best) { best = turn; next = e; }
          }
        }
        edge = next;
      }
      const lengthM = polylineM(pts);
      if (lengthM >= minCompM && pts.length >= 2) results.push({ points: pts, lengthM, wayCount: wayIds.length, wayIds, pointWay });
    }
  }
  return results;
}

/**
 * 紧公差缝合：把同一编号内**端点相距很近**的连通分量接起来。
 *
 * 为什么需要：OSM 中一条国道穿过城区时 ref 常断掉（实测 G318 有 200 个断点，
 * **中位断口仅 0.14km**），画出来就是一串虚线。这些 100~500m 的断口在几何上
 * 几乎必然是同一条路的继续。
 *
 * 与旧实现"5km 容差贪心拼链"的本质区别：
 *   1. 只在**同一编号**的分量之间缝合（不跨编号、不跨无关路段）；
 *   2. 容差收紧到 500m（旧实现 5000m，正是它把 G318 拼到西藏去的原因）；
 *   3. 缝合只影响"怎么画"，里程仍以去重里程为准，且缝合段长度单独统计，
 *      不混入已收录里程 —— 诚实口径不变。
 */
export function stitchComponents(components, maxGapM = 500) {
  if (components.length < 2) return { components, stitchedGaps: 0 };
  const cell = Math.max(maxGapM, 50);
  const cellOf = (p) => Math.floor((p[0] * 111320 * Math.cos(p[1] * RAD)) / cell) + ',' + Math.floor((p[1] * 111320) / cell);
  const grid = new Map();
  const endRefs = []; // {ci, end, pt}
  for (let ci = 0; ci < components.length; ci += 1) {
    const pts = components[ci].points;
    for (const end of [0, 1]) {
      const pt = end === 0 ? pts[0] : pts[pts.length - 1];
      endRefs.push({ ci, end, pt });
      const k = cellOf(pt);
      let list = grid.get(k);
      if (!list) { list = []; grid.set(k, list); }
      list.push(endRefs.length - 1);
    }
  }
  const pairs = [];
  for (let i = 0; i < endRefs.length; i += 1) {
    const a = endRefs[i];
    const cx = Math.floor((a.pt[0] * 111320 * Math.cos(a.pt[1] * RAD)) / cell);
    const cy = Math.floor((a.pt[1] * 111320) / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const j of grid.get((cx + dx) + ',' + (cy + dy)) ?? []) {
          if (j <= i) continue;
          const b = endRefs[j];
          if (b.ci === a.ci) continue;
          const d = haversineM(a.pt[0], a.pt[1], b.pt[0], b.pt[1]);
          if (d <= maxGapM) pairs.push({ i, j, d });
        }
      }
    }
  }
  if (!pairs.length) return { components, stitchedGaps: 0 };
  pairs.sort((x, y) => x.d - y.d);

  // 每个端点只接受一次连接（最近优先）
  const usedEnd = new Set();
  const link = new Map(); // endRefIndex → {toEndRefIndex, d}
  let stitched = 0;
  for (const p of pairs) {
    if (usedEnd.has(p.i) || usedEnd.has(p.j)) continue;
    usedEnd.add(p.i);
    usedEnd.add(p.j);
    link.set(p.i, { to: p.j, d: p.d });
    link.set(p.j, { to: p.i, d: p.d });
    stitched += 1;
  }
  if (!link.size) return { components, stitchedGaps: 0 };

  // 沿连接走链，把分量串成更长的折线
  const visited = new Uint8Array(components.length);
  const out = [];
  const endIndexOf = (ci, end) => ci * 2 + end;
  const walk = (startCi, startEnd) => {
    // startEnd=0 表示从分量首端开始（沿正向走），=1 表示从末端开始（先反向）
    const points = [];
    let ci = startCi;
    let dir = startEnd === 0 ? 1 : -1;
    let guard = components.length + 2;
    for (;;) {
      if (visited[ci]) break;
      visited[ci] = 1;
      const pts = components[ci].points;
      const seq = dir === 1 ? pts : [...pts].reverse();
      if (!points.length) points.push(...seq);
      else {
        // 缝合处补一个点（缝合距离 ≤500m，直接连上，不插值伪造）
        points.push(...seq);
      }
      // 从当前分量的"出口端"继续
      const exitEnd = dir === 1 ? 1 : 0;
      const l = link.get(endIndexOf(ci, exitEnd));
      if (!l || guard-- <= 0) break;
      const other = endRefs[l.to];
      if (visited[other.ci]) break;
      // 进入 other 的那一端 = other.end；从该端进入意味着行进方向为 end===0 → 正向
      dir = other.end === 0 ? 1 : -1;
      ci = other.ci;
    }
    const lengthM = polylineM(points);
    return { points, lengthM, wayCount: 0, wayIds: [], stitched: true };
  };

  const hasLink = new Set();
  for (const [k] of link) hasLink.add(endRefs[k].ci);
  // 先处理只连了一端的（链路起点），再处理环
  const order = [...Array(components.length).keys()].sort((a, b) => {
    const aFree = [0, 1].some((e) => !link.has(endIndexOf(a, e))) ? 0 : 1;
    const bFree = [0, 1].some((e) => !link.has(endIndexOf(b, e))) ? 0 : 1;
    return aFree - bFree;
  });
  for (const ci of order) {
    if (visited[ci] || !hasLink.has(ci)) continue;
    const startEnd = link.has(endIndexOf(ci, 0)) && !link.has(endIndexOf(ci, 1)) ? 0 : 0;
    out.push(walk(ci, startEnd));
  }
  for (let ci = 0; ci < components.length; ci += 1) {
    if (visited[ci]) continue;
    out.push({ ...components[ci], stitched: false });
  }
  out.sort((a, b) => b.lengthM - a.lengthM);
  return { components: out, stitchedGaps: stitched };
}

/**
 * 按官方起讫点方向给分量定向、排序，再做紧公差缝合。
 * 解决「最长分量碰巧在西藏中段、上海段被丢进虚线」——主链应沿规划走向，
 * 而不是单纯取最长碎段。
 *
 * 不跨大断口飞线：缝合上限仍由 maxGapM 约束（默认 8km，只吃城区 ref 断档）。
 */
export function orderAndStitchAlongAxis(polylines, fromPt, toPt, maxGapM = 8000) {
  const ax = toPt[0] - fromPt[0];
  const ay = toPt[1] - fromPt[1];
  const proj = (p) => (p[0] - fromPt[0]) * ax + (p[1] - fromPt[1]) * ay;
  const comps = [];
  for (const pts of polylines) {
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const oriented = proj(a) <= proj(b) ? pts.slice() : pts.slice().reverse();
    const mid = oriented[(oriented.length >> 1)];
    comps.push({ points: oriented, lengthM: polylineM(oriented), t: proj(mid) });
  }
  comps.sort((a, b) => a.t - b.t || b.lengthM - a.lengthM);
  const stitched = stitchComponents(comps, maxGapM);
  const tagged = stitched.components.map((c) => {
    const mid = c.points[(c.points.length >> 1)];
    return { ...c, t: proj(mid) };
  });
  tagged.sort((a, b) => a.t - b.t);
  return { components: tagged, stitchedGaps: stitched.stitchedGaps };
}

/**
 * 段间断点标注：以"已收录集合"的任一端点到新分量的任一端点的最小距离为断口。
 * 诚实标注，不插值伪造连续。
 */
export function computeGaps(components) {
  const out = [];
  if (components.length < 2) return out;
  let cumKm = components[0].lengthM / 1000;
  const placed = [components[0]];
  for (let i = 1; i < components.length; i += 1) {
    const c = components[i];
    const a = c.points[0];
    const b = c.points[c.points.length - 1];
    let best = Infinity;
    for (const p of placed) {
      for (const q of [p.points[0], p.points[p.points.length - 1]]) {
        const d1 = haversineM(a[0], a[1], q[0], q[1]);
        const d2 = haversineM(b[0], b[1], q[0], q[1]);
        if (d1 < best) best = d1;
        if (d2 < best) best = d2;
      }
    }
    out.push({
      atKm: Math.round(cumKm * 100) / 100,
      gapKm: Math.round((best / 1000) * 100) / 100,
      fromSeg: i - 1,
      toSeg: i,
      status: best / 1000 > 200 ? 'suspect' : 'normal',
    });
    cumKm += c.lengthM / 1000;
    placed.push(c);
  }
  return out;
}
