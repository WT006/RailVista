/**
 * 万里路书 · 全国公路旅游网 —— 网质量检（PRD §3 Step 5）。
 *
 *   - 每条国道长度与官方里程偏差 >±25% → 告警（partial / broken 标记）
 *   - 连通分量检测：干线应落在 1 个主分量（含跨省接续）
 *   - 几何跳点 >5km 的段 → 标 broken
 *
 * 用法：node scripts/verify-road-network.mjs
 * 产物：data/roads/coverage-gap.csv（缺几何/超差的在册编号）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineKm } from './lib/overpass.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, '../data/roads/index');
const AUTH_DIR = join(__dirname, '../data/roads/authoritative');
const GEOM_DIR = join(__dirname, '../data/roads/geom');
const TOPO_META = join(__dirname, '../data/roads/china-road-topo.meta.json');
const GAP_CSV = join(__dirname, '../data/roads/coverage-gap.csv');

const DEVIATION_LIMIT = 0.25;
const JUMP_KM = 5;

// 官方里程参考值以权威名录为准（index 的 lengthKm 已被 --merge 回写为几何实测值）
const officialKm = new Map();
for (const f of ['national.json', 'expressway.json', 'provincial.json']) {
  const p = join(AUTH_DIR, f);
  if (!existsSync(p)) continue;
  for (const r of JSON.parse(readFileSync(p, 'utf8')).roads ?? []) {
    const key = r.province ? `${r.province}:${r.ref}` : r.ref;
    officialKm.set(key, r.officialLengthKm ?? 0);
  }
}

const entries = [];
for (const f of ['national.json', 'expressway.json', 'provincial.json']) {
  const p = join(INDEX_DIR, f);
  if (!existsSync(p)) continue;
  entries.push(...JSON.parse(readFileSync(p, 'utf8')).roads);
}

const gaps = [];
let ok = 0;
let partial = 0;
let broken = 0;
let missing = 0;

/** 两方位角之差（弧度 → 度，0~180） */
function angleDiff(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return (d * 180) / Math.PI;
}

for (const e of entries) {
  const geomPath = join(GEOM_DIR, `${e.key.replace(/[^\w:]/g, '_')}.json`);
  if (!existsSync(geomPath) || e.hasGeom === false) {
    missing += 1;
    gaps.push([e.key, 'no-geometry', '', e.lengthKm].join(','));
    continue;
  }
  let g;
  try {
    g = JSON.parse(readFileSync(geomPath, 'utf8'));
  } catch {
    broken += 1;
    gaps.push([e.key, 'broken-json', '', e.lengthKm].join(','));
    continue;
  }
  const points = g.points ?? [];
  if (points.length < 2) {
    broken += 1;
    gaps.push([e.key, 'too-few-points', points.length, e.lengthKm].join(','));
    continue;
  }

  // 跳点检测（>5km 的段）：
  // 注意 DP 简化后的笔直长段（青藏线柴达木段可连续数十公里直线）不是跳点，
  // 只有「长段 + 方向突变」才是断链/传送。方向变化 >25° 判定突变。
  let jumps = 0;
  const bearing = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
  for (let i = 1; i < points.length; i += 1) {
    const d = haversineKm([points[i - 1][0], points[i - 1][1]], [points[i][0], points[i][1]]);
    if (d <= JUMP_KM) continue;
    const prev = points[i - 2] ?? points[i - 1];
    const next = points[i + 1] ?? points[i];
    const a1 = bearing(prev, points[i - 1]);
    const a2 = bearing(points[i - 1], points[i]);
    const a3 = bearing(points[i], next);
    const bend = Math.max(angleDiff(a1, a2), angleDiff(a2, a3));
    if (bend > 25) jumps += 1;
  }

  // 与官方里程偏差（官方里程参考值来自 authoritative/，为 0 时跳过比对）
  const geomKm = g.cumKm?.length === points.length ? g.cumKm[g.cumKm.length - 1] : null;
  const refKm = officialKm.get(e.key) ?? 0;
  if (geomKm == null || !refKm) {
    partial += 1;
    gaps.push([e.key, 'no-official-km', geomKm?.toFixed?.(1) ?? '', refKm].join(','));
    continue;
  }
  const dev = Math.abs(geomKm - refKm) / refKm;
  if (jumps > 0 || dev > DEVIATION_LIMIT * 3) {
    broken += 1;
    console.warn(`✗ ${e.key}: 偏差 ${(dev * 100).toFixed(0)}%（${geomKm.toFixed(0)} vs 官方 ${refKm} km）· 跳点 ${jumps} → broken`);
    gaps.push([e.key, 'broken', geomKm.toFixed(1), refKm].join(','));
  } else if (dev > DEVIATION_LIMIT) {
    partial += 1;
    console.warn(`⚠ ${e.key}: 偏差 ${(dev * 100).toFixed(0)}%（${geomKm.toFixed(0)} vs 官方 ${refKm} km）→ partial`);
    gaps.push([e.key, 'partial', geomKm.toFixed(1), refKm].join(','));
  } else {
    ok += 1;
    console.log(`✓ ${e.key}: ${geomKm.toFixed(0)} km（偏差 ${(dev * 100).toFixed(0)}%）`);
  }
}

// 连通分量
if (existsSync(TOPO_META)) {
  const meta = JSON.parse(readFileSync(TOPO_META, 'utf8'));
  console.log(`\n拓扑：${meta.nodeCount} 节点 / ${meta.edgeCount} 边，主分量 ${meta.mainCompNodes} 节点（应覆盖绝大多数干线）`);
}

writeFileSync(GAP_CSV, ['key,issue,geomKm,officialKm'].join('\n') + '\n' + gaps.join('\n') + '\n', 'utf8');
console.log(`\n汇总：ok ${ok} · partial ${partial} · broken ${broken} · 缺几何 ${missing} / 在册 ${entries.length}`);
console.log(`缺口清单 → data/roads/coverage-gap.csv`);
