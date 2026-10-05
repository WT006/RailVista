/**
 * 万里路书 · 公路几何重串接
 *
 * 用途：不重新请求 Overpass，仅从现有 ways 缓存重新执行 chainAll，
 * 用于验证/优化 chainAll 算法改进效果（如 orphan 去重）。
 *
 * 用法：
 *   node scripts/rechain-road-geometry.mjs            # 重串所有缓存路线
 *   node scripts/rechain-road-geometry.mjs --ref G227 # 单条
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chainAll,
  computeCumKm,
  computeGapAnnotations,
  simplifyDP,
} from './lib/overpass.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../data/cache/roads');
const GEOM_DIR = join(__dirname, '../data/roads/geom');
const INDEX_DIR = join(__dirname, '../data/roads/index');
const AUTH_DIR = join(__dirname, '../data/roads/authoritative');

function parseArgs() {
  const args = process.argv.slice(2);
  const refs = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--ref' && args[i + 1]) refs.push(args[i + 1]);
  }
  return { refs };
}

const officialKmByRef = new Map();
const metaByRef = new Map();
for (const f of ['national.json', 'expressway.json']) {
  const p = join(AUTH_DIR, f);
  if (!existsSync(p)) continue;
  const data = JSON.parse(readFileSync(p, 'utf8'));
  for (const r of data.roads ?? []) {
    officialKmByRef.set(r.ref, r.officialLengthKm ?? 0);
    metaByRef.set(r.ref, { fromPlace: r.fromPlace, toPlace: r.toPlace });
  }
}

function discoverCacheFiles(filterRefs) {
  const files = readdirSync(CACHE_DIR).filter((n) => {
    if (!n.startsWith('ways-') || !n.endsWith('.json')) return false;
    // 排除省分片缓存 ways-G227-XJ.json
    if (/ways-[^-]+-[A-Z]{2,3}\.json$/.test(n)) return false;
    return true;
  });
  const out = [];
  for (const f of files) {
    const ref = f.replace(/^ways-/, '').replace(/\.json$/, '');
    if (filterRefs.length && !filterRefs.includes(ref)) continue;
    out.push({ ref, file: join(CACHE_DIR, f) });
  }
  return out;
}

function rechainOne(ref, cacheFile) {
  const ways = JSON.parse(readFileSync(cacheFile, 'utf8'));
  if (!ways.length) {
    console.log(`  ✗ ${ref}：缓存为空`);
    return null;
  }
  const officialKm = officialKmByRef.get(ref) ?? 0;
  const meta = metaByRef.get(ref) ?? {};
  const { main, segments, gapAnnotations, orphans } = chainAll(ways, officialKm);
  if (main.length < 10) {
    console.log(`  ✗ ${ref}：成链过短（${main.length} 点）`);
    return null;
  }
  const simplified = simplifyDP(main, 30);
  const simplifiedSegments = segments.map((seg) => simplifyDP(seg, 30));
  const cumKm = computeCumKm(simplified);
  const totalKm = Math.round(cumKm[cumKm.length - 1] * 10) / 10;
  const nodes = [
    { name: meta.fromPlace ?? ref, atKm: 0, type: 'endpoint' },
    { name: meta.toPlace ?? ref, atKm: totalKm, type: 'endpoint' },
  ];
  const geom = {
    key: ref,
    points: simplified,
    cumKm: cumKm.map((k) => Math.round(k * 100) / 100),
    nodes,
    simplified: true,
    segments: simplifiedSegments,
    gapAnnotations,
  };
  mkdirSync(GEOM_DIR, { recursive: true });
  writeFileSync(join(GEOM_DIR, `${ref.replace(/[^\w:]/g, '_')}.json`), JSON.stringify(geom), 'utf8');
  return { ref, totalKm, points: simplified.length, orphans, segmentCount: segments.length };
}

const args = parseArgs();
const items = discoverCacheFiles(args.refs);
console.log(`▶ 重串接 ${items.length} 条路线（来源：${CACHE_DIR}）`);
const results = [];
for (const { ref, file } of items) {
  const r = rechainOne(ref, file);
  if (r) {
    results.push(r);
    console.log(`  ✓ ${r.ref}: ${r.totalKm} km · ${r.points} 点 · ${r.segmentCount} 段 · orphan ${r.orphans}`);
  }
}
console.log(`\n完成 ${results.length}/${items.length}。`);
console.log('后续：node scripts/build-road-index.mjs --merge 挂回 L0');
