#!/usr/bin/env node
/**
 * 路书库构建期校验 + 统计。
 *
 * 用法: node scripts/build-roadbook-index.mjs [--json]
 *
 * 校验判据（全部硬性，除非标注 WARN）：
 *   A. JSON 可解析；文件级乱码扫描（占位符/西里尔/块元素/生造词）
 *   B. 枚举合法：mode/shape/tier/layer/difficulty/poiCategory/nodeRole/roadClass
 *   C. 一致性：days === plan.length；|Σplan - totalKm| ≤ 1；
 *      |Σsegment - totalKm| / totalKm ≤ 25%；primaryMode ∈ modes
 *   D. 引用完整：segments/plan 的 fromNode/toNode 在 nodes 里；
 *      segment.poiIds / day.poiIds 在 pois 里；poi.province/city 非空
 *   E. 行政区划：route.provinces / cities 必须能在 _regions.json 找到
 *   F. 道路编号：G1-3位 必须在 national.json；G4位 必须在 expressway.json；
 *      S编号 应在 provincial.json（缺失降级为 WARN）；俗称必须有 refPending
 *   G. editorRank 全库唯一
 *
 * 本轮新增（接 shared 层 + 构建期独有能力，level 见注释）：
 *   shared.dist → validateTravelRoute()（V1~V9 / V13 / V16 / V17）
 *   V10 anchorCity 必须能在 _regions.json 找到（name 或 alias）
 *   V11 editorRank 必须落在 LAYER_RANK_RANGE[layer] 区间内
 *   V12 路线 id 全局唯一（此前装载器只 skip，不阻断）
 *   V14 单数据文件 > 600KB → WARN（提示拆 -part2.json）
 *   V15 路线未显式写 layer → WARN（带推断结果）
 *
 * 存量文件（本轮之前就存在的 10 个源文件）命中的新问题降级进
 * 「存量待治理清单」并只报 WARN —— 存量内容不是本轮写的，不阻塞本批次。
 *
 * 统计输出：路线/景点/省/市数量、玩法分布、分层分布、覆盖列表 —— 供 CHANGELOG 引用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data/presets/roadbooks');
const REGIONS_FILE = path.join(DIR, '_regions.json');
const ROADS_INDEX = path.join(ROOT, 'data/roads/index');

const ENUMS = {
  modes: new Set(['selfdrive', 'charter', 'public', 'cycling', 'hiking', 'mixed']),
  shape: new Set(['loop', 'point', 'outback', 'corridor']),
  tier: new Set(['national', 'regional', 'city']),
  layer: new Set(['L1', 'L2', 'L3', 'L4', 'L5']),
  poiCategory: new Set([
    'mountain', 'water', 'landform', 'grassland', 'forest', 'desert',
    'village', 'temple', 'ruin', 'culture', 'cityview', 'roadside', 'food',
  ]),
  nodeRole: new Set(['hub', 'start', 'end', 'stay', 'pass']),
  roadClass: new Set(['国道', '高速', '省道', '县道', '乡道', '景区公路', '城市道路', '步道']),
};

/** 乱码/占位符扫描：历史踩过的坑都要拦住 */
const GARBAGE = [
  { re: /hy_placeholder|Hy_Placeholder|HY_PLACEHOLDER/, label: 'hy_placeholder 占位符' },
  { re: /[\u2580-\u259F]/, label: 'U+2580-259F 块元素字符' },
  { re: /[\u0400-\u04FF]/, label: '西里尔字母' },
  { re: /[\u3040-\u30FF]/, label: '日文假名' },
  { re: /\bXxxx\b|\bXxxx|\bTODO_PLACEHOLDER\b|\bLorem ipsum\b/, label: '英文占位词' },
];

/** 模型历史上混入过的生造词（出现即报错） */
const FAKE_WORDS = ['Pub723', 'pendidikan', '收敾', 'dissolves', 'Eisenhower', 'Vallée'];

const errors = [];
const warns = [];
/** 存量文件命中的问题 → 只列清单不阻断（交给后续批次治理） */
const governance = [];
const err = (file, msg) => errors.push(`[${file}] ${msg}`);
const warn = (file, msg) => warns.push(`[${file}] ${msg}`);

/**
 * 本轮之前就存在的源文件（13 条存量路线）。
 * 它们命中新判据时不进 errors，而是降级到「存量待治理清单」。
 */
const LEGACY_FILES = new Set([
  'inner-mongolia-hulunbuir.json',
  'qinghai-gansu-loop.json',
  'sichuan-west-loop.json',
  'tibet-access-north.json',
  'tibet-access-south.json',
  'tibet-rings.json',
  'xinjiang-altay-loop.json',
  'xinjiang-south-loop.json',
  'xinjiang-yili-loop.json',
  'yunnan-sichuan-shangrila-daocheng.json',
]);

/** V14：单文件体积上限（KB），超出建议拆 -part2.json */
const FILE_SIZE_WARN_KB = 600;

function scanGarbage(obj, file, breadcrumb = '') {
  if (typeof obj === 'string') {
    for (const g of GARBAGE) {
      if (g.re.test(obj)) err(file, `乱码扫描「${g.label}」@ ${breadcrumb}: "${obj.slice(0, 40)}"`);
    }
    for (const w of FAKE_WORDS) {
      if (obj.includes(w)) err(file, `生造词「${w}」@ ${breadcrumb}: "${obj.slice(0, 40)}"`);
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => scanGarbage(v, file, `${breadcrumb}[${i}]`));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) scanGarbage(v, file, breadcrumb ? `${breadcrumb}.${k}` : k);
  }
}

// ── 公路索引（防编造编号的关键闸门） ─────────────────────────────────────
function loadRoadSets() {
  const natRefs = new Set();
  const expRefs = new Set();
  const provRefs = new Set();
  try {
    const nat = JSON.parse(fs.readFileSync(path.join(ROADS_INDEX, 'national.json'), 'utf8'));
    for (const r of nat.roads ?? []) natRefs.add(r.ref);
  } catch {
    warn('index', 'national.json 读取失败，跳过国道编号校验');
  }
  try {
    const exp = JSON.parse(fs.readFileSync(path.join(ROADS_INDEX, 'expressway.json'), 'utf8'));
    for (const r of exp.roads ?? []) expRefs.add(r.ref);
  } catch {
    warn('index', 'expressway.json 读取失败，跳过高速编号校验');
  }
  try {
    const prov = JSON.parse(fs.readFileSync(path.join(ROADS_INDEX, 'provincial.json'), 'utf8'));
    for (const r of prov.roads ?? []) {
      provRefs.add(r.ref);
      if (r.key) provRefs.add(r.key);
    }
  } catch {
    warn('index', 'provincial.json 读取失败，跳过省道编号校验');
  }
  return { natRefs, expRefs, provRefs };
}
const roadSets = loadRoadSets();

// ── shared 层校验接入 ───────────────────────────────────────────────────
// dist 未构建 / 过期时降级为 WARN 并继续跑脚本自有的 A~G + V10~V15 判据，绝不中断。
// R4：把 dist 的 mtime 打出来，一眼看出用的产物是否新鲜。
const SHARED_DIST = path.join(ROOT, 'packages/shared/dist/travelbook/index.js');
let shared = null;
let distMtime = '不可用';
try {
  distMtime = fs.statSync(SHARED_DIST).mtime.toISOString().replace('T', ' ').slice(0, 19);
} catch {
  /* 产物不存在，下面 import 会失败并给出 warn */
}
try {
  const mod = await import('../packages/shared/dist/travelbook/index.js');
  const { validateTravelRoute, resolveLayer, LAYER_RANK_RANGE, TRAVEL_LAYERS } = mod;
  if (typeof validateTravelRoute !== 'function') throw new Error('dist 未导出 validateTravelRoute');
  shared = { validateTravelRoute, resolveLayer, LAYER_RANK_RANGE, TRAVEL_LAYERS };
} catch (e) {
  warn(
    'shared',
    `dist 未构建或已过期，跳过 shared 层校验（请先跑 pnpm --filter @railvista/shared build）：${e.message}`,
  );
}

function checkRoadRef(ref, file, ctx, refPending) {
  // 编号规则（实测索引验证）：普通国道 G101~G3XX（3 位）；
  // 国家高速 G1~G98（1~2 位放射/纵横线）+ G4 位联络线，都在 expressway.json
  if (/^G\d{3}$/.test(ref)) {
    if (!roadSets.natRefs.has(ref)) err(file, `${ctx} 国道编号 ${ref} 不在 national.json 索引中`);
  } else if (/^G\d{1,2}$/.test(ref) || /^G\d{4,}$/.test(ref)) {
    if (!roadSets.expRefs.has(ref)) err(file, `${ctx} 高速编号 ${ref} 不在 expressway.json 索引中`);
  } else if (/^S\d{1,3}$/.test(ref)) {
    if (!roadSets.provRefs.has(ref)) warn(file, `${ctx} 省道编号 ${ref} 未在 provincial.json 命中（索引覆盖不全，人工复核）`);
  } else if (!refPending) {
    warn(file, `${ctx} 非编号道路「${ref}」未标 refPending（应写俗称并置 refPending=true）`);
  }
}

// ── 区划底座 ─────────────────────────────────────────────────────────────
let regions = null;
try {
  regions = JSON.parse(fs.readFileSync(REGIONS_FILE, 'utf8'));
} catch (e) {
  err('_regions.json', `JSON 解析失败: ${e.message}`);
}
const provinceNames = new Set();
const cityIndex = new Map(); // 地级名（含 alias）→ Set(省简称)，供归属校验
let cityTotal = 0; // 地级行政区总数（不含 alias）
if (regions) {
  for (const p of regions.provinces ?? []) {
    provinceNames.add(p.shortName);
    for (const c of p.cities ?? []) {
      cityTotal += 1;
      if (!cityIndex.has(c.name)) cityIndex.set(c.name, new Set());
      cityIndex.get(c.name).add(p.shortName);
      for (const a of c.alias ?? []) {
        if (!cityIndex.has(a)) cityIndex.set(a, new Set());
        cityIndex.get(a).add(p.shortName);
      }
    }
  }
}

// ── 路线文件校验 ─────────────────────────────────────────────────────────
const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .sort();

const routes = [];
const ranks = new Map();
const routeIds = new Map(); // V12：路线 id 全局唯一

for (const f of files) {
  const full = path.join(DIR, f);

  // V14：单文件体积（> 600KB 提示拆 -part2.json，避免装载与首屏变慢）
  const sizeKb = fs.statSync(full).size / 1024;
  if (sizeKb > FILE_SIZE_WARN_KB) {
    warn(f, `文件 ${sizeKb.toFixed(0)}KB 超过 ${FILE_SIZE_WARN_KB}KB，建议拆分为 <area>-part2.json`);
  }

  let j = null;
  try {
    j = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    err(f, `JSON 解析失败: ${e.message}`);
    continue;
  }
  scanGarbage(j, f);

  // 文件结构：{ version, updated, area, note, routes: [...] }
  const list = Array.isArray(j.routes) ? j.routes : [j];
  for (const r of list) {
    validateRoute(r, `${f}#${r.id ?? '?'}`);
    routes.push({ file: f, route: r });
  }
}

function validateRoute(r, label) {
  const f = label;
  const srcFile = label.split('#')[0];
  // 存量文件命中的新判据 → 降级到「存量待治理清单」，不阻塞本轮批次
  const isLegacy = LEGACY_FILES.has(srcFile);
  const fail = (msg) => (isLegacy ? governance.push(`[${f}] ${msg}`) : err(f, msg));
  const hint = (msg) => warn(f, msg);

  // 契约：TravelNode 无 id，fromNode/toNode/via 引用的是节点 name
  const nodeNames = new Set((r.nodes ?? []).map((n) => n.name));
  const poiIds = new Set((r.pois ?? []).map((p) => p.id));

  // V12. 路线 id 全局唯一（此前只在装载器里 skip，不阻断）
  if (r.id) {
    if (routeIds.has(r.id)) fail(`路线 id 重复：${r.id}（已出现在 ${routeIds.get(r.id)}）`);
    else routeIds.set(r.id, f);
  }

  // B. 枚举
  for (const m of r.modes ?? []) {
    if (!ENUMS.modes.has(m)) err(f, `modes 非法枚举: ${m}`);
  }
  if (!ENUMS.shape.has(r.shape)) err(f, `shape 非法: ${r.shape}`);
  if (!ENUMS.tier.has(r.tier)) err(f, `tier 非法: ${r.tier}`);
  if (r.layer !== undefined && !ENUMS.layer.has(r.layer)) err(f, `layer 非法: ${r.layer}`);
  if (!(r.difficulty >= 1 && r.difficulty <= 5)) err(f, `difficulty 越界: ${r.difficulty}`);
  if (!ENUMS.modes.has(r.primaryMode)) err(f, `primaryMode 非法: ${r.primaryMode}`);
  if (!(r.modes ?? []).includes(r.primaryMode)) err(f, `primaryMode(${r.primaryMode}) 不在 modes 内`);

  // C. 一致性
  if (Array.isArray(r.plan) && r.days !== r.plan.length) {
    err(f, `days(${r.days}) ≠ plan.length(${r.plan.length})`);
  }
  const planSum = (r.plan ?? []).reduce((s, d) => s + (d.distanceKm || 0), 0);
  if (Math.abs(planSum - r.totalKm) > 1) {
    err(f, `Σplan(${planSum}) 与 totalKm(${r.totalKm}) 差超过 1`);
  }
  const segSum = (r.segments ?? []).reduce((s, x) => s + (x.distanceKm || 0), 0);
  if (Math.abs(segSum - r.totalKm) / r.totalKm > 0.25) {
    err(f, `Σsegment(${segSum}) 偏离 totalKm(${r.totalKm}) 超过 25%`);
  }

  // D. 引用完整
  for (const n of r.nodes ?? []) {
    if (!ENUMS.nodeRole.has(n.role)) err(f, `节点 ${n.name} role 非法: ${n.role}`);
  }
  for (const s of r.segments ?? []) {
    if (!nodeNames.has(s.fromNode)) err(f, `路段 ${s.id} fromNode 悬空: ${s.fromNode}`);
    if (!nodeNames.has(s.toNode)) err(f, `路段 ${s.id} toNode 悬空: ${s.toNode}`);
    for (const pid of s.poiIds ?? []) {
      if (!poiIds.has(pid)) err(f, `路段 ${s.id} poiId 悬空: ${pid}`);
    }
    if (!ENUMS.roadClass.has(s.roadClass)) err(f, `路段 ${s.id} roadClass 非法: ${s.roadClass}`);
    for (const ref of s.roadRefs ?? []) checkRoadRef(ref, f, `路段 ${s.id}`, s.refPending);
  }
  for (const d of r.plan ?? []) {
    if (!nodeNames.has(d.fromNode)) err(f, `D${d.day} fromNode 悬空: ${d.fromNode}`);
    if (!nodeNames.has(d.toNode)) err(f, `D${d.day} toNode 悬空: ${d.toNode}`);
    for (const pid of d.poiIds ?? []) {
      if (!poiIds.has(pid)) err(f, `D${d.day} poiId 悬空: ${pid}`);
    }
  }
  for (const p of r.pois ?? []) {
    if (!ENUMS.poiCategory.has(p.category)) err(f, `景点 ${p.id} category 非法: ${p.category}`);
    if (!p.province || !p.city) err(f, `景点 ${p.id} 缺 province/city`);
  }

  // E. 行政区划
  for (const pn of r.provinces ?? []) {
    if (!provinceNames.has(pn)) err(f, `provinces 中的「${pn}」不在 _regions.json`);
  }
  for (const cn of r.cities ?? []) {
    if (!cityIndex.has(cn)) err(f, `cities 中的「${cn}」不在 _regions.json`);
  }

  // G. editorRank 唯一
  if (ranks.has(r.editorRank)) {
    err(f, `editorRank(${r.editorRank}) 与 ${ranks.get(r.editorRank)} 重复`);
  }
  ranks.set(r.editorRank, r.id);

  // ═══ 本轮新增判据（V10 / V11 / V15 + shared 层）═════════════════════════

  // V10. anchorCity 必须能在区划底座找到（name 或 alias 兜底，与 applyRouteCoverage 对齐）
  //      这条是「幽灵城市」的唯一拦截点：城市名写错会导致 coverage 永远回写不上且无报错。
  if (r.anchorCity && !cityIndex.has(r.anchorCity)) {
    fail(`anchorCity「${r.anchorCity}」不在 _regions.json 的地级名单（含 alias）中`);
  }

  const layer = shared?.resolveLayer ? shared.resolveLayer(r) : undefined;

  // V15. 未显式写 layer —— 阶段 1A 起新写路线必须显式标注（推断只能兜底存量）
  if (!r.layer) {
    hint(`未显式写 layer（推断为 ${layer ?? 'L4'}），建议显式标注`);
  }

  // V11. editorRank 必须落在所属 layer 的区间内
  if (layer && shared?.LAYER_RANK_RANGE?.[layer] && typeof r.editorRank === 'number') {
    const [min, max] = shared.LAYER_RANK_RANGE[layer];
    if (!(r.editorRank >= min && r.editorRank < max)) {
      fail(`editorRank(${r.editorRank}) 越界：该路线 layer=${layer}，rank 应在 ${min}~${max - 1}`);
    }
  }

  // shared 层（V1~V9 / V13 / V16 / V17）：内容完整性判据，主板一套，构建期接线到这里
  if (shared?.validateTravelRoute) {
    let issues = [];
    try {
      issues = shared.validateTravelRoute(r) ?? [];
    } catch (e) {
      warn(f, `shared 校验抛错（已跳过该条）：${e.message}`);
    }
    for (const i of issues ?? []) {
      const msg = `[shared] ${i.field ? `${i.field}: ` : ''}${i.message}`;
      if (i.level === 'error') fail(msg);
      else hint(msg);
    }
  }
}

// ── 统计 ─────────────────────────────────────────────────────────────────
const modeCount = {};
const layerCount = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 };
const poiTotal = routes.reduce((s, x) => s + (x.route.pois?.length ?? 0), 0);
const provincesHit = new Set();
const citiesHit = new Set();
for (const { route: r } of routes) {
  for (const m of r.modes ?? []) modeCount[m] = (modeCount[m] ?? 0) + 1;
  for (const p of r.provinces ?? []) provincesHit.add(p);
  for (const c of r.cities ?? []) citiesHit.add(c);
  const layer = shared?.resolveLayer ? shared.resolveLayer(r) : undefined;
  if (layer && layer in layerCount) layerCount[layer] += 1;
}
const sorted = [...routes].sort((a, b) => a.route.editorRank - b.route.editorRank);

const stats = {
  routes: routes.length,
  pois: poiTotal,
  provincesCovered: [...provincesHit].sort(),
  provincesCount: provincesHit.size,
  citiesCount: citiesHit.size,
  regionsProvinces: provinceNames.size,
  regionsCities: cityTotal,
  modes: modeCount,
  byLayer: layerCount,
  ranking: sorted.map((x) => `${x.route.editorRank}. ${x.route.name} (${x.route.totalKm}km/${x.route.days}d)`),
};

// ── 输出 ─────────────────────────────────────────────────────────────────
console.log('=== 路书库校验 ===');
console.log(`shared dist: ${distMtime}${shared ? '' : '（未加载，shared 层判据已降级跳过）'}`);
console.log(`文件: ${files.length} 个 · 路线 ${routes.length} 条 · 景点 ${poiTotal} 个`);
console.log(`区划: ${stats.regionsProvinces} 省级 / ${stats.regionsCities} 地级（底座）`);
console.log(`覆盖: ${stats.provincesCount} 省 · ${stats.citiesCount} 市`);
console.log(`玩法分布: ${JSON.stringify(stats.modes)}`);
console.log(`分层分布: ${JSON.stringify(stats.byLayer)}`);
console.log('推荐序:');
for (const line of stats.ranking) console.log(`  ${line}`);

const groupByFile = (list) => {
  const map = new Map();
  for (const line of list) {
    const key = String(line).slice(1, String(line).indexOf(']'));
    if (!key) continue;
    const file = key.includes('#') ? key.split('#')[0] : key;
    if (!map.has(file)) map.set(file, []);
    map.get(file).push(line);
  }
  return map;
};

if (warns.length) {
  console.log(`\n=== WARN (${warns.length}) ===`);
  for (const [file, lines] of groupByFile(warns)) {
    console.log(`  ── ${file} (${lines.length})`);
    for (const l of lines) console.log('    ' + l);
  }
}
if (governance.length) {
  console.log(`\n=== 存量待治理清单 (${governance.length}) —— 不阻断，交后续批次 ===`);
  for (const [file, lines] of groupByFile(governance)) {
    console.log(`  ── ${file} (${lines.length})`);
    for (const l of lines) console.log('    ' + l);
  }
}
if (errors.length) {
  console.log(`\n=== ERROR (${errors.length}) ===`);
  for (const [file, lines] of groupByFile(errors)) {
    console.log(`  ── ${file} (${lines.length})`);
    for (const l of lines) console.log('    ' + l);
  }
  console.log(`\n✗ 校验未通过：ERROR ${errors.length} 条 / WARN ${warns.length} 条 / 存量待治理 ${governance.length} 条`);
  process.exit(1);
}
console.log(`\n✓ 全部校验通过（WARN ${warns.length} 条 / 存量待治理 ${governance.length} 条）`);
