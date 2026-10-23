import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, type IExtensionDataManager, type IExtensionDataService, type IHostNavigationService } from "azure-devops-extension-api/Common";
import { CoreRestClient } from "azure-devops-extension-api/Core";
import { GitServiceIds, type IVersionControlRepositoryService } from "azure-devops-extension-api/Git";
import { getClient } from "azure-devops-extension-api";
import { type Feature, type OrganizationSettings, readOrganizationSettings } from "../data/access";
import { AdoPrListSource } from "../data/adoList";
import type { PrSummary } from "../data/list";
import { AdoPrSource } from "../data/adoSource";
import { AdoTagStore } from "./adoTags";
import type { Identity, PrSource } from "../data/model";
import type { ReleaseCatalog } from "../data/releases";
import { type BackendService, restackPr, type RestackOutcome } from "../review/backend";
import { type ReviewKey, type SavedReview, type SavedReviews, savedFor, withSaved } from "../review/saved";
import { type AppHost, type BackendSettings, type FavoriteRepos, DEFAULT_PROJECT_SETTINGS, Listeners, type ProjectSettings, readBackendSettings, readProjectSettings, type Route } from "./host";
import { featureContributionId, syncFeatureStates } from "./featureStates";
import { HashRouter } from "./hashRoute";
import { syncRestackHooks } from "./restackHooks";
import type { PreferenceStore } from "../ui/preferences";

/** User-scoped extension data value holding the user's view preferences (ui/preferences.ts). */
const PREFERENCES_KEY = "preferences";
/** Extension data collection holding one settings document per project, keyed by project ID. */
const SETTINGS_COLLECTION = "project-settings";
/** Extension data collection holding each pull request's saved guided views, one document per PR (review/saved.ts). */
const REVIEWS_COLLECTION = "saved-reviews";
/** User-scoped extension data value holding your starred repository ids. */
const FAVORITES_KEY = "favorite-repos";
/** The "Project" security namespace and its GENERIC_WRITE bit ("Edit project-level information"), held by Project Administrators. */
const PROJECT_NAMESPACE = "52d39943-cb85-4d7f-8fa8-c6baac873819";
const EDIT_PROJECT = 2;
/** Organization-wide (Default scope) extension data value holding the organization's own backend. */
const BACKEND_KEY = "backend";
/** Organization-wide extension data collection holding the organization's settings (data/access.ts), as one document. */
const ORGANIZATION_COLLECTION = "organization-settings";
const ORGANIZATION_DOCUMENT = "settings";
/** How long a page reuses the organization's settings before reading them again, so an open page picks up changes. */
const ORGANIZATION_REUSE_MS = 30_000;
/** Saves tried when someone else saved the same document in between. */
const SAVE_ATTEMPTS = 3;
/** How long a prefetched pull request is fresh enough to open with; a row hovered long before its click loads again. */
const PREFETCH_REUSE_MS = 15_000;
/** Projects per page when listing the organization's. */
const PROJECT_PAGE = 100;
/** The "Collection" security namespace and its GENERIC_WRITE bit ("Edit instance-level information"), held by Project Collection Administrators. */
const COLLECTION_NAMESPACE = "3e65f728-f8bc-4ecd-8764-7e378b19bfa7";
const EDIT_COLLECTION = 2;

/**
 * Runs inside the Azure DevOps hub iframe. The route lives in the host page's hash (`#pr=<id>&repo=<id>`, see
 * app/hashRoute.ts), so links to a review are shareable and the browser's back and forward move between pages.
 */
export class AdoHost implements AppHost {
  readonly kind = "ado";
  readonly currentUser: Identity;
  readonly cacheScope: string;
  readonly projectId: string;
  private router!: HashRouter;
  private readonly listeners = new Listeners<Route>();
  private readonly project = SDK.getWebContext().project;
  private readonly hostUrl: string;
  private dataManager: Promise<IExtensionDataManager> | null = null;
  private tagStore: AdoTagStore | null = null;
  private backend: Promise<BackendService | null> | null = null;
  private releaseCatalog: Promise<ReleaseCatalog> | null = null;
  private organization: { read: number; settings: Promise<OrganizationSettings> } | null = null;
  /** The pull request prefetchPr started, for the first prSource() that asks for it. */
  private early: { repo: string; pr: number; source: AdoPrSource; at: number } | null = null;

  private constructor(
    private readonly nav: IHostNavigationService,
  ) {
    const user = SDK.getUser();
    this.currentUser = { id: user.id, displayName: user.displayName, uniqueName: user.name, imageUrl: user.imageUrl };
    this.hostUrl = `https://dev.azure.com/${encodeURIComponent(SDK.getHost().name)}/`;
    // No project on Organization settings pages.
    this.projectId = this.project?.id ?? "";
    this.cacheScope = `${SDK.getHost().id}/${this.projectId}/${user.id}`;
  }

  static async create(): Promise<AdoHost> {
    const nav = await SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);
    const host = new AdoHost(nav);
    host.router = await HashRouter.connect(nav, (route) => host.listeners.emit(route));
    return host;
  }

  route(): Route {
    return this.router.route();
  }

  navigate(route: Route): void {
    if (route.view === "pr" && route.project && route.project.toLowerCase() !== this.project.name.toLowerCase()) {
      // Another project's PR: open it in that project's hub, so its settings and links apply.
      this.nav.navigate(this.reviewUrl(route));
      return;
    }
    this.router.navigate(route);
    this.listeners.emit(route);
  }

  subscribe(listener: (route: Route) => void): () => void {
    return this.listeners.add(listener);
  }

  async listSource() {
    return new AdoPrListSource(this.project.id, this.currentUser, this.hostUrl, `${this.projectUrl()}/_git/${encodeURIComponent(this.project.name)}`);
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
    const early = this.early;
    this.early = null;
    if (early && this.isEarly(early, route)) return early.source;
    return new AdoPrSource(this.project.id, route.repo, route.pr, this.currentUser);
  }

  /**
   * The REST calls, and the host's token and API lookups ahead of them, run while the page's code loads (a link
   * straight to a PR, src/index.ts) or while the pointer moves from the hub row to its click.
   */
  prefetchPr(route: Extract<Route, { view: "pr" }>): void {
    // Another project's PR opens in that project's hub (navigate), which loads it itself.
    if (route.project && route.project.toLowerCase() !== this.project.name.toLowerCase()) return;
    if (this.early && this.isEarly(this.early, route)) return;
    const source = new AdoPrSource(this.project.id, route.repo, route.pr, this.currentUser);
    source.prefetch();
    this.early = { repo: route.repo, pr: route.pr, source, at: Date.now() };
  }

  private isEarly(early: NonNullable<AdoHost["early"]>, route: Extract<Route, { view: "pr" }>): boolean {
    return early.repo === route.repo && early.pr === route.pr && Date.now() - early.at < PREFETCH_REUSE_MS;
  }

  setTitle(title: string): void {
    this.nav.setDocumentTitle(title);
  }

  backendService(): Promise<BackendService | null> {
    this.backend ??= this.resolveBackend();
    return this.backend;
  }

  private async resolveBackend(): Promise<BackendService | null> {
    const own = await this.backendSettings();
    const scope = { organization: SDK.getHost().name, projectId: this.project.id, projectName: this.project.name };
    return own && { url: own.url, token: own.key, scope };
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

  organizationSettings(): Promise<OrganizationSettings> {
    // Shared for a short while: the hub's startup check, the review and the settings sections read it together.
    if (this.organization && Date.now() - this.organization.read < ORGANIZATION_REUSE_MS) return this.organization.settings;
    const settings = this.data()
      .then(storedOrganizationSettings)
      .then(
        (stored) => stored.settings,
        (e) => {
          console.warn("[review-deck] organization settings unavailable, using defaults without AI titles:", e);
          this.organization = null;
          // The hubs stay usable, but code isn't sent to an LLM the organization may have turned off.
          return { ...readOrganizationSettings(null), aiTitles: false };
        },
      );
    this.organization = { read: Date.now(), settings };
    return settings;
  }

  async updateOrganizationSettings(change: (settings: OrganizationSettings) => OrganizationSettings): Promise<OrganizationSettings> {
    const data = await this.data();
    for (let attempt = 1; ; attempt++) {
      // Unlike organizationSettings(), a failed read rejects: saving on top of the defaults could undo others' choices.
      const stored = await storedOrganizationSettings(data);
      const settings = change(stored.settings);
      const doc = { id: ORGANIZATION_DOCUMENT, ...settings };
      try {
        // The etag makes a save fail if someone else saved since the read, instead of overwriting their change.
        if (stored.etag === undefined) await data.createDocument(ORGANIZATION_COLLECTION, doc);
        else await data.setDocument(ORGANIZATION_COLLECTION, { ...doc, __etag: stored.etag });
        this.organization = { read: Date.now(), settings: Promise.resolve(settings) };
        return settings;
      } catch (e) {
        // Lost the race: apply the change again on top of theirs.
        if (attempt >= SAVE_ATTEMPTS || !isConflict(e)) throw e;
      }
    }
  }

  async syncFeatureVisibility(feature: Feature, projectIds?: string[]): Promise<void> {
    // Fresh, not the copy read on load: another administrator may have changed it since.
    const { settings } = await storedOrganizationSettings(await this.data());
    const ids = projectIds ?? (await this.organizationProjects()).map((p) => p.id);
    await syncFeatureStates(featureContributionId(SDK.getExtensionContext().id, feature), settings[feature], ids, !projectIds);
  }

  async organizationProjects(): Promise<{ id: string; name: string }[]> {
    const core = getClient(CoreRestClient);
    const all: { id: string; name: string }[] = [];
    for (;;) {
      const page = await core.getProjects(undefined, PROJECT_PAGE, all.length);
      all.push(...page.map((p) => ({ id: p.id, name: p.name })));
      if (page.length < PROJECT_PAGE) return all.sort((a, b) => a.name.localeCompare(b.name));
    }
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
    await syncRestackHooks({ hostUrl: this.hostUrl, projectId: this.project.id, backend, token: await SDK.getAccessToken(), extensionId: this.extensionId() }, on);
  }

  async restack(pr: PrSummary): Promise<RestackOutcome[]> {
    const backend = await this.backendService();
    if (!backend) throw new Error("No backend is set up for this organization, so it can't restack.");
    return restackPr(backend, {
      projectId: pr.repository.projectId,
      repositoryId: pr.repository.id,
      pullRequestId: pr.id,
      extensionId: this.extensionId(),
      adoToken: await SDK.getAccessToken(),
    });
  }

  /** publisher.extension, where the backend reads this project's settings. */
  private extensionId(): string {
    const { publisherId, extensionId } = SDK.getExtensionContext();
    return `${publisherId}.${extensionId}`;
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
   * In extension data, shared by everyone in the organization who opens the PR. One document per PR holds the
   * comparisons last grouped (review/saved.ts), so the collection grows only with the PRs reviewed. Documents saved
   * before (one comparison, no `comparisons`) are ignored and then replaced.
   */
  savedReviews(): SavedReviews {
    const id = (key: ReviewKey) => [this.project.id, key.repo, key.pr].join(".").replace(/[^A-Za-z0-9.-]/g, "_");
    const read = async (data: IExtensionDataManager, key: ReviewKey) => {
      try {
        return (await data.getDocument(REVIEWS_COLLECTION, id(key))) as { __etag?: number; comparisons?: unknown };
      } catch (e) {
        // Never saved.
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    };
    return {
      load: async (key) => {
        try {
          return savedFor((await read(await this.data(), key))?.comparisons, key);
        } catch (e) {
          console.warn("[review-deck] saved guided view unavailable:", e);
          return null;
        }
      },
      save: async (key, review: SavedReview) => {
        try {
          const data = await this.data();
          for (let attempt = 1; ; attempt++) {
            const doc = await read(data, key);
            const comparisons = withSaved(doc?.comparisons, key, review);
            if (!comparisons) return;
            const next = { id: id(key), comparisons };
            try {
              // The etag makes the save fail if someone else saved since the read, instead of dropping their comparison.
              if (doc) await data.setDocument(REVIEWS_COLLECTION, { ...next, __etag: doc.__etag });
              else await data.createDocument(REVIEWS_COLLECTION, next);
              return;
            } catch (e) {
              // Lost the race (merge with theirs) or a passing failure: read and try again.
              if (attempt >= SAVE_ATTEMPTS) throw e;
            }
          }
        } catch (e) {
          // E.g. a huge PR over the document size limit: it is analyzed on every open, as before.
          console.warn("[review-deck] could not save the guided view:", e);
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

  reviewUrl(route: Extract<Route, { view: "pr" }>): string {
    const { publisherId, extensionId } = SDK.getExtensionContext();
    const query = new URLSearchParams({ pr: String(route.pr), repo: route.repo });
    return `${this.hostUrl}${encodeURIComponent(route.project ?? this.project.name)}/_apps/hub/${publisherId}.${extensionId}.review-hub?${query}`;
  }

  nativePrUrl(route: Extract<Route, { view: "pr" }>): string {
    return `${this.projectUrl()}/_git/${encodeURIComponent(route.repo)}/pullrequest/${route.pr}`;
  }

  createPrUrl(route: Extract<Route, { view: "pr" }>, source: string, target: string): string {
    const query = new URLSearchParams({ sourceRef: source, targetRef: target });
    return `${this.projectUrl()}/_git/${encodeURIComponent(route.repo)}/pullrequestcreate?${query}`;
  }

  fileUrl(route: Extract<Route, { view: "pr" }>, path: string, commit: string): string {
    const query = new URLSearchParams({ path: `/${path}`, version: `GC${commit}`, _a: "contents" });
    return `${this.projectUrl()}/_git/${encodeURIComponent(route.repo)}?${query}`;
  }

  private projectUrl(): string {
    return `${this.hostUrl}${encodeURIComponent(this.project.name)}`;
  }
}

/** The organization's settings as saved, with the version a save must match (none if never saved). */
async function storedOrganizationSettings(data: IExtensionDataManager): Promise<{ settings: OrganizationSettings; etag?: number }> {
  try {
    const doc = (await data.getDocument(ORGANIZATION_COLLECTION, ORGANIZATION_DOCUMENT)) as { __etag?: number };
    return { settings: readOrganizationSettings(doc), etag: doc.__etag };
  } catch (e) {
    // Never saved: the defaults.
    if ((e as { status?: number }).status === 404) return { settings: readOrganizationSettings(null) };
    throw e;
  }
}

/** A document save refused because another save changed (or created) the document since it was read. */
function isConflict(e: unknown): boolean {
  const { status, message } = e as { status?: number; message?: string };
  return status === 409 || status === 412 || /etag|version|already exists/i.test(message ?? "");
}
