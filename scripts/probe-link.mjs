/**
 * 万里路书 · 单段缺口探测（scripts/probe-link.mjs）
 *
 * 用法：
 *   node scripts/probe-link.mjs G331 99.0719,41.8775 90.9883,46.1435
 * 输出：多策略求解结果（里程/绕行/主要路名），以及二分后各子段的可达性。
 */
import { drivingLeg } from './lib/amap.mjs';
import { haversineM } from './lib/road-assemble.mjs';
import { legStats } from './lib/road-crawl.mjs';

const ref = process.argv[2];
const a = process.argv[3].split(',').map(Number);
const b = process.argv[4].split(',').map(Number);
const num = ref.slice(1);
const chord = haversineM(a[0], a[1], b[0], b[1]);
console.log(ref, '弦长', (chord / 1000).toFixed(1), 'km');

for (const st of [0, 6, 2, 9, 3]) {
  try {
    const leg = await drivingLeg(a, b, { strategy: st });
    const s = legStats(leg, num);
    const top = leg.steps.filter((x) => x.distanceM > 15000).slice(0, 14)
      .map((x) => (x.name || '(无名)') + (x.distanceM / 1000).toFixed(0));
    console.log(` s${st} ${(leg.distanceM / 1000).toFixed(0)}km 绕行${(leg.distanceM / chord).toFixed(2)} nat=${(s.natPct * 100).toFixed(0)}% exp=${(s.expPct * 100).toFixed(0)}% run=${(s.maxRunM / 1000).toFixed(0)}km | ${top.join(',')}`);
  } catch (e) { console.log(` s${st} ERR ${e.message}`); }
}

console.log('— 二分可达性 —');
for (const t of [0.25, 0.5, 0.75]) {
  const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  try {
    const leg = await drivingLeg(a, p, { strategy: 0 });
    console.log(` a→t${t} 弦${(haversineM(a[0], a[1], p[0], p[1]) / 1000).toFixed(0)}km 路${(leg.distanceM / 1000).toFixed(0)}km`);
  } catch (e) { console.log(` a→t${t} ERR ${e.message}`); }
  try {
    const leg = await drivingLeg(p, b, { strategy: 0 });
    console.log(` t${t}→b 弦${(haversineM(p[0], p[1], b[0], b[1]) / 1000).toFixed(0)}km 路${(leg.distanceM / 1000).toFixed(0)}km`);
  } catch (e) { console.log(` t${t}→b ERR ${e.message}`); }
}
