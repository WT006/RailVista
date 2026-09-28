/**
 * 站坐标合并（S5）：以 12306 全量站表为主表，用 OSM 站点补齐 stations-geo.json。
 *
 * 宁缺勿错写入约束：
 *   - 站名 normalize（去"站"后缀 + 手工别名表）后唯一匹配
 *   - 候选坐标距既有走廊折线 ≤5 km 或距任一既有站 ≤5 km（轨网邻近近似）
 *   - verified:true 条目一律不覆盖
 *
 * 用法：
 *   node scripts/merge-stations-geo.mjs --osm data/stations-osm.json --write
 *   node scripts/merge-stations-geo.mjs --osm data/stations-osm.json --report report.txt
 *   node scripts/merge-stations-geo.mjs --osm ... --write --strict-coverage
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const geoPath = join(root, 'data/stations-geo.json');
const cachePath = join(root, 'data/station_name.cache.json');
const corrDir = join(root, 'data/presets/corridors');

const SNAP_KM = 5;
const COVERAGE_THRESHOLD = Number(process.env.PATROL_COVERAGE_THRESHOLD || 0.95);

/** 手工别名表：12306 名 → OSM 常见名（键值均应为去"站"后缀形态） */
const ALIASES = new Map([
  ['白涧', '白涧'],
  ['呼和浩特东', '呼和浩特东'],
]);

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function normalize(name) {
  let n = String(name || '').trim();
  // 统一全角括号内的注明（如「北京（丰台）」→ 北京）
  n = n.replace(/[（(].*?[)）]/g, '').trim();
  n = n.replace(/站$/, '').trim();
  return ALIASES.get(n) || n;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const osmIdx = args.indexOf('--osm');
  const reportIdx = args.indexOf('--report');
  return {
    osmPath: osmIdx >= 0 ? args[osmIdx + 1] : join(root, 'data/stations-osm.json'),
    reportPath: reportIdx >= 0 ? args[reportIdx + 1] : null,
    write: args.includes('--write'),
    strictCoverage: args.includes('--strict-coverage'),
  };
}

// ── Load ──
const { osmPath, reportPath, write, strictCoverage } = parseArgs();
const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
const allStations = cache.stations || [];
const osmData = existsSync(osmPath) ? JSON.parse(readFileSync(osmPath, 'utf8')) : null;

if (!osmData?.stations?.length) {
  console.error(`OSM stations file missing or empty: ${osmPath}`);
  console.error('Run `node scripts/fetch-stations-osm.mjs --resume` first (needs Overpass access).');
  process.exit(1);
}

// OSM 站名 → 候选列表（normalize 后聚合）
const osmByNorm = new Map();
for (const s of osmData.stations) {
  if (!s.name || s.lng == null || s.lat == null) continue;
  const k = normalize(s.name);
  if (!k) continue;
  if (!osmByNorm.has(k)) osmByNorm.set(k, []);
  osmByNorm.get(k).push({ lng: s.lng, lat: s.lat, raw: s.name });
}

// 走廊折线索引（bbox 预筛 + 投影用）
const corridors = [];
if (existsSync(corrDir)) {
  for (const f of readdirSync(corrDir).filter((f) => f.endsWith('.json'))) {
    try {
      const c = JSON.parse(readFileSync(join(corrDir, f), 'utf8'));
      if (c.railway?.length >= 2) corridors.push(c);
    } catch {
      /* ignore */
    }
  }
}

function corridorBBox(c) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of c.railway) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}
const corridorBoxes = corridors.map((c) => ({ c, bbox: corridorBBox(c) }));

/** 距既有走廊折线的最小距离 km（bbox ±0.05° 预筛后逐段投影近似） */
function minDistToCorridors(lng, lat) {
  let best = Infinity;
  const deg5 = SNAP_KM / 111;
  for (const { c, bbox } of corridorBoxes) {
    if (
      lng < bbox.minLng - deg5 * 2 || lng > bbox.maxLng + deg5 * 2 ||
      lat < bbox.minLat - deg5 * 2 || lat > bbox.maxLat + deg5 * 2
    ) {
      continue;
    }
    const rw = c.railway;
    for (let i = 1; i < rw.length; i++) {
      const a = rw[i - 1];
      const b = rw[i];
      // 端点粗筛
      if (
        Math.abs(a[0] - lng) > deg5 && Math.abs(b[0] - lng) > deg5 &&
        Math.abs((a[0] + b[0]) / 2 - lng) > deg5
      ) continue;
      if (
        Math.abs(a[1] - lat) > deg5 && Math.abs(b[1] - lat) > deg5 &&
        Math.abs((a[1] + b[1]) / 2 - lat) > deg5
      ) continue;
      const d1 = haversine({ lng, lat }, { lng: a[0], lat: a[1] });
      if (d1 < best) best = d1;
      const d2 = haversine({ lng, lat }, { lng: b[0], lat: b[1] });
      if (d2 < best) best = d2;
      if (best <= SNAP_KM) return best;
    }
  }
  return best;
}

/** 距任一既有站的最小距离 km（既有站都在轨网上） */
function minDistToExistingStations(lng, lat) {
  let best = Infinity;
  const deg = SNAP_KM / 111;
  for (const k of Object.keys(geo)) {
    const g = geo[k];
    if (g?.lng == null) continue;
    if (Math.abs(g.lng - lng) > deg || Math.abs(g.lat - lat) > deg) continue;
    const d = haversine({ lng, lat }, { lng: g.lng, lat: g.lat });
    if (d < best) best = d;
    if (best <= SNAP_KM) return best;
  }
  return best;
}

// ── Merge ──
const unmatched = [];
const ambiguous = [];
const offRail = [];
let added = 0;
let skippedVerified = 0;

for (const st of allStations) {
  const name = String(st?.name || '').trim();
  if (!name) continue;
  const key = normalize(name);
  const exists =
    !!geo[name] ||
    !!geo[key] ||
    (st.short && !!geo[st.short]);
  const existingEntry = geo[name] || geo[key] || (st.short ? geo[st.short] : null);
  if (existingEntry?.verified) {
    skippedVerified += 0; // verified 条目本就存在，无需处理
    if (existingEntry?.lng != null) continue;
  }
  if (exists && existingEntry?.lng != null) continue;

  const cands = osmByNorm.get(key);
  if (!cands || cands.length === 0) {
    unmatched.push(name);
    continue;
  }
  if (cands.length > 1) {
    // 唯一匹配约束：同名多候选 → 歧义不写入
    // 但若多候选坐标彼此 <2km（同一站重复节点）则取均值
    let clustered = true;
    for (let i = 1; i < cands.length; i++) {
      if (haversine(cands[0], cands[i]) > 2) {
        clustered = false;
        break;
      }
    }
    if (!clustered) {
      ambiguous.push(`${name} (${cands.length} cands)`);
      continue;
    }
  }
  const cand = cands[0];
  const dCorr = minDistToCorridors(cand.lng, cand.lat);
  const dStation = minDistToExistingStations(cand.lng, cand.lat);
  if (dCorr > SNAP_KM && dStation > SNAP_KM) {
    offRail.push(`${name} (${Math.min(dCorr, dStation).toFixed(1)}km from rail)`);
    continue;
  }
  if (write) {
    geo[name] = {
      name,
      lng: Number(cand.lng.toFixed(6)),
      lat: Number(cand.lat.toFixed(6)),
      verified: false,
      source: 'osm-merge',
    };
  }
  added += 1;
}

if (write) {
  writeFileSync(geoPath, JSON.stringify(geo, null, 2) + '\n', 'utf8');
}

// ── Coverage ──
const geoKeys = new Set(Object.keys(geo));
let covered = 0;
for (const s of allStations) {
  const key = normalize(s.name);
  if (geoKeys.has(key) || geoKeys.has(s.name) || (s.short && geoKeys.has(s.short))) covered++;
}
const coverage = allStations.length ? covered / allStations.length : 0;

console.log(`merge: total=${allStations.length} added=${added}${write ? ' (WRITTEN)' : ' (dry-run)'}`);
console.log(`unmatched=${unmatched.length} ambiguous=${ambiguous.length} offRail=${offRail.length}`);
console.log(`coverage: ${(coverage * 100).toFixed(1)}% (${covered}/${allStations.length}) threshold=${(COVERAGE_THRESHOLD * 100).toFixed(0)}%`);

if (reportPath) {
  const lines = [];
  lines.push(`# merge-stations-geo report`);
  lines.push(`total=${allStations.length} added=${added} coverage=${(coverage * 100).toFixed(1)}%`);
  lines.push('');
  lines.push(`## unmatched (${unmatched.length})`);
  for (const u of unmatched) lines.push(`- ${u}`);
  lines.push('');
  lines.push(`## ambiguous (${ambiguous.length})`);
  for (const u of ambiguous) lines.push(`- ${u}`);
  lines.push('');
  lines.push(`## offRail > ${SNAP_KM}km (${offRail.length})`);
  for (const u of offRail) lines.push(`- ${u}`);
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`report written to ${reportPath}`);
}

if (strictCoverage && coverage < COVERAGE_THRESHOLD) {
  console.error(`STRICT: coverage ${(coverage * 100).toFixed(1)}% < ${(COVERAGE_THRESHOLD * 100).toFixed(0)}%`);
  process.exit(1);
}