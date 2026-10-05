/**
 * 万里路书 · 公路几何装配（scripts/build-road-geom.mjs）
 *
 *   data/roads/net/{prov}.rvwn  →  data/roads/geom/{key}.json
 *
 * 与旧管道（scripts/fetch-road-geometry.mjs）的根本区别：
 *   旧：按编号向 Overpass 抓 way，再用"端点最近邻 + 5km 容差"贪心拼链 —— 拼错、丢段、里程虚高。
 *   新：从本地要素库取该编号的全部 way，用 OSM 真实拓扑（共享 node id）求连通分量，
 *       分量内直行优先走链，平行重复（双向分隔道路）只保留一条。
 *       不猜、不拼、不丢：有几段就如实输出几段。
 *
 * 用法：
 *   node scripts/build-road-geom.mjs --all
 *   node scripts/build-road-geom.mjs --class national,expressway
 *   node scripts/build-road-geom.mjs --key G318
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRvwn } from './lib/rvwn.mjs';
import { assembleComponents, computeGaps, simplifyDP, polylineM, haversineM, stitchComponents } from './lib/road-assemble.mjs';
import { classifyRef, buildKey, canonicalRef, keyToFileName, CLASS_CODE } from './lib/road-ref.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NET_DIR = join(ROOT, 'data/roads/net');
const GEOM_DIR = join(ROOT, 'data/roads/geom');
const INDEX_DIR = join(ROOT, 'data/roads/index');
const REPORT_DIR = join(ROOT, 'data/roads/reports');
const PLACES = join(ROOT, 'data/roads/places-geo.json');

const args = process.argv.slice(2);
const getArg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const classFilter = getArg('--class') ? new Set(getArg('--class').split(',')) : null;
const keyFilter = getArg('--key');

/** DP 简化容差（米）：等级越高保留细节越多 */
const DP_TOL = { expressway: 18, national: 22, provincial: 40, county: 55, township: 70, village: 90, other: 120 };

/**
 * 紧公差缝合上限（米）：城区 ref 断档多在 100~500m，取 1.5km 可再吃掉一批；
 * 上限刻意远小于旧实现的 5km —— 那正是 G318 被拼到西藏去的原因。
 */
const STITCH_GAP_M = Number(process.env.ROAD_STITCH_M || 1500);

/** 端点/沿线锚点匹配半径（米） */
const ANCHOR_NEAR_M = 3000;
const ENDPOINT_TRUST_M = 30000;

const SLUG_TO_NAME = {
  anhui: '安徽', beijing: '北京', chongqing: '重庆', fujian: '福建', gansu: '甘肃',
  guangdong: '广东', guangxi: '广西', guizhou: '贵州', hainan: '海南', hebei: '河北',
  heilongjiang: '黑龙江', henan: '河南', hubei: '湖北', hunnan: '湖南', hunan: '湖南',
  inner_mongolia: '内蒙古', jiangsu: '江苏', jiangxi: '江西', jilin: '吉林', liaoning: '辽宁',
  macau: '澳门', ningxia: '宁夏', qinghai: '青海', shaanxi: '陕西', shandong: '山东',
  shanghai: '上海', shanxi: '山西', sichuan: '四川', tianjin: '天津', tibet: '西藏',
  xinjiang: '新疆', yunnan: '云南', zhejiang: '浙江', hong_kong: '香港',
};

// ── 权威名录（官方里程 / 起讫点） ───────────────────────────────────────────
const officialKm = new Map();
const officialEnds = new Map();
for (const f of ['national.json', 'expressway.json', 'provincial.json']) {
  const p = join(ROOT, 'data/roads/authoritative', f);
  if (!existsSync(p)) continue;
  try {
    for (const r of JSON.parse(readFileSync(p, 'utf8')).roads ?? []) {
      const key = r.key ?? (r.province && r.ref ? r.province + ':' + r.ref : r.ref);
      if (r.officialLengthKm > 0) officialKm.set(key, r.officialLengthKm);
      if (r.fromPlace || r.toPlace) officialEnds.set(key, { from: r.fromPlace ?? '', to: r.toPlace ?? '' });
    }
  } catch { /* 单文件损坏不阻塞 */ }
}
// 2022 规划表兜底（更全）
for (const [f, cls] of [['plan-2022-national.json', 'national'], ['plan-2022-expressway.json', 'expressway']]) {
  const p = join(ROOT, 'data/roads/authoritative', f);
  if (!existsSync(p)) continue;
  try {
    for (const r of JSON.parse(readFileSync(p, 'utf8')).roads ?? []) {
      if (!officialEnds.has(r.ref)) officialEnds.set(r.ref, { from: r.fromPlace ?? '', to: r.toPlace ?? '' });
      if (!officialKm.has(r.ref) && r.officialLengthKm > 0) officialKm.set(r.ref, r.officialLengthKm);
    }
  } catch { /* ignore */ }
}

// ── 地名锚点 ────────────────────────────────────────────────────────────────
const places = (() => {
  if (!existsSync(PLACES)) return [];
  const raw = JSON.parse(readFileSync(PLACES, 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.places ?? Object.values(raw));
  return list.filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat));
})();
const PLACE_CELL = 0.25;
const placeGrid = new Map();
for (const p of places) {
  const k = Math.floor(p.lng / PLACE_CELL) + ',' + Math.floor(p.lat / PLACE_CELL);
  let l = placeGrid.get(k);
  if (!l) { l = []; placeGrid.set(k, l); }
  l.push(p);
}
function nearestPlace(lng, lat, maxM) {
  const cx = Math.floor(lng / PLACE_CELL);
  const cy = Math.floor(lat / PLACE_CELL);
  let best = null;
  let bestD = maxM;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (const p of placeGrid.get((cx + dx) + ',' + (cy + dy)) ?? []) {
        const d = haversineM(lng, lat, p.lng, p.lat);
        if (d < bestD) { bestD = d; best = p; }
      }
    }
  }
  return best ? { place: best, distM: bestD } : null;
}

function computeCumKm(points) {
  const cum = new Array(points.length);
  cum[0] = 0;
  let acc = 0;
  for (let i = 1; i < points.length; i += 1) {
    acc += haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    cum[i] = acc;
  }
  return cum;
}

/** 精度分级（§2.2）：A ≤10% · B ≤25% · C ≤50% 或官方里程未知 · X >50% */
function gradePrecision(deviation) {
  if (deviation === null) return 'C';
  if (deviation <= 0.10) return 'A';
  if (deviation <= 0.25) return 'B';
  if (deviation <= 0.50) return 'C';
  return 'X';
}

/** 拆分含 NaN（省外节点）的 way 节点序列 → 若干有效子段 */
function splitValidSegments(ids, lngs, lats) {
  const out = [];
  let cur = null;
  for (let i = 0; i < lngs.length; i += 1) {
    const ok = Number.isFinite(lngs[i]) && Number.isFinite(lats[i]);
    if (ok) {
      if (!cur) { cur = { nodeIds: [], lngs: [], lats: [] }; }
      cur.nodeIds.push(ids[i]);
      cur.lngs.push(lngs[i]);
      cur.lats.push(lats[i]);
    } else if (cur) {
      if (cur.nodeIds.length >= 2) out.push(cur);
      cur = null;
    }
  }
  if (cur && cur.nodeIds.length >= 2) out.push(cur);
  return out;
}

// ── 省片读取器 ──────────────────────────────────────────────────────────────
const shards = existsSync(NET_DIR)
  ? readdirSync(NET_DIR).filter((f) => f.endsWith('.rvwn')).sort()
  : [];
if (!shards.length) {
  console.error('未找到要素库：请先运行 node scripts/build-road-ways.mjs --all');
  process.exit(1);
}
const readers = [];
for (const f of shards) {
  const slug = f.replace('.rvwn', '');
  readers.push({ slug, province: SLUG_TO_NAME[slug] ?? slug, reader: openRvwn(join(NET_DIR, f)) });
}

// ── Phase 1：编号 → way 位置（扫一遍省片，只记编号 way） ────────────────────
const SHARD_SHIFT = 4194304; // 每省 way 数上限 4,194,304
const keyMap = new Map(); // key → { ref, cls, ways: number[], provinces:Set<string> }
for (let pi = 0; pi < readers.length; pi += 1) {
  const { reader, province } = readers[pi];
  for (const w of reader.iterateWays()) {
    if (!w.ref) continue;
    for (const rawRef of w.ref.split(';')) {
      // 读时归一化：要素库按原样存 ref，这里把 "G0111" 收敛成 "G111"（避免重复实体与等级误判）
      const ref = canonicalRef(rawRef);
      const cls = classifyRef(ref);
      if (!cls) continue;
      const key = buildKey(ref, province);
      if (!key) continue;
      let e = keyMap.get(key);
      if (!e) { e = { key, ref, cls, ways: [], provinces: new Set() }; keyMap.set(key, e); }
      e.ways.push(pi * SHARD_SHIFT + w.index);
      e.provinces.add(province);
    }
  }
}
console.log('编号实体 ' + keyMap.size + ' 条（来自 ' + readers.length + ' 个省片）');

// ── Phase 2：逐编号装配 ─────────────────────────────────────────────────────
mkdirSync(GEOM_DIR, { recursive: true });
mkdirSync(REPORT_DIR, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const stats = [];
const byClass = {};
let done = 0;
const t0 = Date.now();

const keys = [...keyMap.keys()]
  .filter((k) => !keyFilter || k === keyFilter)
  .filter((k) => !classFilter || classFilter.has(keyMap.get(k).cls))
  .sort();

for (const key of keys) {
  const entry = keyMap.get(key);
  const tol = DP_TOL[entry.cls] ?? 60;
  const ways = [];
  const byProv = new Map();
  for (const enc of entry.ways) {
    const pi = Math.floor(enc / SHARD_SHIFT);
    const wi = enc % SHARD_SHIFT;
    let l = byProv.get(pi);
    if (!l) { l = []; byProv.set(pi, l); }
    l.push(wi);
  }
  let rawWayCount = 0;
  for (const [pi, idxs] of byProv) {
    const reader = readers[pi].reader;
    for (const wi of idxs) {
      rawWayCount += 1;
      const w = reader.readWay(wi);
      if (!w || w.nodeCnt < 2) continue;
      const g = reader.readWayNodes(w);
      for (const seg of splitValidSegments(g.ids, g.lngs, g.lats)) {
        ways.push({
          id: w.id,
          ref: w.ref,
          name: w.name,
          highway: w.highway,
          cls: w.cls,
          flag: w.flag,
          nodeIds: Float64Array.from(seg.nodeIds),
          lngs: Float64Array.from(seg.lngs),
          lats: Float64Array.from(seg.lats),
        });
      }
    }
  }
  if (!ways.length) continue;

  const assembled = assembleComponents(ways, {});
  if (!assembled.components.length) continue;
  // 紧公差缝合：把同一编号内端点相距 ≤500m 的分量接起来（城区 ref 断档），
  // 只影响"怎么画"，不改里程口径。
  const stitched = stitchComponents(assembled.components, STITCH_GAP_M);
  const components = stitched.components;
  const duplicateDropped = assembled.duplicateDropped;
  const dedupM = assembled.dedupM;

  // 简化 + 重算里程（以实际绘制的折线为准，保证"画出来的长度 = 报出的长度"）
  const simplified = components.map((c) => {
    const pts = simplifyDP(c.points, tol);
    return { pts, lengthM: polylineM(pts), wayCount: c.wayCount, rawLengthM: c.lengthM };
  });
  const drawnM = simplified.reduce((s, c) => s + c.lengthM, 0);
  // 报出的里程用"去重后里程"（平行折返/对向车道只算一遍），
  // 与官方里程比对才有意义；drawnM 是实际画出的折线总长，供排查。
  const totalM = dedupM && dedupM > 0 ? dedupM : drawnM;
  const totalKm = Math.round((totalM / 1000) * 10) / 10;
  const drawnKm = Math.round((drawnM / 1000) * 10) / 10;
  const main = simplified[0];
  const points = main.pts.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
  const cumKm = computeCumKm(points).map((k) => Math.round(k * 100) / 100);
  const segments = simplified.slice(1).map((s) => s.pts.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]));
  const gapAnnotations = computeGaps(components);

  // 端点与沿线锚点命名（只用可信锚点，绝不硬贴官方起讫点）
  const nodes = [];
  const first = points[0];
  const last = points[points.length - 1];
  // 端点标注只在可信时写入（≤30km）；内部途经城市锚点独立收集，不受端点可信度影响
  const nf = nearestPlace(first[0], first[1], ENDPOINT_TRUST_M);
  const nl = nearestPlace(last[0], last[1], ENDPOINT_TRUST_M);
  const endpointsUnverified = !(nf && nl);
  const seenAnchor = new Set();
  if (nf && nl) {
    nodes.push({ name: nf.place.name, atKm: 0, type: 'endpoint' });
    seenAnchor.add(nf.place.name);
  }
  let lastAtKm = -Infinity;
  for (let i = 1; i < points.length && nodes.length < 80; i += 1) {
    if (cumKm[i] < 3000 || cumKm[i] - lastAtKm < 8000) continue;
    const mid = nearestPlace(points[i][0], points[i][1], ANCHOR_NEAR_M);
    if (!mid || seenAnchor.has(mid.place.name) || mid.place.name === nl?.place.name) continue;
    seenAnchor.add(mid.place.name);
    lastAtKm = cumKm[i];
    nodes.push({ name: mid.place.name, atKm: Math.round(cumKm[i] / 10) * 10, type: 'city' });
  }
  if (nf && nl) {
    nodes.push({ name: nl.place.name, atKm: cumKm[cumKm.length - 1], type: 'endpoint' });
  }

  const official = officialKm.get(key) ?? 0;
  const deviation = official > 0 ? (totalKm - official) / official : null;
  const precision = gradePrecision(deviation === null ? null : Math.abs(deviation));
  const ends = officialEnds.get(key) ?? { from: '', to: '' };

  const geom = {
    key,
    ref: entry.ref,
    class: entry.cls,
    points,
    cumKm,
    nodes,
    simplified: true,
    segments,
    gapAnnotations,
    // 新增字段（旧读取端不受影响）
    componentCount: components.length,
    stitchedGaps: stitched.stitchedGaps,
    totalKm,
    drawnKm,
    wayCount: rawWayCount,
    duplicateDropped,
    precision,
    officialKm: official || null,
    lengthDeviation: deviation === null ? null : Math.round(deviation * 1000) / 10,
    endpointsUnverified,
    declaredEnds: ends.from || ends.to ? ends : null,
    provinces: [...entry.provinces],
    assembledAt: new Date().toISOString(),
    source: 'osm-pbf-elements',
    method: 'components+straight-through+stitch500',
  };
  writeFileSync(join(GEOM_DIR, keyToFileName(key)), JSON.stringify(geom), 'utf8');

  done += 1;
  const b = byClass[entry.cls] ?? (byClass[entry.cls] = { keys: 0, km: 0, A: 0, B: 0, C: 0, X: 0, segments: 0, multiComponent: 0, dup: 0 });
  b.keys += 1;
  b.km += totalKm;
  b[precision] += 1;
  b.segments += components.length;
  if (components.length > 1) b.multiComponent += 1;
  b.dup += duplicateDropped;
  stats.push({ key, cls: entry.cls, totalKm, officialKm: official || null, deviationPct: deviation === null ? null : Math.round(deviation * 1000) / 10, precision, componentCount: components.length, wayCount: rawWayCount, points: points.length });

  if (done % 50 === 0) {
    console.log('  … 已装配 ' + done + '/' + keys.length + '（' + ((Date.now() - t0) / 1000).toFixed(0) + 's）');
  }
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
console.log('\n== 装配汇总 ==');
const order = ['expressway', 'national', 'provincial', 'county', 'township', 'village', 'other'];
for (const cls of order) {
  const b = byClass[cls];
  if (!b) continue;
  console.log(
    '  ' + CLASS_CODE[cls] + ' ' + cls.padEnd(11) +
    ' 条数 ' + String(b.keys).padStart(5) +
    ' · 里程 ' + b.km.toFixed(0).padStart(7) + ' km' +
    ' · 精度 A' + String(b.A).padStart(4) + ' B' + String(b.B).padStart(4) + ' C' + String(b.C).padStart(4) + ' X' + String(b.X).padStart(4) +
    ' · 多段 ' + String(b.multiComponent).padStart(5) +
    ' · 去重段 ' + b.dup,
  );
}
const report = { generatedAt: new Date().toISOString(), date, keyCount: stats.length, byClass, items: stats };
writeFileSync(join(REPORT_DIR, 'geometry-' + date + '.json'), JSON.stringify(report, null, 1), 'utf8');
console.log('\n→ data/roads/geom/（' + stats.length + ' 条）· 报告 data/roads/reports/geometry-' + date + '.json');
for (const r of readers) r.reader.close();
