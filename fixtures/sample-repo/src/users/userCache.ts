import type { CacheConfig } from "../config";
import type { UserRecord } from "./types";

interface Entry {
  user: UserRecord;
  expiresAt: number;
}

export class UserCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly config: CacheConfig,
    private readonly clock: () => number = Date.now,
  ) {}

  get(id: string): UserRecord | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt < this.clock()) {
      console.log("cache expired", id);
      this.entries.delete(id);
      return undefined;
    }
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
}
