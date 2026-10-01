/**
 * 万里路书 · 全国公路旅游网 —— L1 几何抓取（PRD §3 Step 2：OSM ref → 折线）。
 *
 * 用法：
 *   node scripts/fetch-road-geometry.mjs                        # 抓默认旗舰清单（西部风景线）
 *   node scripts/fetch-road-geometry.mjs --ref G318             # 抓单条
 *   node scripts/fetch-road-geometry.mjs --key 青海:S101 --bbox 35.5,98,39,103   # 省道（省内 bbox）
 *
 * 产物：
 *   data/roads/geom/{key}.json   RoadGeometry（points + cumKm + nodes，DP 30m 简化）
 *   data/cache/roads/ways-{ref}.json  Overpass 原始 way 缓存（命中不重复请求）
 *
 * 抓取纪律继承 v1（scripts/lib/overpass.mjs）：UA + 多端点 failover + 磁盘缓存；
 * Overpass geometry 是 {lat,lon} 对象数组，已在 lib 中转 [lng,lat]。
 * 串接：多链贪心 + 5km 容差并链；仍接不上的孤立段记入 orphan（不静默丢弃）。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chainWays,
  computeCumKm,
  fetchWaysForRef,
  haversineKm,
  simplifyDP,
} from './lib/overpass.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEOM_DIR = join(__dirname, '../data/roads/geom');

// 中国大陆 bbox（不含海外争议区，覆盖国道全线）
const CN_BBOX = [18, 73, 54, 135];

/** 默认旗舰清单：榜单与「最美公路」相关度最高的西部风景线优先 + 第二批经典放射/纵横线 */
const FLAGSHIP_REFS = [
  // 第一批：西部风景线（榜单相关）
  'G318', // 沪聂线 · 川藏
  'G109', // 京拉线 · 青藏
  'G315', // 西宁—喀什 · 柴达木/昆仑
  'G217', // 独库公路
  'G227', // 宁张线 · 祁连
  'G312', // 沪霍线 · 丝路
  'G213', // 策克—磨憨 · 九寨/若尔盖
  'G214', // 西宁—澜沧 · 三江并流
  'G317', // 成那线 · 川藏北线
  'G219', // 新藏/沿边
  'G331', // 丹阿线 · 沿边
  'G316', // 福兰线 · 秦岭
  'G320', // 沪瑞线 · 滇缅
  'G212', // 兰州—龙邦 · 甘南
  // 第二批：经典放射线与东中部纵横线
  'G104', // 北京—平潭
  'G105', // 北京—澳门
  'G106', // 北京—广州
  'G107', // 北京—香港
  'G108', // 北京—昆明
  'G110', // 北京—青铜峡
  'G111', // 北京—漠河
  'G204', // 烟台—上海
  'G205', // 山海关—深圳
  'G206', // 烟台—汕头
  'G207', // 锡林浩特—海安
  'G209', // 呼和浩特—北海
  'G210', // 包头—南宁
  'G307', // 黄骅—山丹
  'G309', // 荣成—兰州
  'G314', // 乌鲁木齐—红其拉甫
  'G319', // 厦门—成都
  'G324', // 福州—昆明
  'G326', // 秀山—河口
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { refs: [], key: null, bbox: CN_BBOX };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--ref') out.refs.push(args[i + 1] ?? '');
    else if (args[i] === '--key') out.key = args[i + 1] ?? null;
    else if (args[i] === '--bbox') out.bbox = (args[i + 1] ?? '').split(',').map(Number);
  }
  return out;
}

/**
 * 多链贪心串接：chainWays 断链后，从剩余池继续开新链，再按 5km 容差把
 * 端点相近的链拼到主链（不动点迭代：拼接延长主链后，原先够不着的段可能够着了）。
 * officialKm > 0 时全程受「官方里程 × 1.6」封顶（防多编号共线误匹配越串越远）。
 */
function chainAll(ways, officialKm = 0) {
  const maxKm = officialKm > 0 ? officialKm * 1.6 : 0;
  let pool = ways.slice();
  const chains = [];
  while (pool.length > 0 && chains.length < 400) {
    const { chain, remaining } = chainWays(pool, 800, maxKm);
    if (!chain || chain.length < 2 || remaining.length === pool.length) break;
    chains.push(chain);
    pool = remaining;
  }
  // 按长度排序，主链最长；其余尝试端点并接（≤5km 且不超上限），不动点直到无可拼接
  chains.sort((a, b) => totalKm(b) - totalKm(a));
  let main = chains.shift() ?? [];
  let rest = chains;
  let orphans = 0;
  for (;;) {
    let attached = false;
    const next = [];
    for (const c of rest) {
      if (maxKm > 0 && totalKm(main) + totalKm(c) > maxKm) {
        next.push(c); // 超上限的段不拼（诚实留给 orphan，verify 会标记偏差）
        continue;
      }
      if (tryAttach(main, c)) {
        attached = true;
      } else if (tryAttach(main, c.slice().reverse())) {
        attached = true;
      } else if (tryAttachHead(main, c)) {
        attached = true;
      } else if (tryAttachHead(main, c.slice().reverse())) {
        attached = true;
      } else {
        next.push(c);
      }
    }
    rest = next;
    if (!attached || !rest.length) break;
  }
  orphans = rest.length;
  return { chain: main, orphans };
}

function totalKm(coords) {
  let acc = 0;
  for (let i = 1; i < coords.length; i += 1) acc += haversineKm(coords[i - 1], coords[i]);
  return acc;
}

function tryAttach(main, piece) {
  if (!main.length || piece.length < 2) return false;
  const tail = main[main.length - 1];
  const head = piece[0];
  const d = haversineKm(tail, head);
  if (d > 5) return false;
  // 保留拼接点：splice 段长 = 端点距（≤5km）。丢弃端点会让跳点放大到
  // 「端点距 + 相邻段长」，质检（跳点 >5km 标 broken）会误伤
  main.push(...piece);
  return true;
}

/** 头部拼接：piece 末点贴 main 首点（西部线段只能从头上接回来） */
function tryAttachHead(main, piece) {
  if (!main.length || piece.length < 2) return false;
  const d = haversineKm(piece[piece.length - 1], main[0]);
  if (d > 5) return false;
  main.unshift(...piece);
  return true;
}

async function fetchOne({ key, ref, bbox, fromPlace, toPlace, officialKm = 0 }) {
  console.log(`▶ ${key}（${fromPlace} → ${toPlace}）${officialKm ? ` 官方里程参考 ${officialKm}km` : ''}`);
  const t0 = Date.now();
  const { ways, source } = await fetchWaysForRef(ref, bbox, { timeoutSec: 300 });
  if (ways.length < 3) {
    console.log(`  ✗ 仅 ${ways.length} ways，跳过`);
    return null;
  }
  console.log(`  抓到 ${ways.length} ways（${source}），串接中…`);
  const { chain, orphans } = chainAll(ways, officialKm);
  if (chain.length < 10) {
    console.log(`  ✗ 成链仅 ${chain.length} 点，跳过`);
    return null;
  }
  const simplified = simplifyDP(chain, 30); // PRD Step 2：ε=30m
  const cumKm = computeCumKm(simplified);
  const totalKm = Math.round(cumKm[cumKm.length - 1] * 10) / 10;
  const nodes = [
    { name: fromPlace, atKm: 0, type: 'endpoint' },
    { name: toPlace, atKm: totalKm, type: 'endpoint' },
  ];
  const geom = { key, points: simplified, cumKm: cumKm.map((k) => Math.round(k * 100) / 100), nodes, simplified: true };
  mkdirSync(GEOM_DIR, { recursive: true });
  writeFileSync(join(GEOM_DIR, `${key.replace(/[^\w:]/g, '_')}.json`), JSON.stringify(geom), 'utf8');
  console.log(
    `  ✓ ${totalKm} km · ${simplified.length} 点 · 孤立段 ${orphans} · ${((Date.now() - t0) / 1000).toFixed(0)}s → data/roads/geom/${key}.json`,
  );
  return { key, totalKm, points: simplified.length, orphans };
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
const args = parseArgs();
// 索引取 from/to（写进几何 nodes）；官方里程取权威层（index 的 lengthKm 已被几何回写）
const indexByRef = new Map();
for (const f of ['national.json', 'expressway.json', 'provincial.json']) {
  const p = join(__dirname, '../data/roads/index', f);
  if (!existsSync(p)) continue;
  const idx = JSON.parse(readFileSync(p, 'utf8'));
  for (const r of idx.roads) indexByRef.set(r.key, r);
}
const officialKmByRef = new Map();
for (const f of ['national.json', 'expressway.json']) {
  const p = join(__dirname, '../data/roads/authoritative', f);
  if (!existsSync(p)) continue;
  for (const r of JSON.parse(readFileSync(p, 'utf8')).roads ?? []) {
    officialKmByRef.set(r.ref, r.officialLengthKm ?? 0);
  }
}

const jobs = [];
if (args.key) {
  const entry = indexByRef.get(args.key);
  jobs.push({
    key: args.key,
    ref: args.key.split(':')[1] ?? args.key,
    bbox: args.bbox,
    fromPlace: entry?.fromPlace ?? args.key,
    toPlace: entry?.toPlace ?? args.key,
    officialKm: officialKmByRef.get(args.key) ?? 0,
  });
} else {
  const refs = args.refs.length ? args.refs : FLAGSHIP_REFS;
  for (const ref of refs) {
    const entry = indexByRef.get(ref);
    jobs.push({
      key: ref,
      ref,
      bbox: CN_BBOX,
      fromPlace: entry?.fromPlace ?? ref,
      toPlace: entry?.toPlace ?? ref,
      officialKm: officialKmByRef.get(ref) ?? 0,
    });
  }
}

const results = [];
for (const job of jobs) {
  try {
    const r = await fetchOne(job);
    if (r) results.push(r);
  } catch (e) {
    console.log(`  ✗ ${job.key} 失败：${e.message}`);
  }
}

console.log('\n== 抓取汇总 ==');
for (const r of results) console.log(`${r.key}: ${r.totalKm}km / ${r.points}点 / 孤立段${r.orphans}`);
console.log(`成功 ${results.length}/${jobs.length}。后续：node scripts/build-road-index.mjs --merge 挂回 L0。`);
