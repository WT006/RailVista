/**
 * 万里路书 · 直连兜底段清单（scripts/report-straight.mjs）
 * 列出所有 geom 里残留的「直连」段（高德无路/在建），按里程降序，便于逐条攻坚。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join('data', 'roads', 'geom');
const rows = [];
for (const f of readdirSync(DIR).filter((x) => /^G\d{3}\.json$/.test(x))) {
  const g = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  for (const s of (g.straightLinks ?? [])) {
    rows.push({
      ref: g.ref, km: s.km,
      from: (s.from ?? []).map((v) => (+v).toFixed(4)).join(','),
      to: (s.to ?? []).map((v) => (+v).toFixed(4)).join(','),
    });
  }
}
rows.sort((a, b) => b.km - a.km);
console.log('直连段', rows.length, '总里程', Math.round(rows.reduce((s, r) => s + r.km, 0)), 'km');
for (const r of rows) console.log(r.ref, r.km + 'km', r.from, '→', r.to);
const csv = ['ref,km,from,to', ...rows.map((r) => [r.ref, r.km, r.from, r.to].join(','))].join('\n');
writeFileSync('data/roads/reports/straight-links.csv', csv, 'utf8');
console.log('→ data/roads/reports/straight-links.csv');
