const fs = require('fs');
const { PNG } = require('pngjs');

const file = process.argv[2];
const png = PNG.sync.read(fs.readFileSync(file));
const { width, height, data } = png;

const colHas = new Array(width).fill(false);
const rowHas = new Array(height).fill(false);
let redBbox = null, blueBbox = null, opaque = 0;

const inBox = (x, y, box) => {
  if (!box) return (box = { x0: x, y0: y, x1: x, y1: y });
  if (x < box.x0) box.x0 = x;
  if (y < box.y0) box.y0 = y;
  if (x > box.x1) box.x1 = x;
  if (y > box.y1) box.y1 = y;
  return box;
};

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a > 10) {
      colHas[x] = true; rowHas[y] = true; opaque++;
      const isRed = r > 170 && g < 90 && b < 90;
      const isBlue = b > 80 && b < 160 && r < 80 && g < 80;
      if (isRed) redBbox = inBox(x, y, redBbox);
      if (isBlue) blueBbox = inBox(x, y, blueBbox);
    }
  }
}

const bboxOf = (arr) => {
  let x0 = -1, x1 = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i]) { if (x0 < 0) x0 = i; x1 = i; }
  return [x0, x1];
};

console.log(`file=${file} ${width}x${height}`);
console.log(`content bbox: x=[${bboxOf(colHas)}] y=[${bboxOf(rowHas)}] opaquePx=${opaque}`);
console.log(`red bbox:`, redBbox);
console.log(`blue bbox:`, blueBbox);
console.log(`transparent bg: corner alpha=${data[3]}`);