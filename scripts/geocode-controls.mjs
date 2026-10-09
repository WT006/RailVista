// 地理编码某国道官方控制点 → 坐标/省份，输出正确省序（结果缓存）
// 用法: node scripts/geocode-controls.mjs G219
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { geocodeControl, searchPoi } from './lib/amap.mjs';

const ref = process.argv[2];
if (!ref) { console.error('用法: node scripts/geocode-controls.mjs G219'); process.exit(1); }

const plan = JSON.parse(readFileSync('data/roads/authoritative/plan-2022-national.json', 'utf8'));
const entry = plan.roads.find((r) => r.ref === ref);
if (!entry?.controls) { console.error('无控制点:', ref); process.exit(2); }

const RAD = Math.PI / 180;
function havKm(a, b) {
  const dl = (b[0] - a[0]) * RAD, dt = (b[1] - a[1]) * RAD;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.sin(dt / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dl / 2) ** 2));
}

const out = [];
let hintProv = '';
for (let i = 0; i < entry.controls.length; i += 1) {
  const name = entry.controls[i];
  const cands = await geocodeControl(name, i === 0 ? '' : hintProv);
  let pick;
  if (i === 0 || !out.length) {
    pick = cands[0];
  } else {
    const prev = out[out.length - 1];
    // 优先：与首点同省的候选中取离上一点最近；否则全部候选取最近
    const inProv = cands.filter((c) => (c.province || '').includes(hintProv));
    const pool = inProv.length ? inProv : cands;
    let best = null, bestD = Infinity;
    for (const c of pool) {
      const d = havKm([prev.lng, prev.lat], [c.lng, c.lat]);
      if (d < bestD) { bestD = d; best = c; }
    }
    // 全部候选都离上一点 >450km（异常稀疏），退回同省首个/首个；否则取最近（同名歧义走这条）
    pick = bestD > 450 ? pool[0] : best;
    // 远跳兜底：离上一点 >600km 几乎必为地理编码误配（同名落到远省），改用 POI 检索取离上一点最近者
    if (havKm([prev.lng, prev.lat], [pick.lng, pick.lat]) > 600) {
      let poi = [];
      try { poi = await searchPoi(name); } catch { /* 全国 POI */ }
      try { poi = poi.concat(await searchPoi(name, { city: prev.province })); } catch { /* 同省 POI */ }
      let pb = null, pd = Infinity; const seenK = new Set();
      for (const c of poi) {
        const k = c.lng.toFixed(4) + ',' + c.lat.toFixed(4); if (seenK.has(k)) continue; seenK.add(k);
        const d = havKm([prev.lng, prev.lat], [c.lng, c.lat]);
        if (d < pd) { pd = d; pb = c; }
      }
      if (pb && pd < havKm([prev.lng, prev.lat], [pick.lng, pick.lat])) pick = pb;
    }
  }
  if (i === 0) {
    hintProv = (pick.province || '').replace(/省|市|壮族|回族|维吾尔|自治区/g, '');
  }
  out.push({ name, lng: pick.lng, lat: pick.lat, province: pick.province, district: pick.district, via: pick.via });
  process.stdout.write('.');
}
process.stdout.write('\n');

// 省序（去重，保留首次出现）
const provOrder = [];
for (const c of out) {
  const p = c.province.replace(/省|市|壮族|回族|维吾尔|自治区/g, '');
  if (p && provOrder[provOrder.length - 1] !== p) provOrder.push(p);
}
console.log('省序:', provOrder.join(' → '));
for (const c of out) console.log(`  ${c.name.padEnd(6)} ${c.province.padEnd(8)} [${c.lng.toFixed(3)},${c.lat.toFixed(3)}]`);

const dir = join('data', 'cache', 'amap', 'controls');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, ref + '.json'), JSON.stringify({ ref, controls: out, provOrder }, null, 1));
console.log('→ data/cache/amap/controls/' + ref + '.json');
