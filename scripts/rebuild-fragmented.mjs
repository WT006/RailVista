#!/usr/bin/env node
// rebuild-fragmented.mjs —— 对散段省道（comps>=6）+ overLong 用 ROAD_STITCH_M=25000 重装配
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const issues = JSON.parse(fs.readFileSync('scripts/provincial-issues.json', 'utf8'));
const targets = issues.filter((r) => {
  if (r.cls !== 'provincial') return false;
  if (r.kind === 'fragmented' || r.kind === 'overLong' || r.kind === 'tooShort') return true;
  return false;
});
console.log('待重装配省道:', targets.length);
const SKIP_FRESH_MS = 2 * 3600 * 1000; // 2小时内已重写的跳过（续跑模式）
let skipped = 0;
const results = [];
let done = 0;
for (const t of targets) {
  const fp = 'data/roads/geom/' + t.f;
  if (fs.existsSync(fp) && Date.now() - fs.statSync(fp).mtimeMs < SKIP_FRESH_MS) { skipped += 1; continue; }
  const key = t.f.replace('_', ':').replace('.json', '');
  try {
    execFileSync('node', ['scripts/build-road-geom.mjs', '--key', key], {
      stdio: 'ignore',
      env: { ...process.env, ROAD_STITCH_M: '25000' },
      timeout: 120000,
    });
    const g = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const comps = 1 + (g.segments || []).length;
    results.push({ f: t.f, before: { comps: t.comps, total: t.total }, after: { comps, total: Math.round(g.totalKm || 0), gaps: (g.gapAnnotations || []).length } });
    done += 1;
    if (done % 50 === 0) console.log(`  ${done}/${targets.length} ...`);
  } catch (e) {
    results.push({ f: t.f, error: String(e.message).slice(0, 80) });
  }
}
fs.writeFileSync('scripts/rebuild-fragmented-result.json', JSON.stringify(results, null, 1));
const ok = results.filter((r) => !r.error);
const improved = ok.filter((r) => r.after.comps < r.before.comps);
console.log(`完成 ${ok.length}/${targets.length}（跳过已重写 ${skipped}），组件减少 ${improved.length} 条`);
const better = improved.slice(0, 20);
for (const r of better) console.log(`  ${r.f}: comps ${r.before.comps}->${r.after.comps}, total ${r.before.total}->${r.after.total}, gaps=${r.after.gaps}`);
