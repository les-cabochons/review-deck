import type { CacheConfig } from "../config";
import type { UserRecord } from "./types";

interface Entry {
  user: UserRecord;
  expiresAt: number;
}

export class UserCache {
  private readonly entries = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly config: CacheConfig,
    private readonly clock: () => number = Date.now,
  ) {}

  get(id: string): UserRecord | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt < this.clock()) {
      console.log("cache expired", id);
      this.entries.delete(id);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.user;
  }

  set(user: UserRecord): void {
    if (this.entries.size >= this.config.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(user.id, { user, expiresAt: this.clock() + this.config.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  stats(): { hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return { hits: this.hits, misses: this.misses, hitRate: total === 0 ? 0 : this.hits / total };
  }
}
