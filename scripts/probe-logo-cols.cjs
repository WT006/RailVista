const fs = require('fs');
const { PNG } = require('pngjs');

const file = process.argv[2];
const png = PNG.sync.read(fs.readFileSync(file));
const { width, height, data } = png;

const colCount = new Array(width).fill(0);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 10) colCount[x]++;
  }
}

const BUCKET = 20;
for (let b = 0; b < width; b += BUCKET) {
  let sum = 0;
  for (let x = b; x < Math.min(b + BUCKET, width); x++) sum += colCount[x];
  const bar = '#'.repeat(Math.round(sum / BUCKET / 4));
  console.log(`x ${String(b).padStart(4)}-${String(Math.min(b + BUCKET, width) - 1).padStart(4)}  avg ${String(Math.round(sum / BUCKET)).padStart(3)}  ${bar}`);
}