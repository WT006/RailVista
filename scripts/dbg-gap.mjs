/**
 * 调试：打印某条国道的排序后组件端点 + 断口信息（不发起补全）。
 * 用法：node scripts/dbg-gap.mjs G331
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { haversineM, polylineM } from './lib/road-assemble.mjs';
import { crawlChain, bestLeg } from './lib/road-crawl.mjs';

const GEOM_DIR = join('data', 'roads', 'geom');
const CTRL_DIR = join('data', 'cache', 'amap', 'controls');

for (const ref of process.argv.slice(2)) {
  const g = JSON.parse(readFileSync(join(GEOM_DIR, ref + '.json'), 'utf8'));
  const comps = [g.points, ...(g.segments ?? [])].filter((c) => c && c.length >= 2);
  console.log('===', ref, '组件', comps.length);
  comps.forEach((c, i) => {
    console.log(' comp' + i, (polylineM(c) / 1000).toFixed(0) + 'km', '起', c[0].map((v) => v.toFixed(4)).join(','), '终', c[c.length - 1].map((v) => v.toFixed(4)).join(','));
  });
  const cp = join(CTRL_DIR, ref + '.json');
  const chain = existsSync(cp) ? JSON.parse(readFileSync(cp, 'utf8')).controls.map((x) => [x.lng, x.lat]) : null;
  console.log(' controls', chain ? chain.length : 0);
  if (process.env.PROBE) {
    const num = ref.slice(1);
    for (let i = 0; i < comps.length - 1; i += 1) {
      const a = comps[i][comps[i].length - 1], b = comps[i + 1][0];
      const leg = await bestLeg(a, b, num, {});
      console.log(' 直连探测', i + 1, (haversineM(a[0], a[1], b[0], b[1]) / 1000).toFixed(1) + 'km', leg ? ('→' + (leg.distanceM / 1000).toFixed(0) + 'km detour ' + leg.detour.toFixed(2) + ' nat ' + (leg.natPct * 100).toFixed(0) + '% s' + leg.strategy) : '拒绝');
    }
  }
}
