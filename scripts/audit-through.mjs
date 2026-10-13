/**
 * 万里路书 · 国道贯通审计（scripts/audit-through.mjs）
 *
 * 扫描 data/roads/geom/*.json，统计每条国道的：
 *   - 组件数（componentCount / points+segments 实际）
 *   - 缺口（gapAnnotations）数量与总长
 *   - 已画里程 vs 官方里程（偏差、precision）
 *   - 最大单段缺口位置
 * 输出 CSV + 控制台汇总，按「缺口总长」降序。
 *
 * 用法：
 *   node scripts/audit-through.mjs                  # 全部
 *   node scripts/audit-through.mjs --min 1          # 只看有缺口的
 *   node scripts/audit-through.mjs --csv out.csv
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { haversineM } from './lib/road-assemble.mjs';

const DIR = join('data', 'roads', 'geom');
const files = readdirSync(DIR).filter((f) => /^G\d{3}\.json$/.test(f)).sort();

function polyM(points) {
  let m = 0;
  for (let i = 1; i < (points?.length ?? 0); i += 1) {
    m += haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return m;
}

const rows = [];
for (const f of files) {
  const g = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const segs = g.segments ?? [];
  const comps = [g.points, ...segs];
  const compCount = comps.length;
  const drawnM = comps.reduce((s, c) => s + polyM(c), 0);
  const gaps = g.gapAnnotations ?? [];
  const gapM = gaps.reduce((s, x) => s + (x.gapKm || 0) * 1000, 0);
  // 相邻组件端点间距（真实断口）
  let endGapM = 0;
  const endGaps = [];
  if (compCount > 1) {
    const ordered = [g.points, ...segs];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const a = ordered[i]; const b = ordered[i + 1];
      if (!a?.length || !b?.length) continue;
      const d1 = haversineM(a[a.length - 1][0], a[a.length - 1][1], b[0][0], b[0][1]);
      const d2 = haversineM(a[0][0], a[0][1], b[b.length - 1][0], b[b.length - 1][1]);
      const d = Math.min(d1, d2);
      endGapM += d;
      endGaps.push(Math.round(d / 1000 * 10) / 10);
    }
  }
  rows.push({
    ref: g.ref ?? f.replace('.json', ''),
    comps: compCount,
    gapN: gaps.length,
    gapKm: Math.round(gapM / 1000 * 10) / 10,
    endGapKm: Math.round(endGapM / 1000 * 10) / 10,
    endGaps: endGaps.join('|'),
    drawnKm: g.drawnKm ?? Math.round(drawnM / 1000 * 10) / 10,
    officialKm: g.officialKm ?? 0,
    dev: g.lengthDeviation ?? null,
    precision: g.precision ?? '-',
    method: g.method ?? '-',
    source: g.source ?? '-',
  });
}

const minGap = Number(process.env.MIN_GAP || 0);
const list = rows.filter((r) => r.gapKm >= minGap || r.endGapKm >= minGap).sort((a, b) => (b.gapKm + b.endGapKm) - (a.gapKm + a.endGapKm));

console.log('国道总数', rows.length, '| 有缺口', rows.filter((r) => r.gapKm + r.endGapKm > 0.5).length);
console.log('ref\tcomps\tgapN\tgapKm\tendGapKm\tdrawn\tofficial\tdev%\tprec');
for (const r of list) {
  console.log([r.ref, r.comps, r.gapN, r.gapKm, r.endGapKm, r.drawnKm, r.officialKm, r.dev, r.precision].join('\t'));
}
const totalGap = rows.reduce((s, r) => s + r.gapKm + r.endGapKm, 0);
console.log('缺口总里程', Math.round(totalGap), 'km');

const csvIdx = process.argv.indexOf('--csv');
if (csvIdx > 0) {
  const out = process.argv[csvIdx + 1] || 'data/roads/reports/through-audit.csv';
  const head = 'ref,comps,gapN,gapKm,endGapKm,endGaps,drawnKm,officialKm,dev,precision';
  writeFileSync(out, [head, ...rows.map((r) => [r.ref, r.comps, r.gapN, r.gapKm, r.endGapKm, r.endGaps, r.drawnKm, r.officialKm, r.dev, r.precision].join(','))].join('\n'), 'utf8');
  console.log('CSV →', out);
}
