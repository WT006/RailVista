#!/usr/bin/env node
/**
 * 热门精确路线预热：读 data/presets/precise-hotlist.json → POST /api/rail-geometry/jobs → 落盘后 pin。
 *
 * 前置：API 已启动（默认 http://127.0.0.1:8787）。
 * PBF 扩图后再跑普速条目效果更好。
 *
 *   node scripts/warmup-precise-routes.mjs
 *   node scripts/warmup-precise-routes.mjs --base http://127.0.0.1:8787 --limit 2
 *   node scripts/warmup-precise-routes.mjs --dry-run
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HOTLIST = join(ROOT, 'data/presets/precise-hotlist.json');
const CACHE_DIR = join(ROOT, 'data/cache/precise');

function fingerprint(trainCode, stops) {
  return `${trainCode || ''}|${stops.map((s) => `${s.name}:${Number(s.lng).toFixed(3)},${Number(s.lat).toFixed(3)}`).join('|')}`;
}

function diskKey(fp) {
  return createHash('sha1').update(fp).digest('hex').slice(0, 24);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postJob(base, entry) {
  const res = await fetch(`${base}/api/rail-geometry/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trainCode: entry.trainCode,
      stops: entry.stops,
    }),
  });
  const json = await res.json();
  if (!json?.ok || !json?.data?.id) {
    throw new Error(json?.error?.message || `HTTP ${res.status}`);
  }
  return json.data;
}

async function pollJob(base, jobId, { timeoutMs = 120000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const res = await fetch(`${base}/api/rail-geometry/jobs/${jobId}`);
    const json = await res.json();
    if (!json?.ok) throw new Error(json?.error?.message || `poll HTTP ${res.status}`);
    const job = json.data;
    if (job.status === 'done' || job.status === 'partial' || job.status === 'failed') {
      return job;
    }
    await sleep(1500);
  }
  throw new Error(`timeout waiting for job ${jobId}`);
}

function pinCacheFile(entry, job) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const fp = fingerprint(entry.trainCode, entry.stops);
  const path = join(CACHE_DIR, `${diskKey(fp)}.json`);
  let raw = null;
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      raw = null;
    }
  }
  if (!raw && job?.coords?.length >= 2 && job.segmentsOk > 0 && job.source !== 'station') {
    raw = {
      trainCode: entry.trainCode,
      stopsFp: fp,
      coords: job.coords,
      source: job.source || 'mixed',
      qualityTier: job.qualityTier,
      message: job.message,
      segmentsOk: job.segmentsOk,
      segmentsTotal: job.segmentsTotal,
      savedAt: Date.now(),
    };
  }
  if (!raw) return false;
  raw.pinned = true;
  raw.savedAt = Date.now();
  writeFileSync(path, JSON.stringify(raw));
  return true;
}

function parseArgs(argv) {
  let base = process.env.API_BASE || 'http://127.0.0.1:8787';
  let limit = Infinity;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1]) base = argv[++i];
    else if (argv[i] === '--limit' && argv[i + 1]) limit = Number(argv[++i]);
    else if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`Usage:
  node scripts/warmup-precise-routes.mjs [--base URL] [--limit N] [--dry-run]
`);
      process.exit(0);
    }
  }
  return { base, limit, dryRun };
}

async function main() {
  const { base, limit, dryRun } = parseArgs(process.argv.slice(2));
  if (!existsSync(HOTLIST)) {
    console.error('[warmup] missing', HOTLIST);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(HOTLIST, 'utf8'));
  const entries = (doc.entries || []).slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(`[warmup] base=${base} entries=${entries.length} dryRun=${dryRun}`);

  let ok = 0;
  let fail = 0;
  for (const entry of entries) {
    const label = `${entry.id || entry.trainCode} (${entry.trainCode})`;
    if (!entry.stops || entry.stops.length < 2) {
      console.warn(`[warmup] skip ${label}: need ≥2 stops`);
      fail++;
      continue;
    }
    if (dryRun) {
      console.log(`[warmup] dry-run would POST ${label} stops=${entry.stops.length}`);
      ok++;
      continue;
    }
    try {
      console.log(`[warmup] job ${label}…`);
      const created = await postJob(base, entry);
      const job = await pollJob(base, created.id);
      const ratio =
        job.segmentsTotal > 0 ? (job.segmentsOk / job.segmentsTotal).toFixed(2) : '0';
      console.log(
        `[warmup] ${label} status=${job.status} ok=${job.segmentsOk}/${job.segmentsTotal} ratio=${ratio} source=${job.source}`,
      );
      if (entry.pinned !== false) {
        const pinned = pinCacheFile(entry, job);
        console.log(`[warmup] pin ${label}: ${pinned ? 'yes' : 'no cache file'}`);
      }
      if (job.segmentsOk > 0) ok++;
      else fail++;
    } catch (e) {
      fail++;
      console.warn(`[warmup] FAIL ${label}:`, e.message || e);
    }
  }

  console.log(`[warmup] done ok=${ok} fail=${fail}`);
  if (fail && !ok) process.exit(1);
}

main().catch((e) => {
  console.error('[warmup] fatal', e);
  process.exit(1);
});
