#!/usr/bin/env node
/**
 * 路书写作取数：从本地**已核验** POI 库里查坐标与资质。
 *
 * 用法:
 *   node scripts/roadbook-poi.mjs 陕西 兵马俑 华山 太白山
 *   node scripts/roadbook-poi.mjs --prov=陕西 --kw=华山 --kw=兵马俑
 *   node scripts/roadbook-poi.mjs --prov=陕西 --list=秦岭      # 列出该省含关键词的全部点
 *
 * 数据源（都是仓库内已核验的底座，不联网）：
 *   data/roads/roadside-spots.json  —— 沿路景点库（含 tier/评分/开放时间/亮点/资质）
 *   data/presets/scenic-spots.json   —— 精选景区库
 *   data/roads/places-admin.json     —— 地级/县级行政中心点（景区查不到时兜底）
 *
 * 写作纪律（交接文档 §3 步骤 2）：
 *   · 坐标只从这里取，查不到就**不写坐标**，改走 segment.via 描述途经。
 *   · 专名逐字复制，不要凭记忆重打（曾出现「省嵬城」被写成「塞嵬城」）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const args = process.argv.slice(2);
const prov = args.find((a) => a.startsWith('--prov='))?.slice(7);
const kws = args.filter((a) => a.startsWith('--kw=')).map((a) => a.slice(5));
const listMode = args.includes('--list');
const bare = args.filter((a) => !a.startsWith('--'));
if (!kws.length && bare.length) {
  if (bare.length > 1) kws.push(...bare.slice(1));
  else kws.push(bare[0]);
}

const spots = read('data/roads/roadside-spots.json').spots ?? [];
const scenic = read('data/presets/scenic-spots.json').spots ?? [];
let admin = [];
try {
  admin = read('data/roads/places-admin.json');
  if (!Array.isArray(admin)) admin = admin.places ?? admin.cities ?? [];
} catch {
  /* 兜底库缺失不阻断 */
}

const r2 = (v) => Math.round(v * 100) / 100;

function fmtSpot(h) {
  const bits = [`   ${r2(h.lng)},${r2(h.lat)}  ${h.name}`];
  const meta = [];
  if (h.province) meta.push(h.province);
  if (h.city) meta.push(h.city);
  if (h.tier) meta.push(h.tier);
  if (h.tags?.length) meta.push(h.tags.join('/'));
  bits.push(`      归属: ${meta.join(' · ')}`);
  if (h.visitHours) bits.push(`      开放: ${h.visitHours}`);
  if (h.tagline) bits.push(`      亮点: ${h.tagline}`);
  if (h.level) bits.push(`      资质: ${h.level}`);
  if (h.score != null) bits.push(`      评分: ${h.score}`);
  return bits.join('\n');
}

if (!kws.length) {
  console.log('用法: node scripts/roadbook-poi.mjs [--prov=省] 关键词…');
  console.log(`库容量: roadside=${spots.length} scenic=${scenic.length} admin=${admin.length}`);
  process.exit(0);
}

console.log(`库容量: roadside=${spots.length} scenic=${scenic.length} admin=${admin.length}\n`);
for (const k of kws) {
  const hits = spots.filter(
    (s) => (s.name ?? '').includes(k) && (!prov || (s.province ?? '') === prov),
  );
  hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (!hits.length) {
    const alt = spots.filter((s) => (s.name ?? '').includes(k)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (alt.length) {
      console.log(`-- ${k}: 本省无，跨省命中 ${alt.length} 个（自行判断归属，别直接抄）`);
      for (const h of alt.slice(0, 4)) console.log(fmtSpot(h));
    } else {
      console.log(`-- ${k}: 本地库无已核验坐标 → 写作时只写名称与 via，不写 lng/lat`);
    }
    // 行政中心兜底
    const ah = admin.filter(
      (a) => (a.name ?? '').includes(k) && (!prov || (a.province ?? prov) === prov || (a.province ?? '').startsWith(prov)),
    );
    for (const a of ah.slice(0, 4)) {
      console.log(`   [admin] ${r2(a.lng)},${r2(a.lat)}  ${a.name}  ${a.province ?? ''}${a.city ? '/' + a.city : ''}`);
    }
    continue;
  }
  console.log(`-- ${k} (${hits.length})`);
  for (const h of hits.slice(0, listMode ? hits.length : 6)) console.log(fmtSpot(h));
  for (const s of scenic.filter((x) => (x.name ?? '').includes(k)).slice(0, 2)) {
    console.log(`   [scenic] ${r2(s.lng)},${r2(s.lat)} ${s.province ?? ''}/${s.category ?? ''} ${s.name}`);
  }
  console.log('');
}
