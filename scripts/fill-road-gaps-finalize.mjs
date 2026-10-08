/**
 * 万里路书 · 国道断口补全收尾（scripts/fill-road-gaps-finalize.mjs）
 *
 * 在 fill-road-gaps.mjs 之后运行，统一处理两类遗留：
 *   1) 小缺口国道（PCA 排序后相邻缺口 <8km，未进驾车补全分支）→ 直线缝合；
 *   2) 已补全国道里驾车规划失败的缺口（gapFill.unfilledGaps > 0）→ 恢复原数据后重试，
 *      成功用真实道路，仍失败则直线兜底。
 *
 * 原则：不改变原本数据（原始 points/segments 保留到 gapFill.prev*），只补空缺。
 *
 * 用法：
 *   node scripts/fill-road-gaps-finalize.mjs --amap-key <key> [--qps 3] [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GEOM_DIR = join(ROOT, 'data/roads/geom');
const STATE_DIR = join(ROOT, 'data/roads/gapfill');
const CACHE_FILE = join(STATE_DIR, 'bridge-cache.json');
const LOG_FILE = join(STATE_DIR, 'finalize-run.log');

const args = process.argv.slice(2);
const getArg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const DRY_RUN = args.includes('--dry-run');
const KEY_FILTER = getArg('--key') || null;
const QPS = Number(getArg('--qps') || 3);
const AMAP_KEY = getArg('--amap-key') || process.env.AMAP_WEBSERVICE_KEY || process.env.AMAP_SERVICE_KEY || '';
const STITCH_M = 8000; // ≤8km 直接直线缝合，不调 API

// ── 几何工具 ────────────────────────────────────────────────────────────
const RAD = Math.PI / 180;
function haversineM(lng1, lat1, lng2, lat2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}
function polylineM(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return s;
}
function linearInterp(a, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

// ── GCJ-02 → WGS-84 ────────────────────────────────────────────────────
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;
function _tLat(x, y) {
  let r = -100 + 2 * x - 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return r;
}
function _tLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return r;
}
function _delta(lng, lat) {
  let dLat = _tLat(lng - 105, lat - 35);
  let dLng = _tLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { dLng, dLat };
}
function gcj02ToWgs84(lng, lat) {
  const { dLng, dLat } = _delta(lng, lat);
  const lngWgs = lng - dLng;
  const latWgs = lat - dLat;
  const { dLng: dLng2, dLat: dLat2 } = _delta(lngWgs, latWgs);
  return [lng - dLng2, lat - dLat2];
}

// ── 驾车规划 + 缓存 ─────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function amapDrive(origin, dest) {
  const qs = new URLSearchParams({
    key: AMAP_KEY,
    origin: origin[0] + ',' + origin[1],
    destination: dest[0] + ',' + dest[1],
    strategy: '2',
    show_fields: 'polyline,cost',
  });
  try {
    const r = await fetch('https://restapi.amap.com/v5/direction/driving?' + qs, { signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    if (j.status !== '1' || !j.route?.paths?.length) return null;
    const steps = j.route.paths[0].steps || [];
    const out = [];
    for (const st of steps) {
      if (!st.polyline) continue;
      for (const seg of st.polyline.split(';')) {
        const [ln, la] = seg.split(',');
        const lng = Number(ln);
        const lat = Number(la);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        out.push(gcj02ToWgs84(lng, lat));
      }
    }
    return out.length >= 2 ? out : null;
  } catch {
    return null;
  }
}

let cache = {};
if (existsSync(CACHE_FILE)) {
  try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
}
const bridgeKey = (a, b) => a[0].toFixed(5) + ',' + a[1].toFixed(5) + '>' + b[0].toFixed(5) + ',' + b[1].toFixed(5);
const cacheGet = (a, b) => cache[bridgeKey(a, b)] ?? null;
const cacheSet = (a, b, pts) => {
  cache[bridgeKey(a, b)] = pts;
  if (!DRY_RUN && Object.keys(cache).length % 20 === 0) writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
};

// ── PCA 主轴投影排序 ────────────────────────────────────────────────────
function orderChain(comps) {
  const n = comps.length;
  if (n <= 1) return { chain: n ? [{ ci: 0, rev: false }] : [], leftovers: [] };
  const mids = comps.map((c) => c.pts[Math.floor(c.pts.length / 2)]);
  const lat0 = mids.reduce((s, m) => s + m[1], 0) / n;
  const cosLat = Math.cos(lat0 * RAD);
  const X = mids.map((m) => m[0] * cosLat);
  const Y = mids.map((m) => m[1]);
  const cx = X.reduce((a, b) => a + b, 0) / n;
  const cy = Y.reduce((a, b) => a + b, 0) / n;
  let xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < n; i++) {
    const dx = X[i] - cx, dy = Y[i] - cy;
    xx += dx * dx; yy += dy * dy; xy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const idx = comps.map((_, i) => i);
  idx.sort((a, b) => ((X[a] - cx) * ux + (Y[a] - cy) * uy) - ((X[b] - cx) * ux + (Y[b] - cy) * uy));
  const chain = idx.map((ci) => ({ ci, rev: false }));
  for (let i = 0; i < chain.length - 1; i++) {
    const a = comps[chain[i].ci].pts;
    const b = comps[chain[i + 1].ci].pts;
    const aF = a[a.length - 1], aR = a[0];
    const bF = b[0], bR = b[b.length - 1];
    const dFF = haversineM(aF[0], aF[1], bF[0], bF[1]);
    const dFR = haversineM(aF[0], aF[1], bR[0], bR[1]);
    const dRF = haversineM(aR[0], aR[1], bF[0], bF[1]);
    const dRR = haversineM(aR[0], aR[1], bR[0], bR[1]);
    const best = Math.min(dFF, dFR, dRF, dRR);
    if (best === dRF || best === dRR) chain[i].rev = true;
    if (best === dFR || best === dRR) chain[i + 1].rev = true;
  }
  return { chain, leftovers: [] };
}

// ── 主流程 ──────────────────────────────────────────────────────────────
mkdirSync(STATE_DIR, { recursive: true });
const log = (...x) => {
  const line = new Date().toISOString() + ' ' + x.join(' ');
  console.log(line);
  if (!DRY_RUN) writeFileSync(LOG_FILE, line + '\n', { flag: 'a' });
};

async function main() {
  const files = readdirSync(GEOM_DIR).filter((f) => f.endsWith('.json')).sort();
  let roadsWithWork = 0;
  let stitched = 0;
  let driven = 0;
  let retried = 0;
  let stillFail = 0;
  const t0 = Date.now();

  for (const f of files) {
    const p = join(GEOM_DIR, f);
    let g;
    try { g = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    if (g.class !== 'national') continue;
    if (KEY_FILTER && g.key !== KEY_FILTER) continue;

    // 提取组件：优先用当前 points/segments；若已补全但有失败缺口，恢复原数据重试
    let comps = [];
    const hasUnfilled = g.gapFill && Array.isArray(g.gapFill.unfilledGaps) && g.gapFill.unfilledGaps.length > 0;
    if (hasUnfilled && Array.isArray(g.gapFill.prevPoints)) {
      comps.push({ pts: g.gapFill.prevPoints, orig: 'points' });
      for (const s of g.gapFill.prevSegments || []) if (Array.isArray(s) && s.length >= 2) comps.push({ pts: s, orig: 'segment' });
    } else {
      if (Array.isArray(g.points) && g.points.length >= 2) comps.push({ pts: g.points, orig: 'points' });
      if (Array.isArray(g.segments)) for (const s of g.segments) if (Array.isArray(s) && s.length >= 2) comps.push({ pts: s, orig: 'segment' });
    }
    if (comps.length <= 1) continue;

    const { chain } = orderChain(comps);

    // 逐缺口补全：≤8km 直线缝合，>8km 驾车规划（失败直线兜底）
    const filledBridges = [];
    let roadStitch = 0, roadDrive = 0, roadRetry = 0, roadFail = 0;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1];
      const pa = comps[a.ci].pts, pb = comps[b.ci].pts;
      const ta = a.rev ? pa[0] : pa[pa.length - 1];
      const hb = b.rev ? pb[pb.length - 1] : pb[0];
      const d = haversineM(ta[0], ta[1], hb[0], hb[1]);
      if (d < 20) continue; // <20m 视为已连
      let pts = cacheGet(ta, hb);
      if (!pts) {
        if (d <= STITCH_M) {
          // 小缺口：直线缝合（不调 API）
          const n = Math.max(2, Math.ceil(d / 800));
          pts = linearInterp(ta, hb, n);
          roadStitch++;
        } else {
          if (!DRY_RUN && AMAP_KEY) {
            pts = await amapDrive(ta, hb);
            if (pts) { cacheSet(ta, hb, pts); roadDrive++; }
            else { roadRetry++; pts = linearInterp(ta, hb, Math.max(8, Math.ceil(d / 2000))); roadFail++; }
            await sleep(Math.max(200, Math.floor(1000 / QPS)));
          } else {
            pts = linearInterp(ta, hb, Math.max(8, Math.ceil(d / 2000)));
            roadStitch++;
          }
        }
      } else if (d > STITCH_M) {
        roadDrive++; // 命中缓存
      } else {
        roadStitch++;
      }
      if (pts && pts.length >= 2) filledBridges.push({ from: ta, to: hb, distM: d, chainIdx: i, pts });
    }

    // 拼接主线
    const mainPts = [];
    const filledMap = new Map(filledBridges.map((b, i) => [b.chainIdx, i]));
    for (let i = 0; i < chain.length; i++) {
      const e = chain[i];
      const pts = comps[e.ci].pts;
      if (i > 0) {
        const fb = filledMap.get(i - 1);
        if (fb >= 0 && filledBridges[fb]) {
          for (const q of filledBridges[fb].pts) {
            if (mainPts.length === 0 || haversineM(mainPts[mainPts.length - 1][0], mainPts[mainPts.length - 1][1], q[0], q[1]) > 5) {
              mainPts.push([Math.round(q[0] * 1e5) / 1e5, Math.round(q[1] * 1e5) / 1e5]);
            }
          }
        }
      }
      for (const q of (e.rev ? [...pts].reverse() : pts)) {
        if (mainPts.length === 0 || haversineM(mainPts[mainPts.length - 1][0], mainPts[mainPts.length - 1][1], q[0], q[1]) > 5) {
          mainPts.push([Math.round(q[0] * 1e5) / 1e5, Math.round(q[1] * 1e5) / 1e5]);
        }
      }
    }

    if (!DRY_RUN) {
      const cumKm = [0];
      let acc = 0;
      for (let i = 1; i < mainPts.length; i++) {
        acc += haversineM(mainPts[i - 1][0], mainPts[i - 1][1], mainPts[i][0], mainPts[i][1]);
        cumKm.push(Math.round(acc * 100) / 100);
      }
      const prevPoints = hasUnfilled ? g.gapFill.prevPoints : g.points;
      const prevSegments = hasUnfilled ? g.gapFill.prevSegments : g.segments;
      g.gapFill = {
        provider: 'amap+finalize',
        updatedAt: new Date().toISOString(),
        prevPoints,
        prevSegments,
        prevGapAnnotations: g.gapAnnotations,
        prevTotalKm: g.totalKm,
        filledGaps: filledBridges.map((b) => ({ distKm: Math.round(b.distM / 10) / 100, pts: b.pts.length, via: b.distM <= STITCH_M ? 'line' : 'amap' })),
        unfilledGaps: [],
      };
      g.points = mainPts;
      g.cumKm = cumKm;
      g.segments = [];
      g.gapAnnotations = [];
      g.componentCount = 1;
      g.totalKm = Math.round((polylineM(mainPts) / 1000) * 10) / 10;
      g.method = (g.method || '').replace(/\+gapfill-amap\+finalize/, '') + '+gapfill-amap+finalize';
      writeFileSync(p, JSON.stringify(g), 'utf8');
    }

    if (filledBridges.length) { roadsWithWork++; stitched += roadStitch; driven += roadDrive; retried += roadRetry; stillFail += roadFail; }
  }

  if (!DRY_RUN) writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  log('\n== 收尾完成 ==');
  log('处理有缺口的国道 ' + roadsWithWork + ' 条 · 直线缝合 ' + stitched + ' · 驾车补全 ' + driven + ' · 重试失败降级 ' + retried + ' · 仍失败 ' + stillFail);
  log('耗时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
}

main().catch((e) => { console.error(e); process.exit(1); });