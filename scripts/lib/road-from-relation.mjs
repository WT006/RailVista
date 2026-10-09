/**
 * 万里路书 · 从 route relation 装配「一条干净单线」（scripts/lib/road-from-relation.mjs）
 *
 * 输入 loadRoadRelation 的产物（有序成员 + 几何），输出沿走向排序定向的分量与残余缺口：
 *   1) 用「坐标完全相同 = 同一节点」重建真实拓扑（等价于共享 OSM node）
 *   2) assembleComponents：真实连通分量 + 直行走链 + 平行对向车道去重（不绕、不重）
 *   3) 用关系成员顺序给分量定向、排序（主路走向唯一，不靠距离猜）
 *   4) 相邻分量端点距离 = 残余缺口（数量应很少，交由后续真实补线）
 */
import { assembleComponents } from './road-assemble.mjs';
import { haversineM, polylineM } from './road-assemble.mjs';

const key7 = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);

export function assembleFromRelation(ref, { members, wayGeom, tags }, opts = {}) {
  // member seq by way id（同一 way 可能重复出现，取最小 seq）
  const seqOfWay = new Map();
  for (const m of members) {
    const prev = seqOfWay.get(m.ref);
    if (prev === undefined || m.seq < prev) seqOfWay.set(m.ref, m.seq);
  }

  // 全局坐标 → 节点 id
  const nodeIdByKey = new Map();
  const nodeId = (p) => {
    const k = key7(p);
    let v = nodeIdByKey.get(k);
    if (v === undefined) { v = nodeIdByKey.size; nodeIdByKey.set(k, v); }
    return v;
  };

  const ways = [];
  for (const [id, geom] of wayGeom) {
    if (!geom || geom.length < 2) continue;
    const nodeIds = new Int32Array(geom.length);
    const lngs = new Float64Array(geom.length);
    const lats = new Float64Array(geom.length);
    for (let i = 0; i < geom.length; i += 1) {
      nodeIds[i] = nodeId(geom[i]);
      lngs[i] = geom[i][0];
      lats[i] = geom[i][1];
    }
    ways.push({
      id,
      ref,
      name: '',
      highway: '',
      cls: 'national',
      flag: opts.flagsById?.get(id) ?? 0,
      nodeIds,
      lngs,
      lats,
    });
  }

  const assembled = assembleComponents(ways, { minComponentM: 30 });
  const comps = assembled.components;

  // 每个端点（坐标 key）→ 该处成员 way 的最小 seq
  const endpointSeq = (comp) => {
    const ends = [comp.points[0], comp.points[comp.points.length - 1]];
    return ends.map((end) => {
      let best = Infinity;
      for (const wid of comp.wayIds || []) {
        const geom = wayGeom.get(wid);
        if (!geom) continue;
        if (key7(geom[0]) === key7(end) || key7(geom[geom.length - 1]) === key7(end)) {
          const s = seqOfWay.get(wid);
          if (s < best) best = s;
        }
      }
      return best;
    });
  };

  // 定向 + 排序键
  for (const c of comps) {
    const [s0, s1] = endpointSeq(c);
    c._seq0 = s0; c._seq1 = s1;
    c._orderKey = Number.isFinite(s0) ? s0 : s1;
    if (Number.isFinite(s0) && Number.isFinite(s1) && s1 < s0) {
      c.points = [...c.points].reverse();
      c._seq0 = s1; c._seq1 = s0;
    }
  }
  comps.sort((a, b) => a._orderKey - b._orderKey || b.lengthM - a.lengthM);

  // 残余缺口
  const gaps = [];
  for (let i = 1; i < comps.length; i += 1) {
    const a = comps[i - 1].points[comps[i - 1].points.length - 1];
    const b = comps[i].points[0];
    gaps.push({
      between: [i - 1, i],
      from: a,
      to: b,
      gapKm: Math.round((haversineM(a[0], a[1], b[0], b[1]) / 1000) * 100) / 100,
    });
  }

  const cleanComps = comps.map((c) => {
    const { _seq0, _seq1, _orderKey, ...rest } = c;
    return rest;
  });
  const totalDrawnKm = Math.round((cleanComps.reduce((s, c) => s + c.lengthM, 0) / 1000) * 10) / 10;
  return { ref, tags, components: cleanComps, gaps, totalDrawnKm };
}
