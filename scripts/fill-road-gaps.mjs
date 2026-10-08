/**
 * 万里路书 · 国道断口补全（scripts/fill-road-gaps.mjs）
 *
 * 目标：把 national 国道 geom 中被 OSM 数据真空切成的多段（components）按地理顺序
 *       重新串成一条连贯主线，段间缺口用「国内地图服务驾车路径规划」补出真实沿路折线。
 *
 * 原则（用户明确要求）：
 *   - 不改变原本数据：仅插入桥接折线，原始 points/segments/gapAnnotations 完整保留到
 *     gapFill.prev* 字段，可回滚。
 *   - 只补空缺：只处理 gapKm > GAP_MIN 的断口，已连通/小断口不动。
 *
 * 数据源（双源，优先高德 v5，失败回退天地图）：
 *   - 高德 Web 服务 v5 驾车规划：https://restapi.amap.com/v5/direction/driving
 *       入参 origin/destination 为 GCJ-02，返回 steps[].polyline 为 GCJ-02，需转 WGS-84。
 *   - 天地图驾车规划：http://api.tianditu.gov.cn/drive  （postStr JSON + type=search + tk）
 *       入参/返回为 CGCS2000（国内近似 WGS-84，不转换）。
 *
 * 用法：
 *   node scripts/fill-road-gaps.mjs --dry-run                 # 只统计/排序，不调 API
 *   node scripts/fill-road-gaps.mjs --gap-min 8000            # 补 >8km 断口
 *   node scripts/fill-road-gaps.mjs --key G219                # 单条调试
 *   node scripts/fill-road-gaps.mjs --provider amap --qps 2
 *
 * key 来源（优先级）：--amap-key / --tianditu-tk 参数 > 环境变量 AMAP_WEBSERVICE_KEY /
 *   TIANDITU_TOKEN > config（见 env）。（现有 config.js 的 AMAP_KEY 为 JS API 类型，
 *   Web 服务会返回 10009 USERKEY_PLAT_NOMATCH，需换「Web 服务」key。）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GEOM_DIR = join(ROOT, 'data/roads/geom');
const STATE_DIR = join(ROOT, 'data/roads/gapfill');
const CACHE_FILE = join(STATE_DIR, 'bridge-cache.json');
const LOG_FILE = join(STATE_DIR, 'fill-run.log');

// ── 参数 ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const DRY_RUN = args.includes('--dry-run');
const GAP_MIN_M = Number(getArg('--gap-min') || process.env.ROAD_FILL_GAP_M || 8000);
const KEY_FILTER = getArg('--key') || null;
const PROVIDER = getArg('--provider') || 'amap'; // amap | tianditu
const QPS = Number(getArg('--qps') || 2);
const AMAP_KEY = getArg('--amap-key') || process.env.AMAP_WEBSERVICE_KEY || process.env.AMAP_SERVICE_KEY || '';
const TDT_TOKEN = getArg('--tianditu-tk') || process.env.TIANDITU_TOKEN || '';
const MAX_BRIDGE_KM = Number(getArg('--max-bridge-km') || 2500); // 单桥接上限，超出跳过并记录

// ── 基础几何工具 ────────────────────────────────────────────────────────
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

// ── GCJ-02 → WGS-84（与 packages/shared/geo/coordTransform.ts 同算法） ──
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

// ── 数据源调用 ──────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 高德 v5 驾车规划：返回 WGS-84 折线 [[lng,lat],...]，失败返回 null */
async function amapDrive(origin, dest) {
  const qs = new URLSearchParams({
    key: AMAP_KEY,
    origin: origin[0] + ',' + origin[1],
    destination: dest[0] + ',' + dest[1],
    strategy: '2',
    show_fields: 'polyline,cost',
  });
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
}

/** 天地图驾车规划：返回 WGS-84（CGCS2000 近似）折线，失败返回 null */
async function tiandituDrive(origin, dest) {
  const postStr = JSON.stringify({ orig: origin[0] + ',' + origin[1], dest: dest[0] + ',' + dest[1], style: '0' });
  const qs = new URLSearchParams({ postStr, type: 'search', tk: TDT_TOKEN });
  const r = await fetch('http://api.tianditu.gov.cn/drive?' + qs, { signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  const route = j?.result?.routes?.[0];
  if (!route) return null;
  const out = [];
  for (const st of route.steps || []) {
    const pts = st.lines || st.points || [];
    for (const p of pts) {
      const ln = p.lng ?? p[0];
      const la = p.lat ?? p[1];
      if (Number.isFinite(ln) && Number.isFinite(la)) out.push([ln, la]);
    }
  }
  return out.length >= 2 ? out : null;
}

function drive(origin, dest) {
  if (PROVIDER === 'tianditu') return tiandituDrive(origin, dest);
  return amapDrive(origin, dest);
}

// ── 缓存（断点续传） ─────────────────────────────────────────────────────
let cache = {};
if (existsSync(CACHE_FILE)) {
  try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
}
const bridgeKey = (a, b) =>
  a[0].toFixed(5) + ',' + a[1].toFixed(5) + '>' + b[0].toFixed(5) + ',' + b[1].toFixed(5);
const cacheGet = (a, b) => cache[bridgeKey(a, b)] ?? null;
const cacheSet = (a, b, pts) => {
  cache[bridgeKey(a, b)] = pts;
  if (!DRY_RUN && Object.keys(cache).length % 20 === 0) writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
};

// ── 主轴投影排序（把散段沿国道走向串成一条主线） ─────────────────────
/**
 * 用所有组件中点的 PCA 第一主成分作为「国道走向」主轴，沿轴投影排序，
 * 再对相邻段做端点朝向校正（rev），使其首尾相接。比贪心最近邻在
 * 多省数据真空（散段跳跃）下稳健得多。
 *
 * @param {Array<{pts:[[lng,lat],...]}>} comps 组件折线（首元素为最长主链）
 * @returns {{chain:[{ci:number,rev:boolean}], leftovers:[{ci:number}]}}
 */
function orderChain(comps) {
  const n = comps.length;
  if (n <= 1) return { chain: n ? [{ ci: 0, rev: false }] : [], leftovers: [] };
  // 墨卡托近似等距坐标（经度乘 cos(平均纬度)），避免高纬经度畸变
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
  // 端点朝向校正：相邻段取 4 种朝向中端点距离最小者，据此设 rev
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
  if (!DRY_RUN) {
    if (PROVIDER === 'amap' && !AMAP_KEY) {
      console.error('错误：未提供高德 Web 服务 key（--amap-key 或环境变量 AMAP_WEBSERVICE_KEY）。');
      console.error('提示：现有 config.js 的 AMAP_KEY 为「Web端 JS API」类型，调 Web 服务会返回 10009。');
      process.exit(1);
    }
    if (PROVIDER === 'tianditu' && !TDT_TOKEN) {
      console.error('错误：未提供天地图 token（--tianditu-tk 或环境变量 TIANDITU_TOKEN）。');
      process.exit(1);
    }
  }

  const files = readdirSync(GEOM_DIR).filter((f) => f.endsWith('.json')).sort();
  let totalBridges = 0;
  let filled = 0;
  let skipped = 0;
  let failed = 0;
  let roadsWithFill = 0;
  let roadsDone = 0;
  const t0 = Date.now();
  const pending = []; // 逐条处理，便于断点续传

  for (const f of files) {
    const p = join(GEOM_DIR, f);
    let g;
    try { g = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    if (g.class !== 'national') continue;
    if (KEY_FILTER && g.key !== KEY_FILTER) continue;
    pending.push({ f, key: g.key, g });
  }
  log('共 ' + pending.length + ' 条 national 国道待处理（GAP_MIN=' + (GAP_MIN_M / 1000) + 'km）');

  for (const { f, key, g } of pending) {
    // 提取所有组件折线：points 主链 + segments 其余
    const comps = [];
    if (Array.isArray(g.points) && g.points.length >= 2) comps.push({ pts: g.points, orig: 'points' });
    if (Array.isArray(g.segments)) {
      for (const s of g.segments) {
        if (Array.isArray(s) && s.length >= 2) comps.push({ pts: s, orig: 'segment' });
      }
    }
    if (comps.length <= 1) { roadsDone++; continue; }

    const { chain, leftovers } = orderChain(comps);
    // 计算每对相邻链段的缺口
    const bridges = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1];
      const pa = comps[a.ci].pts, pb = comps[b.ci].pts;
      const ta = a.rev ? pa[0] : pa[pa.length - 1];
      const hb = b.rev ? pb[pb.length - 1] : pb[0];
      const d = haversineM(ta[0], ta[1], hb[0], hb[1]);
      if (d > GAP_MIN_M) bridges.push({ from: ta, to: hb, distM: d, chainIdx: i });
    }

    if (!bridges.length) { roadsDone++; continue; }

    // 逐桥补全（优先缓存）
    const filledBridges = [];
    const unfilled = [];
    for (const br of bridges) {
      if (br.distM / 1000 > MAX_BRIDGE_KM) { skipped++; unfilled.push(br); continue; }
      if (DRY_RUN) { unfilled.push(br); totalBridges++; continue; }
      let pts = cacheGet(br.from, br.to);
      if (!pts) {
        pts = await drive(br.from, br.to);
        if (pts) cacheSet(br.from, br.to, pts);
        await sleep(Math.max(200, Math.floor(1000 / QPS)));
      }
      totalBridges++;
      if (pts) { filledBridges.push({ ...br, pts }); filled++; }
      else { failed++; unfilled.push(br); }
    }

    // 拼接主线：chain 顺序 + 桥接折线
    const mainPts = [];
    const filledMap = new Map(filledBridges.map((b, i) => [b.chainIdx, i]));
    for (let i = 0; i < chain.length; i++) {
      const e = chain[i];
      const pts = comps[e.ci].pts;
      if (i > 0) {
        const fb = filledMap.get(i - 1);
        if (fb >= 0 && filledBridges[fb]) {
          // 桥接折线（起点=上段尾、终点=下段头，去重插入）
          const bp = filledBridges[fb].pts;
          for (const q of bp) {
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
      // 重算 cumKm / totalKm
      const cumKm = [];
      let acc = 0;
      cumKm[0] = 0;
      for (let i = 1; i < mainPts.length; i++) {
        acc += haversineM(mainPts[i - 1][0], mainPts[i - 1][1], mainPts[i][0], mainPts[i][1]);
        cumKm.push(Math.round(acc * 100) / 100);
      }
      const remainingSegments = leftovers.map((l) => comps[l.ci].pts);

      g.gapFill = {
        provider: PROVIDER,
        updatedAt: new Date().toISOString(),
        prevPoints: g.points,
        prevSegments: g.segments,
        prevGapAnnotations: g.gapAnnotations,
        prevTotalKm: g.totalKm,
        filledGaps: filledBridges.map((b) => ({ distKm: Math.round(b.distM / 10) / 100, pts: b.pts.length })),
        unfilledGaps: unfilled.map((b) => ({ distKm: Math.round(b.distM / 10) / 100 })),
      };
      g.points = mainPts;
      g.cumKm = cumKm;
      g.segments = remainingSegments;
      g.gapAnnotations = []; // 主链已贯通，剩余孤岛另算（保留下方简标注）
      g.componentCount = 1 + remainingSegments.length;
      g.totalKm = Math.round((polylineM(mainPts) / 1000) * 10) / 10;
      g.method = (g.method || '') + '+gapfill-' + PROVIDER;
      writeFileSync(join(GEOM_DIR, f), JSON.stringify(g), 'utf8');
    }
    if (filledBridges.length) roadsWithFill++;
    roadsDone++;
    if (roadsDone % 20 === 0) {
      log('… ' + roadsDone + '/' + pending.length + ' 条（桥接 ' + totalBridges + ' 成功 ' + filled + ' 失败 ' + failed + ' 跳过 ' + skipped + '）');
    }
  }

  if (!DRY_RUN) writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  log('\n== 完成 ==');
  log('处理国道 ' + roadsDone + ' 条 · 有补全 ' + roadsWithFill + ' 条 · 桥接 ' + totalBridges + ' · 成功 ' + filled + ' · 失败 ' + failed + ' · 跳过 ' + skipped);
  log('耗时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
}

main().catch((e) => { console.error(e); process.exit(1); });