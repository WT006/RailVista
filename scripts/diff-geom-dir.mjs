/**
 * 万里路书 · geom 目录对比（scripts/diff-geom-dir.mjs）
 *
 * 用法：node scripts/diff-geom-dir.mjs data/roads/geom.bak-20261012 data/roads/geom
 * 输出每个编号的：组件数 前→后、里程 前→后、缺口数 前→后
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { polylineM } from './lib/road-assemble.mjs';

const [A, B] = [process.argv[2], process.argv[3]];
if (!A || !B) { console.error('用法：node scripts/diff-geom-dir.mjs <旧目录> <新目录>'); process.exit(1); }

function load(dir, ref) {
  const p = join(dir, ref + '.json');
  if (!existsSync(p)) return null;
  const g = JSON.parse(readFileSync(p, 'utf8'));
  const comps = [g.points, ...(g.segments ?? [])].filter((c) => c && c.length >= 2);
  const km = comps.reduce((s, c) => s + polylineM(c), 0) / 1000;
  const gaps = (g.gapAnnotations ?? []).length;
  const gapKm = (g.gapAnnotations ?? []).reduce((s, x) => s + (x.gapKm ?? 0), 0);
  return { comps: comps.length, km: Math.round(km * 10) / 10, gaps, gapKm: Math.round(gapKm * 10) / 10 };
}

const refs = readdirSync(B).filter((f) => /^G\d{3}\.json$/.test(f)).map((f) => f.replace('.json', '')).sort();
let changed = 0, fixed = 0;
const grew = [];
for (const ref of refs) {
  const a = load(A, ref), b = load(B, ref);
  if (!a || !b) continue;
  if (a.comps !== b.comps || a.gaps !== b.gaps || Math.abs(a.km - b.km) > 0.5) {
    changed += 1;
    if (b.comps === 1 && b.gaps === 0 && (a.comps > 1 || a.gaps > 0)) fixed += 1;
    const d = b.km - a.km;
    if (d > 0) grew.push({ ref, d: Math.round(d * 10) / 10, a: a.km, b: b.km });
    console.log(ref.padEnd(6), '组件', a.comps + '→' + b.comps, '缺口', a.gaps + '→' + b.gaps,
      '里程', a.km + '→' + b.km, (d >= 0 ? '+' : '') + (Math.round(d * 10) / 10) + 'km');
  }
}
console.log('\n变化', changed, '条；由「有断口」变为「单线贯通」', fixed, '条');
console.log('里程增加最多的：');
grew.sort((x, y) => y.d - x.d);
for (const g of grew.slice(0, 15)) console.log(' ', g.ref, '+' + g.d + 'km', '(' + g.a + '→' + g.b + ')');
