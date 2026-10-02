/**
 * 万里路书 · 路网质量分析（scripts/audit-road-network.mjs）
 *
 * 扫 data/roads/geom/*.json，输出：
 *   1. G/E 中与官方里程偏差最大的 N 条（找"官方里程基准过时"或"去重不足"）
 *   2. 连通分量分布（中位/p75/p90/p99/最大、单分量占比、>50 分量的条数）
 *   3. 断口分布（中位/p90/最大、按区间计数）与缝合次数
 *
 * 用法：node --max-old-space-size=6144 scripts/audit-road-network.mjs [topN]
 */
import { readFileSync, readdirSync } from 'node:fs';
const items = [];
for (const f of readdirSync('data/roads/geom')) {
  if (!f.endsWith('.json')) continue;
  try {
    const g = JSON.parse(readFileSync('data/roads/geom/' + f, 'utf8'));
    items.push(g);
  } catch { /* skip */ }
}
const ge = items.filter((g) => g.class === 'expressway' || g.class === 'national');
const withOff = ge.filter((g) => g.officialKm > 0);
const TOPN = Number(process.argv[2]) || 12;
const worst = withOff.map((g) => ({ k: g.key, dev: (g.totalKm - g.officialKm) / g.officialKm, km: g.totalKm, off: g.officialKm, cc: g.componentCount }))
  .sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)).slice(0, TOPN);
console.log('== G/E 里与官方里程偏差最大的 12 条 ==');
for (const w of worst) console.log('  ' + w.k.padEnd(8) + (w.dev * 100).toFixed(0).padStart(6) + '%  ' + String(Math.round(w.km)).padStart(6) + ' / ' + String(w.off).padStart(6) + ' km  分量 ' + w.cc);
const frag = items.map((g) => g.componentCount ?? 1).sort((a, b) => a - b);
const q = (p) => frag[Math.floor(frag.length * p)];
console.log('\n== 连通分量分布（全部 ' + items.length + ' 条）==');
console.log('  中位 ' + q(0.5) + ' · p75 ' + q(0.75) + ' · p90 ' + q(0.9) + ' · p99 ' + q(0.99) + ' · 最大 ' + frag[frag.length - 1]);
console.log('  单分量 ' + frag.filter((x) => x === 1).length + ' 条（' + ((frag.filter((x) => x === 1).length / frag.length) * 100).toFixed(0) + '%）');
console.log('  >50 分量 ' + frag.filter((x) => x > 50).length + ' 条');
const gaps = items.flatMap((g) => (g.gapAnnotations ?? []).map((a) => a.gapKm));
gaps.sort((a, b) => a - b);
console.log('\n== 断口分布（共 ' + gaps.length + ' 处）==');
console.log('  中位 ' + (gaps[Math.floor(gaps.length / 2)] ?? 0).toFixed(2) + ' km · p90 ' + (gaps[Math.floor(gaps.length * 0.9)] ?? 0).toFixed(1) + ' km · 最大 ' + (gaps[gaps.length - 1] ?? 0).toFixed(1) + ' km');
console.log('  <0.5km ' + gaps.filter((x) => x < 0.5).length + ' · 0.5~5km ' + gaps.filter((x) => x >= 0.5 && x < 5).length + ' · >5km ' + gaps.filter((x) => x >= 5).length);
const stitched = items.reduce((s, g) => s + (g.stitchedGaps ?? 0), 0);
console.log('\n缝合次数合计 ' + stitched);