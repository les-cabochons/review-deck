import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../src/http/client";
import { HttpError } from "../../src/http/errors";
import { UserCache } from "../../src/users/userCache";
import { UserService } from "../../src/users/userService";
import type { UserRecord } from "../../src/users/types";

const alice: UserRecord = {
  id: "u1",
  email: "alice@example.com",
  displayName: "Alice",
  role: "admin",
  createdAt: "2024-01-01T00:00:00Z",
};

function makeService(get = vi.fn(), post = vi.fn()) {
  const http = { get, post } as unknown as HttpClient;
  const cache = new UserCache({ ttlMs: 1000, maxEntries: 10 });
  return { service: new UserService(http, cache), cache, get, post };
}

describe("UserService", () => {
  it("returns cached users without calling the API", async () => {
    const { service, cache, get } = makeService();
    cache.set(alice);
    expect(await service.getUser("u1")).toEqual(alice);
    expect(get).not.toHaveBeenCalled();
  });

  it("returns undefined when the API responds 404", async () => {
    const get = vi.fn().mockRejectedValue(new HttpError(404, "not found"));
    const { service } = makeService(get);
    expect(await service.getUser("missing")).toBeUndefined();
  });

  it("rejects invalid input on create", async () => {
    const { service, post } = makeService();
    await expect(service.createUser({ email: "nope", displayName: "A", role: "guest" })).rejects.toThrow(
      /Invalid user/,
    );
    expect(post).not.toHaveBeenCalled();
  });
});

describe("UserService.searchUsers", () => {
  it("normalizes the query before calling the API", async () => {
    const get = vi.fn().mockResolvedValue({ data: { users: [alice], total: 1, page: 1 } });
    const { service } = makeService(get);
    expect(await service.searchUsers("  ALICE  ")).toEqual([alice]);
    expect(get).toHaveBeenCalledWith("/users/search", { q: "alice", role: undefined, limit: 20 });
  });

  it("skips the API for blank queries", async () => {
    const { service, get } = makeService();
    expect(await service.searchUsers("   ")).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
