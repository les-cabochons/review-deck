import type { PrListSource } from "../data/list";
import type { Identity, PrSource } from "../data/model";
import type { BackendService } from "../review/backend";

/** Backend (Azure Function) base URL, set at build time from SEMANTIC_PR_BACKEND_URL (extension/build.mjs). */
declare const __BACKEND_URL__: string;
// typeof: unbundled runs (tsx tests) have no define.
export const BACKEND_URL = typeof __BACKEND_URL__ === "string" ? __BACKEND_URL__.replace(/\/+$/, "") : "";

/**
 * Per-project choices, stored with the extension (Azure DevOps extension data). Everything is off by
 * default: some projects have policies against sending code to AI services.
 */
export interface ProjectSettings {
  /** Send each group's changed lines to the backend's LLM (gpt-5-nano) for titles. */
  aiTitles: boolean;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { aiTitles: false };

/** The two pages of the hub: the PR inbox, or one pull request. */
export type Route = { view: "hub" } | { view: "pr"; repo: string; pr: number };

/**
 * Everything environment-specific the UI needs. `AdoHost` runs inside the Azure DevOps hub iframe;
 * `LocalHost` serves mock data for fast local iteration (npm run ext:dev).
 */
export interface AppHost {
  readonly kind: "ado" | "local";
  readonly currentUser: Identity;
  route(): Route;
  /** Updates the URL (shareable) and notifies subscribers. */
  navigate(route: Route): void;
  subscribe(listener: (route: Route) => void): () => void;
  listSource(): Promise<PrListSource>;
  prSource(route: Extract<Route, { view: "pr" }>): Promise<PrSource>;
  setTitle(title: string): void;
  /** The backend for embeddings and LLM titles, or null for structural grouping and heuristic titles. Never rejects. */
  backendService(): Promise<BackendService | null>;
  /** This project's settings. Resolves to the defaults (all off) when they can't be read, so a failure never turns AI on. */
  projectSettings(): Promise<ProjectSettings>;
  /** Saves this project's settings; the UI offers it to project administrators only. */
  saveProjectSettings(settings: ProjectSettings): Promise<void>;
  /** Whether the user may change project settings (Azure DevOps: "Edit project-level information"). False if unknown. */
  canManageProject(): Promise<boolean>;
  /** The native Azure DevOps PR page, for "open in Azure DevOps" links. */
  nativePrUrl(route: Extract<Route, { view: "pr" }>): string | null;
}

export function parseRoute(params: Record<string, string | undefined>): Route {
  const pr = Number(params.pr ?? params.pullRequestId);
  if (Number.isSafeInteger(pr) && pr > 0 && params.repo) return { view: "pr", repo: params.repo, pr };
  return { view: "hub" };
}

export function sameRoute(a: Route, b: Route): boolean {
  return a.view === b.view && (a.view === "hub" || (b.view === "pr" && a.repo === b.repo && a.pr === b.pr));
}

export class Listeners<T> {
  private readonly set = new Set<(value: T) => void>();
  add(listener: (value: T) => void): () => void {
    this.set.add(listener);
    return () => this.set.delete(listener);
  }
  emit(value: T): void {
    for (const l of this.set) l(value);
  }
}
