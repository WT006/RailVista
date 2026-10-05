/**
 * 万里路书 · 全国路网光栅背景（scripts/build-drive-network-raster.mjs）
 *
 *   data/roads/net/*.rvwn + data/roads/geom/*.json  →  apps/web/public/drive-network.png
 *
 * 为什么要位图：全国可通行道路 790 万条 / 编号公路 1.5 万条，
 * 任何"把折线打进前端"的方案都不可行（旧实现因此只能画 33 条）。
 * 构建期一次性把整张路网渲染成 PNG，前端只加载一张图 —— 体积可控、观感完整。
 *
 * 用法：node scripts/build-drive-network-raster.mjs [--width 1800] [--no-base]
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster, encodePng, hexToRgb } from './lib/raster.mjs';
import { openRvwn, loadNodes } from './lib/rvwn.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NET_DIR = join(ROOT, 'data/roads/net');
const GEOM_DIR = join(ROOT, 'data/roads/geom');
const OUT = join(ROOT, 'apps/web/public/drive-network.png');

const args = process.argv.slice(2);
const OUT_W = Number(args.includes('--width') ? args[args.indexOf('--width') + 1] : 1800);
const WITH_BASE = !args.includes('--no-base');

// 与 chinaBackdrop.ts 严格一致的墨卡托参数（背景与铁路页同坐标系）
const B = { minX: 1.2828581027, maxX: 2.3578445245, minY: 0.0670400688, maxY: 1.1112870864 };
const VIEW_W = 1000;
const VIEW_H = 971;
const SS = 2;
const RW = OUT_W * SS;
const RH = Math.round((OUT_W * (VIEW_H / VIEW_W))) * SS;

const CLASS_COLOR = {
  expressway: '#ffb84d',
  national: '#4d9fff',
  provincial: '#7ee0c0',
  county: '#b79cff',
  township: '#93a1b5',
  village: '#7b8798',
  other: '#6b7280',
};
const CLASS_ALPHA = {
  expressway: 0.88,
  national: 0.78,
  provincial: 0.48,
  county: 0.32,
  township: 0.16,
  village: 0.1,
  other: 0.12,
};
const CLASS_GLOW = {
  expressway: 0.14,
  national: 0.1,
  provincial: 0.05,
  county: 0.03,
  township: 0.015,
  village: 0.01,
  other: 0.01,
};

const scale = RW / VIEW_W;
function project(lng, lat) {
  const x = lng * (Math.PI / 180);
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
  return [((x - B.minX) / (B.maxX - B.minX)) * RW, RH - ((y - B.minY) / (B.maxY - B.minY)) * RH];
}

const raster = new Raster(RW, RH);
const bgColor = hexToRgb('#7f8ea3');

// ── 1. 基础层：全部可通行道路（含无编号的乡道村道） ─────────────────────────
if (WITH_BASE) {
  const shards = existsSync(NET_DIR) ? readdirSync(NET_DIR).filter((f) => f.endsWith('.rvwn')).sort() : [];
  let ways = 0;
  const t0 = Date.now();
  for (const f of shards) {
    const path = join(NET_DIR, f);
    const { ids, lngs, lats } = loadNodes(path);
    // 预投影节点池（每省一次，避免逐 way 重复三角函数）
    const px = new Float32Array(ids.length);
    const py = new Float32Array(ids.length);
    for (let i = 0; i < ids.length; i += 1) {
      const [x, y] = project(lngs[i], lats[i]);
      px[i] = x;
      py[i] = y;
    }
    const r = openRvwn(path);
    let buf = [];
    for (const w of r.iterateWays()) {
      const idx = r.readWayIndices(w);
      buf.length = 0;
      let lx = -1;
      let ly = -1;
      for (let i = 0; i < idx.length; i += 1) {
        const k = idx[i];
        if (k < 0) continue;
        const x = px[k];
        const y = py[k];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const rx = Math.round(x * 2) / 2;
        const ry = Math.round(y * 2) / 2;
        if (rx === lx && ry === ly) continue;
        lx = rx; ly = ry;
        buf.push([rx, ry]);
      }
      // 基础层（全部可通行道路）刻意压暗：东部路网极密，alpha 稍高就会糊成白块，
      // 反而看不出等级结构。编号公路层随后以等级色覆盖上去。
      if (buf.length >= 2) raster.polyline(buf, bgColor, 0.045);
      ways += 1;
    }
    r.close();
    console.log('  [base] ' + f.padEnd(24) + ' ways=' + String(ways).padStart(8) + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
  }
}

// ── 2. 编号公路层：按等级上色 + 光晕 ────────────────────────────────────────
let drawn = 0;
const t1 = Date.now();
if (existsSync(GEOM_DIR)) {
  const files = readdirSync(GEOM_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    let g;
    try {
      g = JSON.parse(readFileSync(join(GEOM_DIR, f), 'utf8'));
    } catch { continue; }
    const cls = g.class ?? 'other';
    const color = hexToRgb(CLASS_COLOR[cls] ?? CLASS_COLOR.other);
    const alpha = CLASS_ALPHA[cls] ?? 0.3;
    const glow = CLASS_GLOW[cls] ?? 0.05;
    const chains = [g.points, ...(Array.isArray(g.segments) ? g.segments : [])];
    for (const chain of chains) {
      if (!Array.isArray(chain) || chain.length < 2) continue;
      const pts = [];
      let lx = -1;
      let ly = -1;
      for (const p of chain) {
        const [x, y] = project(p[0], p[1]);
        const rx = Math.round(x * 2) / 2;
        const ry = Math.round(y * 2) / 2;
        if (rx === lx && ry === ly) continue;
        lx = rx; ly = ry;
        pts.push([rx, ry]);
      }
      if (pts.length >= 2) {
        raster.polyline(pts, color, alpha, glow);
        drawn += 1;
      }
    }
  }
}
console.log('  [numbered] 折线 ' + drawn + ' 条 (' + ((Date.now() - t1) / 1000).toFixed(0) + 's)');

// ── 3. 输出 PNG ─────────────────────────────────────────────────────────────
const { width, height, rgb } = raster.toRgb(SS, 0.95);
const png = encodePng(width, height, rgb);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log('\n→ apps/web/public/drive-network.png  ' + width + '×' + height + '  ' + (png.length / 1024).toFixed(0) + 'KB');
