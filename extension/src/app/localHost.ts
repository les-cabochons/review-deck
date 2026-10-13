import { MockPrListSource } from "../data/list";
import { MockPrSource } from "../data/mockSource";
import type { Identity, PrSource } from "../data/model";
import { MockReleaseCatalog } from "../data/mockReleases";
import { mergeTags, type TagStore, type TagStyles, withoutTag, withTag } from "../data/tags";
import type { BackendService } from "../review/backend";
import type { SavedReview, SavedReviews } from "../review/saved";
import { type AppHost, BACKEND_URL, type BackendSettings, type FavoriteRepos, Listeners, parseRoute, type ProjectSettings, readBackendSettings, readProjectSettings, type Route } from "./host";

const SETTINGS_KEY = "review-deck.local.projectSettings";
const TAGS_KEY = "review-deck.local.tagStyles";
const FAVORITES_KEY = "review-deck.local.favoriteRepos";
const BACKEND_KEY = "review-deck.local.backend";

/**
 * Local development host: routes live in this page's own query string (`?pr=17901&repo=t3code`),
 * data comes from extension/dev-data (npm run ext:mock), and writes stay in memory.
 */
export class LocalHost implements AppHost {
  readonly kind = "local";
  readonly cacheScope = "local";
  private readonly listeners = new Listeners<Route>();
  private readonly prSources = new Map<number, Promise<PrSource>>();
  private readonly reviews = new Map<string, SavedReview>();
  private readonly releaseCatalog = new MockReleaseCatalog();

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

  /**
   * The dev shell has no repository picker; `?currentRepo=<id>` stands in for one. The Changelog page opens on the
   * made-up repository with tags, as Azure DevOps always has one selected there.
   */
  async currentRepository(): Promise<{ id: string; name: string } | null> {
    const id = new URLSearchParams(location.search).get("currentRepo");
    const releaseRepos = await this.releaseCatalog.repositories();
    if (!id && document.body.dataset.page === "changelog") return releaseRepos[0] ?? null;
    const known = releaseRepos.find((r) => r.id === id);
    if (known) return known;
    const pr = id && (await this.list.list()).find((p) => p.repository.id === id);
    return pr ? { id, name: pr.repository.name } : null;
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

  /**
   * `?backend=http://localhost:7071` points at a local `func start` (which skips the token check without
   * API_KEY); otherwise the backend saved in the dev shell's Project settings → Review Deck, then the build's.
   */
  async backendService(): Promise<BackendService | null> {
    const scope = { organization: "local", projectId: "t3code", projectName: "t3code" };
    const query = new URLSearchParams(location.search).get("backend")?.replace(/\/+$/, "");
    if (query) return { url: query, token: "", scope };
    const own = await this.backendSettings();
    if (own) return { url: own.url, token: own.key, scope };
    return BACKEND_URL ? { url: BACKEND_URL, token: "", scope } : null;
  }

  async backendSettings(): Promise<BackendSettings | null> {
    try {
      return readBackendSettings(JSON.parse(localStorage.getItem(BACKEND_KEY) ?? "null"));
    } catch {
      return null;
    }
  }

  async saveBackendSettings(settings: BackendSettings | null): Promise<void> {
    if (settings) localStorage.setItem(BACKEND_KEY, JSON.stringify(settings));
    else localStorage.removeItem(BACKEND_KEY);
  }

  async canManageOrganization(): Promise<boolean> {
    return true;
  }

  /** In memory, so a reload analyzes again with the code being worked on. */
  savedReviews(): SavedReviews {
    const id = (key: Parameters<SavedReviews["load"]>[0]) => JSON.stringify(key);
    return {
      load: async (key) => this.reviews.get(id(key)) ?? null,
      save: async (key, review) => void this.reviews.set(id(key), review),
    };
  }

  /** Kept in localStorage; the local user may change them. */
  async projectSettings(): Promise<ProjectSettings> {
    try {
      return readProjectSettings({ trunkBranches: this.list.trunkBranches, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") });
    } catch {
      return readProjectSettings({ trunkBranches: this.list.trunkBranches });
    }
  }

  async updateProjectSettings(change: Partial<ProjectSettings>): Promise<ProjectSettings> {
    const settings = { ...(await this.projectSettings()), ...change };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }

  async canManageProject(): Promise<boolean> {
    return true;
  }

  /** No Azure DevOps here: the setting is saved, and nothing calls the backend. */
  async syncRestackHooks(): Promise<void> {}

  /** Styles in localStorage; renames and deletions change the demo's pull requests in memory. */
  tags(): TagStore {
    const read = (): TagStyles => {
      try {
        return JSON.parse(localStorage.getItem(TAGS_KEY) ?? "{}") as TagStyles;
      } catch {
        return {};
      }
    };
    const write = (styles: TagStyles) => localStorage.setItem(TAGS_KEY, JSON.stringify(styles));
    return {
      list: async () => mergeTags(this.list.labels, read()),
      save: async (previous, tag) => {
        if (previous && previous !== tag.name) this.list.replaceLabel(previous, tag.name.trim());
        write(withTag(read(), previous, tag));
      },
      remove: async (name) => {
        this.list.replaceLabel(name, null);
        write(withoutTag(read(), name));
      },
    };
  }

  favoriteRepos(): FavoriteRepos {
    return {
      load: async () => {
        try {
          return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]") as string[];
        } catch {
          return [];
        }
      },
      save: async (ids) => localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids)),
    };
  }

  /** A made-up repository's tags and pipeline runs (data/mockReleases.ts). */
  async releases(): Promise<MockReleaseCatalog> {
    return this.releaseCatalog;
  }

  reviewUrl(route: Extract<Route, { view: "pr" }>): string {
    return new URL(this.href(route), location.href).href;
  }

  nativePrUrl(route: Extract<Route, { view: "pr" }>): string {
    return `https://github.com/pingdotgg/t3code/pull/${route.pr}`;
  }

  createPrUrl(_route: Extract<Route, { view: "pr" }>, source: string, target: string): string {
    return `https://github.com/pingdotgg/t3code/compare/${encodeURIComponent(target)}...${encodeURIComponent(source)}`;
  }

  fileUrl(_route: Extract<Route, { view: "pr" }>, path: string, commit: string): string {
    return `https://github.com/pingdotgg/t3code/blob/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
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
