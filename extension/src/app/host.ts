import { DEFAULT_TRUNK_PATTERNS } from "../../../src/stack/branches";
import type { PrListSource } from "../data/list";
import type { Identity, PrSource } from "../data/model";
import type { TagStore } from "../data/tags";
import type { BackendService } from "../review/backend";
import type { SavedReviews } from "../review/saved";

/** Backend (Azure Function) base URL, set at build time from SEMANTIC_PR_BACKEND_URL (extension/build.mjs). */
declare const __BACKEND_URL__: string;
// typeof: unbundled runs (tsx tests) have no define.
export const BACKEND_URL = typeof __BACKEND_URL__ === "string" ? __BACKEND_URL__.replace(/\/+$/, "") : "";

/**
 * Per-project choices, stored with the extension (Azure DevOps extension data). Everything is off by
 * default: some projects have policies against sending code to AI services.
 */
export interface ProjectSettings {
  /** Send each group's changed lines to the backend's LLM (Terraform's titles_model) for titles. */
  aiTitles: boolean;
  /** Branch patterns where stacks end (see src/stack/branches.ts), e.g. main, dev, uat, release-style 00- branches. */
  trunkBranches: string[];
  /** The backend keeps stacks rebased on their parents (service hooks -> src/stack/restack.ts). */
  autoRestack: boolean;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { aiTitles: false, trunkBranches: DEFAULT_TRUNK_PATTERNS, autoRestack: false };

/** Settings from storage, with anything missing or malformed at its default. */
export function readProjectSettings(saved: Partial<Record<keyof ProjectSettings, unknown>> | null | undefined): ProjectSettings {
  const trunks = Array.isArray(saved?.trunkBranches) ? saved.trunkBranches.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
  return {
    aiTitles: saved?.aiTitles === true,
    trunkBranches: trunks.length ? trunks : DEFAULT_TRUNK_PATTERNS,
    autoRestack: saved?.autoRestack === true,
  };
}

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
  /**
   * Creates (on) or removes (off) this project's service hooks that call the backend's auto-restack.
   * Rejects with a readable message, e.g. without a backend or the permission to edit subscriptions.
   */
  syncRestackHooks(on: boolean): Promise<void>;
  /** Finished groupings, so reopening a pull request shows them without re-running the analysis. */
  savedReviews(): SavedReviews;
  /** This project's tags, with their colors and descriptions. */
  tags(): TagStore;
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
