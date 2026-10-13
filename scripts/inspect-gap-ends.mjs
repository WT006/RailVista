/**
 * 万里路书 · 国道断口端点检察（scripts/inspect-gap-ends.mjs）
 *
 * 按「行走顺序」重建组件序列（依据 gapAnnotations 的 fromSeg/toSeg 与端点最近原则），
 * 输出每个断口两端的坐标 + 逆地理编码（省/市/县），便于判断是真未建还是装配失败。
 *
 * 用法：node scripts/inspect-gap-ends.mjs G331 G228 G215
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { haversineM } from './lib/road-assemble.mjs';
import { AMAP_KEY } from './lib/amap.mjs';

async function regeo(lng, lat) {
  const u = `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${AMAP_KEY}&output=json`;
  try {
    const j = await fetch(u).then((r) => r.json());
    return j.regeocode?.formatted_address || j.info || '?';
  } catch { return '?'; }
}

/** 重建行走顺序：以 gapAnnotations 的 fromSeg/toSeg 或端点最近距离贪心串联 */
function walkOrder(comps) {
  if (comps.length <= 1) return comps.slice();
  const used = new Array(comps.length).fill(false);
  // 起点：距离所有其它组件最远的那个端点所属的组件（道路一端）
  let start = 0, bestSpan = -1;
  for (let i = 0; i < comps.length; i += 1) {
    let span = 0;
    for (let j = 0; j < comps.length; j += 1) if (j !== i) span += haversineM(comps[i][0][0], comps[i][0][1], comps[j][0][0], comps[j][0][1]);
    if (span > bestSpan) { bestSpan = span; start = i; }
  }
  const order = [start]; used[start] = true;
  let cur = start;
  let dirFlipped = false;
  // 贪心：每次接最近的未用组件端点（允许翻转）
  for (let k = 1; k < comps.length; k += 1) {
    let bestJ = -1, bestD = Infinity, flip = false, fromEnd = true;
    const head = comps[cur][0], tail = comps[cur][comps[cur].length - 1];
    for (let j = 0; j < comps.length; j += 1) {
      if (used[j]) continue;
      const c = comps[j];
      const d1 = haversineM(tail[0], tail[1], c[0][0], c[0][1]);
      const d2 = haversineM(tail[0], tail[1], c[c.length - 1][0], c[c.length - 1][1]);
      const d = Math.min(d1, d2);
      if (d < bestD) { bestD = d; bestJ = j; flip = d2 < d1; }
    }
    if (bestJ < 0) break;
    order.push({ i: bestJ, flip });
    used[bestJ] = true;
    cur = bestJ;
  }
  return order.map((o) => (typeof o === 'number' ? comps[o] : (o.flip ? comps[o.i].slice().reverse() : comps[o.i])));
}

for (const ref of process.argv.slice(2)) {
  const p = join('data', 'roads', 'geom', ref + '.json');
  if (!existsSync(p)) { console.log(ref, '缺文件'); continue; }
  const g = JSON.parse(readFileSync(p, 'utf8'));
  const comps = [g.points, ...(g.segments ?? [])];
  const ord = walkOrder(comps);
  console.log('\n===', ref, '组件', comps.length, '官方', g.officialKm ?? '-', '已画', g.drawnKm ?? '-');
  const totals = ord.map((c) => Math.round(c.reduce((s, p, i) => i ? s + haversineM(c[i - 1][0], c[i - 1][1], p[0], p[1]) : 0, 0) / 1000));
  console.log('各组件里程(km):', totals.join(', '));
  for (let i = 0; i < ord.length - 1; i += 1) {
    const a = ord[i][ord[i].length - 1], b = ord[i + 1][0];
    const d = haversineM(a[0], a[1], b[0], b[1]) / 1000;
    console.log(` 断口${i + 1} ${d.toFixed(1)}km  ${a[0].toFixed(4)},${a[1].toFixed(4)} → ${b[0].toFixed(4)},${b[1].toFixed(4)}`);
    console.log('    A:', await regeo(a[0], a[1]));
    console.log('    B:', await regeo(b[0], b[1]));
  }
  console.log(' 首:', await regeo(ord[0][0][0], ord[0][0][1]), '| 尾:', await regeo(ord[ord.length - 1].slice(-1)[0][0], ord[ord.length - 1].slice(-1)[0][1]));
}
