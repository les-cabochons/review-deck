import * as React from "react";
import * as ReactDOM from "react-dom";
import type { AppHost } from "./app/host";
import { Root } from "./ui/Root";

const root = document.getElementById("root")!;

export function renderHost(host: AppHost) {
  ReactDOM.render(<Root host={host} />, root);
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
  renderHost(await LocalHost.create());
}
