/**
 * 万里路书 · 普通国道全线贯通构建器（scripts/build-national-through.mjs）
 *
 * 数据管线（只补空缺、不改原正确数据；真实走线、一条单线）：
 *   1) gatherWays       关系成员 ∪ 省片 ref 命中 way（真实国道几何 + 无名连接）
 *   2) gatherSurfaceWays 以现有几何为走廊种子，纳入带宽内「非高速」地面 way（补 OSM 漏标）
 *   3) buildGraph + buildTraceStream  控制点 Dijkstra 最短路（真实、一条线、不绕路）
 *   4) 残余缺口 fillGap  高德只接受「非高速」地面走线；高速大绕行/确实未建 → 诚实保留缺口
 *   5) 按真实缺口切分组件，DP 简化、算里程，写 data/roads/geom/{ref}.json
 *
 * 用法：
 *   node scripts/build-national-through.mjs G219
 *   node scripts/build-national-through.mjs --all
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  readProvOrder, PROV_TO_SLUG, openProviders, gatherWays, gatherSurfaceWays, buildGlobalMembers,
} from './lib/road-build.mjs';
import { buildGraph, buildTraceStream } from './lib/road-trace.mjs';
import { haversineM, simplifyDP, polylineM } from './lib/road-assemble.mjs';
import { fillGap, evaluateLeg } from './lib/road-fill.mjs';
import { drivingLeg } from './lib/amap.mjs';

const BAND_KM = Number(process.env.BAND_KM || 40);
const DP_TOL = 22;

function computeCumKm(points) {
  const cum = new Array(points.length); cum[0] = 0; let acc = 0;
  for (let i = 1; i < points.length; i += 1) {
    acc += haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    cum[i] = acc;
  }
  return cum;
}

// 非对称精度分级：少画（负偏差）>50% 才是 X（真未覆盖，必修）；
// 多画（正偏差，多为 2022 规划延长 / 旧里程参考过时）封顶 C，不当作缺陷。
function gradePrecision(deviation) {
  if (deviation === null) return 'C';
  const a = Math.abs(deviation);
  if (deviation < 0) {
    if (a <= 0.10) return 'A';
    if (a <= 0.25) return 'B';
    if (a <= 0.50) return 'C';
    return 'X';
  }
  if (a <= 0.10) return 'A';
  if (a <= 0.25) return 'B';
  return 'C';
}

// 官方里程
function officialKmOf(ref) {
  for (const f of ['national.json', 'plan-2022-national.json']) {
    const p = join('data', 'roads', 'authoritative', f);
    if (!existsSync(p)) continue;
    for (const r of JSON.parse(readFileSync(p, 'utf8')).roads ?? []) {
      if ((r.ref ?? r.key) === ref && r.officialLengthKm > 0) return r.officialLengthKm;
    }
  }
  return 0;
}

const round1e5 = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

export async function buildOne(ref) {
  const ctrl = readProvOrder(ref);
  if (!ctrl) throw new Error('缺控制点省序：' + ref);
  const provSlugs = ctrl.provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);
  const providers = openProviders(provSlugs);
  const atoms = []; // {pts} | {gap}
  try {
    const realWays = gatherWays(ref, providers);               // 本编号/关系真实 way
    // 走廊种子：真实 way + 全部控制点（保证带宽覆盖每个控制点）；
    // 稀疏/真空（新规划 6/7 字头、口岸支线，<4 way）再沿控制点走向每 ~8km 插值，让带宽覆盖整条规划走向
    const corridorSeed = realWays.slice();
    let si = 0;
    const pushSeed = (lng, lat) => corridorSeed.push({ id: '__ctrl_' + (si++), points: [[lng, lat]] });
    for (let ci = 0; ci < ctrl.controls.length; ci += 1) {
      const a = ctrl.controls[ci];
      pushSeed(a.lng, a.lat);
      if (realWays.length >= 4) continue;   // 覆盖良好：只补控制点，不插值
      const b = ctrl.controls[ci + 1];
      if (!b) continue;
      const segM = haversineM(a.lng, a.lat, b.lng, b.lat);
      const stepsN = Math.max(1, Math.floor(segM / 8000));
      for (let t = 1; t < stepsN; t += 1) {
        const f = t / stepsN;
        pushSeed(a.lng + (b.lng - a.lng) * f, a.lat + (b.lat - a.lat) * f);
      }
    }
    const mw = []; // 走廊内高速 way（真实共线借道，入图加惩罚）
    const extras = gatherSurfaceWays(corridorSeed, provSlugs, { bandKm: BAND_KM, motorwayOut: mw }); // 走廊非高速地面 way
    // 图只用真实 way + 地面 extras + 惩罚高速（不喂孤立控制点，避免控制点吸到无连接的孤点）
    // 高速惩罚 ×3：只有地面路断头/绕行>3倍时才借道共线高速（国道与高速共线段是中国真实路况）
    const graph = buildGraph([
      ...realWays.map((w) => ({ points: w.points })),
      ...extras.map((w) => ({ points: w.points })),
      ...mw.map((w) => ({ points: w.points, penalty: Number(process.env.MOTORWAY_PENALTY || 3) })),
    ]);
    const stream = buildTraceStream(graph, ctrl.controls);
    for (const el of stream) {
      if (el.nodes) atoms.push({ pts: el.nodes.map((n) => graph.coords[n]) });
      else if (el.gap) {
        // 残余缺口：高德只补「非高速」真实地面线；高速大绕行/确实未建 → 诚实保留
        const r = await fillGap(el.gap, { ref });
        for (const rn of r.runs) atoms.push(rn);
      }
    }
  } finally {
    providers.close();
  }

  // 按 gap 切分组件
  const comps = [];
  const gapAnnotations = [];
  let cur = [];
  let cumM = 0;
  const flush = () => {
    if (cur.length >= 2) { comps.push(cur); cumM += polylineM(cur); }
    cur = [];
  };
  for (const a of atoms) {
    if (a.pts) {
      for (const p of a.pts) {
        const last = cur[cur.length - 1];
        if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
        cur.push(p);
      }
    } else if (a.gap) {
      const before = comps.length;
      flush();
      gapAnnotations.push({
        atKm: Math.round((cumM / 1000) * 100) / 100,
        gapKm: a.gap.km,
        fromSeg: before - 1,
        toSeg: before,
        status: a.gap.km > 200 ? 'suspect' : 'normal',
      });
    }
  }
  flush();

  // 组件缺口「干净单线」合并：trace 的缺口边界节点可能紧贴高速入口，导致逐段补线被迫反复上高速；
  // 这里直接在相邻组件的真实端点间规划，只要整条 leg 通过 evaluateLeg（地面、绕行/横向/高速达标），
  // 就用该真实走线把两组件合并为一条，杜绝绕路与重复线。
  async function cleanLeg(a, b) {
    try { return await drivingLeg(a, b); }
    catch (e) {
      if (/无路径|20011|INSUFFICIENT_ABROAD/.test(e.message || '')) return null;
      throw e;
    }
  }
  let merging = true;
  while (merging && comps.length > 1) {
    merging = false;
    for (let i = 0; i < comps.length - 1; i += 1) {
      const a = comps[i][comps[i].length - 1];
      const b = comps[i + 1][0];
      const leg = await cleanLeg(a, b);
      if (!leg) continue;
      if (!evaluateLeg(leg, a, b).accept) continue;
      const mid = leg.steps.flatMap((s) => s.points);
      comps[i] = comps[i].concat(mid, comps[i + 1]);
      comps.splice(i + 1, 1);
      merging = true;
      break;
    }
  }
  // 合并后按有序组件重建缺口标注（atKm 沿真实走线累计）
  gapAnnotations.length = 0;
  let runKm = 0;
  for (let i = 0; i < comps.length - 1; i += 1) {
    runKm += polylineM(comps[i]);
    const gapM = haversineM(comps[i][comps[i].length - 1][0], comps[i][comps[i].length - 1][1],
      comps[i + 1][0][0], comps[i + 1][0][1]);
    gapAnnotations.push({
      atKm: Math.round((runKm / 1000) * 100) / 100,
      gapKm: Math.round((gapM / 1000) * 100) / 100,
      fromSeg: i, toSeg: i + 1,
      status: gapM / 1000 > 200 ? 'suspect' : 'normal',
    });
  }

  // 简化（comps 为走线顺序）
  const simplified = comps.map((c) => simplifyDP(c, DP_TOL));
  if (!simplified.length) throw new Error('无几何：' + ref);
  // 与 build-road-geom 一致：最长组件为主链 points（assembleComponents 按长度降序），其余进 segments
  const lengths = simplified.map((c) => polylineM(c));
  let mainIdx = 0;
  for (let i = 1; i < lengths.length; i += 1) if (lengths[i] > lengths[mainIdx]) mainIdx = i;
  const points = simplified[mainIdx].map(round1e5);
  const segments = simplified
    .map((c, i) => (i === mainIdx ? null : c.map(round1e5)))
    .filter(Boolean);
  const cumKm = computeCumKm(points).map((k) => Math.round(k * 100) / 100);
  const drawnKm = Math.round((lengths.reduce((s, L) => s + L, 0) / 1000) * 10) / 10;
  const official = officialKmOf(ref);
  const deviation = official > 0 ? (drawnKm - official) / official : null;
  const precision = gradePrecision(deviation);

  const geom = {
    key: ref,
    ref,
    class: 'national',
    points,
    cumKm,
    nodes: [],
    simplified: true,
    segments,
    gapAnnotations,
    componentCount: simplified.length,
    stitchedGaps: [],
    totalKm: drawnKm,
    drawnKm,
    wayCount: 0,
    duplicateDropped: 0,
    precision,
    officialKm: official || null,
    lengthDeviation: deviation === null ? null : Math.round(deviation * 1000) / 10,
    endpointsUnverified: false,
    declaredEnds: null,
    provinces: ctrl.provOrder,
    assembledAt: new Date().toISOString(),
    source: 'osm-pbf-elements+amap-surface',
    method: 'surface-corridor+dijkstra-through-controls',
    gapFill: { at: new Date().toISOString(), bandKm: BAND_KM, note: 'full-through build (surface only, expressway rejected)' },
  };
  mkdirSync('data/roads/geom', { recursive: true });
  writeFileSync(join('data/roads/geom', ref + '.json'), JSON.stringify(geom), 'utf8');
  return { ref, points: points.length, segments: segments.length, gaps: gapAnnotations.length, drawnKm, precision, official };
}

// CLI
const arg = process.argv[2];
if (arg === '--all') {
  const national = JSON.parse(readFileSync('data/roads/index/national.json', 'utf8'));
  const refs = (national.roads ?? national).map((r) => r.ref ?? r).filter((r) => /^G\d{3}$/.test(r));
  let ok = 0; const failures = [];
  const CONC = Number(process.env.BUILD_CONC || 2);
  let qi = 0;
  async function worker() {
    for (;;) {
      const i = qi; qi += 1; if (i >= refs.length) return;
      const ref = refs[i];
      try { const r = await buildOne(ref); ok += 1; console.log('✓', ref, '点', r.points, '段', r.segments, '缺口', r.gaps, r.drawnKm + 'km', r.precision); }
      catch (e) { failures.push(ref); console.log('✗', ref, e.message); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('完成', ok + '/' + refs.length, failures.length ? '| 失败 ' + failures.join(',') : '');
} else if (arg) {
  const r = await buildOne(arg);
  console.log('✓', JSON.stringify(r));
}
