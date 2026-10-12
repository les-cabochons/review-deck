import { describe, expect, it } from "vitest";
import { UserCache } from "../../src/users/userCache";
import type { UserRecord } from "../../src/users/types";

const bob: UserRecord = {
  id: "u2",
  email: "bob@example.com",
  displayName: "Bob",
  role: "member",
  createdAt: "2024-02-01T00:00:00Z",
};

describe("UserCache.stats", () => {
  it("counts hits and misses", () => {
    const cache = new UserCache({ ttlMs: 1000, maxEntries: 10 }, () => 0);
    cache.get("u2");
    cache.set(bob);
    cache.get("u2");
    expect(cache.stats()).toEqual({ hits: 1, misses: 1, hitRate: 0.5 });
  });

  it("counts expired entries as misses", () => {
    let now = 0;
    const cache = new UserCache({ ttlMs: 10, maxEntries: 10 }, () => now);
    cache.set(bob);
    now = 100;
    expect(cache.get("u2")).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
  });
});
