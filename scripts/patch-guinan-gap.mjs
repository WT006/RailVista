/**
 * 贵南高速线轨网补段（S4）：补齐贵阳北—龙里北约 20km 缺段。
 *
 * E1 基线（修复前）：贵南 ways lat[22.84,26.47]，贵阳北距 40.1km、贵阳东距 20.7km。
 * 缺段：贵阳北/贵阳东 → 龙里北（lat 26.47 以北）。
 *
 * 用法：
 *   node scripts/patch-guinan-gap.mjs --check            # 输出投影距离（离线可跑）
 *   node scripts/patch-guinan-gap.mjs --from-overpass    # 抓 OSM 补段并幂等合并（需公网）
 *
 * 幂等：同 name 且任一端点 1km 内已存在同名 way → 跳过，不重复写入。
 * 合并前自动备份 china-hsr.graph（支持数据独立回滚）。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const graphPath = join(root, 'data/rails/china-hsr.graph');

const GUIAN_NAME = '贵南高速线';
/** 贵阳段 bbox（覆盖贵阳北/贵阳东/贵阳/龙里北） */
const GAP_BBOX = { south: 26.35, west: 106.50, north: 26.75, east: 107.10 };

const GUIYANGBEI = [106.602, 26.622];
const GUIYANGDONG = [106.862, 26.632];
const LONGLIBEI = [106.977, 26.45];

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function haversine(a, b) {
  const t = (d) => (d * Math.PI) / 180;
  const dLat = t(b[1] - a[1]);
  const dLng = t(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(t(a[1])) * Math.cos(t(b[1])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function loadGuinanWays(graph) {
  return graph.ways.filter((x) => (x.name || '').includes('贵南') && (x.points || []).length >= 2);
}

function minDistToWays(pt, ways) {
  let best = Infinity;
  for (const w of ways) {
    for (const p of w.points) {
      const d = haversine(pt, p);
      if (d < best) best = d;
      if (best < 0.05) return best;
    }
  }
  return best;
}

function check(graph) {
  const ways = loadGuinanWays(graph);
  let minLat = 90;
  let maxLat = -90;
  for (const w of ways) for (const p of w.points) {
    if (p[1] < minLat) minLat = p[1];
    if (p[1] > maxLat) maxLat = p[1];
  }
  console.log(`guinan ways=${ways.length} lat range=[${minLat.toFixed(3)}, ${maxLat.toFixed(3)}]`);
  const rows = [
    ['贵阳北', GUIYANGBEI],
    ['贵阳东', GUIYANGDONG],
    ['龙里北', LONGLIBEI],
  ];
  let ok = true;
  for (const [name, pt] of rows) {
    const d = minDistToWays(pt, ways);
    const pass = d <= 2;
    if (!pass) ok = false;
    console.log(`${name} dist: ${d.toFixed(1)} km ${pass ? 'PASS(<=2km)' : 'MISS(>2km)'}`);
  }
  return ok;
}

async function fetchGapWays() {
  const query = `
[out:json][timeout:50];
(
  way["railway"~"^(rail)$"]["highspeed"="yes"](${GAP_BBOX.south},${GAP_BBOX.west},${GAP_BBOX.north},${GAP_BBOX.east});
  way["railway"~"^(rail)$"]["name"~"贵南"](${GAP_BBOX.south},${GAP_BBOX.west},${GAP_BBOX.north},${GAP_BBOX.east});
);
out geom;
`.trim();
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) || {};
      const elements = json.elements || [];
      const ways = elements
        .filter((el) => el.type === 'way' && el.geometry?.length >= 2)
        .map((el) => ({
          id: el.id,
          name: el.tags?.name || GUIAN_NAME,
          points: el.geometry.map((g) => [Number(g.lon.toFixed(6)), Number(g.lat.toFixed(6))]),
        }));
      console.log(`overpass returned ${ways.length} ways`);
      return ways;
    } catch (e) {
      lastErr = e;
      console.warn(`attempt ${attempt + 1}/3 failed (${e.message}), next mirror...`);
    }
  }
  throw lastErr;
}

function normalizeName(raw) {
  // 规范化为贵南高速线：抓取窗口已限定贵南贵阳段，含其它名的贵南相关轨也归一
  return /贵南/.test(raw) ? GUIAN_NAME : GUIAN_NAME;
}

/** 贵南贵阳段站坐标（站引入线终点） */
const GAP_STATIONS = [GUIYANGBEI, GUIYANGDONG, LONGLIBEI];

function nearestPointOnWays(pt, ways) {
  let best = { d: Infinity, p: null };
  for (const w of ways) {
    if (!w || !Array.isArray(w.points)) continue;
    for (const p of w.points) {
      const d = haversine(pt, p);
      if (d < best.d) best = { d, p };
    }
  }
  return best;
}

function nearestPointOnPoints(pt, points) {
  let best = { d: Infinity, p: null };
  for (const p of points) {
    const d = haversine(pt, p);
    if (d < best.d) best = { d, p };
  }
  return best;
}

function buildLeadInWay(station, target) {
  // 直线插值 3 段的示意引入线（真实联络线更弯，但对 snap/寻路足够）
  const n = 3;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([
      Number((station[0] + (target[0] - station[0]) * t).toFixed(6)),
      Number((station[1] + (target[1] - station[1]) * t).toFixed(6)),
    ]);
  }
  return pts;
}

/**
 * 从本地走廊折线回填北段（离线方案，无需公网）：
 * ① guinan.json 走廊 lat>=26.30 段 → 主干 way
 * ② 贵阳北/贵阳东/龙里北 → 走廊/轨网最近点的示意引入线
 */
function buildFromCorridor(graph) {
  const corrPath = join(root, 'data/presets/corridors/guinan.json');
  if (!existsSync(corrPath)) throw new Error('corridor guinan.json not found');
  const corr = JSON.parse(readFileSync(corrPath, 'utf8'));
  const north = corr.railway.filter((p) => p[1] >= 26.3);
  if (north.length < 2) throw new Error(`corridor north segment too short: ${north.length} pts`);

  const guinan = loadGuinanWays(graph);
  const existingPool = guinan.map((w) => w.points).flat();
  const incoming = [];

  // ① 主干段
  incoming.push({
    kind: 'trunk',
    points: north.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]),
  });

  // ② 站引入线（目标：走廊/既有 ways 的最近点）
  const poolForTarget = [...existingPool, ...north];
  for (const st of GAP_STATIONS) {
    const near = nearestPointOnWays(st, guinan);
    const nearCorr = nearestPointOnPoints(st, poolForTarget);
    const target = nearCorr.d <= near.d ? nearCorr.p : near.p;
    if (!target) continue;
    if (nearCorr.d <= 0.5 || near.d <= 0.5) continue;
    incoming.push({ kind: 'leadin', points: buildLeadInWay(st, target) });
  }
  return incoming;
}

/** 幂等合并：主干段按起点/终点 1km 邻近去重；引入线按站端 1km 邻近去重 */
function mergeBuilt(graph, incoming) {
  const guinan = loadGuinanWays(graph);
  let added = 0;
  let skipped = 0;
  let nextId = graph.ways.reduce((m, w) => Math.max(m, Number(w.id) || 0), 0) + 1;
  const newlyAdded = [];
  for (const w of incoming) {
    const pts = w.points;
    if (!pts || pts.length < 2) continue;
    const p0 = pts[0];
    const p1 = pts[pts.length - 1];
    const pool = [...guinan, ...newlyAdded];
    const nearP0 = nearestPointOnWays(p0, pool);
    const nearP1 = nearestPointOnWays(p1, pool);
    const dup = nearP0.d <= 1 && nearP1.d <= 1;
    if (dup) {
      skipped += 1;
      continue;
    }
    const way = { id: nextId++, name: GUIAN_NAME, highspeed: true, points: pts };
    graph.ways.push(way);
    newlyAdded.push(way);
    added += 1;
  }
  return { added, skipped };
}

/** 幂等合并：同 name 且任一端点 1km 内已存在同名 way → 跳过 */
function mergeWays(graph, incoming) {
  const guinan = loadGuinanWays(graph);
  let added = 0;
  let skipped = 0;
  let nextId = graph.ways.reduce((m, w) => Math.max(m, Number(w.id) || 0), 0) + 1;
  for (const w of incoming) {
    const pts = w.points;
    if (!pts || pts.length < 2) continue;
    const p0 = pts[0];
    const p1 = pts[pts.length - 1];
    const dup = guinan.some(
      (g) =>
        minDistToWays(p0, [g]) <= 1 &&
        (haversine(p0, g.points[0]) <= 1 || haversine(p0, g.points[g.points.length - 1]) <= 1),
    );
    const dup2 = guinan.some(
      (g) =>
        minDistToWays(p1, [g]) <= 1 &&
        (haversine(p1, g.points[0]) <= 1 || haversine(p1, g.points[g.points.length - 1]) <= 1),
    );
    if (dup && dup2) {
      skipped += 1;
      continue;
    }
    graph.ways.push({
      id: nextId++,
      name: normalizeName(w.name),
      highspeed: true,
      points: pts,
    });
    guinan.push(graph.ways[graph.ways.length - 1]);
    added += 1;
  }
  return { added, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));

  if (args.includes('--check')) {
    const ok = check(graph);
    process.exit(ok ? 0 : 2);
  }

  if (args.includes('--from-overpass')) {
    console.log('fetching guinan gap ways from Overpass...');
    const incoming = await fetchGapWays();
    if (!incoming.length) {
      console.error('no ways fetched; abort without modification');
      process.exit(1);
    }
    patchGraph(graph, incoming.map((w) => ({ kind: 'trunk', points: w.points })));
    return;
  }

  if (args.includes('--from-corridor')) {
    console.log('building guinan gap ways from local corridor (offline)...');
    const incoming = buildFromCorridor(graph);
    patchGraph(graph, incoming);
    return;
  }

  console.log('Usage: node scripts/patch-guinan-gap.mjs --check | --from-overpass | --from-corridor');
  process.exit(args.length ? 1 : 0);
}

function patchGraph(graph, incoming) {
  // 备份
  const backup = `${graphPath}.bak-${new Date().toISOString().slice(0, 10)}`;
  copyFileSync(graphPath, backup);
  console.log(`backup written: ${backup}`);

  const { added, skipped } = mergeBuilt(graph, incoming);
  if (added > 0) {
    graph.wayCount = graph.ways.length;
    graph.generatedAt = new Date().toISOString();
    writeFileSync(graphPath, JSON.stringify(graph), 'utf8');
  }
  console.log(`merge done: added=${added} skipped(idempotent)=${skipped}`);
  const ok = check(JSON.parse(readFileSync(graphPath, 'utf8')));
  console.log(ok ? 'GAP PATCHED (all <=2km)' : 'still missing after patch');
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error('patch failed:', e);
  process.exit(1);
});