#!/usr/bin/env node
// assess-provincial.mjs —— S/X/Y 线质量诊断：超长（ref 重用混装）/ 过短 / 散段
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data/roads/geom';
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !/^G\d+\.json$/.test(f));
const rows = [];
const stat = { total: 0, overLong: 0, tooShort: 0, fragmented: 0, dead: 0 };
for (const f of files) {
  let g;
  try { g = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
  if (g.points.length < 2 && !(g.segments || []).length) { stat.dead += 1; rows.push({ f, ref: g.ref, cls: g.class, kind: 'dead' }); continue; }
  stat.total += 1;
  const segs = (g.segments || []);
  const comps = 1 + segs.length;
  const total = g.totalKm || 0;
  const official = g.officialKm || 0;
  const kind = official && total > official * 1.5 ? 'overLong' : official && total < official * 0.6 ? 'tooShort' : comps >= 6 ? 'fragmented' : null;
  if (kind) {
    stat[kind] += 1;
    rows.push({ f, ref: g.ref, cls: g.class, kind, total: Math.round(total), official, comps });
  }
}
rows.sort((a, b) => (b.total / (b.official || 1)) - (a.total / (a.official || 1)));
fs.writeFileSync('scripts/provincial-issues.json', JSON.stringify(rows, null, 1));
console.log('S/X/Y 总数:', stat.total, '· overLong:', stat.overLong, '· tooShort:', stat.tooShort, '· fragmented:', stat.fragmented, '· dead:', stat.dead);
const byKind = {};
for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
console.log(JSON.stringify(byKind));
console.log('--- overLong top30 ---');
rows.filter((r) => r.kind === 'overLong').slice(0, 30).forEach((r) => console.log(`  ${r.f} ${r.cls} total=${r.total} official=${r.official} comps=${r.comps} x${(r.total / r.official).toFixed(1)}`));
console.log('--- tooShort top15 ---');
rows.filter((r) => r.kind === 'tooShort').slice(0, 15).forEach((r) => console.log(`  ${r.f} ${r.cls} total=${r.total} official=${r.official} comps=${r.comps}`));
console.log('--- fragmented top15 ---');
rows.filter((r) => r.kind === 'fragmented').slice(0, 15).forEach((r) => console.log(`  ${r.f} ${r.cls} total=${r.total} official=${r.official} comps=${r.comps}`));
