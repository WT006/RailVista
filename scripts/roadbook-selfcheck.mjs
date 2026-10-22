#!/usr/bin/env node
/**
 * 单文件（多文件）路书写作自检 —— 在跑全库校验**之前**先把本地能查的问题打掉。
 *
 * 用法:
 *   node scripts/roadbook-selfcheck.mjs data/presets/roadbooks/segments-xxx.json [其它新文件…]
 *
 * 校验口径（交接文档 §3 步骤 6 + 红线 R1~R9）：
 *   · Σplan === totalKm（容差 1km）            —— 判据 C
 *   · Σsegment 偏离 totalKm ≤25%              —— 判据 C
 *   · days === plan.length === intro.days      —— V5
 *   · pois ≥6 / mustSee ≥3 / nodes ≥4 / segments ≥3  —— V1~V4
 *   · editorRank 落在层区间 + 全库唯一           —— V11 / G
 *   · 单日里程上限（L1/L2≤300、L3/L5≤250、L4≤150）
 *   · 节点/景点/逐日的城市名都在 cities 里；城市名逐字对齐 _regions.json
 *   · 引用完整：segments/plan 的 from/to 在 nodes；poiIds 在 pois
 *   · practical 九件套齐全；carFree ≥20 字；lodgingNote/foodNote 60~90 字
 *   · plan[].summary ≥60 字 + tips ≥2 条
 *   · 每个 POI 必须有 ticketNote
 *   · 红线 R1：不写票价金额、不写班次时刻
 *   · 红线 R9：中文字段不得混入拉丁单词（白名单除外）
 *   · 顶��� note 必须逐字列出本文件全部路线名
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data/presets/roadbooks');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node scripts/roadbook-selfcheck.mjs <file.json> [更多…]');
  process.exit(1);
}

const readJsonSafe = (file) =>
  JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

const regions = readJsonSafe(path.join(DIR, '_regions.json'));
const cityIndex = new Map();
for (const p of regions.provinces ?? []) {
  for (const c of p.cities ?? []) {
    cityIndex.set(c.name, p.shortName);
    for (const a of c.alias ?? []) cityIndex.set(a, p.shortName);
  }
}

const RANGE = { L1: [1, 100], L2: [100, 200], L3: [200, 300], L4: [300, 400], L5: [400, 500] };
const DAYS = { L1: [1, 15], L2: [3, 7], L3: [2, 5], L4: [1, 3], L5: [2, 5] };
const CEIL = { L1: 300, L2: 300, L3: 250, L4: 150, L5: 250 };
const TIERS = { L1: ['national'], L2: ['regional'], L3: ['city'], L4: ['city'], L5: ['city', 'regional'] };
const LATIN_OK = new Set([
  'RailVista', 'OTA', 'G', 'S', 'X', 'Y', 'C', 'km', 'id', 'name', 'selfdrive', 'charter',
  'public', 'mixed', 'point', 'loop', 'outback', 'corridor', 'regional', 'city', 'national',
  'hiking', 'cycling', 'L1', 'L2', 'L3', 'L4', 'L5', 'JSON', 'BD', 'WGS', 'GPS',
  // 中文里合理出现的专名缩写 / 技术名词（红线 R9 明确「专名缩写除外」）
  'DEET', 'BRT', 'DIY', 'SPA', 'UV', 'TV', 'APP', 'API', 'PM', 'OK', 'SOS', 'SUV', 'MPV',
]);

// 全库已用 editorRank（排除本轮待检文件自身，避免自撞）
const targets = files.map((f) => path.resolve(f));
const rankUsed = new Map();
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  const full = path.join(DIR, f);
  if (targets.includes(path.resolve(full))) continue;
  const j = readJsonSafe(full);
  for (const r of (Array.isArray(j.routes) ? j.routes : [j])) rankUsed.set(r.editorRank, r.id);
}

/**
 * 收集「给人读的中文文案」文本，用于红线 R1（金额/时刻）、R9（拉丁词）与繁体残留检查。
 * 只取内容字段，**不取 schema 键名** —— 键名是英文属于数据格式，不属于文案违规。
 */
function collectProse(r) {
  const parts = [];
  const push = (v) => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(push);
  };
  push(r.name);
  push(r.subtitle);
  push(r.summary);
  push(r.alias);
  push(r.tags);
  push(r.mileageNote);
  push(r.intro?.overview);
  push(r.intro?.bestSeason);
  push(r.intro?.daysNote);
  push(r.intro?.difficultyNote);
  push(r.intro?.audience);
  push(r.intro?.avoid);
  for (const s of r.intro?.seasonNotes ?? []) push(s.note);
  for (const n of r.nodes ?? []) push(n.note);
  for (const s of r.segments ?? []) {
    push(s.name);
    push(s.condition);
    push(s.note);
    push(s.via);
  }
  for (const p of r.pois ?? []) {
    push(p.name);
    push(p.tagline);
    push(p.intro);
    push(p.bestTime);
    push(p.ticketNote);
    push(p.level);
  }
  for (const d of r.plan ?? []) {
    push(d.title);
    push(d.summary);
    push(d.tips);
  }
  for (const k of Object.keys(r.practical ?? {})) push(r.practical[k]);
  // sources 不进 prose：publisher/title 是「出处引用」，写 `data/roads/china-road-topo.bin`
  // 这类底座路径是正确做法（要能指到发布方），不属于红线 R9 说的「中文字段混入英文单词」。
  return parts.join('\n');
}

let totalErr = 0;

for (const file of files) {
  const abs = path.resolve(file);
  let d;
  try {
    d = readJsonSafe(abs);
  } catch (e) {
    console.log(`\n✗ ${path.basename(abs)}: JSON 解析失败 ${e.message}`);
    totalErr += 1;
    continue;
  }
  const routes = Array.isArray(d.routes) ? d.routes : [d];
  console.log(`\n=== ${path.basename(abs)} · ${routes.length} 条 ===`);

  const noteText = String(d.note ?? '');
  for (const r of routes) {
    if (!noteText.includes(r.name) && !noteText.includes(r.id)) {
      console.log(`  ✗ 顶层 note 未列出路线名「${r.name}」`);
      totalErr += 1;
    }
  }

  for (const r of routes) {
    const errs = [];
    const warns = [];
    const sp = (r.plan ?? []).reduce((s, x) => s + (x.distanceKm ?? 0), 0);
    const ss = (r.segments ?? []).reduce((s, x) => s + (x.distanceKm ?? 0), 0);
    if (Math.abs(sp - r.totalKm) > 1) errs.push(`Σplan ${sp} ≠ totalKm ${r.totalKm}`);
    if (Math.abs(ss - r.totalKm) / r.totalKm > 0.25) errs.push(`Σsegment ${ss} 偏离 ${((Math.abs(ss - r.totalKm) / r.totalKm) * 100).toFixed(0)}%`);
    if ((r.plan ?? []).length !== r.days || r.intro?.days !== r.days) errs.push('days 与 plan.length / intro.days 不一致');
    if ((r.pois ?? []).length < 6) errs.push(`pois ${(r.pois ?? []).length} < 6`);
    if ((r.pois ?? []).filter((x) => x.mustSee).length < 3) errs.push('mustSee < 3');
    if ((r.nodes ?? []).length < 4) errs.push('nodes < 4');
    if ((r.segments ?? []).length < 3) errs.push('segments < 3');

    const nn = new Set((r.nodes ?? []).map((n) => n.name));
    if (!nn.has(r.startNode)) errs.push(`startNode「${r.startNode}」不在 nodes`);
    if (!nn.has(r.endNode)) errs.push(`endNode「${r.endNode}」不在 nodes`);
    for (const s of r.segments ?? []) {
      for (const k of ['fromNode', 'toNode']) if (!nn.has(s[k])) errs.push(`${s.id}.${k}「${s[k]}」不在 nodes`);
    }
    for (const x of r.plan ?? []) {
      for (const k of ['fromNode', 'toNode']) if (!nn.has(x[k])) errs.push(`D${x.day}.${k}「${x[k]}」不在 nodes`);
    }

    const pids = new Set((r.pois ?? []).map((x) => x.id));
    const used = new Set();
    for (const s of r.segments ?? []) {
      for (const pid of s.poiIds ?? []) used.add(pid);
      if (!s.roadRefs?.length) errs.push(`${s.id} 无 roadRefs`);
      else if (!/^[GSXYC]\d+$/.test(s.roadRefs[0]) && !s.refPending && !['景区公路', '步道', '乡道'].includes(s.roadClass)) {
        errs.push(`${s.id} 首个 roadRefs「${s.roadRefs[0]}」需 refPending=true`);
      }
    }
    for (const x of r.plan ?? []) for (const pid of x.poiIds ?? []) used.add(pid);
    const dangling = [...used].filter((p) => !pids.has(p));
    if (dangling.length) errs.push(`悬空 poiIds: ${dangling.join(',')}`);

    const maxDay = Math.max(0, ...(r.plan ?? []).map((x) => x.distanceKm ?? 0));
    if (maxDay > CEIL[r.layer]) errs.push(`单日 ${maxDay}km > 上限 ${CEIL[r.layer]}`);
    const [dlo, dhi] = DAYS[r.layer] ?? [0, 99];
    if (r.days < dlo || r.days > dhi) errs.push(`days ${r.days} 超出 ${r.layer} 区间 ${dlo}~${dhi}`);
    const [rlo, rhi] = RANGE[r.layer] ?? [0, 999];
    if (r.editorRank < rlo || r.editorRank >= rhi) errs.push(`editorRank ${r.editorRank} 越界（${r.layer} 应在 ${rlo}~${rhi - 1}）`);
    if (rankUsed.has(r.editorRank)) errs.push(`editorRank ${r.editorRank} 与已有「${rankUsed.get(r.editorRank)}」重复`);
    rankUsed.set(r.editorRank, r.id);

    for (const x of r.pois ?? []) {
      if (!x.ticketNote) errs.push(`${x.id} 缺 ticketNote`);
      if (!x.intro || x.intro.length < 40) errs.push(`${x.id} intro 过短`);
      if (!x.tagline) errs.push(`${x.id} 缺 tagline`);
      if (!x.category) errs.push(`${x.id} 缺 category`);
      if (!(x.lng >= 73 && x.lng <= 136)) errs.push(`${x.id} lng ${x.lng} 越界`);
      if (!(x.lat >= 3 && x.lat <= 54)) errs.push(`${x.id} lat ${x.lat} 越界`);
      if (!(r.cities ?? []).includes(x.city)) errs.push(`${x.id} city「${x.city}」不在 cities`);
      if (!cityIndex.has(x.city)) warns.push(`${x.id} city「${x.city}」不在 _regions.json`);
    }
    for (const n of r.nodes ?? []) {
      if (!(r.cities ?? []).includes(n.city)) errs.push(`节点「${n.name}」city「${n.city}」不在 cities`);
      if (!(r.provinces ?? []).includes(n.province)) errs.push(`节点「${n.name}」province「${n.province}」不在 provinces`);
      if (!cityIndex.has(n.city)) warns.push(`节点「${n.name}」city「${n.city}」不在 _regions.json`);
    }
    for (const x of r.plan ?? []) {
      if ((x.summary ?? '').length < 60) errs.push(`D${x.day} summary ${(x.summary ?? '').length} 字 < 60`);
      if (!x.tips || x.tips.length < 2) errs.push(`D${x.day} tips < 2 条`);
      if (!(r.cities ?? []).includes(x.stayCity)) errs.push(`D${x.day} stayCity「${x.stayCity}」不在 cities`);
    }

    const pr = r.practical ?? {};
    for (const k of ['carFree', 'lodgingNote', 'foodNote', 'fuelNote', 'signalNote', 'gearNote', 'bookingNote', 'permit', 'altitudeNote']) {
      if (!pr[k]) warns.push(`practical.${k} 缺`);
    }
    if (!pr.warnings || pr.warnings.length < 3) errs.push('practical.warnings < 3 条');
    if ((pr.carFree ?? '').length < 20) errs.push('carFree < 20 字');
    for (const k of ['lodgingNote', 'foodNote']) {
      const len = (pr[k] ?? '').length;
      if (len < 60) errs.push(`practical.${k} ${len} 字 < 60`);
      else if (len > 120) warns.push(`practical.${k} ${len} 字 > 120（硬上限）`);
    }
    if (!r.mileageNote || r.mileageNote.length < 8) errs.push('缺 mileageNote');
    if (!r.sources?.length) errs.push('缺 sources');
    if (!(r.cities ?? []).includes(r.anchorCity)) errs.push(`anchorCity「${r.anchorCity}」不在 cities`);
    if (!(r.modes ?? []).includes(r.primaryMode)) errs.push('primaryMode 不在 modes');
    if (r.layer === 'L4' && !['selfdrive', 'public'].every((m) => (r.modes ?? []).includes(m))) errs.push('L4 需同时含 selfdrive 与 public');
    if (!TIERS[r.layer]?.includes(r.tier)) errs.push(`tier ${r.tier} 与 layer ${r.layer} 不匹配`);

    // 红线 R1 / R9 / 繁体残留
    // 只扫「给人读的中文文案」字段；schema 键名（subtitle/anchorCity…）本身是英文，不算违规。
    const prose = collectProse(r);
    const money = [...new Set(prose.match(/[0-9]+ ?元|[0-9]{1,2}:[0-9]{2}/g) ?? [])];
    if (money.length) errs.push(`红线 R1：出现金额/时刻 ${money.join(',')}`);
    const latin = [...new Set((prose.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !LATIN_OK.has(w) && !/^G\d|^S\d|^X\d/.test(w)))];
    if (latin.length) errs.push(`红线 R9：文案出现拉丁单词 ${latin.slice(0, 10).join(',')}`);
    // 繁体残留
    const trad = [...new Set(prose.match(/[區臺裏後於時觀覽橋門龍飛國學會體點與從來還開關無處業產當經進]/g) ?? [])];
    if (trad.length) warns.push(`繁体字残留 ${trad.join('')}（请逐字核对）`);

    console.log(
      `  ${errs.length ? '✗' : '✓'} ${r.id} ${r.layer} rank${r.editorRank} Σplan${sp} Σseg${ss} total${r.totalKm} pois${(r.pois ?? []).length} mustSee${(r.pois ?? []).filter((x) => x.mustSee).length} nodes${(r.nodes ?? []).length} segs${(r.segments ?? []).length} maxDay${maxDay}`,
    );
    if (errs.length) for (const e of errs) { console.log(`      ERROR: ${e}`); totalErr += 1; }
    if (warns.length) for (const w of warns) console.log(`      WARN: ${w}`);
  }
}

console.log(`\n${totalErr ? `✗ 自检未通过：${totalErr} 项 ERROR` : '✓ 自检通过'}`);
process.exit(totalErr ? 1 : 0);
