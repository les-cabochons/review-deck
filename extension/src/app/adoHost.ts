import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, type IExtensionDataManager, type IExtensionDataService, type IHostNavigationService } from "azure-devops-extension-api/Common";
import { AdoPrListSource } from "../data/adoList";
import { AdoPrSource } from "../data/adoSource";
import type { Identity, PrSource } from "../data/model";
import type { BackendService } from "../review/backend";
import { type AppHost, BACKEND_URL, DEFAULT_PROJECT_SETTINGS, Listeners, parseRoute, type ProjectSettings, readProjectSettings, type Route } from "./host";
import { syncRestackHooks } from "./restackHooks";

/** Extension data collection holding one settings document per project, keyed by project ID. */
const SETTINGS_COLLECTION = "project-settings";
/** The "Project" security namespace and its GENERIC_WRITE bit ("Edit project-level information"), held by Project Administrators. */
const PROJECT_NAMESPACE = "52d39943-cb85-4d7f-8fa8-c6baac873819";
const EDIT_PROJECT = 2;

/**
 * Runs inside the Azure DevOps hub iframe. The route lives in the host page's query string
 * (`?pr=<id>&repo=<id>`), so links to a review are shareable; navigation updates it in place.
 */
export class AdoHost implements AppHost {
  readonly kind = "ado";
  readonly currentUser: Identity;
  private current: Route;
  private readonly listeners = new Listeners<Route>();
  private readonly project = SDK.getWebContext().project;
  private readonly hostUrl: string;
  private dataManager: Promise<IExtensionDataManager> | null = null;

  private constructor(
    private readonly nav: IHostNavigationService,
    query: Record<string, string>,
  ) {
    const user = SDK.getUser();
    this.currentUser = { id: user.id, displayName: user.displayName, uniqueName: user.name, imageUrl: user.imageUrl };
    this.current = parseRoute(query);
    this.hostUrl = `https://dev.azure.com/${encodeURIComponent(SDK.getHost().name)}/`;
  }

  static async create(): Promise<AdoHost> {
    const nav = await SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);
    return new AdoHost(nav, await nav.getQueryParams());
  }

  route(): Route {
    return this.current;
  }

  navigate(route: Route): void {
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

  async prSource(route: Extract<Route, { view: "pr" }>): Promise<PrSource> {
    return new AdoPrSource(this.project.id, route.repo, route.pr, this.currentUser);
  }

  setTitle(title: string): void {
    this.nav.setDocumentTitle(title);
  }

  async backendService(): Promise<BackendService | null> {
    if (!BACKEND_URL) return null;
    try {
      // Signed with the extension's secret; the function checks it (backend/src/auth.ts).
      const scope = { organization: SDK.getHost().name, projectId: this.project.id, projectName: this.project.name };
      return { url: BACKEND_URL, token: await SDK.getAppToken(), scope };
    } catch (e) {
      console.warn("[semantic-pr] no app token, grouping without the backend:", e);
      return null;
    }
  }

  async projectSettings(): Promise<ProjectSettings> {
    try {
      return readProjectSettings(await (await this.data()).getDocument(SETTINGS_COLLECTION, this.project.id));
    } catch (e) {
      // A project that never saved settings has no document (404): that's the defaults too.
      if ((e as { status?: number }).status !== 404) console.warn("[semantic-pr] project settings unavailable, using defaults:", e);
      return DEFAULT_PROJECT_SETTINGS;
    }
  }

  async saveProjectSettings(settings: ProjectSettings): Promise<void> {
    // __etag -1: last write wins.
    await (await this.data()).setDocument(SETTINGS_COLLECTION, { id: this.project.id, __etag: -1, ...settings });
  }

  async syncRestackHooks(on: boolean): Promise<void> {
    const backend = await this.backendService();
    if (!backend) throw new Error("This extension was built without a backend, so it can't restack automatically.");
    await syncRestackHooks({ hostUrl: this.hostUrl, projectId: this.project.id, backend, token: await SDK.getAccessToken() }, on);
  }

  async canManageProject(): Promise<boolean> {
    try {
      const response = await fetch(`${this.hostUrl}_apis/security/permissionevaluationbatch?api-version=7.1`, {
        method: "POST",
        headers: { authorization: `Bearer ${await SDK.getAccessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({
          alwaysAllowAdministrators: true,
          evaluations: [{ securityNamespaceId: PROJECT_NAMESPACE, token: `$PROJECT:vstfs:///Classification/TeamProject/${this.project.id}`, permissions: EDIT_PROJECT }],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { evaluations } = (await response.json()) as { evaluations?: { value?: boolean }[] };
      return evaluations?.[0]?.value === true;
    } catch (e) {
      console.warn("[semantic-pr] could not check project permissions:", e);
      return false;
    }
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

  private projectUrl(): string {
    return `${this.hostUrl}${encodeURIComponent(this.project.name)}`;
  }
}
