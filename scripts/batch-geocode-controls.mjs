// 批量地理编码：为 plan-2022-national 中所有缺控制点文件的国道生成 controls + 省序（结果缓存）
// 用法: node scripts/batch-geocode-controls.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { geocodeControl } from './lib/amap.mjs';

const RAD = Math.PI / 180;
function havKm(a, b) {
  const dl = (b[0] - a[0]) * RAD, dt = (b[1] - a[1]) * RAD;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.sin(dt / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dl / 2) ** 2));
}

const plan = JSON.parse(readFileSync('data/roads/authoritative/plan-2022-national.json', 'utf8'));
const dir = join('data', 'cache', 'amap', 'controls');
mkdirSync(dir, { recursive: true });

let done = 0, skipped = 0, failed = 0;
const queue = [];
for (const entry of plan.roads) {
  const ref = entry.ref;
  if (!/^G\d{3}$/.test(ref) || !entry.controls?.length) continue;
  if (existsSync(join(dir, ref + '.json'))) { skipped += 1; continue; }
  queue.push(entry);
}
async function processRoad(entry) {
  const ref = entry.ref;
  try {
    const out = [];
    for (let i = 0; i < entry.controls.length; i += 1) {
      const name = entry.controls[i];
      const prevProv = out.length ? out[out.length - 1].province.replace(/省|市|壮族|回族|维吾尔|自治区/g, '') : '';
      const cands = await geocodeControl(name, prevProv);
      let pick;
      if (i === 0 || !out.length) pick = cands[0];
      else {
        const prev = out[out.length - 1];
        let best = null, bestD = Infinity;
        for (const c of cands) { const d = havKm([prev.lng, prev.lat], [c.lng, c.lat]); if (d < bestD) { bestD = d; best = c; } }
        pick = bestD > 450 ? cands[0] : best;
      }
      out.push({ name, lng: pick.lng, lat: pick.lat, province: pick.province, district: pick.district });
    }
    const provOrder = [];
    for (const c of out) {
      const p = c.province.replace(/省|市|壮族|回族|维吾尔|自治区/g, '');
      if (p && provOrder[provOrder.length - 1] !== p) provOrder.push(p);
    }
    writeFileSync(join(dir, ref + '.json'), JSON.stringify({ ref, controls: out, provOrder }, null, 1));
    done += 1;
    if (done % 20 === 0) console.log('  … 已编码', done, '/', queue.length);
  } catch (e) {
    failed += 1; console.log('✗', ref, e.message);
  }
}
// 受控并发（请求发起仍由全局节流间隔；免费 key 地理编码 QPS≈3，默认 2 路 + 340ms）
const CONC = Number(process.env.GEO_CONC || 2);
let qi = 0;
async function worker() {
  for (;;) { const i = qi; qi += 1; if (i >= queue.length) return; await processRoad(queue[i]); }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log('完成编码', done, '| 已存在跳过', skipped, '| 失败', failed);
