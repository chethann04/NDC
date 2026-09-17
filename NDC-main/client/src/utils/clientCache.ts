/**
 * Lightweight in-memory Stale-While-Revalidate (SWR) cache for frontend API data.
 * Keeps previously loaded results in memory so navigation between tabs is instantaneous
 * and doesn't flash empty skeleton loaders or reset state.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class ClientCache {
  private cache = new Map<string, CacheEntry<any>>();
  private inflight = new Map<string, Promise<any>>();

  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    return entry ? entry.data : null;
  }

  public set<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  public isStale(key: string, maxAgeMs = 30000): boolean {
    const entry = this.cache.get(key);
    if (!entry) return true;
    return Date.now() - entry.timestamp > maxAgeMs;
  }

  public async fetchWithCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    maxAgeMs = 30000
  ): Promise<{ data: T; fromCache: boolean }> {
    const cached = this.get<T>(key);

    // If cache is fresh, return immediately
    if (cached !== null && !this.isStale(key, maxAgeMs)) {
      return { data: cached, fromCache: true };
    }

    // Deduplicate in-flight promises for identical keys
    if (this.inflight.has(key)) {
      const data = await this.inflight.get(key);
      return { data, fromCache: false };
    }

    const promise = (async () => {
      try {
        const freshData = await fetcher();
        this.set(key, freshData);
        return freshData;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);

    if (cached !== null) {
      // Return stale data immediately; promise updates cache in background
      promise.catch(() => {});
      return { data: cached, fromCache: true };
    }

    const data = await promise;
    return { data, fromCache: false };
  }

  public invalidate(keyOrPrefix?: string): void {
    if (!keyOrPrefix) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(keyOrPrefix)) {
        this.cache.delete(key);
      }
    }
  }
}

export const clientCache = new ClientCache();
