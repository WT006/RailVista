/**
 * 通用航司 logo 1:1 正方形画布归一脚本。
 *
 * 提炼自 rebuild-mu-logo-square.cjs 的「裁透明边 + 1:1 画布居中」两步，
 * 剥离 mu 专属「裁燕子标区 MARK_RIGHT=300」步骤，对整图直接归一。
 *
 * 白名单分类：
 *   mu 豁免（上一阶段已 270×270）/ ca·cz·3u 归一 /
 *   zh·mf·sc·9c·ho 超标仅归一画布不瘦身 / gs~ry 新素材统一归一 /
 *   联盟徽章与路徽豁免
 *
 * jpg 素材 pngjs 不支持，记录告警不自动处理（hu 人工归一、mf/9c 超标豁免）。
 *
 * 用法:
 *   node scripts/rebuild-logo-square-all.cjs                       # 全量
 *   node scripts/rebuild-logo-square-all.cjs --target ca,cz,3u      # 子集
 *   node scripts/rebuild-logo-square-all.cjs --target ca --dry-run  # 干跑
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ASSET_DIR = 'apps/web/src/assets/ticket';
const SIDE_MAX = 480;

const FILE_MAP = {
  ca: 'ca.png', cz: 'cz.png', mu: 'mu.png', hu: 'hu.jpg', mf: 'mf.jpg',
  '3u': '3u.png', zh: 'zh.png', sc: 'sc-crop.png', '9c': '9c.jpg', ho: 'ho.png',
  gs: 'gs.png', jd: 'jd.png', kn: 'kn.png', g5: 'g5.png', eu: 'eu.png',
  wz: 'wz.png', ns: 'ns.png', fu: 'fu.png', uq: 'uq.png', aq: 'aq.png',
  gj: 'gj.png', qw: 'qw.png', gt: 'gt.png', a6: 'a6.png', gx: 'gx.png', ry: 'ry.png',
};
const EXEMPT = new Set(['mu']);
const OVERSIZE = new Set(['zh', 'mf', 'sc', '9c', 'ho']);

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const targetIdx = argv.indexOf('--target');
const target = targetIdx >= 0 && argv[targetIdx + 1]
  ? argv[targetIdx + 1].split(',').map((s) => s.trim().toLowerCase())
  : Object.keys(FILE_MAP);

const span = (arr) => {
  let a = 0, b = arr.length - 1;
  while (a <= b && !arr[a]) a++;
  while (b >= a && !arr[b]) b--;
  return [a, b];
};

function bbox(png) {
  const { width, height, data } = png;
  const colHas = new Array(width).fill(false);
  const rowHas = new Array(height).fill(false);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) { colHas[x] = true; rowHas[y] = true; }
    }
  }
  const [x0, x1] = span(colHas);
  const [y0, y1] = span(rowHas);
  if (x0 > x1 || y0 > y1) return null;
  return { x0, y0, cw: x1 - x0 + 1, ch: y1 - y0 + 1 };
}

function cropPng(src, x0, y0, cw, ch) {
  const dst = new PNG({ width: cw, height: ch });
  PNG.bitblt(src, dst, x0, y0, cw, ch, 0, 0);
  return dst;
}

function resize(src, rw, rh) {
  const { width: sw, height: sh } = src;
  const dst = new PNG({ width: rw, height: rh });
  for (let y = 0; y < rh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / rh));
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / rw));
      const si = (sy * sw + sx) * 4;
      const di = (y * rw + x) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

function normalize(src, oversize) {
  const box = bbox(src);
  if (!box) return null;
  const { x0, y0, cw, ch } = box;
  const crop = cropPng(src, x0, y0, cw, ch);
  const side = oversize ? Math.max(cw, ch) : Math.min(Math.max(cw, ch), SIDE_MAX);
  const scale = Math.min(side / cw, side / ch);
  const rw = Math.round(cw * scale);
  const rh = Math.round(ch * scale);
  const scaled = scale < 1 ? resize(crop, rw, rh) : crop;
  const square = new PNG({ width: side, height: side });
  PNG.bitblt(scaled, square, 0, 0, rw, rh, Math.floor((side - rw) / 2), Math.floor((side - rh) / 2));
  return square;
}

let pass = 0, skip = 0, fail = 0;
for (const code of target) {
  const file = FILE_MAP[code];
  if (!file) { console.log(`[${code}] UNKNOWN 跳过（无文件映射）`); skip++; continue; }
  if (EXEMPT.has(code)) { console.log(`[${code}] 豁免已 1:1 跳过`); skip++; continue; }
  const fp = path.join(ASSET_DIR, file);
  if (!fs.existsSync(fp)) { console.log(`[${code}] MISSING ${file} 跳过（待落位）`); skip++; continue; }
  if (file.endsWith('.jpg')) { console.log(`[${code}] JPG ${file} pngjs 不支持，记录告警（${OVERSIZE.has(code) ? '超标豁免维持现状' : '建议人工归一为 png'}）`); skip++; continue; }
  try {
    const src = PNG.sync.read(fs.readFileSync(fp));
    const ow = src.width, oh = src.height;
    if (ow === oh) { console.log(`[${code}] ${ow}×${oh} 已 1:1 跳过`); skip++; continue; }
    const out = normalize(src, OVERSIZE.has(code));
    if (!out) { console.log(`[${code}] ${ow}×${oh} 空内容跳过`); skip++; continue; }
    const kb = (fs.statSync(fp).size / 1024).toFixed(0);
    if (!dryRun) fs.writeFileSync(fp, PNG.sync.write(out, { deflateLevel: 9 }));
    const newKb = dryRun ? '?' : (fs.statSync(fp).size / 1024).toFixed(0);
    const warn = !OVERSIZE.has(code) && !dryRun && fs.statSync(fp).size > 50 * 1024 ? ' ⚠超50KB需复核' : '';
    console.log(`[${code}] ${ow}×${oh} ${kb}KB → ${out.width}×${out.height} ${newKb}KB ${dryRun ? '(干跑)' : '✓'}${warn}`);
    pass++;
  } catch (e) {
    console.log(`[${code}] FAIL ${file} ${e.message}`);
    fail++;
  }
}
console.log(`\n归一 ${pass} / 跳过 ${skip} / 失败 ${fail}${dryRun ? ' （干跑模式）' : ''}`);