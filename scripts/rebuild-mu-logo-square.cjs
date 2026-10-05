/**
 * 产出东航正方形 logo（替代 rebuild-mu-logo.py 的 1:1 正方形产出职责）。
 *
 * 背景：mu.png 现为 1000×214 横版（燕子标 x0~280 + 中英文 x320~999）。
 * 需求：正方形 1:1 版本 —— 票面航司行已有航司名文字，方形 logo 采用
 * 纯燕子标（App 图标风格）：裁燕子标区 → 裁透明边 → 1:1 画布居中。
 *
 * Python/PIL 不可用（系统仅 Store stub），故用 Node + pngjs（零框架纯 JS 编解码）。
 * 用法: node scripts/rebuild-mu-logo-square.cjs
 */
const fs = require('fs');
const { PNG } = require('pngjs');

const SRC = 'apps/web/src/assets/ticket/mu.png';
const OUT = 'apps/web/src/assets/ticket/mu.png';
const MARK_RIGHT = 300;
const SIDE_MAX = 480;

const src = PNG.sync.read(fs.readFileSync(SRC));
const { width, height, data } = src;

// 1. 裁燕子标区（x 0 ~ 300，空隙分界由 probe-logo-cols.cjs 实测）
const markW = Math.min(MARK_RIGHT, width);
const mark = new PNG({ width: markW, height });
PNG.bitblt(src, mark, 0, 0, markW, height, 0, 0);

// 2. 裁透明边
const colHas = new Array(markW).fill(false);
const rowHas = new Array(height).fill(false);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < markW; x++) {
    if (mark.data[(y * markW + x) * 4 + 3] > 10) { colHas[x] = true; rowHas[y] = true; }
  }
}
const span = (arr) => {
  let a = 0, b = arr.length - 1;
  while (a <= b && !arr[a]) a++;
  while (b >= a && !arr[b]) b--;
  return [a, b];
};
const [x0, x1] = span(colHas);
const [y0, y1] = span(rowHas);
const cw = x1 - x0 + 1;
const ch = y1 - y0 + 1;
const crop = new PNG({ width: cw, height: ch });
PNG.bitblt(mark, crop, x0, y0, cw, ch, 0, 0);

// 3. 1:1 正方形画布居中（≤480 边长控制体积）
const side = Math.min(Math.max(cw, ch), SIDE_MAX);
const scale = Math.min(side / cw, side / ch);
const rw = Math.round(cw * scale);
const rh = Math.round(ch * scale);
const scaled = new PNG({ width: rw, height: rh });
for (let y = 0; y < rh; y++) {
  const sy = Math.min(ch - 1, Math.floor(y / scale));
  for (let x = 0; x < rw; x++) {
    const sx = Math.min(cw - 1, Math.floor(x / scale));
    const si = (sy * cw + sx) * 4;
    const di = (y * rw + x) * 4;
    scaled.data[di] = crop.data[si];
    scaled.data[di + 1] = crop.data[si + 1];
    scaled.data[di + 2] = crop.data[si + 2];
    scaled.data[di + 3] = crop.data[si + 3];
  }
}
const square = new PNG({ width: side, height: side });
PNG.bitblt(scaled, square, 0, 0, rw, rh, Math.floor((side - rw) / 2), Math.floor((side - rh) / 2));

fs.writeFileSync(OUT, PNG.sync.write(square, { deflateLevel: 9 }));
console.log(`已生成 ${OUT}  ${side}x${side}  ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);