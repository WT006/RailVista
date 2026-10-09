/**
 * 万里路书 · 国家高速全线贯通构建器（scripts/build-expressway-through.mjs）
 *
 * 与 build-national-through.mjs 同一管线（真实走线、一条单线、拒绝高速大绕行）：
 *   1) gatherWays       关系成员 ∪ 省片 ref 命中 way
 *   2) gatherSurfaceWays 走廊内「非高速」地面 way（补漏标连接）
 *   3) buildGraph + buildTraceStream  控制点 Dijkstra 最短路
 *   4) 残余缺口 fillGap  高德只接受「非高速」地面走线；确实未建 → 诚实保留缺口
 *   5) 简化、算里程，写 data/roads/geom/{ref}.json（class=expressway）
 *
 * 用法：
 *   node scripts/build-expressway-through.mjs G45
 *   node scripts/build-expressway-through.mjs --all
 *   node scripts/build-expressway-through.mjs --todo   （只跑未贯通的）
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  readProvOrder, PROV_TO_SLUG, openProviders, gatherWays, gatherSurfaceWays,
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

function officialKmOf(ref) {
  for (const f of ['expressway.json', 'plan-2022-expressway.json']) {
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
  const provOrder = Array.isArray(ctrl.provOrder) ? ctrl.provOrder : String(ctrl.provOrder || '').split(/[，,]/).filter(Boolean);
  const provSlugs = provOrder.map((p) => PROV_TO_SLUG[p]).filter(Boolean);
  const providers = openProviders(provSlugs);
  const atoms = []; // {pts} | {gap}
  try {
    const realWays = gatherWays(ref, providers);
    const corridorSeed = realWays.slice();
    let si = 0;
    const pushSeed = (lng, lat) => corridorSeed.push({ id: '__ctrl_' + (si++), points: [[lng, lat]] });
    for (let ci = 0; ci < ctrl.controls.length; ci += 1) {
      const a = ctrl.controls[ci];
      pushSeed(a.lng, a.lat);
      if (realWays.length >= 4) continue;
      const b = ctrl.controls[ci + 1];
      if (!b) continue;
      const segM = haversineM(a.lng, a.lat, b.lng, b.lat);
      const stepsN = Math.max(1, Math.floor(segM / 8000));
      for (let t = 1; t < stepsN; t += 1) {
        const f = t / stepsN;
        pushSeed(a.lng + (b.lng - a.lng) * f, a.lat + (b.lat - a.lat) * f);
      }
    }
    const extras = gatherSurfaceWays(corridorSeed, provSlugs, { bandKm: BAND_KM });
    const graph = buildGraph([...realWays, ...extras].map((w) => ({ points: w.points })));
    const stream = buildTraceStream(graph, ctrl.controls);
    for (const el of stream) {
      if (el.nodes) atoms.push({ pts: el.nodes.map((n) => graph.coords[n]) });
      else if (el.gap) {
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

  // 组件缺口「干净单线」合并（与 national 版一致）
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

  const simplified = comps.map((c) => simplifyDP(c, DP_TOL));
  if (!simplified.length) throw new Error('无几何：' + ref);
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
    class: 'expressway',
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
function expresswayRefs() {
  const p = JSON.parse(readFileSync('data/roads/authoritative/expressway.json', 'utf8'));
  return (p.roads ?? p).map((r) => r.ref).filter((r) => /^G\d{1,4}$/.test(r));
}
function todoRefs() {
  const out = [];
  for (const f of readdirSync('data/roads/geom').filter((f) => /^G\d+\.json$/.test(f))) {
    const g = JSON.parse(readFileSync(join('data/roads/geom', f), 'utf8'));
    if (g.class !== 'expressway') continue;
    const done = g.componentCount === 1 && (!g.segments || g.segments.length === 0);
    if (!done) out.push(g.ref ?? f.replace('.json', ''));
  }
  return out;
}
if (arg === '--all') {
  const refs = expresswayRefs();
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
} else if (arg === '--todo') {
  const refs = todoRefs();
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
