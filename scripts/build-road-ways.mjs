/**
 * 万里路书 · 全等级路网要素库构建（scripts/build-road-ways.mjs）
 *
 *   data/cache/osm/{prov}-latest.osm.pbf  →  data/roads/net/{prov}.rvwn
 *
 * 这是"所有道路精准化落地"的地基：一次把全省可通行道路（含无编号的乡道村道）
 * 落成二进制要素库，后续几何装配 / 拓扑 / 瓦片全部从它派生，零网络请求。
 *
 * 两遍扫描（内存可控）：
 *   Pass A 只解析 ways（命中 highway 白名单）→ way 记录 + 节点 id 临时文件
 *   Pass B 只解析 nodes，与"所需节点 id 有序表"归并 → 节点坐标池
 *
 * 用法：
 *   node scripts/build-road-ways.mjs --all
 *   node scripts/build-road-ways.mjs --prov hainan
 *   node scripts/build-road-ways.mjs --all --no-track     # 不含机耕道
 */
import {
  openSync, closeSync, readSync, writeSync, readdirSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanWays, scanNodes } from './lib/osm-pbf.mjs';
import { normalizeRefs, classifyRef, isRoadHighway, CLASS_CODE } from './lib/road-ref.mjs';
import {
  HEADER_SIZE, WAY_RECORD_SIZE, NODE_RECORD_SIZE,
  encodeStringPool, encodeIndexDeltas, writeRvwnHeader, writeNodeRecord,
  FLAG_ONEWAY, FLAG_BRIDGE, FLAG_TUNNEL, FLAG_TOLL, CLS_CODE,
} from './lib/rvwn.mjs';
import { PROVINCE_BBOXES } from './lib/province-bbox.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PBF_DIR = join(ROOT, 'data/cache/osm');
const NET_DIR = join(ROOT, 'data/roads/net');
const TMP_DIR = join(ROOT, 'data/cache/road-tmp');

const args = process.argv.slice(2);
const all = args.includes('--all');
const provArg = args.includes('--prov') ? args[args.indexOf('--prov') + 1] : null;
const OPTS = {
  withTrack: !args.includes('--no-track'),
  withService: !args.includes('--no-service'),
};

/** PBF 文件名（英文 slug）→ 省名 / 省代码 */
const SLUG_TO_NAME = {
  anhui: '安徽', beijing: '北京', chongqing: '重庆', fujian: '福建', gansu: '甘肃',
  guangdong: '广东', guangxi: '广西', guizhou: '贵州', hainan: '海南', hebei: '河北',
  heilongjiang: '黑龙江', henan: '河南', hubei: '湖北', hunan: '湖南', inner_mongolia: '内蒙古',
  jiangsu: '江苏', jiangxi: '江西', jilin: '吉林', liaoning: '辽宁', macau: '澳门',
  ningxia: '宁夏', qinghai: '青海', shaanxi: '陕西', shandong: '山东', shanghai: '上海',
  shanxi: '山西', sichuan: '四川', tianjin: '天津', tibet: '西藏', xinjiang: '新疆',
  yunnan: '云南', zhejiang: '浙江', hong_kong: '香港',
};

const provCodeOf = (() => {
  const m = new Map();
  PROVINCE_BBOXES.forEach((p, i) => m.set(p.name, i + 1));
  return (name) => m.get(name) ?? 99;
})();

const CLASS_RANK = { expressway: 6, national: 5, provincial: 4, county: 3, township: 2, village: 1, other: 0 };

function listTargets() {
  if (!existsSync(PBF_DIR)) return [];
  return readdirSync(PBF_DIR)
    .filter((f) => f.endsWith('.osm.pbf'))
    .map((f) => f.replace('-latest.osm.pbf', ''))
    .filter((s) => (provArg ? s === provArg : all || true))
    .sort();
}

async function buildProvince(slug) {
  const pbf = join(PBF_DIR, slug + '-latest.osm.pbf');
  const outFile = join(NET_DIR, slug + '.rvwn');
  const tmpFile = join(TMP_DIR, slug + '.waynodes.f64');
  const provName = SLUG_TO_NAME[slug] ?? slug;
  const t0 = Date.now();

  mkdirSync(NET_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  // ── Pass A：ways ─────────────────────────────────────────────────────────
  const strings = [''];                       // 0 号恒为空串
  const strMap = new Map([['', 0]]);
  const intern = (s) => {
    if (!s) return 0;
    let id = strMap.get(s);
    if (id === undefined) {
      id = strings.length;
      strings.push(s);
      strMap.set(s, id);
    }
    return id;
  };

  const wayId = [];
  const refI = [];
  const nameI = [];
  const hwI = [];
  const clsA = [];
  const flagA = [];
  const cntA = [];
  let nodeRefTotal = 0;

  const fdTmp = openSync(tmpFile, 'w');
  let wBuf = Buffer.allocUnsafe(1 << 20);
  let wPos = 0;
  const flushTmp = () => {
    if (wPos > 0) {
      writeSync(fdTmp, wBuf, 0, wPos);
      wPos = 0;
    }
  };
  const pushRawId = (id) => {
    if (wPos + 8 > wBuf.length) flushTmp();
    wBuf.writeDoubleLE(id, wPos);
    wPos += 8;
  };

  const wayCount = await scanWays(pbf, (w) => {
    const hw = w.tags.highway;
    if (!isRoadHighway(hw, OPTS)) return;
    if (!w.refs || w.refs.length < 2) return;
    const refs = normalizeRefs(w.tags.ref);
    let cls = null;
    for (const r of refs) {
      const c = classifyRef(r);
      if (c && (!cls || CLASS_RANK[c] > CLASS_RANK[cls])) cls = c;
    }
    if (!cls) cls = 'other';
    let flag = 0;
    const ow = w.tags.oneway;
    if (ow === 'yes' || ow === '1' || ow === 'true' || ow === '-1' || ow === 'reverse') flag |= FLAG_ONEWAY;
    if (w.tags.bridge && w.tags.bridge !== 'no') flag |= FLAG_BRIDGE;
    if (w.tags.tunnel && w.tags.tunnel !== 'no') flag |= FLAG_TUNNEL;
    if (w.tags.toll === 'yes') flag |= FLAG_TOLL;

    wayId.push(w.id);
    refI.push(intern(refs.join(';')));
    nameI.push(intern(w.tags.name));
    hwI.push(intern(hw));
    clsA.push(CLS_CODE[CLASS_CODE[cls]] ?? CLS_CODE.O);
    flagA.push(flag);
    cntA.push(w.refs.length);
    for (let i = 0; i < w.refs.length; i += 1) pushRawId(w.refs[i]);
    nodeRefTotal += w.refs.length;
  }, { wantTags: ['highway', 'ref', 'name', 'oneway', 'bridge', 'tunnel', 'toll'] });

  flushTmp();
  closeSync(fdTmp);
  const nWays = wayId.length;
  if (nWays === 0) {
    console.log('[ways] ' + slug + ' 无可用道路，跳过');
    return null;
  }

  // ── 节点 id 排序去重 ─────────────────────────────────────────────────────
  const rawIds = new Float64Array(nodeRefTotal);
  {
    const fd = openSync(tmpFile, 'r');
    const buf = Buffer.allocUnsafe(1 << 22);
    let off = 0;
    while (off < nodeRefTotal) {
      const n = Math.min(buf.length >> 3, nodeRefTotal - off);
      const bytes = readSync(fd, buf, 0, n * 8);
      const got = bytes >> 3;
      for (let i = 0; i < got; i += 1) rawIds[off + i] = buf.readDoubleLE(i * 8);
      off += got;
      if (got === 0) break;
    }
    closeSync(fd);
  }
  const sorted = rawIds.slice();
  sorted.sort();
  let uniq = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (i === 0 || sorted[i] !== sorted[i - 1]) {
      sorted[uniq] = sorted[i];
      uniq += 1;
    }
  }
  const nodeIds = sorted.subarray(0, uniq);
  const nodeCount = uniq;

  // ── 下标化：way 节点 id → nodes[] 下标（zigzag varint delta） ────────────
  const nodeOffArr = new Uint32Array(nWays);
  const varintChunks = [];
  let varintTotal = 0;
  let cursor = 0;
  // 注意：不能写 Math.max(...cntA)（百万级数组会爆栈）
  let maxCnt = 2;
  for (let i = 0; i < nWays; i += 1) if (cntA[i] > maxCnt) maxCnt = cntA[i];
  const idxBuf = new Int32Array(maxCnt);
  for (let k = 0; k < nWays; k += 1) {
    const n = cntA[k];
    for (let i = 0; i < n; i += 1) {
      const id = rawIds[cursor + i];
      // 二分查找（节点 id 升序）
      let lo = 0;
      let hi = nodeCount - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = nodeIds[mid];
        if (v === id) { found = mid; break; }
        if (v < id) lo = mid + 1; else hi = mid - 1;
      }
      // 缺节点（跨省边界被裁掉的节点）写 -1：显式断点，绝不静默置 0
      // —— 置 0 会把该点接到本省第一个节点上，凭空造出一条横贯全省的假线段。
      idxBuf[i] = found;
    }
    cursor += n;
    const enc = encodeIndexDeltas(idxBuf.subarray(0, n));
    nodeOffArr[k] = varintTotal;
    varintChunks.push(enc);
    varintTotal += enc.length;
  }
  const wayNodesBuf = Buffer.concat(varintChunks, varintTotal);
  varintChunks.length = 0;
  // 下标化完成后即可释放 way 顺序的原始 id 数组（大省可达数百 MB）
  rawIds.fill(0);

  // ── 文件布局 ─────────────────────────────────────────────────────────────
  const poolBuf = encodeStringPool(strings);
  const waysOffset = HEADER_SIZE + poolBuf.length + wayNodesBuf.length + nodeCount * NODE_RECORD_SIZE;
  const wayNodesOffset = HEADER_SIZE + poolBuf.length;
  const nodesOffset = wayNodesOffset + wayNodesBuf.length;
  const totalSize = waysOffset + nWays * WAY_RECORD_SIZE;

  const fd = openSync(outFile, 'w+');
  const headerBuf = Buffer.alloc(HEADER_SIZE);
  writeRvwnHeader(headerBuf, {
    provCode: provCodeOf(provName),
    wayCount: nWays,
    nodeCount,
    strCount: strings.length,
    waysOffset,
    wayNodesOffset,
    nodesOffset,
  });
  writeSync(fd, headerBuf, 0, HEADER_SIZE, 0);
  writeSync(fd, poolBuf, 0, poolBuf.length, HEADER_SIZE);
  writeSync(fd, wayNodesBuf, 0, wayNodesBuf.length, wayNodesOffset);

  // ── Pass B：nodes（与所需 id 有序归并），同时留一份内存节点池供算长度 ────
  // 说明：OSM 中同一条 way 的节点 id 可以高度离散（节点是不同时期创建的），
  // 因此不能用"最小~最大下标区间"一次性读取（跨度可能覆盖整个省）。
  // 内存池是本省节点坐标的唯一权威副本，Pass B 之后长度计算零 I/O。
  const poolLng = new Float64Array(nodeCount);
  const poolLat = new Float64Array(nodeCount);
  const have = new Uint8Array(nodeCount);
  const NODE_CHUNK = 16384;
  const nodeOutBuf = Buffer.alloc(NODE_CHUNK * NODE_RECORD_SIZE);
  let bufStart = 0;
  let nodeOutPos = 0;
  const flushNodes = () => {
    if (nodeOutPos > 0) {
      writeSync(fd, nodeOutBuf, 0, nodeOutPos, nodesOffset + bufStart * NODE_RECORD_SIZE);
      nodeOutPos = 0;
    }
  };
  let ptr = 0;
  const acceptNode = (id, lng, lat) => {
    while (ptr < nodeCount && nodeIds[ptr] < id) ptr += 1;
    if (ptr >= nodeCount || nodeIds[ptr] !== id) return;
    const i = ptr;
    ptr += 1;
    if (nodeOutPos === 0 || i < bufStart || i >= bufStart + NODE_CHUNK) {
      flushNodes();
      bufStart = i;
      nodeOutBuf.fill(0);
    }
    writeNodeRecord(nodeOutBuf, (i - bufStart) * NODE_RECORD_SIZE, id, lng, lat);
    nodeOutPos = Math.max(nodeOutPos, (i - bufStart + 1) * NODE_RECORD_SIZE);
    poolLng[i] = lng;
    poolLat[i] = lat;
    have[i] = 1;
    if (nodeOutPos >= nodeOutBuf.length) flushNodes();
  };
  await scanNodes(pbf, acceptNode);
  flushNodes();

  // 缺失节点补扫：少数节点不在本省提取物内（省级裁剪把跨省 way 的省外节点裁掉了）。
  // 第二遍用 Map 精确判定再收一次；仍缺失的写 NaN 显式标记 —— 绝不静默置 0，
  // 否则该点会接到本省第一个节点上，凭空造出一条横贯全省的假线段。
  let missingBefore = 0;
  for (let i = 0; i < nodeCount; i += 1) if (!have[i]) missingBefore += 1;
  if (missingBefore > 0) {
    const want = new Map();
    for (let i = 0; i < nodeCount; i += 1) if (!have[i]) want.set(nodeIds[i], i);
    await scanNodes(pbf, (id, lng, lat) => {
      const i = want.get(id);
      if (i === undefined) return;
      want.delete(id);
      poolLng[i] = lng;
      poolLat[i] = lat;
      have[i] = 1;
    });
  }
  let missingNodes = 0;
  {
    const rec = Buffer.alloc(NODE_RECORD_SIZE);
    for (let i = 0; i < nodeCount; i += 1) {
      if (have[i]) continue;
      missingNodes += 1;
      // 关键：内存池也必须显式置 NaN。Float64Array 默认是 0，
      // 若只把文件写成 NaN 而池里留着 0，算长度时会从 (0,0) 起算，
      // 凭空多出一条上万公里的边（Hebei 曾出现单条 way 459,750km 的脏值）。
      poolLng[i] = NaN;
      poolLat[i] = NaN;
      rec.writeDoubleLE(nodeIds[i], 0);
      rec.writeDoubleLE(NaN, 8);
      rec.writeDoubleLE(NaN, 16);
      writeSync(fd, rec, 0, NODE_RECORD_SIZE, nodesOffset + i * NODE_RECORD_SIZE);
    }
  }

  // ── 计算每条 way 长度（米）+ 写 way 记录 ─────────────────────────────────
  const wayBuf = Buffer.allocUnsafe(nWays * WAY_RECORD_SIZE);
  const idx2 = new Int32Array(maxCnt);
  let brokenWays = 0;
  for (let k = 0; k < nWays; k += 1) {
    const n = cntA[k];
    const indices = decodeInto(wayNodesBuf, nodeOffArr[k], n, idx2);
    let lenM = 0;
    let broken = false;
    for (let i = 1; i < n; i += 1) {
      const a = indices[i - 1];
      const b = indices[i];
      if (a < 0 || b < 0 || a >= nodeCount || b >= nodeCount) { broken = true; continue; }
      const la = poolLng[a];
      const lb = poolLng[b];
      const ta = poolLat[a];
      const tb = poolLat[b];
      if (!Number.isFinite(la) || !Number.isFinite(lb) || !Number.isFinite(ta) || !Number.isFinite(tb)) {
        broken = true;
        continue;
      }
      lenM += haversineM(la, ta, lb, tb);
    }
    if (broken) brokenWays += 1;
    const o = k * WAY_RECORD_SIZE;
    wayBuf.writeDoubleLE(wayId[k], o);
    wayBuf.writeUInt32LE(refI[k], o + 8);
    wayBuf.writeUInt32LE(nameI[k], o + 12);
    wayBuf.writeUInt32LE(hwI[k], o + 16);
    wayBuf.writeUInt32LE(nodeOffArr[k], o + 20);
    wayBuf.writeUInt32LE(Math.min(4294967295, Math.round(lenM)), o + 24);
    wayBuf.writeUInt16LE(n, o + 28);
    wayBuf.writeUInt8(clsA[k], o + 30);
    wayBuf.writeUInt8(flagA[k], o + 31);
  }
  writeSync(fd, wayBuf, 0, wayBuf.length, waysOffset);
  closeSync(fd);

  try { unlinkSync(tmpFile); } catch { /* 临时文件清理失败不影响结果 */ }

  const size = statSync(outFile).size;
  const ms = Date.now() - t0;
  console.log(
    '[ways] ' + slug.padEnd(16) +
    ' ways=' + String(nWays).padStart(8) +
    ' nodes=' + String(nodeCount).padStart(9) +
    ' wayNodes=' + String(nodeRefTotal).padStart(9) +
    ' pool=' + strings.length +
    ' size=' + (size / 1048576).toFixed(1) + 'MB' +
    (missingNodes ? ' ⚠ 省外节点 ' + missingNodes : '') +
    (brokenWays ? ' · 跨界 way ' + brokenWays : '') +
    ' (' + (ms / 1000).toFixed(1) + 's)',
  );
  return { slug, province: provName, provCode: provCodeOf(provName), wayCount: nWays, nodeCount, wayNodes: nodeRefTotal, strings: strings.length, size, ms };
}

function decodeInto(buf, offset, count, out) {
  let p = offset;
  let prev = 0;
  for (let i = 0; i < count; i += 1) {
    let x = 0;
    let s = 1;
    let b;
    do {
      b = buf[p++];
      x += (b & 0x7f) * s;
      s *= 128;
    } while (b >= 0x80);
    const d = x % 2 === 1 ? -(x + 1) / 2 : x / 2;
    prev += d;
    out[i] = prev;
  }
  return out;
}

function haversineM(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const targets = listTargets();
if (!targets.length) {
  console.error('未找到 PBF 文件，请先运行 node scripts/fetch-china-pbf.mjs --all');
  process.exit(1);
}
console.log('要素库构建：' + targets.length + ' 个省片（track=' + OPTS.withTrack + ' service=' + OPTS.withService + '）');
const results = [];
for (const slug of targets) {
  try {
    const r = await buildProvince(slug);
    if (r) results.push(r);
  } catch (e) {
    console.error('[ways] ' + slug + ' 失败：' + (e && e.stack ? e.stack : e));
  }
}
const manifest = {
  generatedAt: new Date().toISOString(),
  opts: OPTS,
  totalWays: results.reduce((s, r) => s + r.wayCount, 0),
  totalNodes: results.reduce((s, r) => s + r.nodeCount, 0),
  totalWayNodes: results.reduce((s, r) => s + r.wayNodes, 0),
  provinces: results,
};
mkdirSync(NET_DIR, { recursive: true });
writeManifest(manifest);
console.log('\n== 汇总 ==');
console.log('  省片 ' + results.length + ' · way ' + manifest.totalWays + ' · 节点 ' + manifest.totalNodes + ' · way 点引用 ' + manifest.totalWayNodes);
console.log('  → data/roads/net/ （' + (results.reduce((s, r) => s + r.size, 0) / 1073741824).toFixed(2) + ' GB）');

function writeManifest(m) {
  writeFileSync(join(NET_DIR, '_manifest.json'), JSON.stringify(m, null, 1), 'utf8');
}
