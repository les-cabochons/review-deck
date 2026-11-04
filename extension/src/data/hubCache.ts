import { activeComments, type DetailRecord, type MyGroup, policyFacts, type PrSummary, withDetails } from "./list";
import type { PrOverview } from "./model";
import { isAll, parseSelection } from "./repoSelection";
import type { PrSkeletonHint } from "../skeletons";

/**
 * What the hub last showed, so coming back to it, reloading, or opening it in a new tab paints at once while it
 * refreshes. Kept in memory and in localStorage, per host scope (organization, project and user), and ignored
 * once it is a month old.
 */
export interface HubSnapshot {
  prs: PrSummary[];
  details: Map<number, Partial<PrSummary>>;
  groups: MyGroup[];
  /** When the list was fetched (not when it was saved), so old data ages out even while refreshes fail. */
  listedAt: number;
  /** The hub's repository choice (JSON of a RepoSelection) the list was fetched for. */
  selection: string;
  /** When each row's details were fetched (ui/hub/detailsDue.ts). Missing from snapshots saved before November 4, 2026. */
  fetched?: Map<number, DetailRecord>;
}

/** The fields the PR page knows fresher than the hub: one row, and the facts `details` would fetch. */
export interface HubPatch {
  id: number;
  row: Partial<PrSummary>;
  details: Partial<PrSummary>;
  /** A hub list requested before this is older than the patch, so the patch wins. */
  loadedAt: number;
}

type SnapshotStorage = Pick<Storage, "getItem" | "setItem">;

const KEY = "review-deck.hub.v1";
/**
 * How old a kept list (and a kept PR, prCache.ts) may be and still paint first. The refresh that follows replaces
 * it whatever its age, and nothing acts on it meanwhile, so the limit only keeps a refresh that fails from leaving
 * months-old rows on screen, and a project not opened in a month from starting on its last state.
 */
export const MAX_AGE_MS = 30 * 86_400_000;
const browserStore = () => window.localStorage;

const memory = new Map<string, HubSnapshot>();
const patches = new Map<string, Map<number, HubPatch>>();
const listeners = new Map<string, Set<(patch: HubPatch) => void>>();

export function readHubSnapshot(scope: string, storage: () => SnapshotStorage = browserStore, now = Date.now()): HubSnapshot | null {
  let snap = memory.get(scope) ?? null;
  if (!snap) {
    try {
      const raw = storage().getItem(`${KEY}:${scope}`);
      if (raw) snap = parse(raw);
    } catch {
      snap = null;
    }
  }
  return snap && now - snap.listedAt < MAX_AGE_MS ? snap : null;
}

/**
 * How old the kept list may be and still stand in for the API on a PR page's stack bar. The hub lists again each
 * time it's shown, so a PR opened from one of its rows has a list as old as the reader's stay on the hub, mostly
 * seconds. Five minutes covers a long stay. A PR page reloaded or linked to later than that asks the API as
 * before, since a layer may well have merged by then. Stacks change when a PR is created, retargeted or closed,
 * far less often than what the rows' details track, so this is longer than DETAILS_FRESH_MS.
 */
export const STACK_FROM_LIST_MS = 5 * 60_000;

/**
 * The kept list, for a PR page to find `prId`'s stack in instead of listing the project again. It stands in when
 * it was listed within STACK_FROM_LIST_MS, lists the PR, and its repository choice took in the PR's whole
 * repository (a stack is PRs of one repository, src/stack/stacks.ts), so every layer is in it. Null otherwise, and
 * the API answers as before. Starred repositories aren't named in the choice, so a list of favorites doesn't vouch
 * for one.
 */
export function listAroundPr(snap: HubSnapshot | null, prId: number, now = Date.now()): HubSnapshot | null {
  if (!snap || now - snap.listedAt >= STACK_FROM_LIST_MS) return null;
  const pr = snap.prs.find((p) => p.id === prId);
  const choice = parseSelection(snap.selection);
  if (!pr || !choice) return null;
  const covered = isAll(choice) || choice.projects.includes(pr.repository.projectId) || choice.repos.includes(pr.repository.id);
  return covered ? snap : null;
}

/**
 * What the hub shows now, held for this page only. A PR opened from it right away draws from its row before
 * writeHubSnapshot's slower save to the browser's storage has run.
 */
export function holdHubSnapshot(scope: string, snap: HubSnapshot): void {
  memory.set(scope, snap);
}

export function writeHubSnapshot(scope: string, snap: HubSnapshot, storage: () => SnapshotStorage = browserStore): void {
  memory.set(scope, snap);
  try {
    storage().setItem(`${KEY}:${scope}`, JSON.stringify({ ...snap, details: [...snap.details], fetched: [...(snap.fetched ?? [])] }));
  } catch {
    // Full or denied storage: the in-memory copy still covers navigation within the page.
  }
}

/**
 * What the hub already knows about one pull request, for its page's skeleton while the real data loads: only
 * the id when the PR isn't in the cached list.
 */
export function prSkeletonHint(scope: string, id: number, storage: () => SnapshotStorage = browserStore): PrSkeletonHint {
  const pr = readHubSnapshot(scope, storage)?.prs.find((p) => p.id === id);
  if (!pr) return { id };
  return {
    id,
    title: pr.title,
    repo: pr.repository.name,
    author: pr.createdBy,
    sourceBranch: pr.sourceBranch,
    targetBranch: pr.targetBranch,
    status: pr.isDraft && pr.status === "active" ? "draft" : pr.status,
  };
}

/**
 * The PR's page as its hub row knows it, so opening it from the hub draws the real page at once instead of a
 * skeleton: the title, description, status, author, branches and reviewers. It is a partial overview (PrOverview),
 * like the PR and its updates ahead of the rest, but without the updates either, so the Files tab waits for them.
 * Null when the hub didn't list the PR. The tags wait like the rest, because the partial that follows has none yet.
 */
export function prFromRow(scope: string, id: number, storage: () => SnapshotStorage = browserStore): PrOverview | null {
  const row = readHubSnapshot(scope, storage)?.prs.find((p) => p.id === id);
  if (!row) return null;
  return {
    pr: {
      id,
      title: row.title,
      description: row.description ?? "",
      status: row.status,
      isDraft: row.isDraft,
      createdBy: row.createdBy,
      creationDate: row.creationDate,
      sourceBranch: row.sourceBranch,
      targetBranch: row.targetBranch,
      repository: row.repository,
      reviewers: row.reviewers,
      labels: [],
      // Only the buttons read these, and they wait for the load.
      headCommit: "",
      mergeStatus: "notSet",
    },
    iterations: [],
    threads: [],
    commits: [],
    policies: [],
    workItems: [],
    partial: true,
  };
}

/** The PR page's latest view of one PR, as a hub patch. */
export function hubPatch(overview: PrOverview, loadedAt = Date.now()): HubPatch {
  const { pr, threads, policies } = overview;
  return {
    id: pr.id,
    row: {
      title: pr.title,
      status: pr.status,
      isDraft: pr.isDraft,
      sourceBranch: pr.sourceBranch,
      targetBranch: pr.targetBranch,
      reviewers: pr.reviewers,
      labels: pr.labels,
    },
    details: { comments: activeComments(threads), ...policyFacts(policies) },
    loadedAt,
  };
}

/**
 * Records what the PR page just loaded (after opening it, or after a vote or another change), so the hub shows
 * the PR in its new section straight away instead of moving it once its own refresh lands.
 */
export function rememberPr(scope: string, patch: HubPatch, storage: () => SnapshotStorage = browserStore): void {
  let byId = patches.get(scope);
  if (!byId) patches.set(scope, (byId = new Map()));
  byId.set(patch.id, patch);
  const snap = readHubSnapshot(scope, storage);
  if (snap?.prs.some((p) => p.id === patch.id)) {
    writeHubSnapshot(
      scope,
      { ...snap, prs: applyPatches(snap.prs, [patch]), details: withDetails(snap.details, patch.id, patch.details) },
      storage,
    );
  }
  for (const l of listeners.get(scope) ?? []) l(patch);
}

export function onHubPatch(scope: string, listener: (patch: HubPatch) => void): () => void {
  let set = listeners.get(scope);
  if (!set) listeners.set(scope, (set = new Set()));
  set.add(listener);
  return () => set.delete(listener);
}

/** A freshly listed page of PRs, with any PR page changes made after the list was requested laid on top. */
export function withRecentPatches(scope: string, prs: PrSummary[], requestedAt: number): PrSummary[] {
  return applyPatches(prs, [...(patches.get(scope)?.values() ?? [])].filter((p) => p.loadedAt > requestedAt));
}

export function applyPatches(prs: PrSummary[], list: HubPatch[]): PrSummary[] {
  if (list.length === 0) return prs;
  const byId = new Map(list.map((p) => [p.id, p]));
  return prs.map((p) => {
    const patch = byId.get(p.id);
    if (!patch) return p;
    const closing = patch.row.status && patch.row.status !== "active" && !p.closedDate;
    return { ...p, ...patch.row, ...(closing ? { closedDate: new Date(patch.loadedAt) } : {}) };
  });
}

function parse(raw: string): HubSnapshot | null {
  const json = JSON.parse(raw) as { prs?: unknown; details?: unknown; groups?: unknown; listedAt?: unknown; selection?: unknown; fetched?: unknown };
  if (!Array.isArray(json.prs) || !Array.isArray(json.details) || !Array.isArray(json.groups) || typeof json.listedAt !== "number" || typeof json.selection !== "string")
    return null;
  return {
    prs: (json.prs as PrSummary[]).map((p) => ({
      ...withDates(p),
      creationDate: new Date(p.creationDate),
      updatedDate: p.updatedDate && new Date(p.updatedDate),
      closedDate: p.closedDate && new Date(p.closedDate),
    })),
    details: new Map((json.details as [number, Partial<PrSummary>][]).map(([id, d]) => [id, withDates(d)])),
    groups: json.groups as MyGroup[],
    listedAt: json.listedAt,
    selection: json.selection,
    fetched: new Map(Array.isArray(json.fetched) ? (json.fetched as [number, DetailRecord][]) : []),
  };
}

function withDates<T extends Partial<PrSummary>>(p: T): T {
  return p.restack ? { ...p, restack: { ...p.restack, date: new Date(p.restack.date) } } : p;
}

/** Tests only. */
export function resetHubCache(): void {
  memory.clear();
  patches.clear();
  listeners.clear();
}
