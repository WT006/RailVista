/**
 * 万里路书 · OSM PBF 流式解析库（scripts/lib/osm-pbf.mjs）
 *
 * 零依赖：只用 Node 内置 fs / zlib。不引入 osmium / osmpbf 等外部二进制或重型包。
 *
 * 为什么自己写：全国公路网需要"一次拿到全部要素"，而不是按编号向 Overpass 逐条查询
 * （OSM 中 89.3% 的 highway way 没有 ref 标签，按编号查必然漏段）。
 * 自实现可做到 ① 零安装 ② 两遍扫描式内存可控 ③ 断点续跑 ④ 与仓库既有 .mjs 脚本同构。
 *
 * 格式参考：https://wiki.openstreetmap.org/wiki/PBF_Format
 *   file    := BlobHeader(length-prefixed) Blob ...
 *   Blob    := { raw(1) | zlib_data(3) }
 *   PrimitiveBlock := stringtable(1) primitivegroup(2..) granularity(17) lat_offset(19) lon_offset(20)
 *   PrimitiveGroup := nodes(1) | dense(2) | ways(3) | relations(4)
 *   坐标     := 1e-9 * (offset + granularity * deltaDecoded)
 *
 * 用法：
 *   import { scanWays, scanNodes, countHighwayWays } from './osm-pbf.mjs';
 *   await scanWays(file, (w) => { ... });   // w = { id, tags: Map, refs: Int32Array|number[] }
 *   await scanNodes(file, (id, lng, lat) => { ... });
 *
 * 自检：node scripts/lib/osm-pbf.mjs --selftest data/cache/osm/hainan-latest.osm.pbf
 */

import { createReadStream } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** ── protobuf 基础读取 ─────────────────────────────────────────────────── */
class Reader {
  constructor(buf, pos = 0, end = buf.length) {
    this.b = buf;
    this.p = pos;
    this.end = end;
  }
  varint() {
    let x = 0;
    let s = 0;
    let b;
    do {
      b = this.b[this.p++];
      x += (b & 0x7f) * Math.pow(2, s);
      s += 7;
    } while (b >= 0x80);
    return x;
  }
  /** zigzag 解码（sint64） */
  sint() {
    const v = this.varint();
    return v % 2 === 1 ? -(v + 1) / 2 : v / 2;
  }
  bytes() {
    const n = this.varint();
    const s = this.p;
    this.p += n;
    return this.b.subarray(s, this.p);
  }
  skip(wire) {
    // 注意：不能用 `this.p += this.varint()` —— += 会先读取 this.p 的旧值，
    // 而 varint() 已经推进了 this.p，导致跳过长度错误（曾造成整体解析错位）。
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) {
      const n = this.varint();
      this.p += n;
    } else if (wire === 5) this.p += 4;
    else throw new Error('osm-pbf: 未知 wire type ' + wire);
  }
  eof() {
    return this.p >= this.end;
  }
}

function parseBlobHeader(buf) {
  const r = new Reader(buf);
  let type = '';
  let datasize = 0;
  while (!r.eof()) {
    const k = r.varint();
    const f = k >> 3;
    const w = k & 7;
    if (f === 1 && w === 2) type = Buffer.from(r.bytes()).toString('utf8');
    else if (f === 3 && w === 0) datasize = r.varint();
    else r.skip(w);
  }
  return { type, datasize };
}

function decodeBlob(buf) {
  const r = new Reader(buf);
  let raw = null;
  let zlib = null;
  while (!r.eof()) {
    const k = r.varint();
    const f = k >> 3;
    const w = k & 7;
    if (f === 1 && w === 2) raw = Buffer.from(r.bytes());
    else if (f === 3 && w === 2) zlib = Buffer.from(r.bytes());
    else r.skip(w);
  }
  if (raw) return raw;
  if (zlib) return inflateSync(zlib);
  return EMPTY;
}
const EMPTY = Buffer.alloc(0);

/**
 * 顺序遍历 PBF 文件的所有 Blob（流式，内存占用 = 当前块）。
 * @param {string} file
 * @param {(blobType: string, data: Buffer) => void} onData
 */
export async function forEachBlob(file, onData) {
  const stream = createReadStream(file, { highWaterMark: 1 << 22 });
  let pending = EMPTY;
  for await (const chunk of stream) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    for (;;) {
      if (pending.length < 4) break;
      const hlen = pending.readUInt32BE(0);
      if (pending.length < 4 + hlen) break;
      const headerBuf = pending.subarray(4, 4 + hlen);
      const { type, datasize } = parseBlobHeader(headerBuf);
      if (pending.length < 4 + hlen + datasize) break;
      const blobBuf = pending.subarray(4 + hlen, 4 + hlen + datasize);
      pending = pending.subarray(4 + hlen + datasize);
      if (type === 'OSMData') onData(type, decodeBlob(blobBuf));
    }
  }
}

/** 解出 PrimitiveBlock 的字符串表与 primitivegroup 列表 */
function readPrimitiveBlock(buf) {
  const r = new Reader(buf);
  let strtab = null;
  const groups = [];
  while (!r.eof()) {
    const k = r.varint();
    const f = k >> 3;
    const w = k & 7;
    if (f === 1 && w === 2) {
      const st = new Reader(r.bytes());
      const arr = [];
      while (!st.eof()) {
        const kk = st.varint();
        const ff = kk >> 3;
        const ww = kk & 7;
        if (ff === 1 && ww === 2) arr.push(Buffer.from(st.bytes()).toString('utf8'));
        else st.skip(ww);
      }
      strtab = arr;
    } else if (f === 2 && w === 2) {
      groups.push(Buffer.from(r.bytes()));
    } else r.skip(w);
  }
  return { strtab, groups };
}

/** 解析一个 PrimitiveGroup，回调 node / way / relation */
function readGroup(buf, strtab, h) {
  const r = new Reader(buf);
  while (!r.eof()) {
    const k = r.varint();
    const f = k >> 3;
    const w = k & 7;
    if (f === 1 && w === 2) {
      // Node（非 dense）
      const nr = new Reader(r.bytes());
      let id = 0;
      let lat = 0;
      let lon = 0;
      const keys = [];
      const vals = [];
      while (!nr.eof()) {
        const nk = nr.varint();
        const nf = nk >> 3;
        const nw = nk & 7;
        if (nf === 1 && nw === 0) id = nr.varint();
        else if (nf === 8 && nw === 0) lat = nr.sint();
        else if (nf === 9 && nw === 0) lon = nr.sint();
        else if (nf === 2 && nw === 2) { const p = new Reader(nr.bytes()); while (!p.eof()) keys.push(p.varint()); }
        else if (nf === 3 && nw === 2) { const p = new Reader(nr.bytes()); while (!p.eof()) vals.push(p.varint()); }
        else nr.skip(nw);
      }
      if (h.onNode) h.onNode(id, lon * 1e-7, lat * 1e-7, { keys, vals });
    } else if (f === 2 && w === 2) {
      // DenseNodes
      const dr = new Reader(r.bytes());
      let ids = null;
      let lats = null;
      let lons = null;
      while (!dr.eof()) {
        const dk = dr.varint();
        const df = dk >> 3;
        const dw = dk & 7;
        if (df === 1 && dw === 2) { const p = new Reader(dr.bytes()); const a = []; while (!p.eof()) a.push(p.sint()); ids = a; }
        else if (df === 8 && dw === 2) { const p = new Reader(dr.bytes()); const a = []; while (!p.eof()) a.push(p.sint()); lats = a; }
        else if (df === 9 && dw === 2) { const p = new Reader(dr.bytes()); const a = []; while (!p.eof()) a.push(p.sint()); lons = a; }
        else dr.skip(dw);
      }
      if (h.onNode && ids) {
        const g = h.granularity;
        const latOff = h.latOffset;
        const lonOff = h.lonOffset;
        let id = 0;
        let lat = 0;
        let lon = 0;
        const n = ids.length;
        for (let i = 0; i < n; i += 1) {
          id += ids[i];
          lat += lats ? lats[i] : 0;
          lon += lons ? lons[i] : 0;
          h.onNode(id, 1e-9 * (lonOff + g * lon), 1e-9 * (latOff + g * lat), null);
        }
      }
    } else if (f === 3 && w === 2) {
      // Way
      const wr = new Reader(r.bytes());
      let id = 0;
      const keys = [];
      const vals = [];
      let refs = null;
      while (!wr.eof()) {
        const wk = wr.varint();
        const wf = wk >> 3;
        const ww = wk & 7;
        if (wf === 1 && ww === 0) id = wr.varint();
        else if (wf === 2 && ww === 2) { const p = new Reader(wr.bytes()); while (!p.eof()) keys.push(p.varint()); }
        else if (wf === 3 && ww === 2) { const p = new Reader(wr.bytes()); while (!p.eof()) vals.push(p.varint()); }
        else if (wf === 8 && ww === 2) {
          const p = new Reader(wr.bytes());
          const a = [];
          let cur = 0;
          while (!p.eof()) { cur += p.sint(); a.push(cur); }
          refs = a;
        } else wr.skip(ww);
      }
      if (h.onWay) h.onWay({ id, keys, vals, refs: refs || [], strtab });
    } else if (f === 4 && w === 2) {
      if (h.onRelation) h.onRelation(r.bytes());
      else r.skip(w);
    } else r.skip(w);
  }
}

// granularity / offset 在 PrimitiveBlock 里，需要先扫一遍才能给 dense nodes 用。
function readBlockParams(buf) {
  const r = new Reader(buf);
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  const limits = [];
  while (!r.eof()) {
    const k = r.varint();
    const f = k >> 3;
    const w = k & 7;
    if (f === 17 && w === 0) granularity = r.varint();
    else if (f === 19 && w === 0) latOffset = r.varint();
    else if (f === 20 && w === 0) lonOffset = r.varint();
    else r.skip(w);
  }
  return { granularity, latOffset, lonOffset, limits };
}

/**
 * 扫描 ways。onWay 收到经过字符串表解析的 tags 对象（仅解出需要的键，降低 GC 压力）。
 * @param {string} file
 * @param {(w: {id:number, tags: Record<string,string>, refs: number[]}) => void} onWay
 * @param {{wantTags?: string[]}} [opts] 只解析这些 tag 键（默认全部）
 */
export async function scanWays(file, onWay, opts = {}) {
  const want = opts.wantTags ? new Set(opts.wantTags) : null;
  let count = 0;
  await forEachBlob(file, (_t, data) => {
    const { strtab, groups } = readPrimitiveBlock(data);
    if (!strtab) return;
    const params = readBlockParams(data);
    for (const g of groups) {
      readGroup(g, strtab, {
        ...params,
        onWay: (w) => {
          const tags = {};
          for (let i = 0; i < w.keys.length; i += 1) {
            const k = strtab[w.keys[i]];
            if (k === undefined) continue;
            if (want && !want.has(k)) continue;
            tags[k] = strtab[w.vals[i]] ?? '';
          }
          count += 1;
          onWay({ id: w.id, tags, refs: w.refs });
        },
      });
    }
  });
  return count;
}

/**
 * 扫描节点。onNode(id, lng, lat)。两遍扫描的第二遍用它。
 * @param {string} file
 * @param {(id: number, lng: number, lat: number) => void} onNode
 */
export async function scanNodes(file, onNode) {
  let count = 0;
  await forEachBlob(file, (_t, data) => {
    const { groups } = readPrimitiveBlock(data);
    const params = readBlockParams(data);
    for (const g of groups) {
      readGroup(g, null, {
        ...params,
        onNode: (id, lng, lat) => {
          count += 1;
          onNode(id, lng, lat);
        },
      });
    }
  });
  return count;
}

/** 只统计不落盘：返回 { ways, highwayWays, nodes, wayNodes } */
export async function countPbf(file, highwayOnly = true) {
  let ways = 0;
  let highwayWays = 0;
  let wayNodes = 0;
  await scanWays(file, (w) => {
    ways += 1;
    if (w.tags.highway) {
      highwayWays += 1;
      wayNodes += w.refs.length;
    }
  });
  const nodes = await scanNodes(file, () => {});
  return { ways, highwayWays, nodes, wayNodes, highwayOnly };
}

// ── 自检 ────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('osm-pbf.mjs') && process.argv.includes('--selftest')) {
  const file = process.argv[process.argv.indexOf('--selftest') + 1];
  const t0 = Date.now();
  const r = await countPbf(file);
  console.log('[selftest] ' + file);
  console.log('  ways=' + r.ways + ' highwayWays=' + r.highwayWays + ' nodes=' + r.nodes + ' wayNodes=' + r.wayNodes);
  console.log('  elapsed=' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
