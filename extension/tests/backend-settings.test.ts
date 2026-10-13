import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyApiKey } from "../../backend/src/auth";
import { normalizeBackendUrl, readBackendSettings } from "../src/app/host";

test("Given a pasted Function App URL, then it is saved without a trailing slash or /api", () => {
  assert.equal(normalizeBackendUrl(" https://func-review-deck-abc123.azurewebsites.net/ "), "https://func-review-deck-abc123.azurewebsites.net");
  assert.equal(normalizeBackendUrl("https://func-review-deck-abc123.azurewebsites.net/api/"), "https://func-review-deck-abc123.azurewebsites.net");
  assert.equal(normalizeBackendUrl("http://localhost:7071"), "http://localhost:7071");
});

test("Given a URL that would send the key in the clear or is not a URL, then it is refused", () => {
  assert.throws(() => normalizeBackendUrl("http://func-review-deck-abc123.azurewebsites.net"), /https/);
  assert.throws(() => normalizeBackendUrl("https://example.com/?x=1"), /query/);
  assert.throws(() => normalizeBackendUrl("func-review-deck"), TypeError);
});

test("Given saved backend settings, then malformed ones read as no backend", () => {
  assert.deepEqual(readBackendSettings({ url: "https://b.example.com/", key: "k" }), { url: "https://b.example.com", key: "k" });
  assert.equal(readBackendSettings(null), null);
  assert.equal(readBackendSettings({ url: "", key: "k" }), null);
  assert.equal(readBackendSettings({ url: "http://b.example.com", key: "k" }), null);
  assert.equal(readBackendSettings({ url: "https://b.example.com" }), null);
});

test("Given the backend's API key, then only the exact key is accepted", () => {
  assert.equal(verifyApiKey("secret-key", "secret-key"), true);
  assert.equal(verifyApiKey("secret-ke", "secret-key"), false);
  assert.equal(verifyApiKey("", ""), false);
});
