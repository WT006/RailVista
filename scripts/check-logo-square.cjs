/**
 * 航司 logo 素材规格校验脚本。
 *
 * 遍历 apps/web/src/assets/ticket/ 全部航司 logo，逐文件报告：
 *   code / 宽×高 / 是否 1:1 / 体积KB / 是否透明底
 *
 * 断言规则：
 *   16 家新素材（gs~ry）必须 1:1 + ≤50KB + 透明底，超标 FAIL
 *   存量超标（zh/mf/sc/9c/ho）仅报告不断言，标注"超标豁免"
 *   mu 已 1:1 豁免、ca/cz/3u 归一后应 1:1
 *   jpg 标注"pngjs 不支持仅报告尺寸"
 *   文件缺失标记 MISSING
 *
 * 用法: node scripts/check-logo-square.cjs
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ASSET_DIR = 'apps/web/src/assets/ticket';
const FILE_MAP = {
  ca: 'ca.png', cz: 'cz.png', mu: 'mu.png', hu: 'hu.jpg', mf: 'mf.jpg',
  '3u': '3u.png', zh: 'zh.png', sc: 'sc-crop.png', '9c': '9c.jpg', ho: 'ho.png',
  gs: 'gs.png', jd: 'jd.png', kn: 'kn.png', g5: 'g5.png', eu: 'eu.png',
  wz: 'wz.png', ns: 'ns.png', fu: 'fu.png', uq: 'uq.png', aq: 'aq.png',
  gj: 'gj.png', qw: 'qw.png', gt: 'gt.png', a6: 'a6.png', gx: 'gx.png', ry: 'ry.png',
};
const NEW16 = new Set(['gs', 'jd', 'kn', 'g5', 'eu', 'wz', 'ns', 'fu', 'uq', 'aq', 'gj', 'qw', 'gt', 'a6', 'gx', 'ry']);
const OVERSIZE = new Set(['zh', 'mf', 'sc', '9c', 'ho']);

let fail = 0;
const rows = [];
for (const code of Object.keys(FILE_MAP)) {
  const file = FILE_MAP[code];
  const fp = path.join(ASSET_DIR, file);
  if (!fs.existsSync(fp)) {
    rows.push([code, file, 'MISSING', '-', '-', '-', NEW16.has(code) ? 'FAIL' : '-']);
    if (NEW16.has(code)) fail++;
    continue;
  }
  const kb = (fs.statSync(fp).size / 1024).toFixed(0);
  if (file.endsWith('.jpg')) {
    rows.push([code, file, 'jpg', '-', `${kb}KB`, '-', OVERSIZE.has(code) ? '超标豁免' : '建议人工归一']);
    continue;
  }
  try {
    const png = PNG.sync.read(fs.readFileSync(fp));
    const w = png.width, h = png.height;
    const isSquare = w === h;
    let transparent = true;
    for (let i = 3; i < png.data.length; i += 4) { if (png.data[i] < 250) { transparent = true; break; } transparent = false; }
    const overKb = fs.statSync(fp).size > 50 * 1024;
    let status = 'PASS';
    if (NEW16.has(code)) {
      if (!isSquare || overKb || !transparent) { status = 'FAIL'; fail++; }
    } else if (OVERSIZE.has(code)) {
      status = '超标豁免';
    } else if (!isSquare) {
      status = 'FAIL'; fail++;
    }
    rows.push([code, file, `${w}×${h}`, isSquare ? '1:1' : '非1:1', `${kb}KB`, transparent ? '透明' : '非透明', status]);
  } catch (e) {
    rows.push([code, file, 'ERR', '-', '-', '-', e.message]);
    fail++;
  }
}

const W = [6, 16, 10, 7, 7, 7, 10];
console.log(['code', 'file', 'size', 'ratio', 'vol', 'alpha', 'status'].map((h, i) => h.padEnd(W[i])).join('  '));
for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(W[i])).join('  '));
console.log(`\nFAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);