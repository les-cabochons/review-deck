import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, type IExtensionDataManager, type IExtensionDataService, type IHostNavigationService } from "azure-devops-extension-api/Common";
import { GitServiceIds, type IVersionControlRepositoryService } from "azure-devops-extension-api/Git";
import { AdoPrListSource } from "../data/adoList";
import { AdoPrSource } from "../data/adoSource";
import { AdoTagStore } from "./adoTags";
import type { Identity, PrSource } from "../data/model";
import type { ReleaseCatalog } from "../data/releases";
import type { BackendService } from "../review/backend";
import type { ReviewKey, SavedReview, SavedReviews } from "../review/saved";
import { type AppHost, BACKEND_URL, type BackendSettings, type FavoriteRepos, DEFAULT_PROJECT_SETTINGS, Listeners, parseRoute, type ProjectSettings, readBackendSettings, readProjectSettings, type Route } from "./host";
import { syncRestackHooks } from "./restackHooks";
import type { PreferenceStore } from "../ui/preferences";

/** User-scoped extension data value holding the user's view preferences (ui/preferences.ts). */
const PREFERENCES_KEY = "preferences";
/** Extension data collection holding one settings document per project, keyed by project ID. */
const SETTINGS_COLLECTION = "project-settings";
/** Extension data collection holding each pull request's latest finished grouping (review/saved.ts). */
const REVIEWS_COLLECTION = "saved-reviews";
/** User-scoped extension data value holding your starred repository ids. */
const FAVORITES_KEY = "favorite-repos";
/** The "Project" security namespace and its GENERIC_WRITE bit ("Edit project-level information"), held by Project Administrators. */
const PROJECT_NAMESPACE = "52d39943-cb85-4d7f-8fa8-c6baac873819";
const EDIT_PROJECT = 2;
/** Organization-wide (Default scope) extension data value holding the organization's own backend. */
const BACKEND_KEY = "backend";
/** The "Collection" security namespace and its GENERIC_WRITE bit ("Edit instance-level information"), held by Project Collection Administrators. */
const COLLECTION_NAMESPACE = "3e65f728-f8bc-4ecd-8764-7e378b19bfa7";
const EDIT_COLLECTION = 2;

/**
 * Runs inside the Azure DevOps hub iframe. The route lives in the host page's query string
 * (`?pr=<id>&repo=<id>`), so links to a review are shareable; navigation updates it in place.
 */
export class AdoHost implements AppHost {
  readonly kind = "ado";
  readonly currentUser: Identity;
  readonly cacheScope: string;
  private current: Route;
  private readonly listeners = new Listeners<Route>();
  private readonly project = SDK.getWebContext().project;
  private readonly hostUrl: string;
  private dataManager: Promise<IExtensionDataManager> | null = null;
  private tagStore: AdoTagStore | null = null;
  private backend: Promise<BackendService | null> | null = null;
  private releaseCatalog: Promise<ReleaseCatalog> | null = null;

  private constructor(
    private readonly nav: IHostNavigationService,
    query: Record<string, string>,
  ) {
    const user = SDK.getUser();
    this.currentUser = { id: user.id, displayName: user.displayName, uniqueName: user.name, imageUrl: user.imageUrl };
    this.current = parseRoute(query);
    this.hostUrl = `https://dev.azure.com/${encodeURIComponent(SDK.getHost().name)}/`;
    this.cacheScope = `${SDK.getHost().id}/${this.project.id}/${user.id}`;
  }

  static async create(): Promise<AdoHost> {
    const nav = await SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);
    return new AdoHost(nav, await nav.getQueryParams());
  }

  route(): Route {
    return this.current;
  }

  navigate(route: Route): void {
    if (route.view === "pr" && route.project && route.project.toLowerCase() !== this.project.name.toLowerCase()) {
      // Another project's PR: open it in that project's hub, so its settings and links apply.
      const { publisherId, extensionId } = SDK.getExtensionContext();
      const query = new URLSearchParams({ pr: String(route.pr), repo: route.repo });
      this.nav.navigate(`${this.hostUrl}${encodeURIComponent(route.project)}/_apps/hub/${publisherId}.${extensionId}.review-hub?${query}`);
      return;
    }
    this.current = route;
    this.nav.setQueryParams(route.view === "pr" ? { pr: String(route.pr), repo: route.repo } : { pr: "", repo: "" });
    this.listeners.emit(route);
  }

  subscribe(listener: (route: Route) => void): () => void {
    return this.listeners.add(listener);
  }

  async listSource() {
    return new AdoPrListSource(this.project.id, this.currentUser, this.hostUrl, `${this.projectUrl()}/_git/${encodeURIComponent(this.project.name)}/pullrequestcreate`);
  }

  async currentRepository(): Promise<{ id: string; name: string } | null> {
    try {
      const service = await SDK.getService<IVersionControlRepositoryService>(GitServiceIds.VersionControlRepositoryService);
      const repo = await service.getCurrentGitRepository();
      return repo && { id: repo.id, name: repo.name };
    } catch (e) {
      console.warn("[review-deck] no current repository:", e);
      return null;
    }
  }

  async prSource(route: Extract<Route, { view: "pr" }>): Promise<PrSource> {
    return new AdoPrSource(this.project.id, route.repo, route.pr, this.currentUser);
  }

  setTitle(title: string): void {
    this.nav.setDocumentTitle(title);
  }

  backendService(): Promise<BackendService | null> {
    this.backend ??= this.resolveBackend();
    return this.backend;
  }

  /** The organization's own backend with its API key, else the build's with an app token, else none. */
  private async resolveBackend(): Promise<BackendService | null> {
    const scope = { organization: SDK.getHost().name, projectId: this.project.id, projectName: this.project.name };
    const own = await this.backendSettings();
    if (own) return { url: own.url, token: own.key, scope };
    if (!BACKEND_URL) return null;
    try {
      // Signed with the extension's secret; the function checks it (backend/src/auth.ts).
      return { url: BACKEND_URL, token: await SDK.getAppToken(), scope };
    } catch (e) {
      console.warn("[review-deck] no app token, grouping without the backend:", e);
      return null;
    }
  }

  async backendSettings(): Promise<BackendSettings | null> {
    try {
      return readBackendSettings(await (await this.data()).getValue<unknown>(BACKEND_KEY, { defaultValue: null }));
    } catch (e) {
      console.warn("[review-deck] backend settings unavailable:", e);
      return null;
    }
  }

  async saveBackendSettings(settings: BackendSettings | null): Promise<void> {
    await (await this.data()).setValue(BACKEND_KEY, settings);
    this.backend = null;
  }

  async canManageOrganization(): Promise<boolean> {
    return this.hasPermission(COLLECTION_NAMESPACE, "NAMESPACE:", EDIT_COLLECTION, "organization");
  }

  async projectSettings(): Promise<ProjectSettings> {
    try {
      return readProjectSettings(await (await this.data()).getDocument(SETTINGS_COLLECTION, this.project.id));
    } catch (e) {
      // A project that never saved settings has no document (404): that's the defaults too.
      if ((e as { status?: number }).status !== 404) console.warn("[review-deck] project settings unavailable, using defaults:", e);
      return DEFAULT_PROJECT_SETTINGS;
    }
  }

  async updateProjectSettings(change: Partial<ProjectSettings>): Promise<ProjectSettings> {
    const data = await this.data();
    let saved: Partial<Record<keyof ProjectSettings, unknown>> | null = null;
    try {
      saved = await data.getDocument(SETTINGS_COLLECTION, this.project.id);
    } catch (e) {
      // Never saved (404) is the defaults; anything else could mean overwriting settings we couldn't read.
      if ((e as { status?: number }).status !== 404) throw e;
    }
    const settings = { ...readProjectSettings(saved), ...change };
    // __etag -1: last write wins.
    await data.setDocument(SETTINGS_COLLECTION, { id: this.project.id, __etag: -1, ...settings });
    return settings;
  }

  async syncRestackHooks(on: boolean): Promise<void> {
    const backend = await this.backendService();
    if (!backend) throw new Error("No backend is set up for this organization, so it can't restack automatically.");
    await syncRestackHooks({ hostUrl: this.hostUrl, projectId: this.project.id, backend, token: await SDK.getAccessToken() }, on);
  }

  async canManageProject(): Promise<boolean> {
    return this.hasPermission(PROJECT_NAMESPACE, `$PROJECT:vstfs:///Classification/TeamProject/${this.project.id}`, EDIT_PROJECT, "project");
  }

  private async hasPermission(securityNamespaceId: string, token: string, permissions: number, what: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.hostUrl}_apis/security/permissionevaluationbatch?api-version=7.1`, {
        method: "POST",
        headers: { authorization: `Bearer ${await SDK.getAccessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ alwaysAllowAdministrators: true, evaluations: [{ securityNamespaceId, token, permissions }] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { evaluations } = (await response.json()) as { evaluations?: { value?: boolean }[] };
      return evaluations?.[0]?.value === true;
    } catch (e) {
      console.warn(`[review-deck] could not check ${what} permissions:`, e);
      return false;
    }
  }

  /** The user's view preferences, in user-scoped extension data so they follow them across browsers. */
  preferences(): PreferenceStore {
    const options = { scopeType: "User", defaultValue: {} };
    return {
      load: async () => ((await (await this.data()).getValue<Record<string, string> | null>(PREFERENCES_KEY, options)) ?? {}),
      save: async (values) => void (await (await this.data()).setValue(PREFERENCES_KEY, values, { scopeType: "User" })),
    };
  }

  /**
   * In extension data, shared by everyone in the organization who opens the PR. One document per PR holds its
   * latest grouping, so the collection grows only with the PRs reviewed. A grouping for another comparison, or
   * saved by another extension version (the grouping code may have changed), is ignored and then replaced.
   */
  savedReviews(): SavedReviews {
    const version = SDK.getExtensionContext().version;
    const id = (key: ReviewKey) => [this.project.id, key.repo, key.pr].join(".").replace(/[^A-Za-z0-9.-]/g, "_");
    return {
      load: async (key) => {
        try {
          const doc = (await (await this.data()).getDocument(REVIEWS_COLLECTION, id(key))) as { version?: string; iteration?: number; compareTo?: number; review?: unknown };
          const fits = doc.version === version && doc.iteration === key.iteration && doc.compareTo === key.compareTo;
          return fits ? (doc.review ?? null) : null;
        } catch (e) {
          // Never saved: 404.
          if ((e as { status?: number }).status !== 404) console.warn("[review-deck] saved grouping unavailable:", e);
          return null;
        }
      },
      save: async (key, review: SavedReview) => {
        try {
          await (await this.data()).setDocument(REVIEWS_COLLECTION, { id: id(key), __etag: -1, version, iteration: key.iteration, compareTo: key.compareTo, review });
        } catch (e) {
          // E.g. a huge PR over the document size limit: it is analyzed on every open, as before.
          console.warn("[review-deck] could not save the grouping:", e);
        }
      },
    };
  }

  tags(): AdoTagStore {
    this.tagStore ??= new AdoTagStore({ hostUrl: this.hostUrl, projectId: this.project.id, token: () => SDK.getAccessToken(), data: () => this.data() });
    return this.tagStore;
  }

  releases(): Promise<ReleaseCatalog> {
    // A separate chunk: the Build and File Container clients are only needed by the Changelog hub and its settings.
    this.releaseCatalog ??= import("./adoReleases").then(
      ({ AdoReleaseCatalog }) =>
        new AdoReleaseCatalog({
          hostUrl: this.hostUrl,
          projectId: this.project.id,
          projectName: this.project.name,
          token: () => SDK.getAccessToken(),
          data: () => this.data(),
        }),
    );
    this.releaseCatalog.catch(() => (this.releaseCatalog = null));
    return this.releaseCatalog;
  }

  /** In user-scoped extension data, so your stars follow you to every project and browser. */
  favoriteRepos(): FavoriteRepos {
    return {
      load: async () => {
        try {
          const ids = await (await this.data()).getValue<unknown>(FAVORITES_KEY, { scopeType: "User", defaultValue: [] });
          return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
        } catch (e) {
          console.warn("[review-deck] favorite repositories unavailable:", e);
          return [];
        }
      },
      save: async (ids) => void (await (await this.data()).setValue(FAVORITES_KEY, ids, { scopeType: "User" })),
    };
  }

  private data(): Promise<IExtensionDataManager> {
    this.dataManager ??= (async () => {
      const service = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
      return service.getExtensionDataManager(SDK.getExtensionContext().id, await SDK.getAccessToken());
    })();
    this.dataManager.catch(() => (this.dataManager = null));
    return this.dataManager;
  }

  nativePrUrl(route: Extract<Route, { view: "pr" }>): string {
    return `${this.projectUrl()}/_git/${encodeURIComponent(route.repo)}/pullrequest/${route.pr}`;
  }

  fileUrl(route: Extract<Route, { view: "pr" }>, path: string, commit: string): string {
    const query = new URLSearchParams({ path: `/${path}`, version: `GC${commit}`, _a: "contents" });
    return `${this.projectUrl()}/_git/${encodeURIComponent(route.repo)}?${query}`;
  }

  private projectUrl(): string {
    return `${this.hostUrl}${encodeURIComponent(this.project.name)}`;
  }
}
