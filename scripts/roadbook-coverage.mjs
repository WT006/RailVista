#!/usr/bin/env node
/**
 * 路书库覆盖体检：各省「路线条数 / 地级覆盖 / 缺口」+ 补全优先级排序。
 *
 * 用法:
 *   node scripts/roadbook-coverage.mjs              # 人读表格
 *   node scripts/roadbook-coverage.mjs --json       # 机读 JSON
 *   node scripts/roadbook-coverage.mjs --prov=河南    # 只看一个省
 *   node scripts/roadbook-coverage.mjs --gap        # 只列出还有 todo 地级的省
 *
 * 口径（与 build-roadbook-index.mjs / applyRouteCoverage 对齐）：
 *   · 省份简称取 _regions.json 的 shortName（判据 E 的唯一合法写法）
 *   · 地级覆盖 = 该省 cities 中，被某条路线的 cities[] 或 anchorCity 命中的条数
 *   · 「covered」= 该城市是某条路线的 anchorCity；「partial」= 仅被途经
 *   · 不读 _regions.json 里的 coverage/routeIds（那两列由装载器回写，可能过期）
 *
 * 优先级 = 「路线条数少」与「地级覆盖低」双低优先；同分时按缺口地级数多者优先。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data/presets/roadbooks');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const onlyProv = args.find((a) => a.startsWith('--prov='))?.slice(7);
const gapOnly = args.includes('--gap');

// ── 读区划底座 ───────────────────────────────────────────────────────────
const regions = JSON.parse(fs.readFileSync(path.join(DIR, '_regions.json'), 'utf8'));

// ── 读全部路线 ───────────────────────────────────────────────────────────
const routes = [];
for (const f of fs.readdirSync(DIR).sort()) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const r of (Array.isArray(j.routes) ? j.routes : [j])) routes.push({ ...r, _file: f });
}

// ── 汇总 ─────────────────────────────────────────────────────────────────
const byCityHits = new Map(); // 城市名 → { covered:Set(anchor), partial:Set }
for (const r of routes) {
  for (const c of new Set([...(r.cities ?? []), r.anchorCity])) {
    if (!byCityHits.has(c)) byCityHits.set(c, { anchor: false });
    if (r.anchorCity === c) byCityHits.get(c).anchor = true;
  }
}

const provStats = [];
const regionProv = new Map(); // shortName → _regions.json 的省对象（--prov 明细要用到 cities）
for (const p of regions.provinces ?? []) {
  regionProv.set(p.shortName, p);
  const mine = routes.filter(
    (r) => (r.provinces ?? []).includes(p.shortName) || (r.cities ?? []).some((c) => p.cities.some((pc) => pc.name === c || (pc.alias ?? []).includes(c))),
  );
  const covered = [];
  const partial = [];
  const todo = [];
  for (const c of p.cities) {
    const hit = byCityHits.get(c.name);
    const aliased = (c.alias ?? []).some((a) => byCityHits.has(a));
    if (hit?.anchor) covered.push(c.name);
    else if (hit || aliased) partial.push(c.name);
    else todo.push(c.name);
  }
  const total = p.cities.length;
  provStats.push({
    province: p.shortName,
    fullName: p.name,
    region: p.region,
    routes: mine.length,
    citiesTotal: total,
    covered: covered.length,
    partial: partial.length,
    todo: todo.length,
    rate: total ? Math.round(((covered.length + partial.length) / total) * 100) : 100,
    coveredList: covered,
    partialList: partial,
    todoList: todo,
    layers: mine.reduce((acc, r) => {
      const L = r.layer ?? '?';
      acc[L] = (acc[L] ?? 0) + 1;
      return acc;
    }, {}),
    files: [...new Set(mine.map((r) => r._file))],
  });
}

// ── 优先级：双低优先（条数少 + 覆盖低）────────────────────────────────────
provStats.sort((a, b) => {
  if (a.routes !== b.routes) return a.routes - b.routes;
  if (a.rate !== b.rate) return a.rate - b.rate;
  return b.todo - a.todo;
});
provStats.forEach((s, i) => { s.priority = i + 1; });

// ── 号段台账（下一批取号用）───────────────────────────────────────────────
const usedRanks = new Set(routes.map((r) => r.editorRank));
const ranges = [
  ['L1', 1, 99],
  ['L2', 100, 199],
  ['L3', 200, 299],
  ['L4', 300, 399],
  ['L5', 400, 499],
];
const rankLedger = ranges.map(([layer, lo, hi]) => {
  const used = [...usedRanks].filter((r) => r >= lo && r <= hi).sort((a, b) => a - b);
  let next = lo;
  for (const u of used) { if (u === next) next += 1; else if (u > next) break; }
  const holes = [];
  for (let i = lo; i <= hi; i += 1) if (!usedRanks.has(i)) holes.push(i);
  return { layer, range: `${lo}~${hi}`, count: used.length, next, holes };
});

const totalRoutes = routes.length;
const totalPois = routes.reduce((s, r) => s + (r.pois?.length ?? 0), 0);
const grandTotal = provStats.reduce((s, p) => s + p.citiesTotal, 0);
const grandCovered = provStats.reduce((s, p) => s + p.covered, 0);
const grandPartial = provStats.reduce((s, p) => s + p.partial, 0);

const result = {
  generatedAt: new Date().toISOString().slice(0, 10),
  totals: {
    routes: totalRoutes,
    pois: totalPois,
    provinces: provStats.length,
    citiesTotal: grandTotal,
    citiesCovered: grandCovered,
    citiesPartial: grandPartial,
    citiesTodo: grandTotal - grandCovered - grandPartial,
    coverageRate: grandTotal ? Math.round(((grandCovered + grandPartial) / grandTotal) * 100) : 0,
  },
  rankLedger,
  provinces: provStats,
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n, ' ');
const padL = (s, n) => String(s).padStart(n, ' ');

console.log('=== 路书库覆盖体检 ===');
console.log(
  `路线 ${totalRoutes} 条 · 景点 ${totalPois} 个 · 省级 ${provStats.length} 个 · 地级 ${grandCovered} covered / ${grandPartial} partial / ${grandTotal - grandCovered - grandPartial} todo（覆盖 ${result.totals.coverageRate}%）`,
);
console.log('\n=== 编号台账（下一批从这里取号）===');
for (const r of rankLedger) {
  console.log(`  ${r.layer} ${pad(r.range, 9)} 已用 ${padL(r.count, 3)} 个 · 下一个可用 ${padL(r.next, 4)} · 空档 ${r.holes.length ? r.holes.slice(0, 12).join(',') + (r.holes.length > 12 ? '…' : '') : '无'}`);
}

console.log('\n=== 各省覆盖与优先级 ===');
console.log(`${pad('优先', 5)}${pad('省份', 10)}${pad('条数', 5)}${pad('covered', 9)}${pad('partial', 8)}${pad('todo', 6)}${pad('覆盖率', 8)}分层`);
for (const p of provStats) {
  if (onlyProv && p.province !== onlyProv) continue;
  if (gapOnly && p.todo === 0) continue;
  console.log(
    `${padL(p.priority, 4)}  ${pad(p.province, 8)}${padL(p.routes, 4)}${padL(p.covered, 8)}${padL(p.partial, 7)}${padL(p.todo, 5)}${padL(p.rate + '%', 7)}  ${JSON.stringify(p.layers)}`,
  );
}

if (onlyProv) {
  const p = provStats.find((x) => x.province === onlyProv);
  if (p) {
    const rp = regionProv.get(onlyProv);
    console.log(`\n=== ${p.province} 缺口明细 ===`);
    console.log(`  已有路线（${p.routes} 条）:`);
    for (const r of routes.filter(
      (x) => (x.provinces ?? []).includes(p.province) || (x.cities ?? []).some((c) => (rp?.cities ?? []).some((pc) => pc.name === c || (pc.alias ?? []).includes(c))),
    )) {
      console.log(`    ${String(r.editorRank).padStart(4)} ${r.layer} ${r.name}  [${r._file}]`);
    }
    console.log(`\n  covered（anchorCity 落此）: ${p.coveredList.join('、') || '无'}`);
    console.log(`  partial（仅途经）: ${p.partialList.join('、') || '无'}`);
    console.log(`  todo（完全未覆盖）: ${p.todoList.join('、') || '无'}`);
  }
}
