// Local browser regression harness. Never included in the extension package.
import "azure-devops-ui/Core/override.css";
import "../src/styles.css";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { MockPrSource } from "../src/data/mockSource";
import { type AppHost, DEFAULT_PROJECT_SETTINGS } from "../src/app/host";
import { LocalHost } from "../src/app/localHost";
import { type SavedReviews, savedFor, withSaved } from "../src/review/saved";
import { PrPage } from "../src/ui/App";

async function main() {
  const params = new URLSearchParams(location.search);
  // ?snapshot=<id> opens another PR from extension/dev-data.
  const source = await MockPrSource.fetch(`../dev-data/${params.get("snapshot") ?? "t3code-17901"}.json`);
  const state = { failWrite: false, failRefresh: false, failSave: false, pauseWrite: false, writes: 0, analyses: 0, resume: () => {}, source };
  const create = source.actions.createThread;
  source.actions.createThread = async (input) => {
    state.writes++;
    if (state.pauseWrite)
      await new Promise<void>((resolve) => {
        state.resume = resolve;
      });
    if (state.failWrite) {
      state.failWrite = false;
      throw new Error("Simulated permission failure");
    }
    await create(input);
  };
  const load = source.load.bind(source);
  source.load = async () => {
    if (state.failRefresh) {
      state.failRefresh = false;
      throw new Error("Simulated refresh failure");
    }
    return load();
  };
  const changes = source.getChanges.bind(source);
  source.getChanges = async (...args) => {
    state.analyses++;
    return changes(...args);
  };
  Object.assign(window, { reviewTest: state });
  // With ?saved, guided views are kept in localStorage across reloads (published-guide.browser.js edits them there),
  // and `failSave` makes saves fail as a host's do: silently, except a Publish. Without it, every open groups.
  const SAVED = "write-test-saved";
  const kept = (): unknown => JSON.parse(localStorage.getItem(SAVED) ?? "null");
  const savedReviews: SavedReviews = params.has("saved")
    ? {
        load: async (key) => savedFor(kept(), key),
        save: async (key, review, options) => {
          if (state.failSave) {
            if (options?.publish) throw new Error("Simulated save failure");
            return;
          }
          const comparisons = withSaved(kept(), key, review, options);
          if (comparisons) localStorage.setItem(SAVED, JSON.stringify(comparisons));
        },
      }
    : { load: async () => null, save: async () => {} };
  const route = { view: "pr" as const, repo: "t3code", pr: 17901 };
  // The local page's host for whatever the harness doesn't stub.
  const overrides: Partial<AppHost> = {
    kind: "local",
    cacheScope: "write-test",
    currentUser: source.currentUser,
    route: () => route,
    navigate: () => {},
    subscribe: () => () => {},
    listSource: () => Promise.reject(new Error("No PR list in the write harness")),
    prSource: async () => source,
    setTitle: (title) => (document.title = title),
    backendService: async () => null,
    projectSettings: async () => DEFAULT_PROJECT_SETTINGS,
    updateProjectSettings: async () => DEFAULT_PROJECT_SETTINGS,
    canManageProject: async () => false,
    savedReviews: () => savedReviews,
    reviewUrl: () => location.href,
    nativePrUrl: () => null,
    createPrUrl: () => null,
  };
  const host = Object.create(await LocalHost.create(), Object.getOwnPropertyDescriptors(overrides)) as AppHost;
  ReactDOM.render(<PrPage host={host} route={route} source={source} />, document.getElementById("root"));
}

main().catch((e) => {
  document.body.textContent = String(e);
});
