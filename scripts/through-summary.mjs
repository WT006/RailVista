/**
 * 万里路书 · 贯通成果汇总（scripts/through-summary.mjs）
 *
 * 输出：307 条国道是否「一条单线、无断口」，以及走线合理性指标
 *   - 绕行比 = 已画里程 / 起讫点直线距离（过大说明绕路/回折成团）
 *   - 点密度 = 点数 / 里程
 *   - 直连兜底段（高德无路/在建）统计
 *
 * 用法：node scripts/through-summary.mjs [--csv out.csv]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { haversineM, polylineM } from './lib/road-assemble.mjs';

const DIR = join('data', 'roads', 'geom');
const rows = [];
for (const f of readdirSync(DIR).filter((x) => /^G\d{3}\.json$/.test(x)).sort()) {
  const g = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const pts = g.points ?? [];
  const km = polylineM(pts) / 1000;
  const chord = pts.length >= 2 ? haversineM(pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1]) / 1000 : 0;
  const st = g.straightLinks ?? [];
  rows.push({
    ref: g.ref ?? f.replace('.json', ''),
    ok: (g.componentCount ?? 1) === 1 && !(g.segments ?? []).length && !(g.gapAnnotations ?? []).length,
    km: Math.round(km * 10) / 10,
    chord: Math.round(chord * 10) / 10,
    ratio: chord > 1 ? Math.round((km / chord) * 100) / 100 : null,
    pts: pts.length,
    dens: km > 0 ? Math.round(pts.length / km) : 0,
    straightN: st.length,
    straightKm: Math.round(st.reduce((s, x) => s + (x.km ?? 0), 0) * 10) / 10,
    official: g.officialKm ?? null,
    prec: g.precision ?? '-',
  });
}
const single = rows.filter((r) => r.ok).length;
console.log('国道', rows.length, '| 单线贯通', single, '| 仍有断口', rows.length - single);
console.log('总里程', Math.round(rows.reduce((s, r) => s + r.km, 0)), 'km');
console.log('直连兜底：', rows.filter((r) => r.straightN).length, '条 /', rows.reduce((s, r) => s + r.straightN, 0), '段 /',
  Math.round(rows.reduce((s, r) => s + r.straightKm, 0)), 'km');
const weird = rows.filter((r) => r.ratio !== null && r.ratio > 8).sort((a, b) => b.ratio - a.ratio);
console.log('\n绕行比 >8（疑似回折成团）', weird.length);
for (const r of weird.slice(0, 20)) console.log(' ', r.ref, r.km + 'km', '弦' + r.chord + 'km', '比' + r.ratio, r.pts + '点');
const sp = rows.filter((r) => r.dens > 60).sort((a, b) => b.dens - a.dens);
console.log('\n点密度 >60/km（疑似抖动毛刺）', sp.length);
for (const r of sp.slice(0, 15)) console.log(' ', r.ref, r.dens + '点/km', r.pts + '点', r.km + 'km');

const i = process.argv.indexOf('--csv');
if (i > 0) {
  const out = process.argv[i + 1] || 'data/roads/reports/through-summary.csv';
  writeFileSync(out, ['ref,ok,km,chord,ratio,pts,dens,straightN,straightKm,official,prec',
    ...rows.map((r) => [r.ref, r.ok, r.km, r.chord, r.ratio, r.pts, r.dens, r.straightN, r.straightKm, r.official, r.prec].join(','))].join('\n'), 'utf8');
  console.log('CSV →', out);
}
