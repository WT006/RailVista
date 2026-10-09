// 逐控制点名测试地理编码，报告触发 30001/失败 的名称
// 用法: node scripts/probe-geocode.mjs G332
import { readFileSync } from 'node:fs';
import { geocodeCandidates } from './lib/amap.mjs';

const ref = process.argv[2];
const plan = JSON.parse(readFileSync('data/roads/authoritative/plan-2022-national.json', 'utf8'));
const entry = plan.roads.find((r) => r.ref === ref);
for (const name of entry.controls) {
  try {
    const c = await geocodeCandidates(name);
    console.log('OK  ', JSON.stringify(name), c.length, c[0].lng.toFixed(3), c[0].lat.toFixed(3));
  } catch (e) {
    console.log('FAIL', JSON.stringify(name), e.message);
  }
}
