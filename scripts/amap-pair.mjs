// 高德驾车探针：node scripts/amap-pair.mjs lng,lat lng,lat
import { drivingLeg } from './lib/amap.mjs';
const parse = (s) => s.split(',').map(Number);
const a = parse(process.argv[2]), b = parse(process.argv[3]);
const leg = await drivingLeg(a, b);
console.log('总里程', (leg.distanceM / 1000).toFixed(2), 'km steps', leg.steps.length);
// 按路名汇总里程
const byName = new Map();
for (const s of leg.steps) byName.set(s.name, (byName.get(s.name) ?? 0) + s.distanceM);
[...byName.entries()].sort((x, y) => y[1] - x[1])
  .forEach(([n, d]) => console.log((d / 1000).toFixed(2) + 'km', JSON.stringify(n)));
