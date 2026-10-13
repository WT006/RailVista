/**
 * 万里路书 · geom 字段一致性校验（scripts/validate-geom.mjs）
 *
 * 校验每条国道几何：
 *   1) 一条单线：componentCount===1、segments 空、gapAnnotations 空
 *   2) cumKm 与 points 等长、单调递增
 *   3) cumKm 末值 ≈ drawnKm（误差 <2km，容差来自四舍五入）
 *   4) points 均为有限坐标、至少 2 点
 *
 * 用法：node scripts/validate-geom.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { polylineM, haversineM } from './lib/road-assemble.mjs';

const FIX = process.argv.includes('--fix');

const DIR = join('data', 'roads', 'geom');
let n = 0, bad = 0;
for (const f of readdirSync(DIR).filter((x) => /^G\d{3}\.json$/.test(x)).sort()) {
  const g = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  n += 1;
  const p = g.points ?? [], c = g.cumKm ?? [];
  const problems = [];
  if (p.length < 2) problems.push('点数<2');
  if (c.length !== p.length) problems.push(`cumKm 长度 ${c.length}≠${p.length}`);
  if ((g.componentCount ?? 1) !== 1) problems.push('componentCount=' + g.componentCount);
  if ((g.segments ?? []).length) problems.push('segments=' + g.segments.length);
  if ((g.gapAnnotations ?? []).length) problems.push('gapAnnotations=' + g.gapAnnotations.length);
  let mono = true;
  for (let i = 1; i < c.length; i += 1) if (c[i] < c[i - 1] - 1e-6) { mono = false; break; }
  if (!mono) problems.push('cumKm 非单调');
  if (!p.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))) problems.push('坐标非有限值');
  // 历史遗留：cumKm 有「km」与「米」两种量纲（API 侧一律重算，不依赖落盘值）。
  // 这里只要求：单调递增、与 points 等长、末值等于实算里程（km 或 米 均可）。
  const L = polylineM(p) / 1000;
  const last = c[c.length - 1] ?? 0;
  const unitOk = Math.abs(last - L) <= Math.max(0.5, L * 0.005) || Math.abs(last - L * 1000) <= Math.max(500, L * 5);
  if (c.length && !unitOk) {
    problems.push(`cumKm 末值 ${last} 与实算里程 ${L.toFixed(1)}km 不符（既非 km 也非 m 量纲）`);
  }
  if (Math.abs((g.drawnKm ?? 0) - L) > Math.max(0.6, L * 0.01)) {
    problems.push(`drawnKm ${g.drawnKm}km 与实算里程 ${L.toFixed(1)}km 不符`);
  }
  if (problems.length) { bad += 1; console.log('✗', f, problems.join('; ')); }
  if (problems.length && FIX) {
    g.cumKm = (() => { const out = [0]; for (let i = 1; i < p.length; i += 1) out.push(out[i - 1] + haversineM(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) / 1000); return out.map((x) => Math.round(x * 100) / 100); })();
    g.drawnKm = Math.round(L * 10) / 10;
    g.totalKm = g.drawnKm;
    writeFileSync(join(DIR, f), JSON.stringify(g), 'utf8');
    console.log('  → 已重算 cumKm/drawnKm =', g.drawnKm + 'km');
  }
}
console.log(`校验 ${n} 条，不合格 ${bad} 条`);
process.exit(bad ? 1 : 0);
