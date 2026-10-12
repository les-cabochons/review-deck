import { describe, expect, it } from "vitest";
import { UserCache } from "../../src/users/userCache";
import type { UserRecord } from "../../src/users/types";

const carol: UserRecord = {
  id: "u3",
  email: "carol@example.com",
  displayName: "Carol",
  role: "guest",
  createdAt: "2024-03-01T00:00:00Z",
};

describe("UserCache with caching disabled", () => {
  it("never stores entries", () => {
    const cache = new UserCache({ enabled: false, ttlMs: 1000, maxEntries: 10 });
    cache.set(carol);
    expect(cache.get("u3")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
