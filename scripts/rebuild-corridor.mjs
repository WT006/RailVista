/**
 * 走廊重做执行器 — 从本地轨网提取参考轨段拼线，端点对齐后写入走廊 JSON。
 *
 * 用法：
 *   node scripts/rebuild-corridor.mjs --id guangshen
 *   node scripts/rebuild-corridor.mjs --id zhanhai --hints 湛江,雷州,海安
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
const geoPath = join(root, 'data/stations-geo.json');
const railGraphPath = join(root, 'data/rails/china-rail.graph');
const hsrGraphPath = join(root, 'data/rails/china-hsr.graph');

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function loadGraph(path) {
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return (data.ways || []).filter((w) => w.points?.length >= 2);
}

function loadGeo() {
  return JSON.parse(readFileSync(geoPath, 'utf8'));
}

function findNearestWay(point, ways) {
  let best = { dist: Infinity, way: null, idx: -1 };
  for (let i = 0; i < ways.length; i++) {
    const w = ways[i];
    for (const p of w.points) {
      const lng = Array.isArray(p) ? p[0] : p.lng;
      const lat = Array.isArray(p) ? p[1] : p.lat;
      const d = haversine(point, { lng, lat });
      if (d < best.dist) {
        best = { dist: d, way: w, idx: i };
      }
    }
  }
  return best;
}

function extractSegmentAlong(from, to, ways, maxDevKm = 15) {
  const fromHit = findNearestWay(from, ways);
  const toHit = findNearestWay(to, ways);
  if (!fromHit.way || !toHit.way) return null;
  if (fromHit.dist > maxDevKm || toHit.dist > maxDevKm) return null;

  const coords = [];
  const fromWay = fromHit.way;
  const toWay = toHit.way;

  if (fromHit.idx === toHit.idx) {
    for (const p of fromWay.points) {
      const lng = Array.isArray(p) ? p[0] : p.lng;
      const lat = Array.isArray(p) ? p[1] : p.lat;
      coords.push([lng, lat]);
    }
    return coords;
  }

  for (const p of fromWay.points) {
    const lng = Array.isArray(p) ? p[0] : p.lng;
    const lat = Array.isArray(p) ? p[1] : p.lat;
    coords.push([lng, lat]);
  }
  for (const p of toWay.points) {
    const lng = Array.isArray(p) ? p[0] : p.lng;
    const lat = Array.isArray(p) ? p[1] : p.lat;
    coords.push([lng, lat]);
  }
  return coords;
}

function rebuildCorridor(id, hintsOverride) {
  const filePath = join(corrDir, `${id}.json`);
  if (!existsSync(filePath)) {
    console.error(`Corridor not found: ${id}`);
    return null;
  }

  const corridor = JSON.parse(readFileSync(filePath, 'utf8'));
  const geo = loadGeo();
  const railWays = loadGraph(railGraphPath);
  const hsrWays = loadGraph(hsrGraphPath);
  const allWays = [...railWays, ...hsrWays];

  const hints = hintsOverride || corridor.stationsHint || [];
  if (hints.length < 2) {
    console.error(`Need at least 2 hints for ${id}`);
    return null;
  }

  console.log(`Rebuilding ${id}: ${hints.length} hints, ${allWays.length} ways`);

  const fullCoords = [];
  for (let i = 0; i < hints.length - 1; i++) {
    const fromName = hints[i].replace(/站$/, '').trim();
    const toName = hints[i + 1].replace(/站$/, '').trim();
    const fromGeo = geo[fromName] || geo[fromName + '站'];
    const toGeo = geo[toName] || geo[toName + '站'];
    if (!fromGeo || !toGeo) {
      console.warn(`  skip ${fromName}→${toName}: missing coords`);
      continue;
    }
    const seg = extractSegmentAlong(
      { lng: fromGeo.lng, lat: fromGeo.lat },
      { lng: toGeo.lng, lat: toGeo.lat },
      allWays,
    );
    if (seg && seg.length >= 2) {
      if (fullCoords.length > 0) seg.shift();
      fullCoords.push(...seg);
      console.log(`  ${fromName}→${toName}: ${seg.length} pts`);
    } else {
      console.warn(`  skip ${fromName}→${toName}: no segment`);
    }
  }

  if (fullCoords.length < 2) {
    console.error(`Rebuild failed: only ${fullCoords.length} points`);
    return null;
  }

  corridor.railway = fullCoords;
  corridor.stationsHint = hints;
  corridor.island = false;
  writeFileSync(filePath, JSON.stringify(corridor, null, 2) + '\n', 'utf8');
  console.log(`Written ${id}: ${fullCoords.length} points`);
  return corridor;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const idIdx = args.indexOf('--id');
  const hintsIdx = args.indexOf('--hints');
  const id = idIdx >= 0 ? args[idIdx + 1] : null;
  const hints = hintsIdx >= 0 ? args[hintsIdx + 1].split(',').map((s) => s.trim()) : null;
  return { id, hints };
}

const { id, hints } = parseArgs();
if (!id) {
  console.error('Usage: node scripts/rebuild-corridor.mjs --id <corridor-id> [--hints a,b,c]');
  process.exit(1);
}
rebuildCorridor(id, hints);