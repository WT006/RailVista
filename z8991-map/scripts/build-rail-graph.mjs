#!/usr/bin/env node
/**
 * 二期：离线轨网建图
 *
 * 默认（无 PBF 也可跑）：
 *   - HSR：data/presets/corridors/_hsr-rails.geojson → data/rails/china-hsr.graph
 *   - 普速：源为 osm/osm-bbox/anchors 等、且非高铁仿真的走廊 railway
 *           → data/rails/china-rail.graph (+ china-rail.geojson)
 *
 * 可选 PBF（本机有 osmium 且文件存在）：
 *   node scripts/build-rail-graph.mjs --pbf tmp/china-latest.osm.pbf
 *
 * Windows：勿用 shell 拼接中文路径；本脚本用纯 Node fs。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CORRIDORS = join(ROOT, 'data/presets/corridors');
const OUT_DIR = join(ROOT, 'data/rails');
const HSR_GEOJSON = join(CORRIDORS, '_hsr-rails.geojson');

/** 名称含高铁/高速/城际，或已知客运专线 id → 不算普速图 */
const HSR_IDS = new Set([
  'xiashen',
  'hanghuang',
  'hamu',
  'hainandong',
  'jingzhang',
  'zhanghu',
  'chenggui',
  'yugui',
  'yuli',
  'chuanqing',
  'zhonglao',
  'fuping',
  'yinlan',
  'lanxin',
  'hefu',
]);

function isHsrCorridor(c) {
  const src = String(c.source || '');
  const name = String(c.name || '');
  if (/china-hsr|hsr-rails|simulation/i.test(src)) return true;
  if (/高铁|高速|城际/.test(name)) return true;
  if (HSR_IDS.has(c.id)) return true;
  return false;
}

function isConventionalCorridor(c) {
  if (isHsrCorridor(c)) return false;
  const src = String(c.source || '');
  // 允许 osm / osm-bbox / anchors / station-chain 等非仿真源
  if (/china-hsr|hsr-rails|simulation/i.test(src)) return false;
  return true;
}

function bboxOf(points) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    minLng = Math.min(minLng, p[0]);
    minLat = Math.min(minLat, p[1]);
    maxLng = Math.max(maxLng, p[0]);
    maxLat = Math.max(maxLat, p[1]);
  }
  return { minLng, minLat, maxLng, maxLat };
}

function simplifyPts(pts, minDeg = 0.00008) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= minDeg) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function waysFromGeoJsonFeatures(features, { highspeed, nameProp = 'name' } = {}) {
  const ways = [];
  let seq = 1;
  for (const f of features || []) {
    const geom = f.geometry;
    if (!geom?.coordinates) continue;
    const name = f.properties?.[nameProp] || f.properties?.name;
    const lines =
      geom.type === 'LineString'
        ? [geom.coordinates]
        : geom.type === 'MultiLineString'
          ? geom.coordinates
          : [];
    for (const line of lines) {
      const points = (line || [])
        .filter((c) => Array.isArray(c) && c.length >= 2)
        .map((c) => [Number(c[0]), Number(c[1])])
        .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
      if (points.length < 2) continue;
      const simplified = simplifyPts(points);
      ways.push({
        id: Number(f.properties?.osm_id) || seq++,
        name: name || undefined,
        highspeed: !!highspeed,
        points: simplified,
        bbox: bboxOf(simplified),
      });
    }
  }
  return ways;
}

function writeGraph(path, kind, ways) {
  const payload = {
    version: 1,
    kind,
    generatedAt: new Date().toISOString(),
    wayCount: ways.length,
    ways: ways.map(({ id, name, highspeed, points }) => ({
      id,
      name,
      highspeed,
      points,
    })),
  };
  writeFileSync(path, JSON.stringify(payload));
  const mb = (Buffer.byteLength(JSON.stringify(payload)) / (1024 * 1024)).toFixed(2);
  console.log(`[build-rail-graph] wrote ${path} ways=${ways.length} ~${mb}MB`);
}

function writeGeoJson(path, ways) {
  const fc = {
    type: 'FeatureCollection',
    features: ways.map((w) => ({
      type: 'Feature',
      properties: { osm_id: w.id, name: w.name, highspeed: w.highspeed ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: w.points },
    })),
  };
  writeFileSync(path, JSON.stringify(fc));
  console.log(`[build-rail-graph] wrote ${path} features=${ways.length}`);
}

function buildFromLocalAssets() {
  mkdirSync(OUT_DIR, { recursive: true });

  // HSR
  if (!existsSync(HSR_GEOJSON)) {
    console.warn('[build-rail-graph] missing', HSR_GEOJSON);
  } else {
    const gj = JSON.parse(readFileSync(HSR_GEOJSON, 'utf8'));
    const hsrWays = waysFromGeoJsonFeatures(gj.features, { highspeed: true });
    writeGraph(join(OUT_DIR, 'china-hsr.graph'), 'hsr', hsrWays);
  }

  // Conventional corridors
  const files = readdirSync(CORRIDORS).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_') && !f.includes('__'),
  );
  const railWays = [];
  let seq = 1;
  const used = [];
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(CORRIDORS, f), 'utf8'));
    if (!isConventionalCorridor(c)) continue;
    const railway = c.railway;
    if (!Array.isArray(railway) || railway.length < 2) continue;
    const points = railway
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map((p) => [Number(p[0]), Number(p[1])])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (points.length < 2) continue;
    const simplified = simplifyPts(points);
    railWays.push({
      id: seq++,
      name: c.name || c.id,
      highspeed: false,
      points: simplified,
      bbox: bboxOf(simplified),
    });
    used.push(c.id);
  }
  writeGraph(join(OUT_DIR, 'china-rail.graph'), 'rail', railWays);
  writeGeoJson(join(OUT_DIR, 'china-rail.geojson'), railWays);
  console.log(`[build-rail-graph] conventional corridors: ${used.join(', ')}`);
}

function whichOsmium() {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['osmium'], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

function tryBuildFromPbf(pbfPath) {
  const abs = resolve(pbfPath);
  if (!existsSync(abs)) {
    console.warn('[build-rail-graph] PBF not found, skip:', abs);
    return false;
  }
  if (!whichOsmium()) {
    console.warn(
      '[build-rail-graph] osmium not on PATH — skip PBF. Install osmium-tool, then re-run with --pbf.',
    );
    return false;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const filtered = join(OUT_DIR, '_china-railway.osm.pbf');
  console.log('[build-rail-graph] osmium tags-filter →', filtered);
  const filter = spawnSync(
    'osmium',
    ['tags-filter', abs, 'nwr/railway', '-o', filtered, '--overwrite'],
    { encoding: 'utf8', stdio: 'inherit' },
  );
  if (filter.status !== 0) {
    console.warn('[build-rail-graph] osmium tags-filter failed; keep GeoJSON-derived graphs');
    return false;
  }
  console.log(
    '[build-rail-graph] PBF filtered OK. Full way→graph conversion needs osmium export + parse;',
    'GeoJSON-derived graphs remain the runtime default until a dedicated PBF parser is wired.',
  );
  console.log('[build-rail-graph] filtered extract at', filtered);
  return true;
}

function main() {
  const args = process.argv.slice(2);
  let pbf = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pbf' && args[i + 1]) {
      pbf = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage:
  node scripts/build-rail-graph.mjs
  node scripts/build-rail-graph.mjs --pbf tmp/china-latest.osm.pbf`);
      process.exit(0);
    }
  }

  console.log('[build-rail-graph] building from local corridor / hsr assets…');
  buildFromLocalAssets();

  if (pbf) {
    tryBuildFromPbf(pbf);
  } else if (existsSync(join(ROOT, 'tmp/china-latest.osm.pbf'))) {
    console.log('[build-rail-graph] found tmp/china-latest.osm.pbf — pass --pbf to use it');
  }

  console.log('[build-rail-graph] done');
}

main();
