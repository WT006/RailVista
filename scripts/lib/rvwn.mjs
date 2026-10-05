/**
 * 万里路书 · RVWN 全等级路网要素库（scripts/lib/rvwn.mjs）
 *
 * 一张省片就是一条省的全部可通行道路：way 记录 + 节点索引 + 节点坐标池。
 * 它是几何装配、拓扑建图、瓦片生成的唯一底座 —— 所有派生都不再访问网络。
 *
 * 布局（全部 little-endian）：
 *   Header 40B : magic 'RVWN' | version u16 | provCode u8 | flags u8
 *                wayCount u32 | nodeCount u32 | strCount u32
 *                waysOffset u32 | wayNodesOffset u32 | nodesOffset u32 | reserved u32
 *   StringPool : offsets u32[strCount+1] + utf8 blob（ref/name/highway 共用一池）
 *   WayNodes   : zigzag varint(u32 delta)，指向 nodes[] 下标
 *   Nodes      : 24B × nodeCount：id f64 | lng f64 | lat f64（按 id 升序）
 *   Ways       : 32B × wayCount：
 *                [0]id f64 | [8]refStr u32 | [12]nameStr u32 | [16]hwStr u32
 *                [20]nodeOff u32 | [24]lenM u32 | [28]nodeCnt u16 | [30]cls u8 | [31]flag u8
 *
 * 为什么用 OSM node id：跨省共享节点天然一致，省片可直接拼接；
 * 为什么 wayNodes 存"节点下标"而不是 id：下游(装配/拓扑/瓦片)全是顺序访问，快且省空间。
 */
import { openSync, readSync, closeSync, readFileSync, writeFileSync, fstatSync } from 'node:fs';

export const RVWN_MAGIC = 'RVWN';
export const RVWN_VERSION = 1;
export const HEADER_SIZE = 40;
export const WAY_RECORD_SIZE = 32;
export const NODE_RECORD_SIZE = 24;

/** way.flag 位定义 */
export const FLAG_ONEWAY = 1;
export const FLAG_BRIDGE = 2;
export const FLAG_TUNNEL = 4;
export const FLAG_TOLL = 8;

/** ← validate-road-keys / road-ref 共用的等级码 */
export const CLS_CODE = { E: 0, G: 1, S: 2, X: 3, Y: 4, C: 5, O: 6 };
export const CODE_CLS = ['E', 'G', 'S', 'X', 'Y', 'C', 'O'];

// ── varint ──────────────────────────────────────────────────────────────────
export function writeVarint(buf, pos, value) {
  let v = value;
  while (v >= 0x80) {
    buf[pos++] = (v & 0x7f) | 0x80;
    v = Math.floor(v / 128);
  }
  buf[pos++] = v;
  return pos;
}
export function varintSize(value) {
  let n = 1;
  let v = value;
  while (v >= 0x80) {
    v = Math.floor(v / 128);
    n += 1;
  }
  return n;
}
export function zigzag(v) {
  return v < 0 ? -v * 2 - 1 : v * 2;
}
export function unzigzag(v) {
  return v % 2 === 1 ? -(v + 1) / 2 : v / 2;
}
export function readVarint(buf, posRef) {
  let x = 0;
  let s = 1;
  let b;
  let p = posRef.p;
  do {
    b = buf[p++];
    x += (b & 0x7f) * s;
    s *= 128;
  } while (b >= 0x80);
  posRef.p = p;
  return x;
}

/** 编码一串节点下标为 zigzag varint delta */
export function encodeIndexDeltas(indices) {
  let size = 0;
  const deltas = new Array(indices.length);
  let prev = 0;
  for (let i = 0; i < indices.length; i += 1) {
    const d = indices[i] - prev;
    prev = indices[i];
    deltas[i] = d;
    size += varintSize(zigzag(d));
  }
  const buf = Buffer.allocUnsafe(size);
  let p = 0;
  for (let i = 0; i < deltas.length; i += 1) p = writeVarint(buf, p, zigzag(deltas[i]));
  return buf;
}

/** 解码 zigzag varint delta → 下标数组 */
export function decodeIndexDeltas(buf, offset, count, out) {
  const ref = { p: offset };
  const arr = out && out.length === count ? out : new Array(count);
  let prev = 0;
  for (let i = 0; i < count; i += 1) {
    prev += unzigzag(readVarint(buf, ref));
    arr[i] = prev;
  }
  return arr;
}

// ── 读 ──────────────────────────────────────────────────────────────────────
export function readRvwnHeader(path) {
  const buf = Buffer.alloc(HEADER_SIZE);
  const fd = openSync(path, 'r');
  let size = 0;
  try {
    readSync(fd, buf, 0, HEADER_SIZE, 0);
    size = fstatSync(fd).size;
  } finally {
    closeSync(fd);
  }
  if (buf.toString('ascii', 0, 4) !== RVWN_MAGIC) throw new Error(path + ': 不是 RVWN 文件');
  return {
    version: buf.readUInt16LE(4),
    provCode: buf.readUInt8(6),
    flags: buf.readUInt8(7),
    wayCount: buf.readUInt32LE(8),
    nodeCount: buf.readUInt32LE(12),
    strCount: buf.readUInt32LE(16),
    waysOffset: buf.readUInt32LE(20),
    wayNodesOffset: buf.readUInt32LE(24),
    nodesOffset: buf.readUInt32LE(28),
    path,
    size,
  };
}

export function writeRvwnHeader(buf, h) {
  buf.write(RVWN_MAGIC, 0, 'ascii');
  buf.writeUInt16LE(RVWN_VERSION, 4);
  buf.writeUInt8(h.provCode & 0xff, 6);
  buf.writeUInt8(h.flags ?? 0, 7);
  buf.writeUInt32LE(h.wayCount, 8);
  buf.writeUInt32LE(h.nodeCount, 12);
  buf.writeUInt32LE(h.strCount, 16);
  buf.writeUInt32LE(h.waysOffset, 20);
  buf.writeUInt32LE(h.wayNodesOffset, 24);
  buf.writeUInt32LE(h.nodesOffset, 28);
  buf.writeUInt32LE(0, 32);
  buf.writeUInt32LE(0, 36);
}

/** 字符串池：offsets + blob */
export function encodeStringPool(strings) {
  const parts = [];
  let total = 0;
  for (const s of strings) {
    const b = Buffer.from(s, 'utf8');
    parts.push(b);
    total += b.length;
  }
  const offsets = Buffer.allocUnsafe((strings.length + 1) * 4);
  const blob = Buffer.allocUnsafe(total);
  let off = 0;
  for (let i = 0; i < parts.length; i += 1) {
    offsets.writeUInt32LE(off, i * 4);
    parts[i].copy(blob, off);
    off += parts[i].length;
  }
  offsets.writeUInt32LE(off, strings.length * 4);
  return Buffer.concat([offsets, blob]);
}

export function readStringPool(fd, offset, strCount) {
  const offsets = Buffer.alloc((strCount + 1) * 4);
  readSync(fd, offsets, 0, offsets.length, offset);
  const blobLen = offsets.readUInt32LE(strCount * 4);
  const blob = Buffer.alloc(blobLen);
  if (blobLen > 0) readSync(fd, blob, 0, blobLen, offset + (strCount + 1) * 4);
  const out = new Array(strCount);
  for (let i = 0; i < strCount; i += 1) {
    out[i] = blob.toString('utf8', offsets.readUInt32LE(i * 4), offsets.readUInt32LE((i + 1) * 4));
  }
  return out;
}

/** 打开一个省片，返回带缓存的读取器 */
export function openRvwn(path) {
  const header = readRvwnHeader(path);
  const fd = openSync(path, 'r');
  const strings = readStringPool(fd, HEADER_SIZE, header.strCount);
  const wayBuf = Buffer.allocUnsafe(WAY_RECORD_SIZE);
  const nodeBuf = Buffer.allocUnsafe(NODE_RECORD_SIZE);

  function readWay(i) {
    readSync(fd, wayBuf, 0, WAY_RECORD_SIZE, header.waysOffset + i * WAY_RECORD_SIZE);
    const cls = CODE_CLS[wayBuf.readUInt8(30)] ?? 'O';
    return {
      index: i,
      id: wayBuf.readDoubleLE(0),
      ref: strings[wayBuf.readUInt32LE(8)] ?? '',
      name: strings[wayBuf.readUInt32LE(12)] ?? '',
      highway: strings[wayBuf.readUInt32LE(16)] ?? '',
      nodeOff: wayBuf.readUInt32LE(20),
      lenM: wayBuf.readUInt32LE(24),
      nodeCnt: wayBuf.readUInt16LE(28),
      cls,
      flag: wayBuf.readUInt8(31),
    };
  }

  function readNodeIndex(i) {
    readSync(fd, nodeBuf, 0, NODE_RECORD_SIZE, header.nodesOffset + i * NODE_RECORD_SIZE);
    return { id: nodeBuf.readDoubleLE(0), lng: nodeBuf.readDoubleLE(8), lat: nodeBuf.readDoubleLE(16) };
  }

  /** 一次读入 [from, to] 下标区间的节点（自动限制跨度，避免异常 way 造成大读） */
  function readNodeSpan(from, to) {
    const n = to - from + 1;
    const buf = Buffer.allocUnsafe(n * NODE_RECORD_SIZE);
    readSync(fd, buf, 0, buf.length, header.nodesOffset + from * NODE_RECORD_SIZE);
    const ids = new Float64Array(n);
    const lngs = new Float64Array(n);
    const lats = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      ids[i] = buf.readDoubleLE(i * NODE_RECORD_SIZE);
      lngs[i] = buf.readDoubleLE(i * NODE_RECORD_SIZE + 8);
      lats[i] = buf.readDoubleLE(i * NODE_RECORD_SIZE + 16);
    }
    return { from, ids, lngs, lats };
  }

  /** magic 0xffffffff 的 varint 最多 5 字节 —— 按需分配，且不得超过本节剩余长度 */
  function wayNodeBuf(way) {
    const sectionEnd = header.nodesOffset - header.wayNodesOffset;
    const remain = Math.max(0, sectionEnd - way.nodeOff);
    return Buffer.allocUnsafe(Math.min(5 * Math.max(1, way.nodeCnt), remain));
  }

  /** 读一条 way 的节点下标 */
  function readWayIndices(way) {
    const buf = wayNodeBuf(way);
    readSync(fd, buf, 0, buf.length, header.wayNodesOffset + way.nodeOff);
    return decodeIndexDeltas(buf, 0, way.nodeCnt);
  }

  /** 读一条 way 的节点（含 id 与坐标）：单次 span 读 + varint 解码 */
  function readWayNodes(way) {
    const buf = wayNodeBuf(way);
    readSync(fd, buf, 0, buf.length, header.wayNodesOffset + way.nodeOff);
    const idx = decodeIndexDeltas(buf, 0, way.nodeCnt);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < idx.length; i += 1) {
      if (idx[i] < min) min = idx[i];
      if (idx[i] > max) max = idx[i];
    }
    if (max - min > 20000) {
      // 极端离散步：逐点读
      const ids = new Float64Array(idx.length);
      const lngs = new Float64Array(idx.length);
      const lats = new Float64Array(idx.length);
      for (let i = 0; i < idx.length; i += 1) {
        const nd = readNodeIndex(idx[i]);
        ids[i] = nd.id; lngs[i] = nd.lng; lats[i] = nd.lat;
      }
      return { indices: idx, ids, lngs, lats };
    }
    const span = readNodeSpan(min, max);
    const ids = new Float64Array(idx.length);
    const lngs = new Float64Array(idx.length);
    const lats = new Float64Array(idx.length);
    for (let i = 0; i < idx.length; i += 1) {
      const k = idx[i] - span.from;
      ids[i] = span.ids[k];
      lngs[i] = span.lngs[k];
      lats[i] = span.lats[k];
    }
    return { indices: idx, ids, lngs, lats };
  }

  /** 遍历全部 way（不含几何） */
  function* iterateWays() {
    const chunkWays = 4096;
    const buf = Buffer.allocUnsafe(chunkWays * WAY_RECORD_SIZE);
    for (let base = 0; base < header.wayCount; base += chunkWays) {
      const n = Math.min(chunkWays, header.wayCount - base);
      readSync(fd, buf, 0, n * WAY_RECORD_SIZE, header.waysOffset + base * WAY_RECORD_SIZE);
      for (let i = 0; i < n; i += 1) {
        const o = i * WAY_RECORD_SIZE;
        yield {
          index: base + i,
          id: buf.readDoubleLE(o),
          ref: strings[buf.readUInt32LE(o + 8)] ?? '',
          name: strings[buf.readUInt32LE(o + 12)] ?? '',
          highway: strings[buf.readUInt32LE(o + 16)] ?? '',
          nodeOff: buf.readUInt32LE(o + 20),
          lenM: buf.readUInt32LE(o + 24),
          nodeCnt: buf.readUInt16LE(o + 28),
          cls: CODE_CLS[buf.readUInt8(o + 30)] ?? 'O',
          flag: buf.readUInt8(o + 31),
        };
      }
    }
  }

  return { header, strings, fd, readWay, readWayIndices, readWayNodes, readNodeIndex, readNodeSpan, iterateWays, close: () => closeSync(fd) };
}

/** 节点索引：写盘用（24B/条） */
export function writeNodeRecord(buf, pos, id, lng, lat) {
  buf.writeDoubleLE(id, pos);
  buf.writeDoubleLE(lng, pos + 8);
  buf.writeDoubleLE(lat, pos + 16);
  return pos + NODE_RECORD_SIZE;
}

/** 供装配/拓扑使用：把省片节点池整体读成 Float64Array（省内存、顺序访问快） */
export function loadNodes(path) {
  const header = readRvwnHeader(path);
  const buf = Buffer.alloc(header.nodeCount * NODE_RECORD_SIZE);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, 0, buf.length, header.nodesOffset);
  } finally {
    closeSync(fd);
  }
  const ids = new Float64Array(header.nodeCount);
  const lngs = new Float64Array(header.nodeCount);
  const lats = new Float64Array(header.nodeCount);
  for (let i = 0; i < header.nodeCount; i += 1) {
    ids[i] = buf.readDoubleLE(i * NODE_RECORD_SIZE);
    lngs[i] = buf.readDoubleLE(i * NODE_RECORD_SIZE + 8);
    lats[i] = buf.readDoubleLE(i * NODE_RECORD_SIZE + 16);
  }
  return { header, ids, lngs, lats };
}

/** 二分查找节点 id → 下标（nodes 按 id 升序） */
export function findNodeIndex(ids, target) {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = ids[mid];
    if (v === target) return mid;
    if (v < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export { readFileSync, writeFileSync };
