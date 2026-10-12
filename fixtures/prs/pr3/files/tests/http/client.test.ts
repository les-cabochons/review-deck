import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/client";
import { HttpError } from "../../src/http/errors";

const config = { baseUrl: "https://api.test", timeoutMs: 1000, headers: {} };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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
