// 从 .rvwn 提取指定国道编号的所有 way，按 OSM 共享 node id 建图 + 找最长拓扑链
//   解决 fill-road-gaps 的 PCA/贪心错配问题
//
// 输出：把最长拓扑链 + 剩余未连接的子链按空间接近拼接，写到 geom
//
import { openRvwn } from './lib/rvwn.mjs';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const KEY = args.includes('--key') ? args[args.indexOf('--key') + 1] : null;
const DRY_RUN = args.includes('--dry-run');

const NET_DIR = 'data/roads/net';
const GEOM_DIR = 'data/roads/geom';
const RAD = Math.PI / 180;
const R = 6371000;

function hav(a, b) {
  const dl = (b[0] - a[0]) * RAD;
  const dt = (b[1] - a[1]) * RAD;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dt / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dl / 2) ** 2));
}
function polylineM(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += hav(pts[i - 1], pts[i]);
  return s;
}

/** 从一个省片提取 ref 含 KEY 的所有 way（返回 way 数组，含节点坐标） */
function extractWaysFromProv(provPath, key) {
  const reader = openRvwn(provPath);
  const ways = [];
  for (const w of reader.iterateWays()) {
    if (w.cls !== 'G') continue;
    // ref 可能是 "G219" / "G219;G315" / "G315;G219" / "G 219"
    const refs = (w.ref || '').split(/[;,]/).map((s) => s.trim().replace(/\s+/g, ''));
    if (!refs.includes(key)) continue;
    const nodes = reader.readWayNodes(w);
    if (!nodes || nodes.lngs.length < 2) continue;
    const pts = [];
    for (let i = 0; i < nodes.lngs.length; i++) pts.push([nodes.lngs[i], nodes.lats[i]]);
    ways.push({ id: w.id, prov: provPath, pts, lenM: w.lenM });
  }
  reader.close();
  return ways;
}

/** 按 OSM node id 做拓扑连通图，找最长拓扑链 */
function buildTopology(ways) {
  // 建立 node id → ways 索引（用 node 的近似坐标作为 key，避免读 id）
  // 实际方案：用节点坐标作为 key（同省片内，OSM node id 共享，坐标也相同）
  // 跨省片共享 node 的概率低，但可以近似用"端点坐标差 < 1m"判定共享
  const EPS = 0.0001; // 约 10m
  const nodeKey = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

  // 每个 way 的端点 keys
  for (const w of ways) {
    w.startKey = nodeKey(w.pts[0]);
    w.endKey = nodeKey(w.pts[w.pts.length - 1]);
    w.startKey2 = `${w.pts[0][0].toFixed(3)},${w.pts[0][1].toFixed(3)}`;
    w.endKey2 = `${w.pts[w.pts.length - 1][0].toFixed(3)},${w.pts[w.pts.length - 1][1].toFixed(3)}`;
  }

  // 用 key2（精度低）做共享节点索引 —— 跨省片也能匹配
  const nodeWays = new Map();
  for (const w of ways) {
    for (const k of [w.startKey2, w.endKey2]) {
      if (!nodeWays.has(k)) nodeWays.set(k, []);
      nodeWays.get(k).push(w);
    }
  }

  // 标记 way 之间是否能连接（共享节点）
  return { ways, nodeWays };
}

/** 找最长拓扑链（DFS + memo） */
function longestChain(startWay, allWays, used, nodeWays) {
  // 从 startWay 开始，找一条最长的链（DFS + memo）
  const memo = new Map();
  function dfs(w, acc) {
    const k = w.id + '|' + used.size;
    if (memo.has(k)) return memo.get(k);
    used.add(w.id);
    const result = { chain: [w], len: w.lenM };
    // 找能从 w.end 连接的下一个 way（w.endKey2 匹配 startKey2）
    const candidates = nodeWays.get(w.endKey2) || [];
    for (const next of candidates) {
      if (used.has(next.id) || next === w) continue;
      const nextStartKey = next.startKey2;
      const wEndKey = w.endKey2;
      if (nextStartKey !== wEndKey) continue;
      const sub = dfs(next, acc + w.lenM);
      if (sub.len + w.lenM > result.len) {
        result.chain = [w, ...sub.chain];
        result.len = w.lenM + sub.len;
      }
    }
    used.delete(w.id);
    memo.set(k, result);
    return result;
  }
  return dfs(startWay, 0);
}

/** 找最大拓扑链：从每个 way 出发试一次 */
function findLongestTopoChain(ways) {
  const { nodeWays } = buildTopology(ways);
  const used = new Set();
  let best = { chain: [], len: 0 };
  for (const w of ways) {
    if (used.has(w.id)) continue;
    const sub = longestChain(w, ways, new Set(), nodeWays);
    if (sub.len > best.len) best = sub;
  }
  return best;
}

// ── 主流程 ─────────────────────────────────────────────────────────────
const files = readdirSync(NET_DIR).filter((f) => f.endsWith('.rvwn'));
const keys = KEY ? [KEY] : readdirSync(GEOM_DIR).filter((f) => /^G\d+\.json$/.test(f) && !f.startsWith('GS')).map((f) => f.replace('.json', ''));

for (const key of keys) {
  // 1. 提取所有 way
  const allWays = [];
  for (const f of files) {
    const ws = extractWaysFromProv(join(NET_DIR, f), key);
    allWays.push(...ws);
  }
  if (allWays.length === 0) { console.log(`${key}: 无 way 数据`); continue; }

  // 2. 找最长拓扑链
  const best = findLongestTopoChain(allWays);
  const chainPts = [];
  for (const w of best.chain) {
    if (chainPts.length === 0) chainPts.push(...w.pts);
    else chainPts.push(...w.pts.slice(1));
  }

  // 3. 拼接未在主链里的 way（按距离排序加入 gaps）
  const usedIds = new Set(best.chain.map((w) => w.id));
  const loose = allWays.filter((w) => !usedIds.has(w.id));

  console.log(`${key}: totalWays=${allWays.length} · mainChain=${best.chain.length} ways · ${(best.len/1000).toFixed(0)}km · loose=${loose.length}`);
  if (best.chain.length <= 5) {
    console.log('  main chain ids:', best.chain.map((w) => w.id));
  }
}
