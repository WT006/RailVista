/**
 * A1: 离线批量补 stations-geo.json 缺失站坐标。
 *
 * 三级策略：
 *   1) 走廊折线投影：站在某走廊 stationsHint 列表里 → 按 hint 序号比例取折线点
 *   2) 轨图 way 搜索：在 china-rail.graph 里找同名 way，取 way 端点或中点
 *   3) 手工坐标表：MANUAL_COORDS 兜底（已知准确坐标的站）
 *
 * 用法：
 *   node scripts/seed-stations-geo-full.mjs                    # 补 KEY_MISSING 列表
 *   node scripts/seed-stations-geo-full.mjs 鹰潭北 弋阳 襄州    # 补指定站
 *   node scripts/seed-stations-geo-full.mjs --all               # 补全部缺失
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const geoPath = join(__dirname, '../data/stations-geo.json');
const cachePath = join(__dirname, '../data/station_name.cache.json');
const corridorsDir = join(__dirname, '../data/presets/corridors');
const railGraphPath = join(__dirname, '../data/rails/china-rail.graph');

const KEY_MISSING = [
  '鹰潭北', '弋阳', '襄州', '沈阳东', '石家庄东', '长沙西', '成都南',
  '哈尔滨北', '阳新', '雷州', '徐闻', '绥化', '北安', '哈尔滨东',
  '沈阳南', '长春西', '昆明南', '贵阳北', '南宁东', '兰州西',
  '乌鲁木齐', '拉萨', '西宁', '银川', '呼和浩特东',
];

const MANUAL_COORDS = {
  鹰潭北: { lng: 117.209, lat: 28.239 },
  弋阳: { lng: 117.43, lat: 28.42 },
  襄州: { lng: 112.15, lat: 32.02 },
  沈阳东: { lng: 123.46, lat: 41.82 },
  石家庄东: { lng: 114.51, lat: 38.05 },
  长沙西: { lng: 112.91, lat: 28.23 },
  成都南: { lng: 104.07, lat: 30.62 },
  哈尔滨北: { lng: 126.57, lat: 45.80 },
  阳新: { lng: 115.23, lat: 29.83 },
  雷州: { lng: 110.08, lat: 20.91 },
  徐闻: { lng: 110.17, lat: 20.33 },
  绥化: { lng: 126.97, lat: 46.65 },
  北安: { lng: 126.49, lat: 48.24 },
  哈尔滨东: { lng: 126.69, lat: 45.79 },
  沈阳南: { lng: 123.43, lat: 41.71 },
  长春西: { lng: 125.24, lat: 43.86 },
  昆明南: { lng: 102.72, lat: 25.02 },
  贵阳北: { lng: 106.65, lat: 26.62 },
  南宁东: { lng: 108.47, lat: 22.82 },
  兰州西: { lng: 103.69, lat: 36.08 },
  乌鲁木齐: { lng: 87.62, lat: 43.83 },
  拉萨: { lng: 91.13, lat: 29.65 },
  西宁: { lng: 101.78, lat: 36.62 },
  银川: { lng: 106.27, lat: 38.47 },
  呼和浩特东: { lng: 111.79, lat: 40.84 },
};

function isPlausibleCnRailPoint(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lng < 73 || lng > 135 || lat < 18 || lat > 54) return false;
  if (lng >= 128.5 && lat < 41.5) return false;
  if (lng >= 138) return false;
  return true;
}

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function nearestOnPolyline(polyline, lng, lat) {
  let best = { distKm: Infinity, lng, lat, idx: 0 };
  for (let i = 0; i < polyline.length; i++) {
    const d = haversine(
      { lng: polyline[i][0], lat: polyline[i][1] },
      { lng, lat },
    );
    if (d < best.distKm) best = { distKm: d, lng: polyline[i][0], lat: polyline[i][1], idx: i };
  }
  return best;
}

function pointAtFrac(polyline, frac) {
  if (!polyline.length) return null;
  const i = Math.min(
    polyline.length - 1,
    Math.max(0, Math.round(frac * (polyline.length - 1))),
  );
  return { lng: polyline[i][0], lat: polyline[i][1] };
}

// ── Load corridor data ──
const corridors = [];
for (const f of readdirSync(corridorsDir).filter((f) => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(corridorsDir, f), 'utf8'));
  if (c.stationsHint?.length >= 2 && c.railway?.length >= 2) {
    corridors.push(c);
  }
}

// ── Load rail graph (lazy) ──
let railWays = null;
function loadRailWays() {
  if (railWays) return railWays;
  const g = JSON.parse(readFileSync(railGraphPath, 'utf8'));
  railWays = g.ways || {};
  return railWays;
}

// ── Strategy 1: Corridor hint projection ──
function projectFromCorridorHints(name) {
  const key = name.replace(/站$/, '');
  for (const c of corridors) {
    const hints = c.stationsHint || [];
    const idx = hints.findIndex((h) => String(h).replace(/站$/, '') === key);
    if (idx < 0) continue;
    const pt = pointAtFrac(c.railway, idx / (hints.length - 1));
    if (pt && isPlausibleCnRailPoint(pt.lng, pt.lat)) {
      return { lng: pt.lng, lat: pt.lat, source: `corridor:${c.id}` };
    }
  }
  return null;
}

// ── Strategy 2: Rail graph way search ──
function searchRailGraph(name, approxLng, approxLat) {
  const ways = loadRailWays();
  const key = name.replace(/站$/, '');
  const lineNames = guessLineNames(key);
  for (const lineName of lineNames) {
    let bestWay = null;
    let bestDist = Infinity;
    for (const w of Object.values(ways)) {
      if (w.name !== lineName || !w.points?.length) continue;
      const mid = w.points[Math.floor(w.points.length / 2)];
      if (!approxLng) {
        bestWay = w;
        break;
      }
      const d = haversine(
        { lng: mid[0], lat: mid[1] },
        { lng: approxLng, lat: approxLat },
      );
      if (d < bestDist) {
        bestDist = d;
        bestWay = w;
      }
    }
    if (bestWay && bestWay.points?.length) {
      const mid = bestWay.points[Math.floor(bestWay.points.length / 2)];
      if (isPlausibleCnRailPoint(mid[0], mid[1])) {
        return { lng: mid[0], lat: mid[1], source: `railgraph:${lineName}` };
      }
    }
  }
  return null;
}

function guessLineNames(name) {
  const map = {
    鹰潭北: ['沪昆线'],
    弋阳: ['沪昆线'],
    襄州: ['焦柳线', '襄渝线'],
    沈阳东: ['沈吉线', '沈大线'],
    石家庄东: ['京广线', '石德线'],
    长沙西: ['长株潭城际'],
    成都南: ['成昆线', '成渝线'],
    哈尔滨北: ['滨北线', '滨洲线'],
    阳新: ['武九线'],
    雷州: ['湛海线'],
    徐闻: ['湛海线'],
    绥化: ['绥佳线', '滨北线'],
    北安: ['滨北线', '齐北线'],
  };
  return map[name] || [];
}

// ── Strategy 3: Manual coords ──
function getManualCoords(name) {
  const key = name.replace(/站$/, '');
  const mc = MANUAL_COORDS[key];
  if (mc && isPlausibleCnRailPoint(mc.lng, mc.lat)) {
    return { ...mc, source: 'manual' };
  }
  return null;
}

function loadGeo() {
  return JSON.parse(readFileSync(geoPath, 'utf8'));
}

function saveGeo(geo) {
  writeFileSync(geoPath, JSON.stringify(geo, null, 0), 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  let targets;
  if (args.includes('--all')) {
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    const geo = loadGeo();
    const geoKeys = new Set(Object.keys(geo));
    targets = (cache.stations || [])
      .map((s) => s.name)
      .filter((n) => !geoKeys.has(n) && !geoKeys.has(n.replace(/站$/, '')));
    console.log(`--all: ${targets.length} missing stations to geocode`);
  } else if (args.length > 0) {
    targets = args.filter((a) => !a.startsWith('-'));
  } else {
    targets = KEY_MISSING;
  }

  const geo = loadGeo();
  let added = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  console.log(`Target: ${targets.length} stations, geo has ${Object.keys(geo).length}`);

  for (let i = 0; i < targets.length; i++) {
    const name = targets[i];
    const key = name.replace(/站$/, '');
    if (geo[key]?.lng != null || geo[name]?.lng != null) {
      skipped += 1;
      continue;
    }

    process.stdout.write(`[${i + 1}/${targets.length}] ${name} ... `);

    // Strategy 1: Manual coords (highest trust for key stations)
    let pt = getManualCoords(name);

    // Strategy 2: Rail graph way search (guided by manual approx)
    if (!pt) {
      const approx = MANUAL_COORDS[key];
      pt = searchRailGraph(name, approx?.lng, approx?.lat);
    }

    // Strategy 3: Corridor hint projection (lowest trust — hint order ≠ geo order)
    if (!pt) {
      pt = projectFromCorridorHints(name);
    }

    if (pt) {
      geo[key] = { name: key, lng: pt.lng, lat: pt.lat, source: pt.source };
      added += 1;
      console.log(`OK ${pt.lng.toFixed(4)} ${pt.lat.toFixed(4)} (${pt.source})`);
    } else {
      failed += 1;
      failures.push(name);
      console.log('FAIL');
    }
  }

  saveGeo(geo);
  console.log(`\nDone: added=${added} skipped=${skipped} failed=${failed} total=${Object.keys(geo).length}`);
  if (failures.length) console.log('Failures:', failures.join(', '));
}

main();
