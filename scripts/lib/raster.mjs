/**
 * 万里路书 · 极简光栅工具（scripts/lib/raster.mjs）
 *
 * 用途：把全国路网（7.9M 条 way）在构建期渲染成一张 PNG 背景图。
 * 为什么不上矢量：15k 条编号公路的折线已经 3MB+，加上无编号路网（乡道村道）
 * 是 10^7 量级 —— 前端静态折线的范式天花板就是几十条线（这正是旧实现只画 33 条的原因）。
 * 位图是唯一能在"全国尺度 + 全路网"下兼顾体积与观感的载体。
 *
 * 零依赖：PNG 用 node:zlib deflate 手写 IHDR/IDAT/IEND。
 * 抗锯齿：整图以 SS 倍超采样渲染，再 2×2 盒式降采样（比逐像素算覆盖率简单且效果稳定）。
 */

import { deflateSync } from 'node:zlib';

// ── PNG 编码 ────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** RGB Buffer(w*h*3) → PNG Buffer */
export function encodePng(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── 加色画布 ────────────────────────────────────────────────────────────────
export class Raster {
  constructor(width, height, bg = [8, 12, 20]) {
    this.w = width;
    this.h = height;
    this.data = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i += 1) {
      this.data[i * 3] = bg[0];
      this.data[i * 3 + 1] = bg[1];
      this.data[i * 3 + 2] = bg[2];
    }
  }

  /** 加色混合一个像素（a 为覆盖度 0~1） */
  plot(x, y, a, r, g, b) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    const d = this.data;
    d[i] += r * a;
    d[i + 1] += g * a;
    d[i + 2] += b * a;
  }

  /** Xiaolin Wu 抗锯齿直线 */
  line(x0, y0, x1, y1, alpha, color) {
    let steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    let ax = x0, ay = y0, bx = x1, by = y1;
    if (steep) { let t = ax; ax = ay; ay = t; t = bx; bx = by; by = t; }
    if (ax > bx) { let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; }
    const dx = bx - ax;
    const dy = by - ay;
    const grad = dx === 0 ? 1 : dy / dx;
    const [r, g, b] = color;
    let inter = ay;
    for (let x = Math.round(ax); x <= Math.round(bx); x += 1) {
      const yf = inter;
      const y = Math.floor(yf);
      const f = yf - y;
      if (steep) {
        this.plot(y, x, alpha * (1 - f), r, g, b);
        this.plot(y + 1, x, alpha * f, r, g, b);
      } else {
        this.plot(x, y, alpha * (1 - f), r, g, b);
        this.plot(x, y + 1, alpha * f, r, g, b);
      }
      inter += grad;
    }
  }

  /** 画一条折线（带光晕）：光晕 = 在 5 个偏移位置重复描一遍 */
  polyline(pts, color, alpha, glowAlpha = 0) {
    if (pts.length < 2) return;
    if (glowAlpha > 0) {
      const offs = [[0, -1], [0, 1], [-1, 0], [1, 0], [1, 1]];
      for (const [ox, oy] of offs) {
        for (let i = 1; i < pts.length; i += 1) {
          this.line(pts[i - 1][0] + ox, pts[i - 1][1] + oy, pts[i][0] + ox, pts[i][1] + oy, glowAlpha, color);
        }
      }
    }
    for (let i = 1; i < pts.length; i += 1) {
      this.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], alpha, color);
    }
  }

  /** SS 倍盒式降采样 + 色调映射 → RGB Buffer */
  toRgb(ss = 2, gain = 1) {
    const w = Math.floor(this.w / ss);
    const h = Math.floor(this.h / ss);
    const out = Buffer.alloc(w * h * 3);
    const d = this.data;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let r = 0, g = 0, b = 0;
        for (let dy = 0; dy < ss; dy += 1) {
          for (let dx = 0; dx < ss; dx += 1) {
            const i = ((y * ss + dy) * this.w + (x * ss + dx)) * 3;
            r += d[i]; g += d[i + 1]; b += d[i + 2];
          }
        }
        const n = ss * ss;
        // 加色累加后做一次软压缩，避免密集区糊成白块
        const map = (v) => {
          const t = (v / n) * gain;
          return Math.max(0, Math.min(255, Math.round(255 * (1 - Math.exp(-t / 255)))));
        };
        const o = (y * w + x) * 3;
        out[o] = map(r);
        out[o + 1] = map(g);
        out[o + 2] = map(b);
      }
    }
    return { width: w, height: h, rgb: out };
  }
}

/** '#rrggbb' → [r,g,b] */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
