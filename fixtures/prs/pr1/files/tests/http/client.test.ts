import { describe, expect, it, vi } from "vitest";
import { buildQueryString, HttpClient } from "../../src/http/client";
import { HttpError } from "../../src/http/errors";

const config = { baseUrl: "https://api.test", timeoutMs: 1000, retries: 0, retryDelayMs: 0, headers: {} };

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

  it("throws HttpError on non-2xx responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" }));
    const client = new HttpClient(config, fetcher);
    await expect(client.get("/ping")).rejects.toBeInstanceOf(HttpError);
  });
});

describe("HttpClient retries", () => {
  const retryConfig = { ...config, retries: 2, retryDelayMs: 0 };

  it("retries GET requests on 503 and eventually succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new HttpClient(retryConfig, fetcher);
    const res = await client.get<{ ok: boolean }>("/ping");
    expect(res.data.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not retry POST requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(503, {}));
    const client = new HttpClient(retryConfig, fetcher);
    await expect(client.post("/users", {})).rejects.toBeInstanceOf(HttpError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry client errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    const client = new HttpClient(retryConfig, fetcher);
    await expect(client.get("/missing")).rejects.toBeInstanceOf(HttpError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
