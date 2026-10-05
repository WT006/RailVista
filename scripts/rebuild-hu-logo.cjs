/**
 * 海南航空 hu.jpg → hu.png 1:1 透明底归一。
 *
 * pngjs 不支持 jpg，用 jpeg-js 解码 → 转 RGBA → flood fill 去白底
 * → 裁透明边 → 1:1 画布居中 → 输出 hu.png。
 *
 * 用法: node scripts/rebuild-hu-logo.cjs
 */
const fs = require('fs');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const SRC = 'apps/web/src/assets/ticket/hu.jpg';
const OUT = 'apps/web/src/assets/ticket/hu.png';
const SIDE_MAX = 160;

const dec = jpeg.decode(fs.readFileSync(SRC), { useTArray: true });
const w = dec.width, h = dec.height;
const src = new PNG({ width: w, height: h });
for (let i = 0; i < w * h; i++) {
  src.data[i * 4] = dec.data[i * 3];
  src.data[i * 4 + 1] = dec.data[i * 3 + 1];
  src.data[i * 4 + 2] = dec.data[i * 3 + 2];
  src.data[i * 4 + 3] = 255;
}

// flood fill 去白底（从四边，tolerance 20）
const tol = 20;
const seen = new Uint8Array(w * h);
const queue = [];
const isBg = (x, y) => {
  const i = (y * w + x) * 4;
  return src.data[i] >= 255 - tol && src.data[i + 1] >= 255 - tol && src.data[i + 2] >= 255 - tol;
};
for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (isBg(x, y) && !seen[y * w + x]) { seen[y * w + x] = 1; queue.push([x, y]); }
for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (isBg(x, y) && !seen[y * w + x]) { seen[y * w + x] = 1; queue.push([x, y]); }
while (queue.length) {
  const [x, y] = queue.pop();
  src.data[(y * w + x) * 4 + 3] = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < w && ny >= 0 && ny < h && !seen[ny * w + nx] && isBg(nx, ny)) { seen[ny * w + nx] = 1; queue.push([nx, ny]); }
  }
}

// 裁透明边
let x0 = w, x1 = -1, y0 = h, y1 = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (src.data[(y * w + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
const crop = new PNG({ width: cw, height: ch });
PNG.bitblt(src, crop, x0, y0, cw, ch, 0, 0);

// 1:1 画布居中
const side = Math.min(Math.max(cw, ch), SIDE_MAX);
const scale = Math.min(side / cw, side / ch);
const rw = Math.round(cw * scale), rh = Math.round(ch * scale);
const scaled = new PNG({ width: rw, height: rh });
for (let y = 0; y < rh; y++) {
  const sy = Math.min(ch - 1, Math.floor((y * ch) / rh));
  for (let x = 0; x < rw; x++) {
    const sx = Math.min(cw - 1, Math.floor((x * cw) / rw));
    const si = (sy * cw + sx) * 4, di = (y * rw + x) * 4;
    scaled.data[di] = crop.data[si]; scaled.data[di + 1] = crop.data[si + 1]; scaled.data[di + 2] = crop.data[si + 2]; scaled.data[di + 3] = crop.data[si + 3];
  }
}
const square = new PNG({ width: side, height: side });
PNG.bitblt(scaled, square, 0, 0, rw, rh, Math.floor((side - rw) / 2), Math.floor((side - rh) / 2));

fs.writeFileSync(OUT, PNG.sync.write(square, { deflateLevel: 9 }));
console.log(`已生成 ${OUT}  ${side}×${side}  ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);