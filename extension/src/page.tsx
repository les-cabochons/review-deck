import * as React from "react";
import * as ReactDOM from "react-dom";
import type { AppHost } from "./app/host";
import { enabledFor, type Feature } from "./data/access";
import { renderUnlessOff } from "./startup";
import { FeatureOff } from "./ui/FeatureOff";
import { Root } from "./ui/Root";
import { SettingsPage } from "./ui/settings/SettingsPage";

const root = document.getElementById("root")!;

/**
 * settings.html (Project settings → Review Deck), org-settings.html (Organization settings → Review Deck),
 * changelog.html (Repos → Changelog) and review.html share this bundle.
 */
const page = document.body.dataset.page;

/** The feature a hub page belongs to; settings pages always open. */
const FEATURE_PAGES: Record<string, Feature> = { review: "deck", changelog: "changelog" };

export async function renderHost(host: AppHost) {
  const feature = FEATURE_PAGES[page ?? "review"];
  if (!feature) return renderPage(host);
  // Azure DevOps normally hides a turned-off hub; this covers links to it, and a hub its feature state didn't hide.
  const off = host.organizationSettings().then((settings) => (enabledFor(settings[feature], host.projectId) ? null : settings[feature]));
  await renderUnlessOff(off, `review-deck.off.v1:${host.cacheScope}:${feature}`, () => renderPage(host), (policy) =>
    ReactDOM.render(<FeatureOff feature={feature} policy={policy} />, root),
  );
}

async function renderPage(host: AppHost) {
  if (page === "changelog") {
    // Its own chunk, so the review page doesn't load it.
    const { ChangelogPage } = await import("./ui/changelog/ChangelogPage");
    ReactDOM.render(<ChangelogPage host={host} />, root);
  } else if (page === "org-settings") {
    const { OrganizationSettingsPage } = await import("./ui/settings/OrganizationSettingsPage");
    ReactDOM.render(<OrganizationSettingsPage host={host} />, root);
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
