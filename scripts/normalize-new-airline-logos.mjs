/**
 * 新增 16 家航司 logo 1:1 归一落位脚本。
 *
 * 输入：tmp-logos/<src>（混合 png/jpeg，白底或透明底，个别为整块色板 app 图标）。
 * 处理：嗅探格式 → 解码 RGBA → 裁内容 bbox（透明用 alpha，白底用近白背景）→
 *       居中放到 1:1 正方形画布（透明源留透明、白底源铺白）→ 长边限 480（box 平均降采样）→ PNG。
 * 特例：NO_CROP 中的整块色板 app 图标（gt 桂林蓝底）不裁内容，直接整幅缩方，
 *       否则白色字标会被裁到透明底上、在白票面上不可见。
 *
 * 用法: node scripts/normalize-new-airline-logos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const SRC = 'tmp-logos';
const OUT = 'apps/web/src/assets/ticket';
const SIDE_MAX = 480;

// code -> 源文件名
const SRC_MAP = {
  eu: 'eu.png', gs: 'gs.png', kn: 'kn.png', fu: 'fu.png', uq: 'uq.png', gj: 'gj.png',
  jd: 'jd.png', ns: 'ns.png', aq: 'aq.png', g5: 'g5.png', wz: 'wz.png', a6: 'a6.png',
  qw: 'qw2.png', ry: 'ry2.jpg', gx: 'gx3.png', gt: 'gt.png',
};
const NO_CROP = new Set(['gt']);

function decode(buf) {
  const isPng = buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (isPng) {
    const p = PNG.sync.read(buf);
    return { width: p.width, height: p.height, data: p.data, hasAlpha: true };
  }
  const d = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: d.width, height: d.height, data: d.data, hasAlpha: false };
}

function alphaStats(img) {
  let minA = 255, trans = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    const a = img.data[i];
    if (a < minA) minA = a;
    if (a < 128) trans++;
  }
  return { minA, transRatio: trans / (img.width * img.height) };
}

function cornerColor(img) {
  const { width: w, height: h, data } = img;
  const idx = (x, y) => (y * w + x) * 4;
  const pts = [idx(0, 0), idx(w - 1, 0), idx(0, h - 1), idx(w - 1, h - 1)];
  let r = 0, g = 0, b = 0;
  for (const i of pts) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  return [Math.round(r / 4), Math.round(g / 4), Math.round(b / 4)];
}

function bbox(img, mode, bg) {
  const { width: w, height: h, data } = img;
  const isContent = (i) => {
    if (mode === 'alpha') return data[i + 3] > 10;
    const dr = Math.abs(data[i] - bg[0]), dg = Math.abs(data[i + 1] - bg[1]), db = Math.abs(data[i + 2] - bg[2]);
    return dr + dg + db > 60; // 与背景色差异足够大才算内容
  };
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isContent((y * w + x) * 4)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0 || y1 < 0) return null;
  return { x0, y0, cw: x1 - x0 + 1, ch: y1 - y0 + 1 };
}

// box 平均降采样（比 nearest 更平滑，logo 细线不易锯齿）
function downscale(img, rw, rh) {
  const { width: sw, height: sh, data } = img;
  const out = Buffer.alloc(rw * rh * 4);
  for (let y = 0; y < rh; y++) {
    const sy0 = Math.floor((y * sh) / rh), sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * sh) / rh));
    for (let x = 0; x < rw; x++) {
      const sx0 = Math.floor((x * sw) / rw), sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * sw) / rw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * sw + sx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]; n++;
        }
      }
      const o = (y * rw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: rw, height: rh, data: out };
}

function blit(src, dst, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      const di = ((y + dy) * dst.width + (x + dx)) * 4;
      const sa = src.data[si + 3] / 255;
      // 源不透明则覆盖；半透明按 alpha 混合到画布底色
      dst.data[di] = src.data[si] * sa + dst.data[di] * (1 - sa);
      dst.data[di + 1] = src.data[si + 1] * sa + dst.data[di + 1] * (1 - sa);
      dst.data[di + 2] = src.data[si + 2] * sa + dst.data[di + 2] * (1 - sa);
      dst.data[di + 3] = Math.max(dst.data[di + 3], src.data[si + 3]);
    }
  }
}

fs.mkdirSync(OUT, { recursive: true });

for (const [code, file] of Object.entries(SRC_MAP)) {
  const fp = path.join(SRC, file);
  if (!fs.existsSync(fp)) { console.log(`[${code}] MISSING ${file}`); continue; }
  const img = decode(fs.readFileSync(fp));
  const { minA, transRatio } = alphaStats(img);
  const transparent = img.hasAlpha && minA === 0 && transRatio > 0.05;
  const bg = transparent ? null : cornerColor(img);

  let content = img;
  if (!NO_CROP.has(code)) {
    const box = bbox(img, transparent ? 'alpha' : 'bg', bg);
    if (!box) { console.log(`[${code}] empty content, skip`); continue; }
    // 裁出内容
    const cropped = { width: box.cw, height: box.ch, data: Buffer.alloc(box.cw * box.ch * 4) };
    for (let y = 0; y < box.ch; y++) {
      for (let x = 0; x < box.cw; x++) {
        const si = ((y + box.y0) * img.width + (x + box.x0)) * 4;
        const di = (y * box.cw + x) * 4;
        cropped.data[di] = img.data[si]; cropped.data[di + 1] = img.data[si + 1];
        cropped.data[di + 2] = img.data[si + 2]; cropped.data[di + 3] = img.data[si + 3];
      }
    }
    content = cropped;
  }

  // 长边限 SIDE_MAX
  let scaled = content;
  const longSide = Math.max(content.width, content.height);
  if (longSide > SIDE_MAX) {
    const r = SIDE_MAX / longSide;
    scaled = downscale(content, Math.round(content.width * r), Math.round(content.height * r));
  }

  // 1:1 正方形画布，居中
  const side = Math.max(scaled.width, scaled.height);
  const canvas = { width: side, height: side, data: Buffer.alloc(side * side * 4) };
  if (!transparent) {
    for (let i = 0; i < canvas.data.length; i += 4) {
      canvas.data[i] = bg[0]; canvas.data[i + 1] = bg[1]; canvas.data[i + 2] = bg[2]; canvas.data[i + 3] = 255;
    }
  }
  blit(scaled, canvas, Math.floor((side - scaled.width) / 2), Math.floor((side - scaled.height) / 2));

  const png = new PNG({ width: side, height: side });
  canvas.data.copy(png.data);
  const dst = path.join(OUT, `${code}.png`);
  fs.writeFileSync(dst, PNG.sync.write(png, { deflateLevel: 9 }));
  const kb = (fs.statSync(dst).size / 1024).toFixed(0);
  console.log(`[${code}] ${img.width}x${img.height} ${transparent ? 'transparent' : 'bg' + bg.join(',')} → ${side}x${side} ${kb}KB ✓`);
}
console.log('done');
