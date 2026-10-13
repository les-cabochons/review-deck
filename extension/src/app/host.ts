import { DEFAULT_TRUNK_PATTERNS } from "../../../src/stack/branches";
import type { PrListSource } from "../data/list";
import { DEFAULT_RELEASE_SETTINGS, type ReleaseCatalog, readReleaseSettings, type ReleaseSettings } from "../data/releases";
import type { Identity, PrSource } from "../data/model";
import type { TagStore } from "../data/tags";
import type { BackendService } from "../review/backend";
import type { SavedReviews } from "../review/saved";

/**
 * Backend (Azure Function) base URL baked in at build time from REVIEW_DECK_BACKEND_URL (extension/build.mjs), for
 * private builds. The published extension has none: each organization points it at its own backend (BackendSettings).
 */
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
  /** The Changelog hub's tag convention and publishing pipelines. */
  releases: ReleaseSettings;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { aiTitles: false, trunkBranches: DEFAULT_TRUNK_PATTERNS, autoRestack: false, releases: DEFAULT_RELEASE_SETTINGS };

/** Settings from storage, with anything missing or malformed at its default. */
export function readProjectSettings(saved: Partial<Record<keyof ProjectSettings, unknown>> | null | undefined): ProjectSettings {
  const trunks = Array.isArray(saved?.trunkBranches) ? saved.trunkBranches.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
  return {
    aiTitles: saved?.aiTitles === true,
    trunkBranches: trunks.length ? trunks : DEFAULT_TRUNK_PATTERNS,
    autoRestack: saved?.autoRestack === true,
    releases: readReleaseSettings(saved?.releases),
  };
}

/**
 * The organization's own backend, saved in Project settings → Review Deck by an organization administrator.
 * It overrides the build's BACKEND_URL. `key` is the backend's API_KEY (Terraform output api_key).
 */
export interface BackendSettings {
  url: string;
  key: string;
}

/** A backend URL as saved: https (or http on localhost, for a local `func start`), without a trailing slash or /api. */
export function normalizeBackendUrl(input: string): string {
  const url = new URL(input.trim());
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("The backend URL must start with https://");
  if (url.search || url.hash) throw new Error("The backend URL can't have a query or fragment");
  return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/api$/, "")}`;
}

/** Saved backend settings, or null when there are none or they're malformed. */
export function readBackendSettings(saved: unknown): BackendSettings | null {
  const s = saved as Partial<Record<keyof BackendSettings, unknown>> | null | undefined;
  if (typeof s?.url !== "string" || !s.url || typeof s.key !== "string") return null;
  try {
    return { url: normalizeBackendUrl(s.url), key: s.key };
  } catch {
    return null;
  }
}

/**
 * The two pages of the hub: the PR inbox, or one pull request. `project` (a name) is set when the hub
 * opens a PR from another project; that PR's page lives in its own project's hub.
 */
export type Route = { view: "hub" } | { view: "pr"; repo: string; pr: number; project?: string };

/**
 * Everything environment-specific the UI needs. `AdoHost` runs inside the Azure DevOps hub iframe;
 * `LocalHost` serves mock data for fast local iteration (npm run ext:dev).
 */
export interface AppHost {
  readonly kind: "ado" | "local";
  readonly currentUser: Identity;
  /** Separates cached hub data between organizations, projects and users that share a browser tab's storage. */
  readonly cacheScope: string;
  route(): Route;
  /** Updates the URL (shareable) and notifies subscribers. */
  navigate(route: Route): void;
  subscribe(listener: (route: Route) => void): () => void;
  listSource(): Promise<PrListSource>;
  /** The repository picked in the Repos breadcrumb, or null if none is (or the host has no such notion). */
  currentRepository(): Promise<{ id: string; name: string } | null>;
  prSource(route: Extract<Route, { view: "pr" }>): Promise<PrSource>;
  setTitle(title: string): void;
  /** The backend for embeddings and LLM titles, or null for structural grouping and heuristic titles. Never rejects. */
  backendService(): Promise<BackendService | null>;
  /** The organization's own backend, or null when it uses the build's (or none). Never rejects. */
  backendSettings(): Promise<BackendSettings | null>;
  /** Saves (or, with null, clears) the organization's backend; the UI offers it to organization administrators only. */
  saveBackendSettings(settings: BackendSettings | null): Promise<void>;
  /** Whether the user may change organization-wide settings (Azure DevOps: "Edit instance-level information"). False if unknown. */
  canManageOrganization(): Promise<boolean>;
  /** This project's settings. Resolves to the defaults (all off) when they can't be read, so a failure never turns AI on. */
  projectSettings(): Promise<ProjectSettings>;
  /**
   * Saves changed settings on top of the ones stored now, so sections of the settings page don't overwrite each
   * other, and resolves to the result. The UI offers it to project administrators only.
   */
  updateProjectSettings(change: Partial<ProjectSettings>): Promise<ProjectSettings>;
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
  /** Your starred repositories, kept per user across projects. */
  favoriteRepos(): FavoriteRepos;
  /** Git tags, pipeline runs and release descriptions, for the Changelog hub. Loaded on first use, so other pages don't carry it. */
  releases(): Promise<ReleaseCatalog>;
  /** The native Azure DevOps PR page, for "open in Azure DevOps" links. */
  nativePrUrl(route: Extract<Route, { view: "pr" }>): string | null;
  /** The native page for a file at a commit, for "View file" links. */
  fileUrl(route: Extract<Route, { view: "pr" }>, path: string, commit: string): string | null;
}

/** Starred repository ids. `load` resolves to none when they can't be read. */
export interface FavoriteRepos {
  load(): Promise<string[]>;
  save(ids: string[]): Promise<void>;
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
