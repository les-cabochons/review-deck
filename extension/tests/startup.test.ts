import assert from "node:assert/strict";
import { test } from "node:test";
import { startHostedPage, withTimeout } from "../src/startup";
import { connectPreferences, readLocal, readPreference, writeLocal, writePreference } from "../src/ui/preferences";

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

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, storage: () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }) };
}

test("Given preferences saved to the user's account, when the page connects, then they replace this browser's and changes are saved back", async () => {
  const local = memoryStorage({ "semantic-review.diffMode": "inline", "semantic-review.fileView": "alpha" });
  const saves: Record<string, string>[] = [];
  await connectPreferences({ load: async () => ({ diffMode: "split", hiddenFiles: "test" }), save: async (values) => { saves.push(values); } }, 1500, local.storage);
  assert.equal(readPreference("diffMode", "inline", local.storage), "split");
  assert.equal(readPreference("hiddenFiles", "", local.storage), "test");
  assert.equal(readPreference("fileView", "grouped", local.storage), "alpha");

  writePreference("hiddenFiles", "test,generated", local.storage);
  writePreference("hiddenFiles", "generated", local.storage);
  await new Promise((resolve) => setTimeout(resolve, 600));
  // One batched save, carrying this browser's older preferences along to the account.
  assert.deepEqual(saves, [{ diffMode: "split", hiddenFiles: "generated", fileView: "alpha" }]);
});

test("Given the user's account is slow, then the page opens with this browser's preferences without waiting", async () => {
  const local = memoryStorage({ "semantic-review.diffMode": "split" });
  const started = Date.now();
  await connectPreferences({ load: () => new Promise(() => {}), save: async () => {} }, 50, local.storage);
  assert.ok(Date.now() - started < 1000);
  assert.equal(readPreference("diffMode", "inline", local.storage), "split");
});

test("Given denied storage, then preferences from the user's account still apply", async () => {
  const denied = () => { throw new DOMException("Storage access denied", "SecurityError"); };
  await connectPreferences({ load: async () => ({ fileView: "alpha" }), save: async () => {} }, 1500, denied);
  assert.equal(readPreference("fileView", "grouped", denied), "alpha");
});

test("Given pending-review drafts, then they stay in this browser and never reach the user's account", async () => {
  const local = memoryStorage();
  const saves: Record<string, string>[] = [];
  await connectPreferences({ load: async () => ({}), save: async (values) => { saves.push(values); } }, 1500, local.storage);
  writeLocal("pending.t3code.17901", '[{"id":"draft-1"}]', local.storage);
  assert.equal(readLocal("pending.t3code.17901", local.storage), '[{"id":"draft-1"}]');
  writePreference("diffMode", "split", local.storage);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.deepEqual(saves, [{ diffMode: "split" }]);
});
