/**
 * 万里路书 · 国道全线贯通缝合器（scripts/stitch-national.mjs）
 *
 * 输入：data/roads/geom/{ref}.json（可能含多个断口组件）
 * 输出：同一文件，但写成「一条连续单线」——componentCount=1、segments=[]、gapAnnotations=[]
 *
 * 流程：
 *   1) 取官方控制点链（data/cache/amap/controls/{ref}.json）作为走廊骨架；
 *   2) 以「沿控制点链的投影进度」判定组件行走顺序与朝向（修复旧装配乱序造成的假断口）；
 *   3) 相邻组件之间：取链上位于两者之间的控制点为锚点，用 road-crawl 让高德沿国道爬行补全；
 *   4) 高德确实无路（真在建/未通）→ 直连兜底并记录 straightLinks（保证全线贯通，可追溯）；
 *   5) 全链合并 → DP 简化 → 重算 cumKm / drawnKm / 偏差 / precision。
 *
 * 用法：
 *   node scripts/stitch-national.mjs G219
 *   node scripts/stitch-national.mjs --all        # 仅处理有断口的
 *   node scripts/stitch-national.mjs --refs G331,G228
 *   node scripts/stitch-national.mjs --all --dry  # 只报计划，不写盘
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { haversineM, polylineM, simplifyDP } from './lib/road-assemble.mjs';
import { crawlChain } from './lib/road-crawl.mjs';

const GEOM_DIR = join('data', 'roads', 'geom');
const CTRL_DIR = join('data', 'cache', 'amap', 'controls');
const DP_TOL = 22;
const HOP_MAX_KM = Number(process.env.HOP_MAX_KM || 250); // 真实锚点间超过此距离才插补中间点
const MIN_COMP_KM = 2;          // 小于此长度的碎片段丢弃（多为误抓）
const DROP_FAR_M = Number(process.env.DROP_FAR_KM || 120) * 1000; // 组件离官方走廊超过此距离 → 判为飞地丢弃
const LEG_GUARD_MAX = Number(process.env.LEG_MAX || 2500);

const round1e5 = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

function loadControls(ref) {
  const p = join(CTRL_DIR, ref + '.json');
  if (!existsSync(p)) return null;
  const c = JSON.parse(readFileSync(p, 'utf8'));
  const pts = (c.controls ?? []).filter((x) => Number.isFinite(x.lng) && Number.isFinite(x.lat));
  return pts.length >= 2 ? pts.map((x) => [x.lng, x.lat]) : null;
}

/** 控制点链的累计进度（米） */
function chainProgress(chain) {
  const cum = [0];
  for (let i = 1; i < chain.length; i += 1) {
    cum[i] = cum[i - 1] + haversineM(chain[i - 1][0], chain[i - 1][1], chain[i][0], chain[i][1]);
  }
  return cum;
}

/** 点 p 投影到链：{ prog（沿链累计米）, dist（垂距米） } */
function projectOnChain(chain, cum, p) {
  let best = { prog: 0, dist: Infinity };
  for (let i = 0; i < chain.length - 1; i += 1) {
    const a = chain[i], b = chain[i + 1];
    const dx = (b[0] - a[0]) * 111320 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
    const dy = (b[1] - a[1]) * 111320;
    const ex = (p[0] - a[0]) * 111320 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
    const ey = (p[1] - a[1]) * 111320;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, (ex * dx + ey * dy) / L2)) : 0;
    const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
    const d = haversineM(p[0], p[1], px, py);
    if (d < best.dist) best = { prog: cum[i] + Math.hypot(dx, dy) * t, dist: d };
  }
  return best;
}

/** 贪心最近邻兜底排序（控制点链不可用时） */
function greedyOrder(comps) {
  const used = new Array(comps.length).fill(false);
  let start = 0, bestSpan = -1;
  for (let i = 0; i < comps.length; i += 1) {
    let span = 0;
    for (let j = 0; j < comps.length; j += 1) {
      if (j === i) continue;
      span += haversineM(comps[i][0][0], comps[i][0][1], comps[j][0][0], comps[j][0][1]);
    }
    if (span > bestSpan) { bestSpan = span; start = i; }
  }
  const out = [comps[start].slice()];
  used[start] = true;
  for (let k = 1; k < comps.length; k += 1) {
    const tail = out[out.length - 1].slice(-1)[0];
    let bj = -1, bd = Infinity, flip = false;
    for (let j = 0; j < comps.length; j += 1) {
      if (used[j]) continue;
      const c = comps[j];
      const d1 = haversineM(tail[0], tail[1], c[0][0], c[0][1]);
      const d2 = haversineM(tail[0], tail[1], c.slice(-1)[0][0], c.slice(-1)[0][1]);
      const d = Math.min(d1, d2);
      if (d < bd) { bd = d; bj = j; flip = d2 < d1; }
    }
    if (bj < 0) break;
    used[bj] = true;
    out.push(flip ? comps[bj].slice().reverse() : comps[bj].slice());
  }
  return out;
}

/** 按控制点链排序 + 定向 */
function orderComponents(comps, chain) {
  if (comps.length <= 1) return { ordered: comps.slice(), progs: [], far: 0 };
  const cum = chainProgress(chain);
  const info = comps.map((c) => {
    const a = projectOnChain(chain, cum, c[0]);
    const b = projectOnChain(chain, cum, c[c.length - 1]);
    return { a, b };
  });
  const far = info.filter((x) => Math.min(x.a.dist, x.b.dist) > 200000).length;
  if (far > 0 && far === comps.length) return { ordered: greedyOrder(comps), progs: null, far };
  const idx = comps.map((_, i) => i);
  const key = (i) => Math.min(info[i].a.prog, info[i].b.prog);
  idx.sort((x, y) => key(x) - key(y));
  const ordered = idx.map((i) => (info[i].a.prog > info[i].b.prog ? comps[i].slice().reverse() : comps[i].slice()));
  const progs = idx.map((i) => [Math.min(info[i].a.prog, info[i].b.prog), Math.max(info[i].a.prog, info[i].b.prog)]);
  return { ordered, progs, far };
}

/** 收集链上位于区间内的控制点（真实锚点，端点本身在国道上） */
function realAnchorsBetween(chain, cum, progA, progB, pa, pb) {
  const out = [];
  const lo = Math.min(progA, progB), hi = Math.max(progA, progB);
  if (hi - lo <= 1000) return out;
  for (let i = 0; i < chain.length; i += 1) {
    if (cum[i] > lo + 1500 && cum[i] < hi - 1500) {
      const p = chain[i];
      if (haversineM(p[0], p[1], pa[0], pa[1]) > 2000 && haversineM(p[0], p[1], pb[0], pb[1]) > 2000) out.push(p);
    }
  }
  out.sort((x, y) => projectOnChain(chain, cum, x).prog - projectOnChain(chain, cum, y).prog);
  return out;
}

/** 真实锚点之间若仍有超长跳段，插补中间点（避免高德跨城乱走） */
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
  for (const f of ['national.json', 'plan-2022-national.json']) {
    const p = join('data', 'roads', 'authoritative', f);
    if (!existsSync(p)) continue;
    for (const r of JSON.parse(readFileSync(p, 'utf8')).roads ?? []) {
      if ((r.ref ?? r.key) === ref && r.officialLengthKm > 0) return r.officialLengthKm;
    }
  }
  return 0;
}

export async function stitchOne(ref, { dry = false, verbose = true } = {}) {
  const gp = join(GEOM_DIR, ref + '.json');
  const g = JSON.parse(readFileSync(gp, 'utf8'));
  const num = ref.slice(1);
  let comps = [g.points, ...(g.segments ?? [])].filter((c) => c && c.length >= 2);
  comps = comps.filter((c) => polylineM(c) >= MIN_COMP_KM * 1000 || comps.length === 1);
  if (!comps.length) throw new Error('无几何');

  const chain = loadControls(ref);
  // 丢掉远离官方走廊的「飞地」组件（多因控制点地理编码错误/误抓造成），长度阈值保护主链
  if (chain) {
    const before = comps.length;
    comps = comps.filter((c) => {
      if (polylineM(c) > 300000) return true;
      let dmin = Infinity;
      const cumX = chainProgress(chain);
      for (let k = 0; k < c.length; k += Math.max(1, Math.floor(c.length / 40))) {
        const d = projectOnChain(chain, cumX, c[k]).dist;
        if (d < dmin) dmin = d;
      }
      if (dmin > DROP_FAR_M && before > 1) {
        if (verbose) console.log('   –', ref, '丢弃飞地组件', (polylineM(c) / 1000).toFixed(0) + 'km', '离走廊', (dmin / 1000).toFixed(0) + 'km');
        return false;
      }
      return true;
    });
    if (!comps.length) comps = [g.points];
  }
  const { ordered, progs } = chain ? orderComponents(comps, chain) : { ordered: greedyOrder(comps), progs: null };
  const cum = chain ? chainProgress(chain) : null;

  const straightLinks = [];
  const legGuard = { n: 0, max: LEG_GUARD_MAX };

  if (ordered.length === 1) {
    if (!dry) {
      const pts = simplifyDP(ordered[0], DP_TOL).map(round1e5);
      writeBack(g, ref, pts, [], []);
    }
    return { ref, comps: 1, stitched: 0, straight: 0, drawnKm: Math.round(polylineM(ordered[0]) / 1000 * 10) / 10 };
  }

  let merged = ordered[0].slice();
  let stitched = 0;
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const a = merged[merged.length - 1];
    const b = ordered[i + 1][0];
    const gapM = haversineM(a[0], a[1], b[0], b[1]);
    if (gapM < 300) { merged = merged.concat(ordered[i + 1]); continue; }

    let anchors = [];
    if (chain && progs) {
      const pa = progs[i][1];  // 当前组件末端进度
      const pb = progs[i + 1][0];
      const real = realAnchorsBetween(chain, cum, pa, pb, a, b);
      // 有真实控制点锚点 → 沿锚点链推进（超长跳段再插补）；没有 → 直接整段求解（失败再二分）
      if (real.length) anchors = densify(real, a, b);
    }
    const r = await crawlChain(a, b, anchors, num, { legGuard });
    if (r.ok) {
      merged = merged.concat(r.points.slice(1), ordered[i + 1]);
      stitched += 1;
      if (verbose) console.log('   ✓', ref, '断口' + (i + 1), (gapM / 1000).toFixed(1) + 'km', '→ 真实走线', (polylineM(r.points) / 1000).toFixed(1) + 'km', r.legs + '腿');
    } else {
      // 部分走通：已走出的真实走线照收，只对残余区间直连兜底（把直线段压到最短）
      const ra = r.restA ?? a, rb = r.restB ?? b;
      const restM = haversineM(ra[0], ra[1], rb[0], rb[1]);
      merged = merged.concat(r.points.slice(1));
      if (restM > 300) {
        straightLinks.push({ from: ra, to: rb, km: Math.round(restM / 1000 * 10) / 10 });
      }
      merged = merged.concat(ordered[i + 1]);
      stitched += 1;
      if (verbose) console.log('   ! ', ref, '断口' + (i + 1), (gapM / 1000).toFixed(1) + 'km',
        '→ 走通', (polylineM(r.points) / 1000).toFixed(1) + 'km', '+ 直连', (restM / 1000).toFixed(1) + 'km（高德无路/在建）');
    }
  }

  const simplified = simplifyDP(merged, DP_TOL).map(round1e5);
  if (dry) {
    return { ref, comps: ordered.length, stitched, straight: straightLinks.length, drawnKm: Math.round(polylineM(simplified) / 1000 * 10) / 10, straightLinks };
  }
  writeBack(g, ref, simplified, [], straightLinks);
  return { ref, comps: ordered.length, stitched, straight: straightLinks.length, drawnKm: Math.round(polylineM(simplified) / 1000 * 10) / 10, straightKm: Math.round(straightLinks.reduce((s, x) => s + x.km, 0) * 10) / 10 };
}

function writeBack(g, ref, points, gapAnnotations, straightLinks) {
  const cumM = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumM[i] = cumM[i - 1] + haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  const cumKm = cumM.map((m) => Math.round((m / 1000) * 100) / 100);
  const drawnKm = Math.round((cumM[cumM.length - 1] / 1000) * 10) / 10;
  const official = officialKmOf(ref);
  const deviation = official > 0 ? (drawnKm - official) / official : null;
  g.points = points;
  g.cumKm = cumKm;
  g.segments = [];
  g.gapAnnotations = gapAnnotations;
  g.componentCount = 1;
  g.stitchedGaps = straightLinks.map((x) => ({ km: x.km, from: x.from, to: x.to }));
  g.straightLinks = straightLinks;
  g.totalKm = drawnKm;
  g.drawnKm = drawnKm;
  g.officialKm = official || null;
  g.lengthDeviation = deviation === null ? null : Math.round(deviation * 1000) / 10;
  g.precision = gradePrecision(deviation);
  g.throughStitchedAt = new Date().toISOString();
  g.method = (g.method ? g.method + '+' : '') + 'crawl-on-national';
  writeFileSync(join(GEOM_DIR, ref + '.json'), JSON.stringify(g), 'utf8');
}

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dry = args.includes('--dry');

function targetsWithGaps() {
  return readdirSync(GEOM_DIR).filter((f) => /^G\d{3}\.json$/.test(f)).map((f) => f.replace('.json', ''))
    .filter((ref) => {
      const g = JSON.parse(readFileSync(join(GEOM_DIR, ref + '.json'), 'utf8'));
      return (g.segments ?? []).length > 0 || (g.gapAnnotations ?? []).length > 0;
    }).sort();
}

if (args[0] === '--all' || args[0] === '--refs') {
  let refs;
  if (args[0] === '--all') refs = targetsWithGaps();
  else refs = (args[1] ?? '').split(',').map((s) => s.trim()).filter((r) => /^G\d{3}$/.test(r));
  console.log('待处理', refs.length, '条：', refs.join(','));
  const res = [];
  for (const ref of refs) {
    const t0 = Date.now();
    try {
      const r = await stitchOne(ref, { dry });
      res.push(r);
      console.log('✓', ref, '组件', r.comps, '缝合', r.stitched, '直连', r.straight, r.drawnKm + 'km', ((Date.now() - t0) / 1000).toFixed(0) + 's');
    } catch (e) {
      console.log('✗', ref, e.message);
    }
  }
  const bad = res.filter((r) => r.straight > 0);
  console.log('\n完成', res.length + '/' + refs.length, '| 含直连兜底', bad.length, bad.map((b) => b.ref + '(' + b.straight + ')').join(' '));
} else if (args[0]) {
  const r = await stitchOne(args[0].toUpperCase(), { dry });
  console.log('✓', JSON.stringify(r));
}
