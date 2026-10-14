/**
 * 进程内 TTL 缓存（OSM 段、精确路线热缓存、天气等共用）。
 *
 * 相对早期「纯 Map」实现：
 * 1. max 上限 + 淘汰最旧 10%（防无界增长 / OOM）
 * 2. 周期性扫过期项（不必等 get 才删）
 * 3. get 命中时刷新插入顺序，近似 LRU
 *
 * 上限可用 API_TTL_CACHE_MAX 覆盖（默认 4000）。
 */

type Entry<T> = { value: T; expiresAt: number };

function envMax(): number {
  const n = Number(process.env.API_TTL_CACHE_MAX || 4000);
  return Number.isFinite(n) && n >= 64 ? Math.floor(n) : 4000;
}

export class TtlCache {
  private store = new Map<string, Entry<unknown>>();
  private lastSweepAt = 0;

  constructor(
    private max: number = envMax(),
    private sweepEveryMs: number = 60_000,
  ) {}

  get size(): number {
    return this.store.size;
  }

  get<T>(key: string): T | undefined {
    this.maybeSweep();
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // 刷新 LRU 位置
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlSec: number): void {
    this.maybeSweep();
    this.store.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlSec) * 1000 });
    this.prune();
  }

  /** 测试 / 运维用 */
  clear(): void {
    this.store.clear();
    this.lastSweepAt = 0;
  }

  private maybeSweep(): void {
    const now = Date.now();
    if (now - this.lastSweepAt < this.sweepEveryMs) return;
    this.lastSweepAt = now;
    for (const [k, v] of this.store) {
      if (now > v.expiresAt) this.store.delete(k);
    }
  }

  private prune(): void {
    if (this.store.size <= this.max) return;
    const drop = Math.max(1, Math.ceil(this.max * 0.1));
    let n = 0;
    for (const k of this.store.keys()) {
      this.store.delete(k);
      if (++n >= drop) break;
    }
  }
}

export const cache = new TtlCache();
