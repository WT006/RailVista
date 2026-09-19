type Entry<T> = { value: T; expiresAt: number };

export class TtlCache {
  private store = new Map<string, Entry<unknown>>();

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlSec: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }
}

export const cache = new TtlCache();
