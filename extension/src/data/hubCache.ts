import { activeComments, type MyGroup, policyFacts, type PrSummary, withDetails } from "./list";
import type { PrOverview } from "./model";
import type { PrSkeletonHint } from "../skeletons";

/**
 * What the hub last showed, so coming back to it, reloading, or opening it in a new tab paints at once while it
 * refreshes. Kept in memory and in localStorage, per host scope (organization, project and user), and ignored
 * once it is many hours old.
 */
export interface HubSnapshot {
  prs: PrSummary[];
  details: Map<number, Partial<PrSummary>>;
  groups: MyGroup[];
  /** When the list was fetched (not when it was saved), so old data ages out even while refreshes fail. */
  listedAt: number;
  /** The hub's repository choice (JSON of a RepoSelection) the list was fetched for. */
  selection: string;
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
/** Opened the next morning, the hub shows a skeleton rather than yesterday's inbox. */
const MAX_AGE_MS = 12 * 3_600_000;
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

export function writeHubSnapshot(scope: string, snap: HubSnapshot, storage: () => SnapshotStorage = browserStore): void {
  memory.set(scope, snap);
  try {
    storage().setItem(`${KEY}:${scope}`, JSON.stringify({ ...snap, details: [...snap.details] }));
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
  const json = JSON.parse(raw) as { prs?: unknown; details?: unknown; groups?: unknown; listedAt?: unknown; selection?: unknown };
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
