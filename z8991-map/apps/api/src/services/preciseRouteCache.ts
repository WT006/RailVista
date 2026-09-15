/**
 * 热门精确路线：trainCode + 站序指纹 → 持久化成功/部分折线，避免反复打 Overpass。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cache } from './cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../../../../data/cache/precise');
const MEM_TTL_SEC = Number(process.env.CACHE_TTL_PRECISE_HOT_SEC || 7 * 24 * 3600);
const MAX_DISK_ENTRIES = 200;

export type PreciseHotEntry = {
  trainCode?: string;
  stopsFp: string;
  coords: [number, number][];
  source: 'osm' | 'mixed' | 'station';
  qualityTier?: string;
  message?: string;
  segmentsOk: number;
  segmentsTotal: number;
  savedAt: number;
};

function fingerprint(trainCode: string | undefined, stops: Array<{ name: string; lng: number; lat: number }>): string {
  return `${trainCode || ''}|${stops.map((s) => `${s.name}:${s.lng.toFixed(3)},${s.lat.toFixed(3)}`).join('|')}`;
}

function diskKey(fp: string): string {
  return createHash('sha1').update(fp).digest('hex').slice(0, 24);
}

function memKey(fp: string): string {
  return `precise-hot:v2:${diskKey(fp)}`;
}

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function pruneDisk() {
  if (!existsSync(CACHE_DIR)) return;
  const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
  if (files.length <= MAX_DISK_ENTRIES) return;
  const ranked = files
    .map((f) => {
      try {
        const raw = JSON.parse(readFileSync(join(CACHE_DIR, f), 'utf8')) as PreciseHotEntry;
        return { f, t: raw.savedAt || 0 };
      } catch {
        return { f, t: 0 };
      }
    })
    .sort((a, b) => a.t - b.t);
  const drop = ranked.length - MAX_DISK_ENTRIES;
  for (let i = 0; i < drop; i++) {
    try {
      unlinkSync(join(CACHE_DIR, ranked[i].f));
    } catch {
      /* ignore */
    }
  }
}

export function getPreciseHotCache(
  trainCode: string | undefined,
  stops: Array<{ name: string; lng: number; lat: number }>,
): PreciseHotEntry | null {
  if (stops.length < 2) return null;
  const fp = fingerprint(trainCode, stops);
  const mem = cache.get<PreciseHotEntry>(memKey(fp));
  if (mem?.coords?.length && mem.coords.length >= 2) return mem;

  const path = join(CACHE_DIR, `${diskKey(fp)}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as PreciseHotEntry;
    if (!raw.coords || raw.coords.length < 2) return null;
    if (raw.stopsFp !== fp) return null;
    // 仅回放含真实轨段的结果
    if (!(raw.segmentsOk > 0) || raw.source === 'station') return null;
    cache.set(memKey(fp), raw, MEM_TTL_SEC);
    return raw;
  } catch {
    return null;
  }
}

export function savePreciseHotCache(input: {
  trainCode?: string;
  stops: Array<{ name: string; lng: number; lat: number }>;
  coords: [number, number][];
  source: 'osm' | 'mixed' | 'station';
  qualityTier?: string;
  message?: string;
  segmentsOk: number;
  segmentsTotal: number;
}): void {
  if (input.stops.length < 2 || input.coords.length < 2) return;
  if (!(input.segmentsOk > 0) || input.source === 'station') return;

  const fp = fingerprint(input.trainCode, input.stops);
  const entry: PreciseHotEntry = {
    trainCode: input.trainCode,
    stopsFp: fp,
    coords: input.coords,
    source: input.source,
    qualityTier: input.qualityTier,
    message: input.message,
    segmentsOk: input.segmentsOk,
    segmentsTotal: input.segmentsTotal,
    savedAt: Date.now(),
  };
  cache.set(memKey(fp), entry, MEM_TTL_SEC);
  try {
    ensureDir();
    writeFileSync(join(CACHE_DIR, `${diskKey(fp)}.json`), JSON.stringify(entry));
    pruneDisk();
  } catch (e) {
    console.warn('[precise-hot] disk save failed', e);
  }
}
