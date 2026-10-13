/**
 * 探针：验证「多策略 + 国道名打分」能否让高德全程走国道。
 * 用法：node scripts/probe-national-route.mjs
 */
import { drivingLeg } from './lib/amap.mjs';
import { haversineM } from './lib/road-assemble.mjs';

const CASES = [
  { ref: 'G219', name: '219国道', a: [80.32614, 42.57446], b: [80.25449, 41.70216] },
  { ref: 'G331', name: '331国道', a: [120.1, 42.6], b: [121.0, 42.2] },
];

const STRATS = [0, 2, 3, 6, 9, 20];

function score(leg, num) {
  let natM = 0, expM = 0;
  for (const s of leg.steps) {
    const n = s.name || '';
    if (new RegExp('(^|[^0-9])' + num + '(国道|线)?').test(n) || n.includes(num + '国道')) natM += s.distanceM;
    if (/高速|快速路/.test(n)) expM += s.distanceM;
  }
  return { natM, expM, natPct: leg.distanceM ? natM / leg.distanceM : 0, expPct: leg.distanceM ? expM / leg.distanceM : 0 };
}

for (const c of CASES) {
  const num = c.ref.slice(1);
  console.log('\n===', c.ref, c.a, '→', c.b, '弦长', (haversineM(c.a[0], c.a[1], c.b[0], c.b[1]) / 1000).toFixed(1), 'km');
  for (const st of STRATS) {
    try {
      const leg = await drivingLeg(c.a, c.b, { strategy: st });
      const sc = score(leg, num);
      const top = leg.steps.filter((s) => s.distanceM > 2000).map((s) => (s.name || '(无名)') + ':' + (s.distanceM / 1000).toFixed(1) + 'km');
      console.log(` s${st} ${(leg.distanceM / 1000).toFixed(1)}km nat=${(sc.natPct * 100).toFixed(0)}% exp=${(sc.expPct * 100).toFixed(0)}% | ${top.slice(0, 8).join(', ')}`);
    } catch (e) {
      console.log(` s${st} ERR ${e.message}`);
    }
  }
}
