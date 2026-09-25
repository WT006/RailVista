/**
 * 一次性离线抓取中国境内 OSM 铁路车站节点（S5）。
 *
 * 产物：data/stations-osm.json  [{ name, lng, lat, zone }]
 * 仅作为 merge-stations-geo.mjs 的合并数据源，不进入运行时链路。
 *
 * 用法：
 *   node scripts/fetch-stations-osm.mjs --resume
 *   node scripts/fetch-stations-osm.mjs --resume --out data/stations-osm.json
 *
 * 安全约束：单块超时 ≤60s、3 镜像轮转、失败重试上限 2 次（不无限重试）。
 * 注意：需要可访问 Overpass 公网的网络环境；弱网/被墙环境会失败退出（exit 1）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(__dirname, '..', 'data/stations-osm.json');

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const BLOCK_TIMEOUT_MS = 60_000;
const MAX_RETRY = 2;

/** 中国境内约 20 块 bbox（lat 步长 9°，lng 步长 ~12-15°，覆盖 [18,73]-[54,135]） */
const BBOX_BLOCKS = (() => {
  const blocks = [];
  for (let lat0 = 18; lat0 < 54; lat0 += 9) {
    for (let lng0 = 73; lng0 < 135; lng0 += 12) {
      blocks.push({
        south: lat0,
        west: lng0,
        north: Math.min(54, lat0 + 9),
        east: Math.min(135, lng0 + 12),
      });
    }
  }
  return blocks;
})();

function parseArgs() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  return {
    resume: args.includes('--resume'),
    out: outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT,
  };
}

function blockQuery(b) {
  return `
[out:json][timeout:50];
(
  node["railway"~"^(station|halt)$"]["name"](${b.south},${b.west},${b.north},${b.east});
);
out body;
`.trim();
}

async function fetchBlock(b, blockIdx) {
  const query = blockQuery(b);
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(BLOCK_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) || {};
      const elements = json.elements || [];
      const nodes = elements
        .filter((el) => el.type === 'node' && el.lat != null && el.lon != null)
        .map((el) => ({
          name: String(el.tags?.name || '').trim(),
          lng: el.lon,
          lat: el.lat,
          zone: `${Math.floor(b.south)}-${Math.floor(b.west)}`,
        }))
        .filter((n) => n.name);
      console.log(
        `block ${blockIdx + 1}/${BBOX_BLOCKS.length} [${b.south},${b.west}] ok: ${nodes.length} nodes (via ${url})`,
      );
      return nodes;
    } catch (e) {
      lastErr = e;
      console.warn(
        `block ${blockIdx + 1} attempt ${attempt + 1}/${MAX_RETRY + 1} failed (${e.message}), next...`,
      );
    }
  }
  throw lastErr;
}

async function main() {
  const { resume, out } = parseArgs();
  let collected = [];
  let doneBlocks = [];
  if (resume && existsSync(out)) {
    try {
      const prev = JSON.parse(readFileSync(out, 'utf8'));
      collected = prev.stations || [];
      doneBlocks = prev.doneBlocks || [];
      console.log(`resume: ${collected.length} nodes from ${doneBlocks.length} blocks`);
    } catch {
      collected = [];
      doneBlocks = [];
    }
  }

  const total = [];
  let failed = 0;
  for (let i = 0; i < BBOX_BLOCKS.length; i++) {
    const key = `${BBOX_BLOCKS[i].south},${BBOX_BLOCKS[i].west}`;
    if (doneBlocks.includes(key)) continue;
    try {
      const nodes = await fetchBlock(BBOX_BLOCKS[i], i);
      total.push(...nodes);
      doneBlocks.push(key);
      // 逐块落盘（支持 --resume 续抓）
      writeFileSync(
        out,
        JSON.stringify({ generatedAt: new Date().toISOString(), doneBlocks, stations: [...collected, ...total] }, null, 2),
        'utf8',
      );
    } catch (e) {
      failed += 1;
      console.error(`block ${i + 1} FAILED after retries: ${e.message}`);
    }
  }

  const stations = [...collected, ...total];
  const uniqueByName = new Map();
  for (const s of stations) {
    const k = `${s.name}|${s.lng.toFixed(3)}|${s.lat.toFixed(3)}`;
    uniqueByName.set(k, s);
  }
  const finalStations = [...uniqueByName.values()];
  writeFileSync(
    out,
    JSON.stringify({ generatedAt: new Date().toISOString(), doneBlocks, stations: finalStations }, null, 2),
    'utf8',
  );
  console.log(`\nDone: blocks=${BBOX_BLOCKS.length} failed=${failed} stations=${finalStations.length} -> ${out}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('fetch failed:', e);
  process.exit(1);
});