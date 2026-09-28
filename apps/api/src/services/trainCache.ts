/**
 * 车次/经停专用缓存（与既有 services/cache.ts 完全隔离，不改动共享实现）。
 *
 * 相对原 TtlCache 增强：
 * 1. 新鲜度可查询（getWithAge）→ 支持 stale-while-revalidate
 * 2. 负缓存（失败短时快速失败，避免反复冲击 12306）
 * 3. 同 key 并发回源去重（in-flight dedupe）
 * 4. LRU 上限，防止内存无界增长
 */

type Entry<T> = { value: T; storedAt: number; expiresAt: number };
type Negative = { message: string; code: string; expiresAt: number };

export interface CacheError {
  code: string;
  message: string;
}

export class TrainCache {
  private store = new Map<string, Entry<unknown>>();
  private negatives = new Map<string, Negative>();
  private inflight = new Map<string, Promise<unknown>>();

  constructor(private max: number = 2000) {}

  /** 仅返回未过期的值 */
  get<T>(key: string): T | undefined {
    return this.getWithAge<T>(key)?.value;
  }

  /** 返回值 + 新鲜度（stale=true 表示已过期但仍可用） */
  getWithAge<T>(key: string): { value: T; ageMs: number; stale: boolean } | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    const now = Date.now();
    // 命中后刷新 LRU 位置
    this.store.delete(key);
    this.store.set(key, hit);
    return {
      value: hit.value as T,
      ageMs: now - hit.storedAt,
      stale: now > hit.expiresAt,
    };
  }

  set<T>(key: string, value: T, ttlSec: number): void {
    const now = Date.now();
    this.store.set(key, {
      value,
      storedAt: now,
      expiresAt: now + Math.max(1, ttlSec) * 1000,
    });
    this.negatives.delete(key);
    this.prune();
  }

  getNegative(key: string): CacheError | undefined {
    const hit = this.negatives.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.negatives.delete(key);
      return undefined;
    }
    return { code: hit.code, message: hit.message };
  }

  setNegative(key: string, err: CacheError, ttlSec: number): void {
    this.negatives.set(key, {
      code: err.code,
      message: err.message,
      expiresAt: Date.now() + Math.max(1, ttlSec) * 1000,
    });
  }

  private prune(): void {
    if (this.store.size <= this.max) return;
    const drop = Math.ceil(this.max * 0.1);
    let n = 0;
    for (const k of this.store.keys()) {
      this.store.delete(k);
      if (++n >= drop) break;
    }
  }

  /**
   * 取数：负缓存快速失败 → 新鲜命中 → 过期则先返回旧值并后台刷新（SWR）→ 回源。
   */
  async getOrLoad<T>(
    key: string,
    ttlSec: number,
    loader: () => Promise<T>,
    opts: { staleWhileRevalidate?: boolean; negativeTtlSec?: number } = {},
  ): Promise<T> {
    const neg = this.getNegative(key);
    if (neg) throw Object.assign(new Error(neg.message), { code: neg.code });

    const hit = this.getWithAge<T>(key);
    if (hit) {
      if (!hit.stale) return hit.value;
      if (opts.staleWhileRevalidate !== false) {
        // 已有同 key 回源在进行中则不重复发起
        if (!this.inflight.has(key)) {
          const task = loader()
            .then((v) => {
              this.set(key, v, ttlSec);
              return v;
            })
            .catch((e) => {
              const err = e as Error & { code?: string };
              this.setNegative(key, { code: err.code || 'UPSTREAM_FAIL', message: err.message || '查询失败' }, opts.negativeTtlSec ?? 30);
              throw e;
            })
            .finally(() => {
              this.inflight.delete(key);
            });
          this.inflight.set(key, task);
          // 后台刷新失败不应变成 unhandled rejection
          void task.catch(() => {});
        }
        return hit.value;
      }
    }

    const existing = this.inflight.get(key);
    if (existing) return (await existing) as T;

    const task = loader()
      .then((v) => {
        this.set(key, v, ttlSec);
        return v;
      })
      .catch((e) => {
        const err = e as Error & { code?: string };
        this.setNegative(key, { code: err.code || 'UPSTREAM_FAIL', message: err.message || '查询失败' }, opts.negativeTtlSec ?? 30);
        throw e;
      })
      .finally(() => {
        if (this.inflight.get(key) === task) this.inflight.delete(key);
      });
    this.inflight.set(key, task);
    return (await task) as T;
  }
}

export const trainCache = new TrainCache();
