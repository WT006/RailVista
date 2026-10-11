#!/usr/bin/env node
// check-overshoot.mjs —— 超长线排查：totalKm 显著超过 officialKm 的线（重复线残留信号）
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data/roads/geom';
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const rows = [];
for (const f of files) {
  const g = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!g.officialKm || !g.totalKm) continue;
  const ratio = g.totalKm / g.officialKm;
  if (ratio > 1.25) rows.push({ f, ref: g.ref, cls: g.class, total: Math.round(g.totalKm), official: g.officialKm, ratio: ratio.toFixed(2), trimmed: !!g.dedupTrimmed });
}
rows.sort((a, b) => b.ratio - a.ratio);
console.log('超长线（total>official*1.25）:', rows.length);
for (const r of rows.slice(0, 40)) console.log(`  ${r.f} ${r.cls} total=${r.total} official=${r.official} x${r.ratio} trimmed=${r.trimmed}`);
