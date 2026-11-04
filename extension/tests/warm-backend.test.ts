import assert from "node:assert/strict";
import { test } from "node:test";
import { type BackendService, warmBackend } from "../src/review/backend";

const backend: BackendService = { url: "https://func-review-deck-abc123.azurewebsites.net", token: "k", scope: { organization: "org", projectId: "proj-1", projectName: "p" } };

/** Lets the warm call's promise chain run: the backend lookup, then the request. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Replaces fetch for one test, recording every request and answering each with `reply`. */
async function withFetch(reply: () => Promise<Response>, run: (requests: { url: string; authorization: string | null }[]) => Promise<void>) {
  const requests: { url: string; authorization: string | null }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return reply();
  }) as typeof fetch;
  try {
    await run(requests);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("Given a connected backend, then opening the page sends one warm request with its key", async () => {
  await withFetch(async () => new Response(null, { status: 204 }), async (requests) => {
    warmBackend(Promise.resolve(backend));
    await settle();
    assert.deepEqual(requests, [{ url: `${backend.url}/api/warm`, authorization: "Bearer k" }]);
  });
});

test("Given no backend connected, then opening the page sends nothing", async () => {
  await withFetch(async () => assert.fail("no request expected"), async (requests) => {
    warmBackend(Promise.resolve(null));
    await settle();
    assert.deepEqual(requests, []);
  });
});

test("Given a backend that doesn't answer, then the failed warm call is ignored", async () => {
  // An unhandled rejection here would fail the test run.
  await withFetch(async () => { throw new TypeError("fetch failed"); }, async (requests) => {
    warmBackend(Promise.resolve(backend));
    await settle();
    assert.equal(requests.length, 1);
  });
});
