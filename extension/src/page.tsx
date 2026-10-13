import * as React from "react";
import * as ReactDOM from "react-dom";
import type { AppHost } from "./app/host";
import { Root } from "./ui/Root";
import { SettingsPage } from "./ui/settings/SettingsPage";

const root = document.getElementById("root")!;

/** settings.html (Project settings → Review Deck), changelog.html (Repos → Changelog) and review.html share this bundle. */
const page = document.body.dataset.page;

export async function renderHost(host: AppHost) {
  if (page === "changelog") {
    // Its own chunk, so the review page doesn't load it.
    const { ChangelogPage } = await import("./ui/changelog/ChangelogPage");
    ReactDOM.render(<ChangelogPage host={host} />, root);
  } else {
    ReactDOM.render(page === "settings" ? <SettingsPage host={host} /> : <Root host={host} />, root);
  }
}

/** Local dev: mock data from extension/dev-data, theme from ?theme=, live reload from the esbuild server. */
export async function renderLocal() {
  const [{ LocalHost }, { applyLocalTheme }] = await Promise.all([import("./app/localHost"), import("./dev/themes")]);
  applyLocalTheme(new URLSearchParams(location.search).get("theme"));
  window.addEventListener("message", (e) => {
    if (e.data?.type === "semantic-review:theme") applyLocalTheme(e.data.theme);
  });
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
    try {
      new EventSource("/esbuild").addEventListener("change", () => location.reload());
    } catch {
      // Not served by esbuild: no live reload.
    }
  }
  await renderHost(await LocalHost.create());
}
