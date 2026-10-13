/**
 * 万里路书 · 国道几何修复（scripts/repair-national.mjs）
 *
 * 针对「已是一条单线，但没画全 / 画到了别处」的国道：
 *   1) 覆盖率 <50%（整条画错，如控制点地理编码错误导致跑到别的省）→ 按官方控制点链整条重画；
 *   2) 其余 → 定向后把缺失的「首端 / 末端」用国道爬行器补到官方起讫控制点；
 *   3) 中间大洞（连续控制点都远离几何）→ 在该处就近断点之间爬行补线。
 *
 * 用法：
 *   node scripts/repair-national.mjs --all          # 按体检结果自动修复
 *   node scripts/repair-national.mjs --refs G639,G333
 *   node scripts/repair-national.mjs --refs G639 --rebuild   # 强制整条重画
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { haversineM, polylineM, simplifyDP } from './lib/road-assemble.mjs';
import { crawlChain } from './lib/road-crawl.mjs';

const GEOM_DIR = join('data', 'roads', 'geom');
const CTRL_DIR = join('data', 'cache', 'amap', 'controls');
const DP_TOL = 22;
const NEAR_KM = Number(process.env.NEAR_KM || 40);
const END_TOL_KM = Number(process.env.END_TOL_KM || 25);
const HOLE_KM = Number(process.env.HOLE_KM || 70);
const HOP_MAX_KM = Number(process.env.HOP_MAX_KM || 250);
const LEG_MAX = Number(process.env.LEG_MAX || 3000);

const round1e5 = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

function loadChain(ref) {
  const p = join(CTRL_DIR, ref + '.json');
  if (!existsSync(p)) return null;
  const c = JSON.parse(readFileSync(p, 'utf8'));
  const pts = (c.controls ?? []).filter((x) => Number.isFinite(x.lng) && Number.isFinite(x.lat)).map((x) => [x.lng, x.lat]);
  return pts.length >= 2 ? pts : null;
}

function distToPolyline(p, pts) {
  let best = Infinity, bi = 0;
  const stride = Math.max(1, Math.floor(pts.length / 4000));
  for (let i = 0; i < pts.length; i += stride) {
    const d = haversineM(p[0], p[1], pts[i][0], pts[i][1]);
    if (d < best) { best = d; bi = i; }
  }
  return { d: best, i: bi };
}

function coverOf(chain, pts) {
  let hit = 0;
  const far = [];
  for (let i = 0; i < chain.length; i += 1) {
    const d = distToPolyline(chain[i], pts).d / 1000;
    if (d <= NEAR_KM) hit += 1; else far.push({ i, d });
  }
  return { pct: hit / chain.length, far };
}

function densify(anchors, pa, pb) {
  const out = [];
  let prev = pa;
  for (const p of anchors.concat([pb])) {
    const d = haversineM(prev[0], prev[1], p[0], p[1]);
    const n = Math.ceil(d / (HOP_MAX_KM * 1000)) - 1;
    for (let k = 1; k <= n; k += 1) {
      const f = k / (n + 1);
      out.push([prev[0] + (p[0] - prev[0]) * f, prev[1] + (p[1] - prev[1]) * f]);
    }
    if (p !== pb) out.push(p);
    prev = p;
  }
  return out;
}

function writeGeom(g, ref, points, extra = {}) {
  const cumM = [0];
  for (let i = 1; i < points.length; i += 1) cumM[i] = cumM[i - 1] + haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  const drawnKm = Math.round((cumM[cumM.length - 1] / 1000) * 10) / 10;
  g.points = points;
  g.cumKm = cumM.map((m) => Math.round((m / 1000) * 100) / 100);
  g.segments = [];
  g.gapAnnotations = [];
  g.componentCount = 1;
  g.totalKm = drawnKm;
  g.drawnKm = drawnKm;
  g.repairedAt = new Date().toISOString();
  Object.assign(g, extra);
  writeFileSync(join(GEOM_DIR, ref + '.json'), JSON.stringify(g), 'utf8');
  return drawnKm;
}

/** 整条按官方控制点链重画 */
async function rebuildFromChain(ref, g, chain, num) {
  const guard = { n: 0, max: LEG_MAX };
  const anchors = densify(chain.slice(1, -1), chain[0], chain[chain.length - 1]);
  const r = await crawlChain(chain[0], chain[chain.length - 1], anchors, num, { legGuard: guard });
  let pts = r.points;
  if (!r.ok && r.restA && r.restB) pts = pts.concat([r.restB]);
  if (pts.length < 2) throw new Error('重画失败：无走线');
  const km = writeGeom(g, ref, simplifyDP(pts, DP_TOL).map(round1e5), {
    straightLinks: r.ok ? [] : [{ from: r.restA, to: r.restB, km: Math.round(haversineM(r.restA[0], r.restA[1], r.restB[0], r.restB[1]) / 1000 * 10) / 10 }],
    method: 'control-chain-crawl',
  });
  return { mode: 'rebuild', km, ok: r.ok };
}

/** 端点补齐 + 中间大洞补线 */
async function patchEnds(ref, g, chain, num) {
  const guard = { n: 0, max: LEG_MAX };
  let pts = g.points.slice();
  // 定向：让 pts[0] 更靠近 chain[0]
  const c0 = chain[0], cN = chain[chain.length - 1];
  const fwd = haversineM(pts[0][0], pts[0][1], c0[0], c0[1]) + haversineM(pts[pts.length - 1][0], pts[pts.length - 1][1], cN[0], cN[1]);
  const rev = haversineM(pts[0][0], pts[0][1], cN[0], cN[1]) + haversineM(pts[pts.length - 1][0], pts[pts.length - 1][1], c0[0], c0[1]);
  if (rev < fwd) pts = pts.slice().reverse();
  const notes = [];
  const straight = [];
  // 找出几何已覆盖到的控制点范围（首/末各取最近命中的下标）
  let firstHit = -1, lastHit = -1;
  for (let i = 0; i < chain.length; i += 1) {
    if (distToPolyline(chain[i], pts).d / 1000 <= NEAR_KM) { if (firstHit < 0) firstHit = i; lastHit = i; }
  }

  // 首端：从官方起点 control[0] 沿（未覆盖的）控制点爬到几何起点
  const d0 = haversineM(pts[0][0], pts[0][1], chain[0][0], chain[0][1]);
  if (d0 > END_TOL_KM * 1000) {
    const head = firstHit > 0 ? chain.slice(1, firstHit + 1) : [];
    const r = await crawlChain(chain[0], pts[0], densify(head, chain[0], pts[0]), num, { legGuard: guard });
    if (r.points.length > 1) {
      const add = r.ok ? r.points : r.points.concat([pts[0]]);
      pts = add.concat(pts.slice(1));
      notes.push('首端补 ' + (polylineM(add) / 1000).toFixed(0) + 'km' + (r.ok ? '' : '(含直连)'));
      if (!r.ok && r.restA) straight.push({ from: r.restA, to: r.restB ?? pts[0], km: Math.round(haversineM(r.restA[0], r.restA[1], (r.restB ?? pts[0])[0], (r.restB ?? pts[0])[1]) / 1000 * 10) / 10 });
    } else {
      // 高德确实无路：直连到官方起点，保证线路抵达官方起讫点
      pts = [chain[0]].concat(pts);
      straight.push({ from: chain[0], to: pts[1], km: Math.round(d0 / 1000 * 10) / 10 });
      notes.push('首端直连 ' + (d0 / 1000).toFixed(0) + 'km');
    }
  }
  // 末端：沿未覆盖的控制点爬到官方终点
  const dN = haversineM(pts[pts.length - 1][0], pts[pts.length - 1][1], chain[chain.length - 1][0], chain[chain.length - 1][1]);
  if (dN > END_TOL_KM * 1000) {
    const tail = lastHit >= 0 ? chain.slice(lastHit + 1, chain.length - 1) : chain.slice(1, chain.length - 1);
    const r = await crawlChain(pts[pts.length - 1], chain[chain.length - 1], densify(tail, pts[pts.length - 1], chain[chain.length - 1]), num, { legGuard: guard });
    if (r.points.length > 1) {
      const add = r.ok ? r.points : r.points.concat([chain[chain.length - 1]]);
      pts = pts.concat(add.slice(1));
      notes.push('末端补 ' + (polylineM(add) / 1000).toFixed(0) + 'km' + (r.ok ? '' : '(含直连)'));
      if (!r.ok && r.restA) straight.push({ from: r.restA, to: r.restB ?? chain[chain.length - 1], km: Math.round(haversineM(r.restA[0], r.restA[1], (r.restB ?? chain[chain.length - 1])[0], (r.restB ?? chain[chain.length - 1])[1]) / 1000 * 10) / 10 });
    } else {
      pts = pts.concat([chain[chain.length - 1]]);
      straight.push({ from: pts[pts.length - 2], to: chain[chain.length - 1], km: Math.round(dN / 1000 * 10) / 10 });
      notes.push('末端直连 ' + (dN / 1000).toFixed(0) + 'km（高德无路/在建）');
    }
  }
  // 中间大洞：连续两个控制点都远离几何 → 在各自最近点之间补线
  const cov = coverOf(chain, pts);
  for (const f of cov.far.slice(0, 6)) {
    if (f.d < HOLE_KM) continue;
    const i = f.i;
    const prevC = chain[i - 1], nextC = chain[i + 1];
    if (!prevC || !nextC) continue;
    const a = distToPolyline(prevC, pts).i, b = distToPolyline(nextC, pts).i;
    if (Math.abs(a - b) < 5) continue;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (hi - lo > pts.length * 0.8) continue;
    const pa = pts[lo], pb = pts[hi];
    if (haversineM(pa[0], pa[1], pb[0], pb[1]) < 3000) continue;
    const r = await crawlChain(pa, pb, densify([chain[i]], pa, pb), num, { legGuard: guard });
    if (r.ok && r.points.length > 2) {
      pts = pts.slice(0, lo).concat(r.points, pts.slice(hi + 1));
      notes.push('中段补(控制点' + (i + 1) + ') ' + (polylineM(r.points) / 1000).toFixed(0) + 'km');
      break; // 一次只补一处，下一轮再评估
    }
  }
  const km = writeGeom(g, ref, simplifyDP(pts, DP_TOL).map(round1e5), { straightLinks: straight });
  return { mode: 'patch', km, notes };
}

async function repairOne(ref, { force = false } = {}) {
  const gp = join(GEOM_DIR, ref + '.json');
  const g = JSON.parse(readFileSync(gp, 'utf8'));
  const chain = loadChain(ref);
  if (!chain) throw new Error('无控制点链');
  const num = ref.slice(1);
  const cov = coverOf(chain, g.points ?? []);
  if (force || cov.pct < 0.5) return rebuildFromChain(ref, g, chain, num);
  return patchEnds(ref, g, chain, num);
}

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const force = args.includes('--rebuild');
let refs = [];
if (args[0] === '--all') {
  // 依据体检口径筛出需要修的：覆盖率不足 或 端点误差过大
  const NEAR = NEAR_KM * 1000;
  refs = readdirSync(GEOM_DIR).filter((f) => /^G\d{3}\.json$/.test(f)).map((f) => f.replace('.json', ''))
    .filter((ref) => {
      const g = JSON.parse(readFileSync(join(GEOM_DIR, ref + '.json'), 'utf8'));
      const ch = loadChain(ref);
      if (!ch || !g.points?.length) return false;
      const cov = coverOf(ch, g.points);
      const s = g.points[0], e = g.points[g.points.length - 1];
      const opt1 = Math.max(haversineM(s[0], s[1], ch[0][0], ch[0][1]), haversineM(e[0], e[1], ch[ch.length - 1][0], ch[ch.length - 1][1]));
      const opt2 = Math.max(haversineM(s[0], s[1], ch[ch.length - 1][0], ch[ch.length - 1][1]), haversineM(e[0], e[1], ch[0][0], ch[0][1]));
      return cov.pct < 0.85 || Math.min(opt1, opt2) > 80000;
    }).sort();
} else {
  const i = args.indexOf('--refs');
  refs = i >= 0 ? (args[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : args.filter((a) => !a.startsWith('--'));
}
console.log('待修复', refs.length, '条', refs.join(','));
let ok = 0;
for (const ref of refs) {
  const t0 = Date.now();
  try {
    const r = await repairOne(ref, { force });
    ok += 1;
    console.log('✓', ref, r.mode, r.km + 'km', (r.notes ?? []).join(' / '), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  } catch (e) { console.log('✗', ref, e.message); }
}
console.log('完成', ok + '/' + refs.length);
