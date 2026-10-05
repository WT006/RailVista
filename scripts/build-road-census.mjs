/**
 * 万里路书 · 全国路网普查（scripts/build-road-census.mjs）
 *
 * 目的：一次算清"全国到底有多少路、多少带编号、各级多少条"，作为后续所有构建的基数。
 * 输入：data/cache/osm/{prov}-latest.osm.pbf（由 scripts/fetch-china-pbf.mjs 下载）
 * 输出：data/roads/reports/census-{date}.json（可入库，作为基线证据）
 *
 * 用法：
 *   node scripts/build-road-census.mjs --all
 *   node scripts/build-road-census.mjs --prov hainan
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanWays, scanNodes } from './lib/osm-pbf.mjs';
import { normalizeRefs, classifyRef, isRoadHighway } from './lib/road-ref.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PBF_DIR = join(ROOT, 'data/cache/osm');
const OUT_DIR = join(ROOT, 'data/roads/reports');

const args = process.argv.slice(2);
const all = args.includes('--all');
const provArg = args.includes('--prov') ? args[args.indexOf('--prov') + 1] : null;

function listPbf() {
  if (!existsSync(PBF_DIR)) return [];
  return readdirSync(PBF_DIR)
    .filter((f) => f.endsWith('.osm.pbf'))
    .map((f) => ({ prov: f.replace('-latest.osm.pbf', ''), path: join(PBF_DIR, f) }))
    .filter((p) => (provArg ? p.prov === provArg : true))
    .sort((a, b) => a.prov.localeCompare(b.prov));
}

const targets = listPbf();
if (!targets.length) {
  console.error('未找到 PBF：请先运行 node scripts/fetch-china-pbf.mjs --all');
  process.exit(1);
}

const CLASSES = ['expressway', 'national', 'provincial', 'county', 'township', 'village', 'other'];
const national = {
  provinces: 0, ways: 0, highwayWays: 0, roadWays: 0, wayNodes: 0, nodes: 0,
  byClass: Object.fromEntries(CLASSES.map((c) => [c, 0])),
  noRef: 0, namedNoRef: 0, bareNumberRef: 0,
  refValues: Object.fromEntries(CLASSES.map((c) => [c, new Set()])),
};
const perProvince = [];

for (const t of targets) {
  const t0 = Date.now();
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  const byHighway = {};
  const refValues = Object.fromEntries(CLASSES.map((c) => [c, new Set()]));
  let ways = 0;
  let highwayWays = 0;
  let roadWays = 0;
  let wayNodes = 0;
  let noRef = 0;
  let namedNoRef = 0;
  let bareNumberRef = 0;

  await scanWays(t.path, (w) => {
    ways += 1;
    const hw = w.tags.highway;
    if (!hw) return;
    highwayWays += 1;
    byHighway[hw] = (byHighway[hw] || 0) + 1;
    if (!isRoadHighway(hw)) return;
    roadWays += 1;
    wayNodes += w.refs.length;
    const raw = w.tags.ref;
    const refs = normalizeRefs(raw);
    if (!refs.length) {
      noRef += 1;
      if (w.tags.name) namedNoRef += 1;
      if (raw && /^[0-9]+\$/.test(raw.trim())) bareNumberRef += 1;
      return;
    }
    let hit = false;
    for (const r of refs) {
      const cls = classifyRef(r);
      if (!cls) continue;
      hit = true;
      byClass[cls] += 1;
      refValues[cls].add(r);
    }
    if (!hit) noRef += 1;
  });

  const nodes = await scanNodes(t.path, () => {});
  const ms = Date.now() - t0;

  national.provinces += 1;
  national.ways += ways;
  national.highwayWays += highwayWays;
  national.roadWays += roadWays;
  national.wayNodes += wayNodes;
  national.nodes += nodes;
  national.noRef += noRef;
  national.namedNoRef += namedNoRef;
  national.bareNumberRef += bareNumberRef;
  for (const c of CLASSES) {
    national.byClass[c] += byClass[c];
    for (const v of refValues[c]) national.refValues[c].add(v);
  }

  perProvince.push({
    province: t.prov, ways, highwayWays, roadWays, wayNodes, nodes,
    byClass, byHighway, noRef, namedNoRef, bareNumberRef,
    refValueCount: Object.fromEntries(CLASSES.map((c) => [c, refValues[c].size])),
    ms,
  });

  const cc = (c) => String(byClass[c]).padStart(7);
  console.log(
    '[census] ' + t.prov.padEnd(16) +
    ' ways=' + String(ways).padStart(8) +
    ' highway=' + String(highwayWays).padStart(8) +
    ' E' + cc('expressway') + ' G' + cc('national') + ' S' + cc('provincial') +
    ' X' + cc('county') + ' Y' + cc('township') + ' C' + cc('village') +
    ' noRef=' + String(noRef).padStart(8) +
    ' (' + (ms / 1000).toFixed(1) + 's)',
  );
}

const date = new Date().toISOString().slice(0, 10);
const report = {
  generatedAt: new Date().toISOString(),
  source: 'OpenStreetMap via download.openstreetmap.fr/extracts/asia/china/{prov}-latest.osm.pbf',
  date,
  provinceCount: national.provinces,
  totals: {
    ways: national.ways,
    highwayWays: national.highwayWays,
    roadWays: national.roadWays,
    wayNodes: national.wayNodes,
    nodes: national.nodes,
    noRef: national.noRef,
    namedNoRef: national.namedNoRef,
    bareNumberRef: national.bareNumberRef,
    byClass: national.byClass,
    refValueCount: Object.fromEntries(CLASSES.map((c) => [c, national.refValues[c].size])),
  },
  provinces: perProvince,
};
mkdirSync(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, 'census-' + date + '.json');
writeFileSync(outFile, JSON.stringify(report, null, 1), 'utf8');

const t = report.totals;
console.log('\n== 全国合计（' + national.provinces + ' 省）==');
console.log('  way 总数        ' + t.ways);
console.log('  highway way     ' + t.highwayWays);
console.log('  纳网 way        ' + t.roadWays + '（way 点引用 ' + t.wayNodes + '）');
console.log('  节点            ' + t.nodes);
console.log('  按等级 way 数   E ' + t.byClass.expressway + ' · G ' + t.byClass.national + ' · S ' + t.byClass.provincial +
  ' · X ' + t.byClass.county + ' · Y ' + t.byClass.township + ' · C ' + t.byClass.village);
console.log('  无 ref          ' + t.noRef + '（' + ((t.noRef / t.roadWays) * 100).toFixed(1) + '%）· 其中有 name ' + t.namedNoRef);
console.log('  不同编号值      E ' + t.refValueCount.expressway + ' · G ' + t.refValueCount.national + ' · S ' + t.refValueCount.provincial +
  ' · X ' + t.refValueCount.county + ' · Y ' + t.refValueCount.township + ' · C ' + t.refValueCount.village);
console.log('\n→ ' + outFile);
