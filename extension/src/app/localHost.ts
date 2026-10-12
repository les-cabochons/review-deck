import { MockPrListSource } from "../data/list";
import { MockPrSource } from "../data/mockSource";
import type { Identity, PrSource } from "../data/model";
import { type AppHost, Listeners, parseRoute, type Route } from "./host";

/**
 * Local development host: routes live in this page's own query string (`?pr=17901&repo=t3code`),
 * data comes from extension/dev-data (npm run ext:mock), and writes stay in memory.
 */
export class LocalHost implements AppHost {
  readonly kind = "local";
  private readonly listeners = new Listeners<Route>();
  private readonly prSources = new Map<number, Promise<PrSource>>();

  private constructor(private readonly list: MockPrListSource) {
    window.addEventListener("popstate", () => this.listeners.emit(this.route()));
  }

  static async create(): Promise<LocalHost> {
    const host = new LocalHost(await MockPrListSource.fetch("../dev-data/pr-list.json"));
    // Old links used ?mock=<snapshot id>.
    const params = new URLSearchParams(location.search);
    const mock = params.get("mock");
    if (mock) {
      const id = [...host.list.snapshots].find(([, snap]) => snap === mock)?.[0];
      if (id) history.replaceState(null, "", host.href({ view: "pr", repo: "t3code", pr: id }));
    }
    return host;
  }

  get currentUser(): Identity {
    return this.list.currentUser;
  }

  route(): Route {
    return parseRoute(Object.fromEntries(new URLSearchParams(location.search)));
  }

  navigate(route: Route): void {
    history.pushState(null, "", this.href(route));
    this.listeners.emit(route);
  }

  subscribe(listener: (route: Route) => void): () => void {
    return this.listeners.add(listener);
  }

  async listSource() {
    return this.list;
  }

  prSource(route: Extract<Route, { view: "pr" }>): Promise<PrSource> {
    let source = this.prSources.get(route.pr);
    if (!source) {
      const snapshot = this.list.snapshots.get(route.pr);
      source = snapshot
        ? MockPrSource.fetch(`../dev-data/${encodeURIComponent(snapshot)}.json`, this.currentUser)
        : Promise.reject(new Error(`No local snapshot for !${route.pr}. Build one with npm run ext:mock -- <id>.`));
      // Keep one source per PR so in-memory writes survive hub <-> PR navigation.
      this.prSources.set(route.pr, source);
    }
    return source;
  }

  setTitle(title: string): void {
    document.title = title;
  }

  nativePrUrl(route: Extract<Route, { view: "pr" }>): string {
    return `https://github.com/pingdotgg/t3code/pull/${route.pr}`;
  }

  private href(route: Route): string {
    const params = new URLSearchParams(location.search);
    params.delete("mock");
    params.delete("pr");
    params.delete("repo");
    if (route.view === "pr") {
      params.set("pr", String(route.pr));
      params.set("repo", route.repo);
    }
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
  }
}
