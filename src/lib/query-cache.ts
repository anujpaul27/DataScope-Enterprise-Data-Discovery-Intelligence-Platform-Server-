// ---------------------------------------------------------------------------
// Phase 6: server-side cache for search results.
//
// What it does
//   * keeps the answer of a records query for `ttlMs` (default 60 s)
//   * LRU: when more than `maxEntries` answers are stored, the least recently used goes
//   * request de-duplication: if 20 browsers ask the SAME query at the same moment, only ONE
//     query reaches PostgreSQL and all 20 get its answer ("shared")
//
// What it must NEVER do: skip a permission check. The route checks access and validates the
// query BEFORE it asks the cache, so the cache only ever holds answers for valid queries
// and nobody can read an entry without having access to that dataset.
//
// Limits (write these in the ADR): the cache lives in the memory of ONE Node process. With
// several servers each has its own cache (use Redis then), and a restart empties it.
// ---------------------------------------------------------------------------

export type CacheStatus = "hit" | "miss" | "shared";

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class QueryCache {
  private readonly store = new Map<string, Entry>(); // Map keeps insertion order = LRU order
  private readonly inflight = new Map<string, Promise<unknown>>();
  private hits = 0;
  private misses = 0;
  private shared = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  async getOrCompute<T>(
    key: string,
    compute: () => Promise<T>,
  ): Promise<{ value: T; status: CacheStatus }> {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      this.store.delete(key); // re-insert = "recently used"
      this.store.set(key, entry);
      this.hits++;
      return { value: entry.value as T, status: "hit" };
    }
    if (entry) this.store.delete(key); // expired

    const running = this.inflight.get(key);
    if (running) {
      this.shared++;
      return { value: (await running) as T, status: "shared" };
    }

    this.misses++;
    const promise: Promise<T> = compute()
      .then((value) => {
        // If the key was invalidated while we were computing, do not store a stale answer.
        if (this.inflight.get(key) === promise) {
          this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
          this.evict();
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return { value: await promise, status: "miss" };
  }

  /** Forget everything whose key starts with `prefix` (e.g. "<datasetId>|"). */
  invalidatePrefix(prefix: string): void {
    for (const key of [...this.store.keys()]) if (key.startsWith(prefix)) this.store.delete(key);
    for (const key of [...this.inflight.keys()]) if (key.startsWith(prefix)) this.inflight.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  stats() {
    const total = this.hits + this.misses + this.shared;
    return {
      entries: this.store.size,
      maxEntries: this.maxEntries,
      ttlSeconds: this.ttlMs / 1000,
      hits: this.hits,
      misses: this.misses,
      shared: this.shared,
      requests: total,
      // share of requests that did NOT start a new database query
      hitRate: total === 0 ? 0 : Number(((this.hits + this.shared) / total).toFixed(4)),
    };
  }

  private evict(): void {
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

// ONE cache for record queries. Max staleness = TTL (60 s) unless invalidated earlier.
export const recordsCache = new QueryCache(500, 60_000);

/** Call whenever the data or the shape of a dataset changes (edit, delete, future imports). */
export function invalidateDatasetCache(datasetId: string): void {
  recordsCache.invalidatePrefix(`${datasetId}|`);
}
