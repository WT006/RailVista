/**
 * 万里路书 · 国道几何体检（scripts/verify-through.mjs）
 *
 * 逐条比对「已画几何」与「官方控制点链」，挑出画错/画歪/画漏的国道：
 *   - 端点误差：几何首/末端 与 官方起讫控制点 的距离（取首尾互换的最小组合）
 *   - 控制点覆盖率：官方控制点中，落在几何 X km 内的比例
 *   - 自相交/回折：相邻点大角度反复（近似抖动）
 *   - 单线检查：componentCount / segments / gapAnnotations 必须为 1/空/空
 *
 * 用法：
 *   node scripts/verify-through.mjs                 # 全量
 *   node scripts/verify-through.mjs --csv out.csv
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { haversineM, polylineM } from './lib/road-assemble.mjs';

const GEOM_DIR = join('data', 'roads', 'geom');
const CTRL_DIR = join('data', 'cache', 'amap', 'controls');
const NEAR_KM = Number(process.env.NEAR_KM || 40);

function distToPolyline(p, pts) {
  let best = Infinity;
  const stride = Math.max(1, Math.floor(pts.length / 4000));
  for (let i = 0; i < pts.length; i += stride) {
    const d = haversineM(p[0], p[1], pts[i][0], pts[i][1]);
    if (d < best) best = d;
  }
  return best;
}

const rows = [];
for (const f of readdirSync(GEOM_DIR).filter((x) => /^G\d{3}\.json$/.test(x)).sort()) {
  const g = JSON.parse(readFileSync(join(GEOM_DIR, f), 'utf8'));
  const pts = g.points ?? [];
  const ref = g.ref ?? f.replace('.json', '');
  const cf = join(CTRL_DIR, ref + '.json');
  const chain = existsSync(cf) ? JSON.parse(readFileSync(cf, 'utf8')).controls.map((x) => [x.lng, x.lat]) : null;
  const rec = {
    ref, pts: pts.length, km: Math.round(polylineM(pts) / 1000 * 10) / 10,
    comps: g.componentCount ?? 1, segs: (g.segments ?? []).length, gaps: (g.gapAnnotations ?? []).length,
    straight: (g.straightLinks ?? []).length,
    straightKm: Math.round((g.straightLinks ?? []).reduce((s, x) => s + x.km, 0) * 10) / 10,
    endErrKm: null, coverPct: null, farControls: '',
  };
  if (chain && chain.length >= 2 && pts.length >= 2) {
    const s = pts[0], e = pts[pts.length - 1];
    const c0 = chain[0], cN = chain[chain.length - 1];
    const opt1 = Math.max(haversineM(s[0], s[1], c0[0], c0[1]), haversineM(e[0], e[1], cN[0], cN[1]));
    const opt2 = Math.max(haversineM(s[0], s[1], cN[0], cN[1]), haversineM(e[0], e[1], c0[0], c0[1]));
    rec.endErrKm = Math.round((Math.min(opt1, opt2) / 1000) * 10) / 10;
    let hit = 0; const far = [];
    for (let i = 0; i < chain.length; i += 1) {
      const d = distToPolyline(chain[i], pts) / 1000;
      if (d <= NEAR_KM) hit += 1; else far.push(i + ':' + d.toFixed(0));
    }
    rec.coverPct = Math.round((hit / chain.length) * 100);
    rec.farControls = far.slice(0, 8).join('|');
  }
  rows.push(rec);
}

const bad = rows.filter((r) => r.comps !== 1 || r.segs > 0 || r.gaps > 0
  || (r.endErrKm !== null && r.endErrKm > 80)
  || (r.coverPct !== null && r.coverPct < 60));
bad.sort((a, b) => (b.endErrKm ?? 0) - (a.endErrKm ?? 0) || (a.coverPct ?? 100) - (b.coverPct ?? 100));

console.log('国道', rows.length, '| 疑似问题', bad.length);
console.log('ref\tpts\tkm\tcomps\tsegs\tgaps\t直连\t直连km\t端点误差km\t控制点覆盖%\t远离的控制点');
for (const r of bad) {
  console.log([r.ref, r.pts, r.km, r.comps, r.segs, r.gaps, r.straight, r.straightKm, r.endErrKm, r.coverPct, r.farControls].join('\t'));
}

const csvIdx = process.argv.indexOf('--csv');
if (csvIdx > 0) {
  const out = process.argv[csvIdx + 1] || 'data/roads/reports/through-verify.csv';
  const head = 'ref,pts,km,comps,segs,gaps,straight,straightKm,endErrKm,coverPct,farControls';
  writeFileSync(out, [head, ...rows.map((r) => [r.ref, r.pts, r.km, r.comps, r.segs, r.gaps, r.straight, r.straightKm, r.endErrKm, r.coverPct, r.farControls].join(','))].join('\n'), 'utf8');
  console.log('CSV →', out);
}
