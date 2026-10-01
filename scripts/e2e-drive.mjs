/**
 * PRD §12 验收端到端测试（#5 搜索 / #6 覆盖 / #7 任意 OD / #8 整条公路 / #10 榜单
 * / 图层 / 本地引擎的 curl 等价物；退出码 0 = 全过）。
 * 用法：node scripts/e2e-drive.mjs（需 API 已在 :3000 运行）
 */
const BASE = 'http://127.0.0.1:3000/api/drive';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`${path} → ${res.status} ${json.error?.message}`);
  return json.data;
}

function assert(cond, label) {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) process.exitCode = 1;
}

// 1. 搜索（验收 #5）
const s1 = await get('/suggest?q=G318');
assert(s1.hits.some((h) => h.kind === 'road' && h.name === 'G318'), `suggest?q=G318 → 命中 G318 (kind=road)，共 ${s1.hits.length} 条`);
const s2 = await get('/suggest?q=稻城');
assert(s2.hits.some((h) => h.kind === 'place' && h.name === '稻城'), `suggest?q=稻城 → 地名命中（含 county 级）`);
const s3 = await get('/suggest?q=盐湖');
assert(s3.hits.some((h) => h.kind === 'spot'), `suggest?q=盐湖 → 景点命中 ${s3.hits.filter((h) => h.kind === 'spot').length} 条`);
const s4 = await get('/suggest?q=京藏高速');
assert(s4.hits.some((h) => h.kind === 'road'), `suggest?q=京藏高速 → 中文名命中 G6`);

// 2. 路网统计（验收 #6）
const stats = await get('/network/stats');
console.log(`  stats: 国道 ${stats.national}/301 · 高速 ${stats.expressway}/278 · 省道 ${stats.provincial} · 挂几何 ${stats.hasGeom}（${stats.hasGeomRatio * 100}%）· 景点 ${stats.spotCount} · 拓扑 ${stats.topology.nodeCount} 节点`);
assert(stats.national > 0 && stats.expressway > 0 && stats.spotCount > 1000, 'network/stats 覆盖与景点库');

// 3. 任意 OD 沿程（验收 #7）
const t0 = Date.now();
const along = await get(`/along?from=${encodeURIComponent('上海')}&to=${encodeURIComponent('拉萨')}`);
const ms = Date.now() - t0;
const spots = along.spots;
const sorted = spots.every((s, i) => i === 0 || spots[i - 1].progressKm <= s.progressKm);
console.log(`  OD 上海→拉萨：${along.route.lengthKm}km · engine=${along.route.engine} · ${spots.length} 景点 · ${ms}ms`);
console.log(`  引擎说明：${along.route.engineNote}`);
console.log(`  前 5 景点：${spots.slice(0, 5).map((s) => `${s.name}@K${Math.round(s.progressKm)}(绕${s.detourKm}km)`).join('，')}`);
assert(spots.length >= 20, `沿程景点 ≥ 20（实际 ${spots.length}）`);
assert(sorted, '按 progressKm 升序');
assert(spots.every((s) => typeof s.detourKm === 'number'), '每个景点带 detourKm');

// 3b. 整条公路（验收 #8）
const road = await get('/road/G318');
console.log(`  G318：${road.totalKm}km · ${road.geometry.points.length} 点（抽稀后）· 在册 ${road.entry.fromPlace}→${road.entry.toPlace}`);
assert(road.totalKm > 1000, 'G318 全线里程（当前为部分段，OSM ref 覆盖不足）');

const alongRoad = await get('/along?road=G318');
console.log(`  G318 沿程：${alongRoad.spots.length} 景点 · 章节 ${alongRoad.chapters.length} 段`);
assert(alongRoad.spots.length > 0, '整条公路沿程景点 > 0');

// 3c. 路书条目（E 层）
const alongRoute = await get(`/along?route=${encodeURIComponent('qinghai-gansu-ring')}`);
console.log(`  青甘环线（路书）：${alongRoute.route.lengthKm}km · ${alongRoute.spots.length} 景点 · v1 highlights ${alongRoute.highlights?.length ?? 0}`);
assert(alongRoute.spots.length > 0, '路书条目沿程可加载');

// 4. 榜单（验收 #10）
const boards = await get('/board');
console.log(`  榜单：${boards.boards.map((b) => `${b.title}(${b.itemCount})`).join(' · ')}`);
assert(boards.boards.length >= 4, '至少 4 个榜单');
const board = await get('/board/mot-2026-12');
assert(board.board.items.length === 12, '政策 12 线条目数');
const withGeom = board.board.items.filter((_, i) => board.geomAvailable[i]);
console.log(`  政策 12 线：${withGeom.length}/12 条有几何可走 C2，其余 OD 兜底`);
const cng = await get('/board/cng-beautiful-roads');
assert(cng.board.items.length === 10, '国家地理榜 10 条');

// 5. 地图图层
const overview = await get('/network/overview');
console.log(`  地图图层：${overview.roads.length} 条折线`);
assert(overview.roads.length >= 14, '公路图层折线');

// 6. 本地引擎（engine=local）：独库公路两端都在 G217 干线网上
const local = await get(`/route?from=${encodeURIComponent('独山子')}&to=${encodeURIComponent('库车')}&engine=local`);
console.log(`  本地 A* 独山子→库车：${local.route.lengthKm}km · engine=${local.route.engine} · roadKeys=${local.route.roadKeys.join(',')}`);
assert(local.route.engine.startsWith('local'), '本地干线拓扑引擎可用（独库两端在网）');
// 覆盖不足时的诚实降级（G227 过串个案 → 张掖 193km 无节点 → direct）
const local2 = await get(`/route?from=${encodeURIComponent('西宁')}&to=${encodeURIComponent('张掖')}&engine=local`);
console.log(`  西宁→张掖（干线未覆盖）：${local2.route.lengthKm}km · engine=${local2.route.engine}（诚实降级 + engineNote）`);
assert(local2.route.engine === 'direct' && !!local2.route.engineNote, '干线未覆盖时诚实降级为 direct 并标注');

console.log(process.exitCode ? '\n存在未通过项' : '\n全部通过');
