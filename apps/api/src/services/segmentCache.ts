/**
 * F2 [P0] 段级几何落盘缓存。
 *
 * 背景：段结果原先只存内存 `cache.ts`（进程/`tsx watch` 重启即失效），
 * 重启后同一 OD 必然重新打公网 Overpass。这里把「成功折线」与「负缓存」都落到
 * `data/cache/railseg/`，使二次生成本地命中 <200ms。
 *
 * 失效纪律：key 由 `osmRailway.segmentCacheKey()` 生成，已内含几何版本号
 * （`railseg:v10:`），算法/门禁变更 bump 版本号即整体失效，不会读到脏几何。
 * 本目录在 .gitignore 中（`data/cache/`），不会污染仓库。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../../../../data/cache/railseg');

const MAX_DISK_ENTRIES = Number(process.env.RAIL_SEG_CACHE_MAX || 6000);
/** 命中文件的默认 TTL（秒） */
const DEFAULT_TTL_SEC = Number(process.env.CACHE_TTL_RAIL_SEG_SEC || 24 * 3600);
/** 与 osmRailway.segmentCacheKey 的版本号保持一致，双保险 */
export const SEG_CACHE_VERSION = 10;

export type LngLat = { lng: number; lat: number };

type HitFile = {
  v: number;
  key: string;
  savedAt: number;
  expiresAt: number;
  coords: [number, number][];
};

type MissFile = {
  v: number;
  key: string;
  reason: string;
  savedAt: number;
  expiresAt: number;
};

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function filePath(key: string, suffix: 'hit' | 'miss'): string {
  return join(CACHE_DIR, `${fileStem(key)}.${suffix}.json`);
}

/** key 形如 `railseg:v10:<hash>`，直接做文件名安全化 */
function fileStem(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    // 损坏文件直接丢弃，下次重算
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
    return null;
  }
}

function writeJson(path: string, value: unknown) {
  try {
    ensureDir();
    writeFileSync(path, JSON.stringify(value));
  } catch (e) {
    console.warn('[seg-cache] disk write failed', e);
  }
}

function pruneDisk() {
  if (!existsSync(CACHE_DIR)) return;
  let files: string[] = [];
  try {
    files = readdirSync(CACHE_DIR).filter((f) => f.endsWith('.hit.json') || f.endsWith('.miss.json'));
  } catch {
    return;
  }
  if (files.length <= MAX_DISK_ENTRIES) return;
  const now = Date.now();
  const ranked = files
    .map((f) => {
      const raw = readJson<{ savedAt?: number; expiresAt?: number }>(join(CACHE_DIR, f));
      return { f, t: raw?.savedAt || 0, expired: !!raw?.expiresAt && raw.expiresAt < now };
    })
    .sort((a, b) => {
      if (a.expired !== b.expired) return a.expired ? -1 : 1;
      return a.t - b.t;
    });
  const drop = ranked.length - MAX_DISK_ENTRIES;
  for (let i = 0; i < drop; i += 1) {
    try {
      unlinkSync(join(CACHE_DIR, ranked[i].f));
    } catch {
      /* ignore */
    }
  }
}

let pruneCounter = 0;

export function getSegmentDisk(key: string): LngLat[] | null {
  const raw = readJson<HitFile>(filePath(key, 'hit'));
  if (!raw) return null;
  if (raw.v !== SEG_CACHE_VERSION || raw.key !== key) return null;
  if (!raw.expiresAt || Date.now() > raw.expiresAt) {
    try {
      unlinkSync(filePath(key, 'hit'));
    } catch {
      /* ignore */
    }
    return null;
  }
  if (!Array.isArray(raw.coords) || raw.coords.length < 2) return null;
  return raw.coords.map(([lng, lat]) => ({ lng, lat }));
}

export function saveSegmentDisk(key: string, coords: LngLat[], ttlSec = DEFAULT_TTL_SEC): void {
  if (!coords || coords.length < 2) return;
  const payload: HitFile = {
    v: SEG_CACHE_VERSION,
    key,
    savedAt: Date.now(),
    expiresAt: Date.now() + Math.max(60, ttlSec) * 1000,
    coords: coords.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))] as [number, number]),
  };
  writeJson(filePath(key, 'hit'), payload);
  // 命中即清除同名负缓存（几何已被证明可用）
  try {
    const missPath = filePath(key, 'miss');
    if (existsSync(missPath)) unlinkSync(missPath);
  } catch {
    /* ignore */
  }
  if (++pruneCounter % 50 === 0) pruneDisk();
}

/** 负缓存命中则返回当时的失败原因；未命中/已过期返回 null */
export function getSegmentMissDisk(key: string): string | null {
  const raw = readJson<MissFile>(filePath(key, 'miss'));
  if (!raw) return null;
  if (raw.v !== SEG_CACHE_VERSION || raw.key !== key) return null;
  if (!raw.expiresAt || Date.now() > raw.expiresAt) {
    try {
      unlinkSync(filePath(key, 'miss'));
    } catch {
      /* ignore */
    }
    return null;
  }
  return raw.reason || 'cached_miss';
}

export function saveSegmentMissDisk(key: string, reason: string, ttlSec: number): void {
  const payload: MissFile = {
    v: SEG_CACHE_VERSION,
    key,
    reason,
    savedAt: Date.now(),
    expiresAt: Date.now() + Math.max(5, ttlSec) * 1000,
  };
  writeJson(filePath(key, 'miss'), payload);
  if (++pruneCounter % 50 === 0) pruneDisk();
}

/**
 * 负缓存 TTL 分级（F2）：
 * - 瞬时类（超时 / 预算 / 网络 / 上游空结果）→ 短 TTL，便于上游恢复后自愈；
 * - 结构类（确实无轨 / 门禁拒收 / Overpass 关闭）→ 长 TTL，避免反复打公网。
 */
const TRANSIENT_RE = /(timeout|budget|abort|fetch|network|econn|socket|empty|disconnect|5\d\d)/i;

export function missTtlSec(reason: string): number {
  if (TRANSIENT_RE.test(reason || '')) {
    return Number(process.env.CACHE_TTL_RAIL_SEG_MISS_FAST_SEC || 45);
  }
  return Number(process.env.CACHE_TTL_RAIL_SEG_MISS_SEC || 20 * 60);
}
