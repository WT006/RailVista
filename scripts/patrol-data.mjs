/**
 * C2: 数据巡检门禁 — 防回归检查。
 *
 * 检查项：
 *   1) 12306 站表 vs stations-geo 覆盖率 <95% → 报警
 *   2) 每条走廊：端点距其 hints 首/末站 >12km → 报警
 *   3) 每条走廊：hints 数量 <5 → 报警
 *   4) 两两走廊几何交叉点 ≤3km 但无共享 hint → 报警（潜在断链）
 *
 * 用法：
 *   node scripts/patrol-data.mjs              # 全量巡检
 *   node scripts/patrol-data.mjs --json out.json  # 输出 JSON
 *   node scripts/patrol-data.mjs --strict     # 有告警则 exit(1)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
const geoPath = join(root, 'data/stations-geo.json');
const cachePath = join(root, 'data/station_name.cache.json');

const ENDPOINT_MAX_KM = 12;
const MIN_HINTS = 5;
const COVERAGE_THRESHOLD = 0.95;
const CROSS_LINK_MAX_KM = 3;

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
  return String(name || '').replace(/站$/, '').trim();
}

function polylineBBox(pl) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of pl) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

function boxesOverlap(a, b, pad = 0) {
  return (
    a.minLng - pad <= b.maxLng &&
    a.maxLng + pad >= b.minLng &&
    a.minLat - pad <= b.maxLat &&
    a.maxLat + pad >= b.minLat
  );
}

function nearestPointsBetween(pl1, pl2, sampleStep = 20) {
  let best = { distKm: Infinity };
  for (let i = 0; i < pl1.length; i += sampleStep) {
    for (let j = 0; j < pl2.length; j += sampleStep) {
      const d = haversine(
        { lng: pl1[i][0], lat: pl1[i][1] },
        { lng: pl2[j][0], lat: pl2[j][1] },
      );
      if (d < best.distKm) {
        best = { distKm: d, i, j, lng: pl1[i][0], lat: pl1[i][1] };
      }
    }
  }
  return best;
}

// ── Load data ──
const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const stationCache = JSON.parse(readFileSync(cachePath, 'utf8'));
const corridors = [];
for (const f of readdirSync(corrDir).filter((f) => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(corrDir, f), 'utf8'));
  if (c.railway?.length >= 2) corridors.push(c);
}

const alerts = [];

// ── Check 1: Station coverage ──
const allStations = stationCache.stations || [];
const geoKeys = new Set(Object.keys(geo));
let covered = 0;
for (const s of allStations) {
  const key = normalize(s.name);
  if (geoKeys.has(key) || geoKeys.has(s.name) || geoKeys.has(s.short)) {
    covered++;
  }
}
const coverage = covered / allStations.length;
if (coverage < COVERAGE_THRESHOLD) {
  alerts.push({
    level: 'WARN',
    check: 'station-coverage',
    detail: `stations-geo 覆盖率 ${(coverage * 100).toFixed(1)}% < ${(COVERAGE_THRESHOLD * 100).toFixed(0)}% (${covered}/${allStations.length})`,
  });
}

// ── Check 2: Corridor endpoints vs hints ──
for (const c of corridors) {
  const hints = (c.stationsHint || []).map(normalize);
  if (hints.length < 2) continue;
  const railway = c.railway;
  const first = hints[0];
  const last = hints[hints.length - 1];
  const firstGeo = geo[first] || geo[first + '站'];
  const lastGeo = geo[last] || geo[last + '站'];

  if (firstGeo?.lng) {
    const d = haversine(
      { lng: railway[0][0], lat: railway[0][1] },
      { lng: firstGeo.lng, lat: firstGeo.lat },
    );
    if (d > ENDPOINT_MAX_KM) {
      alerts.push({
        level: 'WARN',
        check: 'endpoint-far',
        corridor: c.id,
        detail: `起点距 hint「${first}」${d.toFixed(1)}km > ${ENDPOINT_MAX_KM}km`,
      });
    }
  }
  if (lastGeo?.lng) {
    const d = haversine(
      { lng: railway[railway.length - 1][0], lat: railway[railway.length - 1][1] },
      { lng: lastGeo.lng, lat: lastGeo.lat },
    );
    if (d > ENDPOINT_MAX_KM) {
      alerts.push({
        level: 'WARN',
        check: 'endpoint-far',
        corridor: c.id,
        detail: `终点距 hint「${last}」${d.toFixed(1)}km > ${ENDPOINT_MAX_KM}km`,
      });
    }
  }
}

// ── Check 3: Hints count ──
for (const c of corridors) {
  const hints = c.stationsHint || [];
  if (hints.length < MIN_HINTS && hints.length >= 2) {
    alerts.push({
      level: 'INFO',
      check: 'hints-few',
      corridor: c.id,
      detail: `hints 数量 ${hints.length} < ${MIN_HINTS}`,
    });
  }
}

// ── Check 4: Geometric cross-link without shared hint ──
const withBBox = corridors
  .filter((c) => c.railway?.length >= 10)
  .map((c) => ({ c, bbox: polylineBBox(c.railway) }));

let crossChecked = 0;
for (let i = 0; i < withBBox.length; i++) {
  for (let j = i + 1; j < withBBox.length; j++) {
    const a = withBBox[i];
    const b = withBBox[j];
    if (!boxesOverlap(a.bbox, b.bbox, 0.05)) continue;
    crossChecked++;

    const hintsA = new Set((a.c.stationsHint || []).map(normalize));
    const hintsB = new Set((b.c.stationsHint || []).map(normalize));
    const shared = [...hintsA].filter((h) => hintsB.has(h));
    if (shared.length > 0) continue;

    const near = nearestPointsBetween(a.c.railway, b.c.railway, 30);
    if (near.distKm <= CROSS_LINK_MAX_KM) {
      alerts.push({
        level: 'INFO',
        check: 'cross-no-link',
        corridor: `${a.c.id} ↔ ${b.c.id}`,
        detail: `折线最近点 ${near.distKm.toFixed(2)}km ≤ ${CROSS_LINK_MAX_KM}km 但无共享 hint`,
      });
    }
  }
}

// ── Output ──
const wantJson = process.argv.includes('--json');
const jsonIdx = process.argv.indexOf('--json');
const jsonPath = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null;
const wantStrict = process.argv.includes('--strict');

const warns = alerts.filter((a) => a.level === 'WARN');
const infos = alerts.filter((a) => a.level === 'INFO');

console.log(`PATROL: corridors=${corridors.length} crossChecked=${crossChecked} alerts=${alerts.length} (WARN=${warns.length} INFO=${infos.length})`);
for (const a of alerts.slice(0, 100)) {
  console.log(`  ${a.level} [${a.check}] ${a.corridor || ''} ${a.detail}`);
}
if (alerts.length > 100) console.log(`  ... +${alerts.length - 100} more`);

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ alerts, coverage, total: alerts.length }, null, 2));
  console.log(`JSON written to ${jsonPath}`);
}

if (wantStrict && alerts.length > 0) {
  console.error(`STRICT MODE: ${alerts.length} alerts found, exiting with code 1`);
  process.exit(1);
}