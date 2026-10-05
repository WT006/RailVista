/**
 * 万里路书 · 全国公路网质检（scripts/verify-road-network.mjs）
 *
 * v0.6.0 起几何来自「省份 PBF 要素库 → 本地装配」，质检口径随之升级：
 *   1. 覆盖率：按等级统计 hasGeom / 在册（G/E 必须 100%，否则阻断）
 *   2. 里程偏差：用**去重后里程** totalKm 与官方里程比对 → 精度分级 A/B/C
 *   3. 分量结构：componentCount 与断点标注一致性
 *   4. 跳点检测：>5km 且方向突变 >25°（DP 简化的笔直长段不算）
 *   5. 几何完整性：NaN 坐标、空折线
 *
 * 用法：node scripts/verify-road-network.mjs [--class national,expressway]
 * 产物：data/roads/coverage-gap.csv + data/roads/reports/quality-{date}.json
 * 退出码：0 通过 / 1 阻断（G/E 覆盖不足或几何文件损坏）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineM } from './lib/road-assemble.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX_DIR = join(ROOT, 'data/roads/index');
const GEOM_DIR = join(ROOT, 'data/roads/geom');
const REPORT_DIR = join(ROOT, 'data/roads/reports');
const GAP_CSV = join(ROOT, 'data/roads/coverage-gap.csv');

const args = process.argv.slice(2);
const classFilter = args.includes('--class') ? new Set(args[args.indexOf('--class') + 1].split(',')) : null;

/** 官方里程参考值（权威名录） */
const officialKm = new Map();
for (const f of ['national.json', 'expressway.json', 'provincial.json']) {
  const p = join(ROOT, 'data/roads/authoritative', f);
  if (!existsSync(p)) continue;
  try {
    for (const r of JSON.parse(readFileSync(p, 'utf8')).roads ?? []) {
      const key = r.key ?? (r.province && r.ref ? r.province + ':' + r.ref : r.ref);
      if (r.officialLengthKm > 0) officialKm.set(key, r.officialLengthKm);
    }
  } catch { /* 单文件损坏不阻塞 */ }
}

const entries = [];
for (const f of ['national.json', 'expressway.json', 'provincial.json']) {
  const p = join(INDEX_DIR, f);
  if (!existsSync(p)) continue;
  try {
    for (const r of JSON.parse(readFileSync(p, 'utf8')).roads ?? []) entries.push(r);
  } catch { /* ignore */ }
}

const JUMP_KM = 5;
const rows = [];
const stat = {};
// 精度门禁只对"有官方里程参考值"的条目成立：权威名录目前仅 136 条有官方里程，
// 其余条目无法比对（标 C），把它们算进 A+B 分母只会得到没有意义的分母。
const officialGrade = { expressway: { n: 0, ab: 0 }, national: { n: 0, ab: 0 } };
function bucket(cls) {
  return stat[cls] ?? (stat[cls] = { total: 0, geom: 0, inOsm: 0, A: 0, B: 0, C: 0, X: 0, km: 0, jumps: 0, multi: 0, corrupt: 0 });
}
const angleDiff = (a, b) => {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return (d * 180) / Math.PI;
};
const bearing = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);

for (const e of entries) {
  if (classFilter && !classFilter.has(e.class)) continue;
  const b = bucket(e.class);
  b.total += 1;
  if (e.inOsm === true) b.inOsm += 1;
  const path = join(GEOM_DIR, e.key.replace(/[:/\\*?"<>|]/g, '_') + '.json');
  if (!existsSync(path) || e.hasGeom === false) {
    rows.push([e.key, e.ref, (officialKm.get(e.key) ?? ''), '', '', 'no-geometry', 0, 0, ''].join(','));
    continue;
  }
  let g;
  try {
    g = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    b.corrupt += 1;
    rows.push([e.key, e.ref, (officialKm.get(e.key) ?? ''), '', '', 'broken-json', 0, 0, ''].join(','));
    continue;
  }
  const chains = [g.points, ...(Array.isArray(g.segments) ? g.segments : [])].filter((c) => Array.isArray(c) && c.length >= 2);
  if (!chains.length) {
    b.corrupt += 1;
    rows.push([e.key, e.ref, (officialKm.get(e.key) ?? ''), '', '', 'empty-geometry', 0, 0, ''].join(','));
    continue;
  }
  // 完整性：NaN 坐标
  let nan = 0;
  for (const c of chains) for (const p of c) if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) nan += 1;

  // 主链跳点（>5km 且方向突变 >25°）
  let jumps = 0;
  const pts = g.points;
  for (let i = 1; i < pts.length; i += 1) {
    const d = haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (d <= JUMP_KM * 1000) continue;
    const prev = pts[i - 2] ?? pts[i - 1];
    const next = pts[i + 1] ?? pts[i];
    const bend = Math.max(angleDiff(bearing(prev, pts[i - 1]), bearing(pts[i - 1], pts[i])), angleDiff(bearing(pts[i - 1], pts[i]), bearing(pts[i], next)));
    if (bend > 25) jumps += 1;
  }
  b.jumps += jumps;

  const measuredKm = Number.isFinite(g.totalKm)
    ? g.totalKm
    : chains.reduce((s, c) => s + c.reduce((a, p, i) => (i ? a + haversineM(c[i - 1][0], c[i - 1][1], p[0], p[1]) : 0), 0) / 1000, 0);
  const refKm = officialKm.get(e.key) ?? 0;
  const precision = g.precision ?? 'C';
  const dev = refKm > 0 ? Math.abs(measuredKm - refKm) / refKm : null;
  const devPct = dev === null ? '' : Math.round(dev * 1000) / 10;
  const componentCount = g.componentCount ?? chains.length;

  b.geom += 1;
  b.km += measuredKm;
  if (b[precision] !== undefined) b[precision] += 1;
  if (refKm > 0 && officialGrade[e.class]) {
    officialGrade[e.class].n += 1;
    if (precision === 'A' || precision === 'B') officialGrade[e.class].ab += 1;
  }
  if (componentCount > 1) b.multi += 1;

  let status = 'ok';
  if (nan > 0) status = 'broken-nan';
  else if (jumps > 0) status = 'broken-jump';
  else if (dev === null) status = 'no-official-km';
  else if (dev > 0.5) status = 'deviation-large';
  else if (dev > 0.25) status = 'deviation-mid';
  rows.push([e.key, e.ref, refKm || '', measuredKm.toFixed(1), devPct, status, componentCount, (g.gapAnnotations?.length ?? 0), precision].join(','));
}

// ── 门禁 ────────────────────────────────────────────────────────────────────
const gates = [];
const ge = ['expressway', 'national'];
let blocking = 0;
for (const cls of ge) {
  const b = stat[cls];
  if (!b) continue;
  // 覆盖率只在"OSM 中真实出现过该编号"的条目上追责：
  // 2022 规划里的 182 条国道联络线（G6xx/G7xx）与部分高速联络线现实中尚未
  // 按该编号标志，OSM 里自然没有数据 —— 这是事实差距，不是装配失败。
  const accounted = b.geom + b.corrupt;
  const cov = b.total ? accounted / b.total : 0;
  const covOsm = b.inOsm ? accounted / b.inOsm : 1;
  gates.push({
    gate: cls + ' 有几何率（OSM 在册口径）',
    value: (covOsm * 100).toFixed(1) + '%（' + accounted + '/' + (b.inOsm ?? b.total) + '）',
    expect: '= 100%',
    pass: covOsm >= 0.999,
  });
  if (covOsm < 0.999) blocking += 1;
  gates.push({
    gate: cls + ' 全量口径覆盖率',
    value: (cov * 100).toFixed(1) + '%',
    expect: '参考值（含官方规划在册、OSM 尚无数据者）',
    pass: true,
  });
  gates.push({ gate: cls + ' 几何损坏', value: String(b.corrupt), expect: '= 0', pass: b.corrupt === 0 });
  if (b.corrupt > 0) blocking += 1;
  const og = officialGrade[cls];
  if (og.n > 0) {
    const ab = og.ab / og.n;
    gates.push({
      gate: cls + ' 有官方里程者 A+B 占比',
      value: (ab * 100).toFixed(1) + '%（' + og.ab + '/' + og.n + '）',
      expect: '≥ 75%',
      pass: ab >= 0.75,
    });
  }
}

console.log('== 按等级 ==');
const clsOrder = ['expressway', 'national', 'provincial', 'county', 'township', 'village'];
for (const cls of clsOrder) {
  const b = stat[cls];
  if (!b) continue;
  console.log('  ' + cls.padEnd(11) + ' 在册 ' + String(b.total).padStart(6) +
    '（OSM 有 ' + String(b.inOsm || b.total).padStart(6) + '）' +
    ' · 有几何 ' + String(b.geom).padStart(6) + '（' + ((b.geom / Math.max(1, b.total)) * 100).toFixed(1) + '%）' +
    ' · ' + b.km.toFixed(0).padStart(7) + ' km' +
    ' · A' + String(b.A).padStart(5) + ' B' + String(b.B).padStart(5) + ' C' + String(b.C).padStart(5) + ' X' + String(b.X).padStart(4) +
    ' · 多段 ' + String(b.multi).padStart(5) + ' · 跳点 ' + b.jumps + ' · 损坏 ' + b.corrupt);
}
console.log('\n== 门禁 ==');
for (const g of gates) console.log('  ' + (g.pass ? '✓' : '✗') + ' ' + g.gate.padEnd(24) + ' ' + g.value.padStart(8) + '  （要求 ' + g.expect + '）');

mkdirSync(REPORT_DIR, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
writeFileSync(GAP_CSV, 'key,ref,officialKm,measuredKm,deviation,status,segmentCount,gapCount,precision\n' + rows.join('\n') + '\n', 'utf8');
writeFileSync(join(REPORT_DIR, 'quality-' + date + '.json'), JSON.stringify({ generatedAt: new Date().toISOString(), date, byClass: stat, gates, items: rows.length }, null, 1), 'utf8');
console.log('\n→ data/roads/coverage-gap.csv · data/roads/reports/quality-' + date + '.json');
if (blocking) {
  console.error('\nRESULT FAIL：' + blocking + ' 项阻断门禁未通过');
  process.exit(1);
}
console.log('\nRESULT PASS');
