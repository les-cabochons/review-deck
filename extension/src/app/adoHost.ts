import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, type IHostNavigationService } from "azure-devops-extension-api/Common";
import { AdoPrListSource } from "../data/adoList";
import { AdoPrSource } from "../data/adoSource";
import type { Identity, PrSource } from "../data/model";
import { type AppHost, Listeners, parseRoute, type Route } from "./host";

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

  nativePrUrl(route: Extract<Route, { view: "pr" }>): string {
    return `${this.projectUrl()}/_git/${encodeURIComponent(route.repo)}/pullrequest/${route.pr}`;
  }

  private projectUrl(): string {
    return `${this.hostUrl}${encodeURIComponent(this.project.name)}`;
  }
}
