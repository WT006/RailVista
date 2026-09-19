#!/usr/bin/env node
/**
 * 二期：离线轨网建图
 *
 * 默认（无 PBF 也可跑）：
 *   - HSR：data/presets/corridors/_hsr-rails.geojson → data/rails/china-hsr.graph
 *   - 普速：常规走廊 railway → data/rails/china-rail.graph (+ china-rail.geojson)
 *
 * 可选 PBF（打通 tags-filter → export → 覆盖 china-rail.graph）：
 *   node scripts/build-rail-graph.mjs --pbf tmp/china-latest.osm.pbf
 *
 * osmium：优先本机 PATH；否则尝试 Docker 镜像 iboates/osmium（需 Docker Desktop 运行中）。
 * Windows：勿用 shell 拼接中文路径；本脚本用纯 Node fs。
 */
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CORRIDORS = join(ROOT, 'data/presets/corridors');
const OUT_DIR = join(ROOT, 'data/rails');
const HSR_GEOJSON = join(CORRIDORS, '_hsr-rails.geojson');
const OSMIUM_DOCKER_IMAGE = process.env.OSMIUM_DOCKER_IMAGE || 'iboates/osmium';
/** PBF 普速 ways 少于此数则不覆盖走廊派生图（防空跑） */
const MIN_PBF_RAIL_WAYS = Number(process.env.RAIL_GRAPH_MIN_PBF_WAYS || 100);

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

const SKIP_RAILWAY = new Set([
  'abandoned',
  'disused',
  'construction',
  'proposed',
  'razed',
  'dismantled',
  'platform',
  'station',
  'halt',
  'buffer_stop',
  'crossing',
  'switch',
  'railway_crossing',
  'turntable',
  'traverser',
  'subway_entrance',
  'fuel',
  'tram',
  'subway',
  'funicular',
  'monorail',
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

  if (!existsSync(HSR_GEOJSON)) {
    console.warn('[build-rail-graph] missing', HSR_GEOJSON);
  } else {
    const gj = JSON.parse(readFileSync(HSR_GEOJSON, 'utf8'));
    const hsrWays = waysFromGeoJsonFeatures(gj.features, { highspeed: true });
    writeGraph(join(OUT_DIR, 'china-hsr.graph'), 'hsr', hsrWays);
  }

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
  return { railWayCount: railWays.length };
}

function whichOnPath(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

function dockerDaemonOk() {
  const r = spawnSync('docker', ['info'], {
    encoding: 'utf8',
    timeout: 8000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return r.status === 0;
}

/**
 * @returns {{ mode: 'native' } | { mode: 'docker' } | null}
 */
function resolveOsmiumRunner() {
  if (whichOnPath('osmium')) return { mode: 'native' };
  if (!whichOnPath('docker')) {
    console.warn(
      '[build-rail-graph] osmium not on PATH and docker not found — skip PBF.\n' +
        '  Install osmium-tool, or start Docker Desktop and re-run with --pbf.',
    );
    return null;
  }
  if (!dockerDaemonOk()) {
    console.warn(
      '[build-rail-graph] osmium not on PATH; Docker CLI present but daemon not running.\n' +
        '  Start Docker Desktop, then re-run with --pbf (uses image ' +
        OSMIUM_DOCKER_IMAGE +
        ').',
    );
    return null;
  }
  console.log(`[build-rail-graph] using Docker osmium image: ${OSMIUM_DOCKER_IMAGE}`);
  return { mode: 'docker' };
}

/** 仅允许项目根下的路径，便于 Docker 挂载 */
function assertUnderRoot(absPath, label) {
  const rel = relative(ROOT, absPath);
  if (!rel || rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`${label} must be under project root: ${absPath}`);
  }
  return rel.split(sep).join('/');
}

function toDockerArg(a) {
  if (typeof a !== 'string') return a;
  // 仅改写绝对路径，避免把 nwr/railway、geojsonseq 等参数误当成文件
  if (!isAbsolute(a) && !/^[A-Za-z]:[\\/]/.test(a)) return a;
  const abs = resolve(a);
  const rel = assertUnderRoot(abs, 'osmium path');
  return `/data/${rel}`;
}

function runOsmium(runner, args) {
  if (runner.mode === 'native') {
    return spawnSync('osmium', args, { encoding: 'utf8', stdio: 'inherit' });
  }
  const dockerArgs = args.map(toDockerArg);
  return spawnSync(
    'docker',
    ['run', '--rm', '-v', `${ROOT}:/data`, '-w', '/data', OSMIUM_DOCKER_IMAGE, ...dockerArgs],
    { encoding: 'utf8', stdio: 'inherit' },
  );
}

function isUsableRailwayProps(props) {
  const rw = String(props?.railway || '').toLowerCase();
  if (!rw || SKIP_RAILWAY.has(rw)) return false;
  return rw === 'rail' || rw === 'light_rail' || rw === 'narrow_gauge';
}

function featureIsHsr(props) {
  const hs = props?.highspeed;
  if (hs === true || hs === 1 || hs === '1' || hs === 'yes') return true;
  const name = String(props?.name || props?.ref || '');
  return /高铁|高速|客运专线|城际/.test(name);
}

function featureToWays(f, seqRef) {
  const props = f.properties || {};
  if (!isUsableRailwayProps(props)) return [];
  const geom = f.geometry;
  if (!geom?.coordinates) return [];
  const name = props.name || props.ref || undefined;
  const osmId = Number(props.osm_id || props.id || props['@id']);
  const highspeed = featureIsHsr(props);
  const lines =
    geom.type === 'LineString'
      ? [geom.coordinates]
      : geom.type === 'MultiLineString'
        ? geom.coordinates
        : [];
  const out = [];
  for (const line of lines) {
    const points = (line || [])
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map((c) => [Number(c[0]), Number(c[1])])
      .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (points.length < 2) continue;
    const simplified = simplifyPts(points);
    out.push({
      id: Number.isFinite(osmId) ? osmId : seqRef.n++,
      name,
      highspeed,
      points: simplified,
      bbox: bboxOf(simplified),
    });
  }
  return out;
}

async function waysFromGeoJsonSeq(seqPath) {
  const railWays = [];
  const hsrWays = [];
  const seqRef = { n: 1 };
  let lines = 0;
  let kept = 0;
  const rl = createInterface({ input: createReadStream(seqPath, { encoding: 'utf8' }) });
  for await (const line of rl) {
    // osmium geojsonseq 可能带 RS (0x1e) 前缀
    const trimmed = line.replace(/^\u001e/, '').trim();
    if (!trimmed) continue;
    lines++;
    let f;
    try {
      f = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const ways = featureToWays(f, seqRef);
    for (const w of ways) {
      kept++;
      if (w.highspeed) hsrWays.push(w);
      else railWays.push(w);
    }
    if (lines % 50000 === 0) {
      console.log(
        `[build-rail-graph] geojsonseq progress lines=${lines} kept=${kept} rail=${railWays.length} hsr=${hsrWays.length}`,
      );
    }
  }
  console.log(
    `[build-rail-graph] geojsonseq done lines=${lines} kept=${kept} rail=${railWays.length} hsr=${hsrWays.length}`,
  );
  return { railWays, hsrWays };
}

async function tryBuildFromPbf(pbfPath, { replaceHsr = false } = {}) {
  const abs = resolve(pbfPath);
  if (!existsSync(abs)) {
    console.warn('[build-rail-graph] PBF not found, skip:', abs);
    return false;
  }
  let relPbf;
  try {
    relPbf = assertUnderRoot(abs, 'PBF');
  } catch (e) {
    console.warn('[build-rail-graph]', e.message || e);
    return false;
  }

  const runner = resolveOsmiumRunner();
  if (!runner) return false;

  mkdirSync(OUT_DIR, { recursive: true });
  const filtered = join(OUT_DIR, '_china-railway.osm.pbf');
  const seqPath = join(OUT_DIR, '_china-railway.geojsonseq');

  console.log('[build-rail-graph] osmium tags-filter →', filtered);
  const filter = runOsmium(runner, [
    'tags-filter',
    join(ROOT, relPbf),
    'nwr/railway',
    '-o',
    filtered,
    '--overwrite',
  ]);
  if (filter.status !== 0) {
    console.warn('[build-rail-graph] osmium tags-filter failed; keep corridor-derived graphs');
    return false;
  }

  console.log('[build-rail-graph] osmium export geojsonseq →', seqPath);
  const exp = runOsmium(runner, [
    'export',
    filtered,
    '-f',
    'geojsonseq',
    '-o',
    seqPath,
    '--overwrite',
  ]);
  if (exp.status !== 0) {
    console.warn('[build-rail-graph] osmium export failed; keep corridor-derived graphs');
    return false;
  }

  const { railWays, hsrWays } = await waysFromGeoJsonSeq(seqPath);
  if (railWays.length < MIN_PBF_RAIL_WAYS) {
    console.warn(
      `[build-rail-graph] PBF conventional ways=${railWays.length} < ${MIN_PBF_RAIL_WAYS}; keep corridor graph`,
    );
    return false;
  }

  writeGraph(join(OUT_DIR, 'china-rail.graph'), 'rail', railWays);
  writeGeoJson(join(OUT_DIR, 'china-rail.geojson'), railWays);

  if (replaceHsr && hsrWays.length >= 1000) {
    writeGraph(join(OUT_DIR, 'china-hsr.graph'), 'hsr', hsrWays);
  } else if (replaceHsr) {
    console.warn(
      `[build-rail-graph] --pbf-replace-hsr ignored (hsr ways=${hsrWays.length} too few); kept _hsr-rails graph`,
    );
  } else {
    console.log(
      `[build-rail-graph] PBF hsr-tagged ways=${hsrWays.length} (not written; HSR stays from _hsr-rails unless --pbf-replace-hsr)`,
    );
  }

  writeFileSync(
    join(OUT_DIR, '_build-meta.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'geofabrik-pbf',
        pbf: relPbf,
        osmium: runner.mode,
        conventionalWays: railWays.length,
        hsrTaggedWays: hsrWays.length,
        hsrGraphReplaced: !!(replaceHsr && hsrWays.length >= 1000),
      },
      null,
      2,
    ) + '\n',
  );

  try {
    unlinkSync(seqPath);
  } catch {
    /* keep seq for debug if unlink fails */
  }

  console.log('[build-rail-graph] PBF → china-rail.graph OK');
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  let pbf = null;
  let replaceHsr = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pbf' && args[i + 1]) {
      pbf = args[++i];
    } else if (args[i] === '--pbf-replace-hsr') {
      replaceHsr = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage:
  node scripts/build-rail-graph.mjs
  node scripts/build-rail-graph.mjs --pbf tmp/china-latest.osm.pbf
  node scripts/build-rail-graph.mjs --pbf tmp/china-latest.osm.pbf --pbf-replace-hsr

Env:
  OSMIUM_DOCKER_IMAGE   default iboates/osmium
  RAIL_GRAPH_MIN_PBF_WAYS  default 100

Download (once):
  mkdir tmp
  curl -L -o tmp/china-latest.osm.pbf https://download.geofabrik.de/asia/china-latest.osm.pbf
`);
      process.exit(0);
    }
  }

  console.log('[build-rail-graph] building from local corridor / hsr assets…');
  buildFromLocalAssets();

  if (pbf) {
    await tryBuildFromPbf(pbf, { replaceHsr });
  } else if (existsSync(join(ROOT, 'tmp/china-latest.osm.pbf'))) {
    console.log('[build-rail-graph] found tmp/china-latest.osm.pbf — pass --pbf to use it');
  }

  console.log('[build-rail-graph] done');
}

main().catch((e) => {
  console.error('[build-rail-graph] fatal', e);
  process.exit(1);
});
