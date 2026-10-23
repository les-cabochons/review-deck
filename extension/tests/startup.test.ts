import assert from "node:assert/strict";
import { test } from "node:test";
import { THEME_KEY } from "../src/skeletons";
import { rememberHostTheme, renderUnlessOff, startHostedPage, withTimeout } from "../src/startup";
import { connectPreferences, preferencesLoaded, readLocal, readPreference, writeLocal, writePreference } from "../src/ui/preferences";

function host() {
  const calls: string[] = [];
  return {
    calls,
    async init() { calls.push("init"); },
    async notifyLoadSucceeded() { calls.push("loaded"); },
    async notifyLoadFailed(error: Error) { calls.push(`failed: ${error.message}`); },
  };
}

test("Given a hosted page, then the host's loading indicator ends right after the handshake, before the page renders", async () => {
  const sdk = host();
  await startHostedPage(sdk, async () => { sdk.calls.push("rendered"); }, () => assert.fail("Unexpected startup failure"));
  assert.deepEqual(sdk.calls, ["init", "loaded", "rendered"]);
});

test("Given a failure after the handshake, then the error shows on the page the host already revealed", async () => {
  const sdk = host();
  await startHostedPage(sdk, async () => { throw new Error("Navigation unavailable"); }, error => sdk.calls.push(`shown: ${error.message}`));
  assert.deepEqual(sdk.calls, ["init", "loaded", "shown: Navigation unavailable"]);
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
  assert.deepEqual(sdk.calls, ["init", "loaded", "shown: Navigation unavailable"]);
});

test("Given a host that never acknowledges the page, then the page says so and the host receives failure", async () => {
  const sdk = host();
  sdk.notifyLoadSucceeded = () => new Promise(() => {});
  await startHostedPage(sdk, async () => { sdk.calls.push("rendered"); }, error => sdk.calls.push(`shown: ${error.message}`), 5);
  assert.deepEqual(sdk.calls, ["init", "rendered", "shown: Azure DevOps did not acknowledge the review page.", "failed: Azure DevOps did not acknowledge the review page."]);
});

test("Given an unanswered host request, then startup stops waiting with a useful error", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), "Host did not respond", 5), /Host did not respond/);
});

test("Given the host applies its theme, then it is kept for the next load's first paint", () => {
  const target = new EventTarget();
  const saved = new Map<string, string>();
  rememberHostTheme(() => ({ setItem: (key: string, value: string) => void saved.set(key, value) }), target);
  target.dispatchEvent(new CustomEvent("themeApplied", { detail: { "background-color": "rgba(32, 31, 30, 1)" } }));
  assert.equal(saved.get(THEME_KEY), JSON.stringify({ "background-color": "rgba(32, 31, 30, 1)" }));
  target.dispatchEvent(new CustomEvent("themeApplied", { detail: undefined }));
  assert.equal(saved.size, 1);
});

test("Given denied storage, then keeping the theme is harmless", () => {
  const target = new EventTarget();
  rememberHostTheme(() => { throw new DOMException("Storage access denied", "SecurityError"); }, target);
  assert.doesNotThrow(() => target.dispatchEvent(new CustomEvent("themeApplied", { detail: { "background-color": "#fff" } })));
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

test("Given a slow account, then a page that opened without its preferences can adopt them once they arrive", async () => {
  const local = memoryStorage();
  let answer!: (values: Record<string, string>) => void;
  await connectPreferences({ load: () => new Promise((resolve) => (answer = resolve)), save: async () => {} }, 10, local.storage);
  assert.equal(readPreference("hub.filter", "inbox", local.storage), "inbox");
  answer({ "hub.filter": "needs-review" });
  await preferencesLoaded();
  assert.equal(readPreference("hub.filter", "inbox", local.storage), "needs-review");
});

test("Given a change made before the account's preferences arrive, then re-reading after they arrive keeps the change", async () => {
  const local = memoryStorage();
  let answer!: (values: Record<string, string>) => void;
  await connectPreferences({ load: () => new Promise((resolve) => (answer = resolve)), save: async () => {} }, 10, local.storage);
  writePreference("diffMode", "split", local.storage);
  answer({ diffMode: "inline", fileView: "alpha" });
  await preferencesLoaded();
  // What usePreference reads once they arrive: the change for diffMode, the account's value for the rest.
  assert.equal(readPreference("diffMode", "inline", local.storage), "split");
  assert.equal(readPreference("fileView", "grouped", local.storage), "alpha");
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

function flags(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    store: () => ({
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
      removeItem: (k: string) => void values.delete(k),
    }),
  };
}

test("Given a hub whose on/off check is still loading, then the page renders without waiting for it", async () => {
  const calls: string[] = [];
  let answer!: (reason: string | null) => void;
  const done = renderUnlessOff(new Promise<string | null>((ok) => (answer = ok)), "off:deck", () => void calls.push("rendered"), (r) => calls.push(`off: ${r}`), flags().store);
  await Promise.resolve();
  assert.deepEqual(calls, ["rendered"]);
  answer(null);
  await done;
  assert.deepEqual(calls, ["rendered"]);
});

test("Given the check finds the feature off, then the page gives way to the notice and the next load waits for the check", async () => {
  const calls: string[] = [];
  const storage = flags();
  await renderUnlessOff(Promise.resolve("org"), "off:deck", () => void calls.push("rendered"), (r) => calls.push(`off: ${r}`), storage.store);
  assert.deepEqual(calls, ["rendered", "off: org"]);
  assert.equal(storage.values.get("off:deck"), "off");
});

test("Given the feature was off last time, then nothing renders until the check answers", async () => {
  const calls: string[] = [];
  const storage = flags({ "off:deck": "off" });
  await renderUnlessOff(Promise.resolve("org"), "off:deck", () => void calls.push("rendered"), (r) => calls.push(`off: ${r}`), storage.store);
  assert.deepEqual(calls, ["off: org"]);
  await renderUnlessOff(Promise.resolve(null), "off:deck", () => void calls.push("rendered"), (r) => calls.push(`off: ${r}`), storage.store);
  assert.deepEqual(calls, ["off: org", "rendered"]);
  assert.equal(storage.values.has("off:deck"), false);
});
