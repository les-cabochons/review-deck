import assert from "node:assert/strict";
import { test } from "node:test";
import { startHostedPage, withTimeout } from "../src/startup";
import { readPreference, writePreference } from "../src/ui/preferences";

function host() {
  const calls: string[] = [];
  return {
    calls,
    async init() { calls.push("init"); },
    async notifyLoadSucceeded() { calls.push("loaded"); },
    async notifyLoadFailed(error: Error) { calls.push(`failed: ${error.message}`); },
  };
}

test("Given an empty hub, when its guidance renders, then the host spinner finishes", async () => {
  const sdk = host();
  await startHostedPage(sdk, async () => { sdk.calls.push("rendered"); }, () => assert.fail("Unexpected startup failure"));
  assert.deepEqual(sdk.calls, ["init", "rendered", "loaded"]);
});

test("Given a startup failure, then the error renders and the host receives failure", async () => {
  const sdk = host();
  await startHostedPage(sdk, async () => { throw new Error("Navigation unavailable"); }, error => sdk.calls.push(`shown: ${error.message}`));
  assert.deepEqual(sdk.calls, ["init", "shown: Navigation unavailable", "failed: Navigation unavailable"]);
});

test("Given a rejected handshake, then page setup does not run and the host receives failure", async () => {
  const sdk = host();
  sdk.init = async () => { throw new Error("Host refused connection"); };
  await startHostedPage(sdk, async () => assert.fail("Cannot render before initialization"), () => {});
  assert.deepEqual(sdk.calls, ["failed: Host refused connection"]);
});

test("Given a serialized host error, then the page displays its message", async () => {
  const sdk = host();
  await startHostedPage(sdk, async () => { throw { message: "Navigation unavailable" }; }, error => sdk.calls.push(`shown: ${error.message}`));
  assert.deepEqual(sdk.calls, ["init", "shown: Navigation unavailable", "failed: Navigation unavailable"]);
});

test("Given an unanswered host request, then startup stops waiting with a useful error", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), "Host did not respond", 5), /Host did not respond/);
});

test("Given a blocked localStorage getter, then reading and changing preferences work in memory", () => {
  const denied = () => { throw new DOMException("Storage access denied", "SecurityError"); };
  assert.equal(readPreference("fileView", "grouped", denied), "grouped");
  assert.doesNotThrow(() => writePreference("fileView", "alpha", denied));
});

test("Given denied storage methods, then the page uses defaults and tolerates saving", () => {
  const denied = () => ({ getItem() { throw new Error("Denied"); }, setItem() { throw new Error("Quota exceeded"); } });
  assert.equal(readPreference("diffMode", "inline", denied), "inline");
  assert.doesNotThrow(() => writePreference("diffMode", "split", denied));
});

test("Given available storage, then existing view preferences still persist", () => {
  const values = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  writePreference("diffMode", "split", storage);
  assert.equal(readPreference("diffMode", "inline", storage), "split");
  assert.equal(values.get("semantic-review.diffMode"), "split");
});
