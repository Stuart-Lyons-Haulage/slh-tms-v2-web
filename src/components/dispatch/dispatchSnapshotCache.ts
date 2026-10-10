type CacheEntry<T> = { expiresAt: number; value: T };

/** Short-lived, memory-only cache for the operational Dispatch workbench. */
export class DispatchSnapshotCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pending = new Map<string, Promise<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const running = this.pending.get(key);
    if (running) return running;
    const request = load().then(value => {
      this.set(key, value);
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
