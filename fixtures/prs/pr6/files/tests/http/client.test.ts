import { describe, expect, it, vi } from "vitest";
import { buildQueryString, HttpClient } from "../../src/http/client";
import { HttpError } from "../../src/http/errors";

const config = { baseUrl: "https://api.test", timeoutMs: 1000, headers: {} };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("buildQueryString", () => {
  it("returns an empty string for no params", () => {
    expect(buildQueryString(undefined)).toBe("");
    expect(buildQueryString({})).toBe("");
  });

  it("skips undefined values and encodes the rest", () => {
    expect(buildQueryString({ q: "a b", page: 2, role: undefined })).toBe("?q=a%20b&page=2");
  });
});

describe("HttpClient", () => {
  it("returns parsed json on success", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new HttpClient(config, fetcher);
    const res = await client.get<{ ok: boolean }>("/ping");
    expect(res.data.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("https://api.test/ping", expect.anything());
  });

  it("sends a unique X-Request-Id header", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    const client = new HttpClient(config, fetcher);
    await client.get("/a");
    await client.get("/b");
    const ids = fetcher.mock.calls.map(([, init]) => init.headers["X-Request-Id"]);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("throws HttpError on non-2xx responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" }));
    const client = new HttpClient(config, fetcher);
    await expect(client.get("/ping")).rejects.toBeInstanceOf(HttpError);
  });
});

describe("HttpClient config validation", () => {
  it("rejects a non-http baseUrl", () => {
    expect(() => new HttpClient({ ...config, baseUrl: "ftp://files.test" })).toThrow(/http\(s\) URL/);
  });
});
