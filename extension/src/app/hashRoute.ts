import { parseRoute, type Route, sameRoute } from "./host";

/** The parts of Azure DevOps' host navigation service that carry the hub's route. */
export interface HostHistory {
  getHash(): Promise<string>;
  getQueryParams(): Promise<Record<string, string>>;
  setHash(hash: string): void;
  replaceHash(hash: string): void;
  setQueryParams(parameters: Record<string, string>): void;
  onHashChanged(callback: (hash: string) => void): void;
}

/**
 * A link to a pull request in the Deck hub from outside it (the pull request menu, another project's hub). Its route
 * arrives as `?pr=<id>&repo=<id>`, which HashRouter.connect moves into the hash.
 */
export function reviewHubUrl(
  organization: string,
  extension: { publisherId: string; extensionId: string },
  project: string,
  route: Extract<Route, { view: "pr" }>,
): string {
  const query = new URLSearchParams({ pr: String(route.pr), repo: route.repo });
  const hub = `${extension.publisherId}.${extension.extensionId}.review-hub`;
  return `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apps/hub/${hub}?${query}`;
}

/** `pr=12&repo=<id>` for a pull request, empty for the hub. */
export function routeHash(route: Route): string {
  return route.view === "pr" ? new URLSearchParams({ pr: String(route.pr), repo: route.repo }).toString() : "";
}

export function routeFromHash(hash: string): Route {
  return parseRoute(Object.fromEntries(new URLSearchParams(hash.replace(/^#/, ""))));
}

/**
 * The hub's route in the host page's hash. The host only reports back and forward through the hash (setHash adds
 * a history entry, onHashChanged fires on back and forward); query parameters have no change event, so a route
 * kept there left the browser's back button leaving the hub. Links from outside (the pull request menu, another
 * project's hub) still arrive as `?pr=<id>&repo=<id>`: that route moves into the hash on startup.
 */
export class HashRouter {
  private constructor(
    private readonly host: HostHistory,
    private current: Route,
  ) {}

  /** `onChange` runs when back or forward lands on another route; never for `navigate`. */
  static async connect(host: HostHistory, onChange: (route: Route) => void): Promise<HashRouter> {
    const [hash, query] = await Promise.all([host.getHash(), host.getQueryParams()]);
    const fromHash = routeFromHash(hash);
    const fromQuery = parseRoute(query);
    const router = new HashRouter(host, fromHash.view === "pr" ? fromHash : fromQuery);
    if (fromQuery.view === "pr") {
      // Clear the query first, so it can't reopen this PR from the hub, then record the route where history sees it.
      host.setQueryParams({ pr: "", repo: "" });
      host.replaceHash(routeHash(router.current));
    }
    host.onHashChanged((next) => {
      const route = routeFromHash(next);
      if (sameRoute(route, router.current)) return;
      router.current = route;
      onChange(route);
    });
    return router;
  }

  route(): Route {
    return this.current;
  }

  /** A new history entry, so back returns to the current route. */
  navigate(route: Route): void {
    if (sameRoute(route, this.current)) return;
    this.current = route;
    this.host.setHash(routeHash(route));
  }
}
