#!/usr/bin/env node
// s-accept.mjs —— S/X/Y 线验收：对比基线 provincial-issues.json
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data/roads/geom';
const baseline = JSON.parse(fs.readFileSync('scripts/provincial-issues.json', 'utf8'));
const baseMap = new Map(baseline.map((r) => [r.f, r]));
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !/^G\d+\.json$/.test(f));
const now = { overLong: 0, tooShort: 0, fragmented: 0, dead: 0, total: 0 };
const stillBad = [];
for (const f of files) {
  let g;
  try { g = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
  if (g.points.length < 2) { now.dead += 1; stillBad.push({ f, issue: 'dead' }); continue; }
  now.total += 1;
  const comps = 1 + (g.segments || []).length;
  const total = g.totalKm || 0;
  const official = g.officialKm || 0;
  const kind = official && total > official * 1.5 ? 'overLong' : official && total < official * 0.6 ? 'tooShort' : comps >= 6 ? 'fragmented' : null;
  if (kind) {
    now[kind] += 1;
    stillBad.push({ f, kind, total: Math.round(total), official, comps });
  }
}
console.log('=== S/X/Y 验收 ===');
console.log('基线: overLong 7 · tooShort 1 · fragmented 1534 · dead 0');
console.log(`现状: overLong ${now.overLong} · tooShort ${now.tooShort} · fragmented ${now.fragmented} · dead ${now.dead}`);
// 省级专项对比
const provBase = baseline.filter((r) => r.cls === 'provincial');
const provStill = stillBad.filter((r) => (baseMap.get(r.f) || {}).cls === 'provincial');
console.log(`省级: 基线问题 ${provBase.length} · 仍问题 ${provStill.length}`);
const cntBase = baseline.filter((r) => r.cls === 'county');
const cntStill = stillBad.filter((r) => (baseMap.get(r.f) || {}).cls === 'county');
console.log(`县级: 基线问题 ${cntBase.length} · 仍问题 ${cntStill.length}`);
const reuseSplit = files.filter((f) => {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).reuseSplit === true; } catch { return false; }
});
console.log('reuseSplit 生效:', reuseSplit.length, reuseSplit.join(', '));
fs.writeFileSync('scripts/provincial-stillbad.json', JSON.stringify(stillBad, null, 1));
const improved = baseline.filter((r) => r.kind === 'fragmented' && !stillBad.find((s) => s.f === r.f));
console.log('fragmented 已修复:', improved.length, '/', baseline.filter((r) => r.kind === 'fragmented').length);
const remain = stillBad.filter((r) => r.kind === 'fragmented').slice(0, 15);
console.log('--- 仍 fragmented 前15 ---');
remain.forEach((r) => console.log(`  ${r.f} total=${r.total} comps=${r.comps}`));
