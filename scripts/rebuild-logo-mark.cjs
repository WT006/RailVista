/**
 * 从航司官方横版素材裁出图形标部分（App 图标风格），替换原文件。
 *
 * 背景：ca.png/cz.png 为「图形标 + 文字」横版（1000×311 / 1000×188）。
 * 直接引用会让 .tk__allogo 内容按高度展开 106px+，挤掉航司名换行破版
 * （实测 alrow 32→62）。票面航司行已有航司名文字，故裁出图形标：
 * 裁标区（空隙分界实测）→ 裁透明边 → 输出，保持图形标原始比例。
 *
 * Python/PIL 不可用（系统仅 Store stub），用 Node + pngjs。
 * 用法: node scripts/rebuild-logo-mark.cjs <png路径> <标区右边界px>
 */
const fs = require('fs');
const { PNG } = require('pngjs');

const OUT = process.argv[2];
const MARK_RIGHT = Number(process.argv[3] || 290);

const src = PNG.sync.read(fs.readFileSync(OUT));
const { width, height } = src;

const markW = Math.min(MARK_RIGHT, width);
const mark = new PNG({ width: markW, height });
PNG.bitblt(src, mark, 0, 0, markW, height, 0, 0);

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

fs.writeFileSync(OUT, PNG.sync.write(crop, { deflateLevel: 9 }));
console.log(`已生成 ${OUT}  ${cw}x${ch}  ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);