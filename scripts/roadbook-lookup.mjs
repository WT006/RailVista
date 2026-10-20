#!/usr/bin/env node
/**
 * 路书取数底座（写新路线前的事实核查，全部查本地已核验数据，不查外部 key）。
 *
 * 用法:
 *   node scripts/roadbook-lookup.mjs poi   天涯海角 --city 三亚        # 景点坐标 + 简介 + 资质
 *   node scripts/roadbook-lookup.mjs place 三亚                       # 城市/区县行政中心坐标与归属
 *   node scripts/roadbook-lookup.mjs roads --prov 海南 --kind 国道    # 该省真实存在的公路编号
 *   node scripts/roadbook-lookup.mjs check G348 G98 海南:X705         # 编号是否在册（决定要不要 refPending）
 *   node scripts/roadbook-lookup.mjs rank                             # 各层 editorRank 已用/可用区间
 *   node scripts/roadbook-lookup.mjs cities --prov 海南               # _regions.json 该省地级名（anchorCity 字典）
 *
 * 数据源：
 *   data/roads/roadside-spots.json（3.7 万条，含 3.5 万条高德核验 POI 坐标）
 *   data/presets/scenic-spots.json（811 条人工核验景观点）
 *   data/presets/roadbooks/_regions.json（省→地级底座，anchorCity 必须命中）
 *   data/roads/index/{national,expressway,provincial}.json（公路编号在册表）
 *   data/roads/places-admin.json（省市县行政中心坐标）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(fs.readFileSync(P(rel), 'utf8'));

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const flags = process.argv.slice(3).filter((a) => !a.startsWith('--'));
const joined = flags.join(' ');

if (process.argv[2] === 'poi') {
  const spots = readJson('data/roads/roadside-spots.json').spots;
  const scenic = readJson('data/presets/scenic-spots.json').spots;
  const city = arg('city');
  const limit = Number(arg('limit', 10));
  const kw = joined;
  const hits = [];
  for (const s of spots) {
    if (!s.name || !s.name.includes(kw)) continue;
    if (city && !((s.city || '') === city || (s.name || '').includes(city) || (s.address || '').includes(city))) {
      const loose = (s.city || '').includes(city) || city.includes(s.city || '');
      if (!loose) continue;
    }
    hits.push(s);
  }
  hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  console.log(`roadside-spots 命中 ${hits.length} 条（显示前 ${limit}）`);
  for (const h of hits.slice(0, limit)) {
    console.log(
      `  ${String(h.lng).padEnd(10)},${String(h.lat).padEnd(9)} ${h.province}/${h.city}  ${h.name}` +
        `  [${h.source}${h.tier ? '/' + h.tier : ''}${h.tags?.length ? '/' + h.tags.join('+') : ''}]` +
        (h.visitHours ? ` 开放:${h.visitHours}` : '') +
        (h.roadRefs?.length ? `  路:${h.roadRefs.join(',')}` : ''),
    );
    if (h.tagline) console.log(`      亮点：${h.tagline}`);
    if (h.level) console.log(`      资质：${h.level}`);
  }
  const sc = scenic.filter((s) => s.name && s.name.includes(kw) && (!city || (s.province || '').includes(city.slice(0, 2))));
  if (sc.length) {
    console.log(`scenic-spots 命中 ${sc.length} 条：`);
    for (const s of sc.slice(0, 6)) console.log(`  ${s.lng},${s.lat}  ${s.province}  ${s.name}  [${s.category}/${s.visibility}]`);
  }
  if (!hits.length && !sc.length) console.log('  （无命中：说明这个点位本地库里没有已核验坐标，需换成县城/景区名再查）');
}

if (process.argv[2] === 'place') {
  const pa = readJson('data/roads/places-admin.json').places;
  const flat = [];
  for (const p of pa) {
    if (Array.isArray(p)) flat.push(...p);
    else if (p.name) flat.push(p);
    else for (const v of Object.values(p)) if (Array.isArray(v)) flat.push(...v.filter((x) => x && x.name));
  }
  const kw = joined;
  const hits = flat.filter((x) => x.name && (x.name === kw || x.name.includes(kw)));
  console.log(`places-admin 命中 ${hits.length}（显示前 ${arg('limit', 15)}）`);
  for (const h of hits.slice(0, Number(arg('limit', 15)))) {
    console.log(`  ${h.lng},${h.lat}  ${h.level || '?'}  ${h.province}${h.city ? '/' + h.city : ''}  ${h.name}`);
  }
}

if (process.argv[2] === 'roads' || process.argv[2] === 'check') {
  const kind = arg('kind');
  const prov = arg('prov');
  const sets = {};
  for (const [k, file] of [
    ['national', 'data/roads/index/national.json'],
    ['expressway', 'data/roads/index/expressway.json'],
    ['provincial', 'data/roads/index/provincial.json'],
  ]) {
    sets[k] = readJson(file);
  }
  if (process.argv[2] === 'check') {
    const refs = flags;
    for (const ref of refs) {
      const found = [];
      for (const [k, d] of Object.entries(sets)) {
        const hit = (d.roads || []).find((r) => r.ref === ref || r.key === ref);
        if (hit) found.push(`${k}:${hit.name || ''}(${hit.status || ''}${hit.hasGeom ? ',有几何' : ''})`);
      }
      console.log(`${found.length ? '✓' : '✗'} ${ref}  ${found.join(' | ') || '不在册 → 该段必须 refPending:true + 俗称'}`);
    }
    console.log('\n提示：S 编号在 provincial.json 以「省:XNNN」形式在册（key），ref 是不带省名的编号。');
  } else {
    for (const [k, d] of Object.entries(sets)) {
      if (kind && kind !== k) continue;
      const rows = (d.roads || []).filter((r) => !prov || (r.provinces || []).includes(prov));
      rows.sort((a, b) => (b.lengthKm || 0) - (a.lengthKm || 0));
      console.log(`\n=== ${k} · ${prov || '全国'} · ${rows.length} 条 ===`);
      for (const r of rows.slice(0, Number(arg('limit', 40)))) {
        console.log(`  ${String(r.ref).padEnd(8)} ${(r.name || '').padEnd(16)} ${String(Math.round(r.lengthKm || 0)).padStart(5)}km  ${r.fromPlace}—${r.toPlace}  [${r.status}]`);
      }
    }
  }
}

if (process.argv[2] === 'rank') {
  const range = { L1: [1, 100], L2: [100, 200], L3: [200, 300], L4: [300, 400], L5: [400, 500] };
  const used = { L1: [], L2: [], L3: [], L4: [], L5: [] };
  const dir = P('data/presets/roadbooks');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    for (const r of readJson(`data/presets/roadbooks/${f}`).routes || []) {
      const layer = r.layer || (r.tier === 'national' ? 'L1' : r.tier === 'regional' ? 'L2' : r.days <= 2 ? 'L4' : 'L3');
      if (used[layer]) used[layer].push(r.editorRank);
    }
  }
  for (const [layer, [lo, hi]] of Object.entries(range)) {
    const u = [...new Set(used[layer])].sort((a, b) => a - b);
    const free = [];
    for (let n = lo; n < hi; n += 1) if (!u.includes(n)) free.push(n);
    console.log(`${layer} 区间[${lo},${hi}) 已用 ${u.length}  最大 ${u[u.length - 1] ?? '-'}  下一个可用 ${free[0] ?? '已满'}（空位 ${free.length}）`);
  }
}

if (process.argv[2] === 'cities') {
  const prov = arg('prov') || joined;
  const regs = readJson('data/presets/roadbooks/_regions.json').provinces;
  const hit = regs.filter((p) => p.shortName.includes(prov) || p.name.includes(prov) || prov.includes(p.shortName));
  for (const p of hit) {
    console.log(`\n=== ${p.name}（简称「${p.shortName}」）· ${p.cities.length} 个地级行政区 ===`);
    for (const c of p.cities) {
      console.log(`  ${c.name}${c.alias?.length ? '  alias: ' + c.alias.join('/') : ''}${c.routeIds?.length ? '  路线' + c.routeIds.length : ''}  coverage=${c.coverage}`);
    }
  }
  if (!hit.length) console.log('未找到该省，请用 _regions.json 的简称（如 海南 / 广西 / 内蒙古）');
}

if (!['poi', 'place', 'roads', 'check', 'rank', 'cities'].includes(process.argv[2])) {
  console.log('用法: node scripts/roadbook-lookup.mjs <poi|place|roads|check|rank|cities> …  详见文件头注释');
}
