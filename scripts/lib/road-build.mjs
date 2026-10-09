/**
 * 万里路书 · 国道贯通装配核心（scripts/lib/road-build.mjs）
 *
 * 关键事实：分省 PBF 里存的是「完整全国关系」，成员为全局顺序；但该顺序可能整体旋转
 * （新 G219 从叶城起、到东兴后，再把「喀纳斯→叶城」北延段追加在末尾）。
 * 因此：
 *   1) 保留关系成员的「全局顺序」，绝不按省分组（分组会破坏顺序）
 *   2) 几何按 way id 跨省路由（该 id 在哪个省 rvwn 有几何就取哪个）
 *   3) 沿全局顺序切成若干连通「run」，跳过平行重复车道
 *   4) 以官方起终点锚定，按拓扑连接 + 全局顺序兜底，把 runs 重排成一条单线
 *   5) 仍接不上的 = 真实缺口，交补线阶段
 */
import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { readRelIndex, openProvGeom } from './road-local.mjs';
import { haversineM, polylineM, assembleComponents } from './road-assemble.mjs';
import { buildGraph, traceThroughControls, surfaceConnector } from './road-trace.mjs';
import { loadNodes, openRvwn, readRvwnHeader, decodeIndexDeltas } from './rvwn.mjs';
import { PROVINCE_BBOXES } from './province-bbox.mjs';

export const PROV_TO_SLUG = {
  安徽: 'anhui', 北京: 'beijing', 重庆: 'chongqing', 福建: 'fujian', 甘肃: 'gansu',
  广东: 'guangdong', 广西: 'guangxi', 贵州: 'guizhou', 海南: 'hainan', 河北: 'hebei',
  黑龙江: 'heilongjiang', 河南: 'henan', 湖北: 'hubei', 湖南: 'hunan', 内蒙古: 'inner_mongolia',
  江苏: 'jiangsu', 江西: 'jiangxi', 吉林: 'jilin', 辽宁: 'liaoning', 宁夏: 'ningxia',
  青海: 'qinghai', 陕西: 'shaanxi', 山东: 'shandong', 上海: 'shanghai', 山西: 'shanxi',
  四川: 'sichuan', 天津: 'tianjin', 西藏: 'tibet', 新疆: 'xinjiang', 云南: 'yunnan', 浙江: 'zhejiang',
};

const SNAP_M = 200;
const DUP_M = 60;
const finite = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]);

export function readProvOrder(ref) {
  const p = join('data', 'cache', 'amap', 'controls', ref + '.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** 打开本路省序涉及的全部省几何提供者，支持按 id 跨省路由 */
export function openProviders(slugs) {
  const map = new Map();
  for (const slug of slugs) if (!map.has(slug)) map.set(slug, openProvGeom(slug));
  const ownerCache = new Map();
  function ownerOf(id) {
    if (ownerCache.has(id)) return ownerCache.get(id);
    let slug = null;
    for (const [s, p] of map) if (p.has(id)) { slug = s; break; }
    ownerCache.set(id, slug);
    return slug;
  }
  return {
    has(id) { return ownerOf(id) !== null; },
    geomOf(id) {
      const slug = ownerOf(id);
      if (!slug) return null;
      return map.get(slug).geomOf(id);
    },
    fullOf(id) {
      const slug = ownerOf(id);
      if (!slug) return null;
      return map.get(slug).fullOf(id);
    },
    taggedIds(ref) {
      const out = [];
      for (const p of map.values()) out.push(...p.taggedIds(ref));
      return out;
    },
    close() { for (const p of map.values()) p.close(); },
  };
}

/**
 * 取关系成员全局顺序（各省副本一致，取省序中第一个含该关系的省）。
 * @returns [{ id, role, seq }]
 */
export function buildGlobalMembers(ref) {
  const ctrl = readProvOrder(ref);
  if (!ctrl) throw new Error('缺控制点省序，请先 geocode-controls: ' + ref);
  for (const prov of ctrl.provOrder) {
    const slug = PROV_TO_SLUG[prov];
    if (!slug) continue;
    const rel = readRelIndex(slug)[ref];
    if (rel?.length) return rel.map((m, i) => ({ id: m.id, role: m.role || '', seq: i }));
  }
  throw new Error('各省 relindex 均无该关系: ' + ref);
}

/**
 * 汇总该国道的全部真实 way（并集）：
 *   ① route 关系成员（含未打 ref 的连接段，提供走向与无名连接）
 *   ② 省片里所有 ref 列表命中该编号的 way（补关系漏收录的真实段，含共线）
 * 去重后返回 [{ id, nodeIds, points }]（仅保留可取到几何且 ≥2 点）。
 */
export function gatherWays(ref, providers) {
  // 无 OSM route 关系的国道（新增/短途）只用 ref 标记 way，不强制要求关系
  const relIds = new Set();
  try {
    for (const m of buildGlobalMembers(ref)) relIds.add(m.id);
  } catch { /* 无关系：退化为 ref 标记 way */ }
  for (const id of providers.taggedIds(ref)) relIds.add(id);
  const ways = [];
  for (const id of relIds) {
    const f = providers.fullOf(id);
    if (!f || f.points.length < 2) continue;
    ways.push({ id, nodeIds: f.nodeIds, points: f.points,
      lngs: f.points.map((p) => p[0]), lats: f.points.map((p) => p[1]) });
  }
  return ways;
}

/**
 * 以 seedWays（关系+ref 几何）为「走廊种子」，纳入走廊带宽内全省「非高速」地面 way，
 * 用于把 OSM 未打 ref / 未被关系收录的真实连接段也并进来（地面最短路不会走高速）。
 *
 * @param {Array} seedWays gatherWays 的产物
 * @param {string[]} slugs 省序
 * @param {{bandKm?:number, denseBandKm?:number}} 稀疏省走廊单侧带宽（默认 40km）；稠密省用 denseBandKm（默认 6km）
 * @returns 新增 way（与 seed 同构，按 id 去重）
 */
// 地广路稀、需宽走廊找连接的西部/边疆省；其余为稠密省（ref 几何基本连通，窄带即可，提速省内存）
const SPARSE_SLUGS = new Set(['xinjiang', 'tibet', 'qinghai', 'inner_mongolia', 'gansu', 'yunnan', 'guangxi', 'heilongjiang', 'jilin']);
export function gatherSurfaceWays(seedWays, slugs, { bandKm = 40, denseBandKm = Number(process.env.DENSE_BAND_KM || 6), motorwayOut = null } = {}) {
  // 走廊栅格：0.02° 格子（约 2.2km），种子落点
  const CELL = 0.02;
  const occupied = new Set();
  const cellKey = (x, y) => Math.floor(x / CELL) + '_' + Math.floor(y / CELL);
  for (const w of seedWays) for (const p of w.points) occupied.add(cellKey(p[0], p[1]));
  // 按省带宽把种子膨胀成走廊（每省不同）
  function bandFor(slug) {
    const b = SPARSE_SLUGS.has(slug) ? bandKm : denseBandKm;
    const dilate = Math.max(1, Math.round(b / 2.2));
    const band = new Set();
    for (const k of occupied) {
      const [cx, cy] = k.split('_').map(Number);
      for (let dx = -dilate; dx <= dilate; dx += 1) for (let dy = -dilate; dy <= dilate; dy += 1) {
        if (Math.hypot(dx, dy) <= dilate) band.add((cx + dx) + '_' + (cy + dy));
      }
    }
    return band;
  }
  const seedIds = new Set(seedWays.map((w) => w.id));
  const extras = [];
  for (const slug of slugs) {
    const t0 = Date.now();
    const band = bandFor(slug);
    const path = join('data', 'roads', 'net', slug + '.rvwn');
    const header = readRvwnHeader(path);
    const nodes = loadNodes(path);
    // 一次性读入整段 wayNodes（避免逐条 way 的同步读）
    const wnLen = header.nodesOffset - header.wayNodesOffset;
    const wnBuf = Buffer.alloc(wnLen);
    const fd = openSync(path, 'r');
    readSync(fd, wnBuf, 0, wnLen, header.wayNodesOffset);
    closeSync(fd);
    // 走廊内节点
    const inBandIdx = new Set();
    for (let i = 0; i < nodes.ids.length; i += 1) {
      if (band.has(cellKey(nodes.lngs[i], nodes.lats[i]))) inBandIdx.add(i);
    }
    let kept = 0, scanned = 0;
    // 直接遍历 way 记录（复用 iterateWays），从 wnBuf 顺序解码
    const rv = openRvwn(path);
    try {
      for (const w of rv.iterateWays()) {
        scanned += 1;
        if (/motorway/.test(w.highway)) {
          // 可选：收集走廊内高速 way（供共线借道，调用方加惩罚权重后入图）
          if (motorwayOut && !seedIds.has(w.id)) {
            const idx2 = decodeIndexDeltas(wnBuf, w.nodeOff, w.nodeCnt);
            if (idx2.some((i2) => inBandIdx.has(i2))) {
              const pts2 = [];
              for (const i2 of idx2) { const p2 = [nodes.lngs[i2], nodes.lats[i2]]; if (Number.isFinite(p2[0])) pts2.push(p2); }
              if (pts2.length >= 2) { seedIds.add(w.id); motorwayOut.push({ id: w.id, points: pts2 }); }
            }
          }
          continue;
        }
        if (seedIds.has(w.id)) continue;
        const idx = decodeIndexDeltas(wnBuf, w.nodeOff, w.nodeCnt);
        if (!idx.some((i) => inBandIdx.has(i))) continue;
        const points = [];
        for (const i of idx) { const p = [nodes.lngs[i], nodes.lats[i]]; if (Number.isFinite(p[0])) points.push(p); }
        if (points.length < 2) continue;
        seedIds.add(w.id);
        extras.push({ id: w.id, points }); // 只保留 points（lngs/lats/nodeIds 与 points 重复，省去以降内存）
        kept += 1;
      }
    } finally {
      rv.close();
    }
    console.log('  [surface] ' + slug.padEnd(15) + ' ways ' + scanned + ' 纳入 ' + kept +
      ' 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  return extras;
}

/**
 * 缺口「局部地面连接」（内存轻、防绕路）：
 * 只在该缺口走廊盒（单侧 bandKm）内，从相关省片收集「非高速」way 建小图，
 * 盒内 Dijkstra 求两端连接，真实里程 ≤ straight×ratio 才返回点，否则 null（交高德）。
 * nodeCache 跨缺口复用省节点（Map slug→nodes），避免重复加载。
 */
export function localGapConnect(slugs, gap, nodeCache, { bandKm = 40, ratio = 2.5 } = {}) {
  const from = gap.from, to = gap.to;
  const straight = haversineM(from[0], from[1], to[0], to[1]);
  // 走廊盒（经纬度），单侧约 bandKm
  const latKm = bandKm / 111.0;
  const lngKm = bandKm / (111.0 * Math.cos(((from[1] + to[1]) / 2) * Math.PI / 180));
  const minX = Math.min(from[0], to[0]) - lngKm, maxX = Math.max(from[0], to[0]) + lngKm;
  const minY = Math.min(from[1], to[1]) - latKm, maxY = Math.max(from[1], to[1]) + latKm;
  const boxIntersect = (bbox) => bbox && !(maxX < bbox[1] || minX > bbox[3] || maxY < bbox[0] || minY > bbox[2]);
  const ways = [];
  for (const slug of slugs) {
    if (!boxIntersect(PROVINCE_BBOXES[slug])) continue;
    const path = join('data', 'roads', 'net', slug + '.rvwn');
    if (!existsSync(path)) continue;
    let nodes = nodeCache.get(slug);
    if (!nodes) { nodes = loadNodes(path); nodeCache.set(slug, nodes); }
    const header = readRvwnHeader(path);
    const wnLen = header.nodesOffset - header.wayNodesOffset;
    const wnBuf = Buffer.alloc(wnLen);
    const fd = openSync(path, 'r');
    readSync(fd, wnBuf, 0, wnLen, header.wayNodesOffset);
    closeSync(fd);
    const rv = openRvwn(path);
    try {
      for (const w of rv.iterateWays()) {
        if (/motorway/.test(w.highway)) continue;
        const idx = decodeIndexDeltas(wnBuf, w.nodeOff, w.nodeCnt);
        let hit = false;
        const points = [];
        for (const i of idx) {
          const x = nodes.lngs[i], y = nodes.lats[i];
          if (!Number.isFinite(x)) continue;
          const inB = x >= minX && x <= maxX && y >= minY && y <= maxY;
          if (inB) hit = true;
          // 收集盒内点（夹在盒外的连接也保留少量以维持链；这里仅取盒内连续段）
          points.push([x, y]);
        }
        if (!hit || points.length < 2) continue;
        // 裁剪到盒：只保留落在盒内的连续子段
        let cur = [];
        for (const p of points) {
          const inB = p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;
          if (inB) cur.push(p);
          else if (cur.length >= 2) { ways.push({ points: cur }); cur = []; }
          else cur = [];
        }
        if (cur.length >= 2) ways.push({ points: cur });
      }
    } finally {
      rv.close();
    }
  }
  if (!ways.length) return null;
  const small = buildGraph(ways);
  const conn = surfaceConnector(small, gap, { ratio });
  return conn ? conn.nodes.map((n) => small.coords[n]) : null;
}

/** 已绘点网格（平行重复检测），cell 200m */
function makeGrid() {
  const cell = 200;
  const g = new Map();
  const key = (p) =>
    Math.floor((p[0] * 111320 * Math.cos(p[1] * Math.PI / 180)) / cell) + ',' +
    Math.floor((p[1] * 111320) / cell);
  return {
    add(p) {
      const k = key(p);
      let l = g.get(k); if (!l) { l = []; g.set(k, l); }
      l.push(p);
    },
    medianNear(samples) {
      const ds = [];
      for (const s of samples) {
        const [cx, cy] = key(s).split(',').map(Number);
        let best = Infinity;
        for (let dx = -2; dx <= 2; dx += 1) for (let dy = -2; dy <= 2; dy += 1) {
          for (const q of g.get((cx + dx) + ',' + (cy + dy)) ?? []) {
            const d = haversineM(s[0], s[1], q[0], q[1]);
            if (d < best) best = d;
          }
        }
        ds.push(best);
      }
      ds.sort((a, b) => a - b);
      return ds[ds.length >> 1];
    },
  };
}

/**
 * 沿全局顺序切成连通 runs：[{ points, startSeq, endSeq }]
 * 跳过平行重复车道；非有限点剔除。
 */
export function splitIntoRuns(members, providers) {
  const runs = [];
  const grid = makeGrid();
  let cur = [];
  let cursor = null;
  let dupSkipped = 0;
  let missing = 0;

  const pushGeom = (geom, all) => {
    for (let i = all ? 0 : 1; i < geom.length; i += 1) {
      if (!finite(geom[i])) continue;
      cur.push(geom[i]);
      grid.add(geom[i]);
    }
  };
  const closeRun = (endSeq) => {
    if (cur.length >= 2) {
      const pts = cur;
      runs.push({ points: pts, startSeq: runs._seq ?? 0, endSeq, start: pts[0], end: pts[pts.length - 1] });
    }
    cur = [];
  };

  for (const m of members) {
    const geom = providers.geomOf(m.id);
    if (!geom || geom.length < 2) { missing += 1; continue; }
    const a = geom[0], b = geom[geom.length - 1];
    if (cursor === null) {
      pushGeom(geom, true);
      runs._seq = m.seq;
      cursor = b;
      continue;
    }
    const dFwd = finite(a) ? haversineM(cursor[0], cursor[1], a[0], a[1]) : Infinity;
    const dRev = finite(b) ? haversineM(cursor[0], cursor[1], b[0], b[1]) : Infinity;
    if (dFwd <= SNAP_M) { pushGeom(geom, false); cursor = b; }
    else if (dRev <= SNAP_M) { pushGeom([...geom].reverse(), false); cursor = a; }
    else {
      const samples = geom.filter((_, i) => i % Math.max(1, Math.floor(geom.length / 20)) === 0).filter(finite);
      if (samples.length && grid.medianNear(samples) <= DUP_M) { dupSkipped += 1; continue; }
      closeRun(m.seq - 1);
      const reversed = dRev < dFwd;
      const useGeom = reversed ? [...geom].reverse() : geom;
      runs._seq = m.seq;
      pushGeom(useGeom, true);
      cursor = reversed ? a : b;
    }
  }
  closeRun(members[members.length - 1].seq);
  return { runs, dupSkipped, missing };
}

/**
 * 以官方起终点锚定，把 runs 重排成一条单线。
 * 贪心：从离起点最近的 run 起，每步优先选端点拓扑相接（≤SNAP）的 run，
 * 否则选全局 seq 最靠后且朝终点推进的 run，并记录真实缺口。
 */
export function chainRuns(runs, startCoord, endCoord) {
  const remaining = new Set(runs);
  const ordered = [];
  const gaps = [];
  // 起点 run：端点离 startCoord 最近
  let cur = null;
  let bestD = Infinity;
  for (const r of runs) {
    for (const ep of [r.start, r.end]) {
      const d = haversineM(startCoord[0], startCoord[1], ep[0], ep[1]);
      if (d < bestD) { bestD = d; cur = r; }
    }
  }
  // 定向：让离起点最近的端点作为 start
  {
    const ds = haversineM(startCoord[0], startCoord[1], cur.start[0], cur.start[1]);
    const de = haversineM(startCoord[0], startCoord[1], cur.end[0], cur.end[1]);
    if (de < ds) cur = { ...cur, points: [...cur.points].reverse(), start: cur.end, end: cur.start };
  }
  remaining.delete(cur);
  ordered.push(cur);

  while (remaining.size) {
    const cEnd = cur.end;
    let next = null, reversed = false, connectD = Infinity;
    // 1) 拓扑相接
    for (const r of remaining) {
      const ds = haversineM(cEnd[0], cEnd[1], r.start[0], r.start[1]);
      const de = haversineM(cEnd[0], cEnd[1], r.end[0], r.end[1]);
      if (ds < connectD && ds <= SNAP_M) { connectD = ds; next = r; reversed = false; }
      if (de < connectD && de <= SNAP_M) { connectD = de; next = r; reversed = true; }
    }
    if (!next) {
      // 2) seq 兜底：选 startSeq 最小（数组顺序最靠前）的 run；若多个，取朝终点更近者
      let cand = null;
      for (const r of remaining) if (!cand || r.startSeq < cand.startSeq) cand = r;
      next = cand;
      const ds = haversineM(cEnd[0], cEnd[1], next.start[0], next.start[1]);
      const de = haversineM(cEnd[0], cEnd[1], next.end[0], next.end[1]);
      reversed = de < ds;
      const gapFrom = cEnd.slice();
      const gapTo = (reversed ? next.end : next.start).slice();
      gaps.push({
        from: gapFrom,
        to: gapTo,
        gapKm: Math.round((Math.min(ds, de) / 1000) * 100) / 100,
      });
    }
    if (reversed) next = { ...next, points: [...next.points].reverse(), start: next.end, end: next.start };
    remaining.delete(next);
    ordered.push(next);
    cur = next;
  }
  return { ordered, gaps };
}

/** 合并有序 runs 的点（接缝去重） */
export function mergeRuns(ordered) {
  const pts = [];
  for (const r of ordered) {
    for (let i = pts.length ? 1 : 0; i < r.points.length; i += 1) pts.push(r.points[i]);
  }
  return pts;
}

/** 分量到最近控制点的序号 */
function nearestControlIndex(comp, controls) {
  let best = 0, bestD = Infinity;
  const step = Math.max(1, Math.floor(comp.points.length / 40));
  for (let k = 0; k < controls.length; k += 1) {
    for (let i = 0; i < comp.points.length; i += step) {
      const d = haversineM(comp.points[i][0], comp.points[i][1], controls[k].lng, controls[k].lat);
      if (d < bestD) { bestD = d; best = k; }
    }
  }
  return best;
}

/**
 * 控制点约束的最近邻贪心：把拓扑分量排成一条单线（含定向），并返回相邻分量的缺口。
 * 所有分量都属于同一条国道；用控制点序号防止在自交/密路段回跳。
 */
export function orderComponentsByControls(components, controls) {
  const items = components
    .map((c) => ({ points: c.points, ci: nearestControlIndex(c, controls), used: false }))
    .filter((x) => x.points.length >= 2);

  // 定向：让给定端点作为 start
  const orient = (it, useEnd) => {
    if (useEnd) return { ...it, points: [...it.points].reverse(), start: it.points[it.points.length - 1], end: it.points[0] };
    return { ...it, start: it.points[0], end: it.points[it.points.length - 1] };
  };

  // 起点：端点离 controls[0] 最近
  let start = null, sd = Infinity;
  for (const it of items) {
    for (const useEnd of [false, true]) {
      const ep = useEnd ? it.points[it.points.length - 1] : it.points[0];
      const d = haversineM(controls[0].lng, controls[0].lat, ep[0], ep[1]);
      if (d < sd) { sd = d; start = { it, useEnd }; }
    }
  }
  let cur = orient(start.it, start.useEnd);
  start.it.used = true;
  const ordered = [cur];
  const gaps = [];
  let currentCi = cur.ci;

  for (;;) {
    let remaining = items.filter((x) => !x.used);
    if (!remaining.length) break;
    let forward = remaining.filter((x) => x.ci >= currentCi);
    if (!forward.length) forward = remaining;
    let pick = null, useEnd = false, md = Infinity;
    for (const it of forward) {
      const d0 = haversineM(cur.end[0], cur.end[1], it.points[0][0], it.points[0][1]);
      const d1 = haversineM(cur.end[0], cur.end[1], it.points[it.points.length - 1][0], it.points[it.points.length - 1][1]);
      if (d0 < md) { md = d0; pick = it; useEnd = false; }
      if (d1 < md) { md = d1; pick = it; useEnd = true; }
    }
    pick.used = true; // 必须标记原始 item，否则 filter 永远选到它 → 死循环
    const placed = orient(pick, useEnd);
    if (md > SNAP_M) {
      gaps.push({ from: cur.end.slice(), to: (useEnd ? pick.points[pick.points.length - 1] : pick.points[0]).slice(), gapKm: Math.round((md / 1000) * 100) / 100 });
    }
    ordered.push(placed);
    cur = placed;
    currentCi = placed.ci;
  }

  const points = mergeRuns(ordered.map((r) => ({ points: r.points })));
  return { points, gaps, ordered };
}

/** 一站式：装配某国道为单线 + 真实缺口 */
export function assembleLocal(ref, providers, startCoord, endCoord, controls) {
  const members = buildGlobalMembers(ref);
  const waysMap = new Map();
  for (const m of members) {
    if (waysMap.has(m.id)) continue;
    const f = providers.fullOf(m.id);
    if (!f || f.points.length < 2) continue;
    waysMap.set(m.id, {
      id: m.id,
      nodeIds: f.nodeIds,
      lngs: f.points.map((p) => p[0]),
      lats: f.points.map((p) => p[1]),
      points: f.points,
    });
  }
  const ways = [...waysMap.values()];
  const r = assembleComponents(ways, { minComponentM: 20 });
  const graph = buildGraph(r.components);
  const tr = traceThroughControls(graph, controls, r.components);
  return {
    points: tr.points,
    gaps: tr.gaps,
    components: r.components.length,
    dupDropped: r.duplicateDropped,
    drawnKm: tr.drawnKm,
  };
}
