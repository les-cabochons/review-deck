// Local browser regression harness. Never included in the extension package.
import "azure-devops-ui/Core/override.css";
import "../src/styles.css";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { MockPrSource } from "../src/data/mockSource";
import type { AppHost } from "../src/app/host";
import { PrPage } from "../src/ui/App";

async function main() {
  const source = await MockPrSource.fetch("../dev-data/t3code-17901.json");
  const state = { failWrite: false, failRefresh: false, pauseWrite: false, writes: 0, analyses: 0, resume: () => {}, source };
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
  const route = { view: "pr" as const, repo: "t3code", pr: 17901 };
  const host: AppHost = {
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
    projectSettings: async () => ({ aiTitles: false }),
    saveProjectSettings: async () => {},
    canManageProject: async () => false,
    savedReviews: () => ({ load: async () => null, save: async () => {} }),
    nativePrUrl: () => null,
    settingsUrl: () => null,
  };
  ReactDOM.render(<PrPage host={host} route={route} source={source} />, document.getElementById("root"));
}

main().catch((e) => {
  document.body.textContent = String(e);
});
