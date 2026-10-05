/**
 * 万里路书 · 稀疏化自驾背景路网位图
 *
 * 现有 drive-network.png 烘焙了「全可通行道路」底网，东部糊成亮白蜘蛛网。
 * 本脚本对 PNG 做过滤：默认只保留彩色干线（国道蓝 / 高速琥珀），去掉灰色细密底网。
 *
 * 用法：
 *   node scripts/thin-drive-network-raster.mjs
 *   node scripts/thin-drive-network-raster.mjs --threshold 18 --gain 1.35
 *   node scripts/thin-drive-network-raster.mjs --all-bright   # 旧模式：按亮度保留，不区分颜色
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { encodePng } from './lib/raster.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PNG_PATH = join(ROOT, 'apps/web/public/drive-network.png');

const args = process.argv.slice(2);
function numFlag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
}
/** 相对暗底的亮度增量门槛 */
const THRESHOLD = numFlag('--threshold', 16);
/** 保留像素增益 */
const GAIN = numFlag('--gain', 1.35);
/** false=只留蓝/琥珀干线；true=凡够亮都留（旧逻辑） */
const ALL_BRIGHT = args.includes('--all-bright');
const BG = [8, 12, 20];

function decodeRgbPng(buf) {
  if (buf[0] !== 0x89) throw new Error('not a PNG');
  let o = 8;
  let width = 0;
  let height = 0;
  const idats = [];
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2) throw new Error(`unsupported PNG ${data[8]}/${data[9]}`);
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    o += 12 + len;
  }
  const inflated = inflateSync(Buffer.concat(idats));
  const stride = width * 3;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (stride + 1)];
    const row = inflated.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    if (filter === 0) {
      row.copy(rgb, y * stride);
    } else if (filter === 1) {
      for (let x = 0; x < stride; x += 1) {
        const left = x >= 3 ? rgb[y * stride + x - 3] : 0;
        rgb[y * stride + x] = (row[x] + left) & 255;
      }
    } else if (filter === 2) {
      for (let x = 0; x < stride; x += 1) {
        const up = y > 0 ? rgb[(y - 1) * stride + x] : 0;
        rgb[y * stride + x] = (row[x] + up) & 255;
      }
    } else {
      throw new Error(`unsupported PNG filter ${filter}`);
    }
  }
  return { width, height, rgb };
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 国道蓝 / 高速琥珀：相对暗底的色增量足够「有颜色」 */
function isTrunkDelta(dr, dg, db) {
  const max = Math.max(dr, dg, db);
  const min = Math.min(dr, dg, db);
  const chroma = max - min;
  if (chroma < 14) return false; // 灰白细线
  const blue = db > dr + 6 && db >= dg; // #4d9fff 一带
  const amber = dr > db + 4 && dr >= dg * 0.85; // #ffb84d 一带
  return blue || amber;
}

const bgLuma = luma(...BG);
const { width, height, rgb } = decodeRgbPng(readFileSync(PNG_PATH));
const out = Buffer.alloc(rgb.length);

let kept = 0;
let cleared = 0;
for (let i = 0; i < rgb.length; i += 3) {
  const r = rgb[i];
  const g = rgb[i + 1];
  const b = rgb[i + 2];
  const dr = r - BG[0];
  const dg = g - BG[1];
  const db = b - BG[2];
  const d = luma(r, g, b) - bgLuma;
  const keep = ALL_BRIGHT
    ? d >= THRESHOLD
    : d >= THRESHOLD && isTrunkDelta(dr, dg, db);
  if (!keep) {
    out[i] = BG[0];
    out[i + 1] = BG[1];
    out[i + 2] = BG[2];
    cleared += 1;
    continue;
  }
  const lift = (v, base) => Math.max(0, Math.min(255, Math.round(base + (v - base) * GAIN)));
  out[i] = lift(r, BG[0]);
  out[i + 1] = lift(g, BG[1]);
  out[i + 2] = lift(b, BG[2]);
  kept += 1;
}

const png = encodePng(width, height, out);
writeFileSync(PNG_PATH, png);
const total = kept + cleared;
console.log(
  `→ ${PNG_PATH}\n` +
    `  ${width}×${height}  ${(png.length / 1024).toFixed(0)}KB\n` +
    `  mode=${ALL_BRIGHT ? 'all-bright' : 'trunk-only'} threshold=${THRESHOLD} gain=${GAIN}\n` +
    `  kept=${((kept / total) * 100).toFixed(2)}%  cleared=${((cleared / total) * 100).toFixed(2)}%`,
);
