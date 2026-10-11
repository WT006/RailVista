// 遍历所有省片 .rvwn，统计 G219 的 way 真实 ref/name 标签
import { openRvwn } from './lib/rvwn.mjs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const NET_DIR = 'data/roads/net';
const files = readdirSync(NET_DIR).filter((f) => f.endsWith('.rvwn'));

const refCounts = new Map();
const nameSamples = new Map();
const refSamples = new Map();
const totalWaysByProv = new Map();

for (const f of files) {
  const p = join(NET_DIR, f);
  let reader;
  try {
    reader = openRvwn(p);
  } catch (e) {
    console.log('跳过 ' + f + ': ' + e.message);
    continue;
  }
  let g219Ways = 0;
  for (const w of reader.iterateWays()) {
    if (w.cls !== 'G') continue;
    if (w.ref === 'G219' || w.ref === '219' || /G\s*219|219\s*G/.test(w.ref) || w.ref.startsWith('G219')) {
      g219Ways++;
      refCounts.set(w.ref, (refCounts.get(w.ref) || 0) + 1);
      if (!refSamples.has(w.ref)) refSamples.set(w.ref, []);
      if (refSamples.get(w.ref).length < 3) refSamples.get(w.ref).push({ prov: f, id: w.id, name: w.name, highway: w.highway });
    }
    if (/219/.test(w.name) && !refCounts.has(w.name)) {
      if (!nameSamples.has(w.name)) nameSamples.set(w.name, []);
      if (nameSamples.get(w.name).length < 2) nameSamples.get(w.name).push({ prov: f, ref: w.ref, highway: w.highway });
    }
  }
  totalWaysByProv.set(f, g219Ways);
  reader.close();
}

console.log('--- G219 way 在 OSM 里的 ref 标签统计 ---');
console.log('总省片:', files.length);
const sorted = [...refCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [r, n] of sorted) {
  console.log(`  ref="${r}" · ${n} ways`);
  console.log('    样本:', JSON.stringify(refSamples.get(r)));
}
console.log('\n--- 各省片 G219 way 数 ---');
const provSorted = [...totalWaysByProv.entries()].filter(([_, n]) => n > 0).sort((a, b) => b[1] - a[1]);
for (const [p, n] of provSorted) console.log(`  ${p}: ${n}`);

console.log('\n--- 含 "219" 的 name 样本（前 5）---');
let i = 0;
for (const [nm, sams] of nameSamples.entries()) {
  if (i++ >= 5) break;
  console.log(`  name="${nm}" · 样本:`, JSON.stringify(sams));
}
