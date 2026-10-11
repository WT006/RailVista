#!/usr/bin/env node
// assess-damage.mjs —— 评估上一轮环修剪误伤：dedupTrimmed=true 且 totalKm/officialKm < 0.6 或 points < 10
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data/roads/geom';
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const dead = [];
const okTrim = [];
for (const f of files) {
  const g = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!g.dedupTrimmed) continue;
  const ref = g.ref || f.replace('.json', '');
  const ratio = g.officialKm ? g.totalKm / g.officialKm : null;
  const broken = g.points.length < 10 || (ratio !== null && ratio < 0.6);
  if (broken) dead.push({ ref, totalKm: g.totalKm, officialKm: g.officialKm || '-', pts: g.points.length, ratio: ratio === null ? '-' : ratio.toFixed(2) });
  else okTrim.push({ ref, totalKm: g.totalKm, officialKm: g.officialKm || '-', ratio: ratio === null ? '-' : ratio.toFixed(2) });
}
console.log('=== 疑似毁坏（需重建）:', dead.length, '===');
for (const d of dead) console.log(`  ${d.ref} total=${d.totalKm} official=${d.officialKm} pts=${d.pts} ratio=${d.ratio}`);
console.log('=== 剪后仍合理:', okTrim.length, '===');
