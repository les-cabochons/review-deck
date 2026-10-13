import { asVote, type Identity, type PolicyStatus, type PrStatus, type Reviewer, type Thread } from "./model";
import type { PrListSnapshot } from "./listSnapshot";

/** One row in the PR hub. Optional fields are filled lazily (`details`) where the host API needs extra calls. */
export interface PrSummary {
  id: number;
  title: string;
  repository: { id: string; name: string; projectName: string };
  createdBy: Identity;
  creationDate: Date;
  updatedDate?: Date;
  closedDate?: Date;
  status: PrStatus;
  isDraft: boolean;
  sourceBranch: string;
  targetBranch: string;
  reviewers: Reviewer[];
  labels: string[];
  size?: { files: number; adds: number; dels: number };
  checks?: "passing" | "failing" | "pending" | "none";
  /** Active (unresolved) comment threads. */
  comments?: number;
  /**
   * Whether the target branch's blocking reviewer policies (minimum number of reviewers, required reviewers) pass;
   * "none" when no such policy applies. Builds, comments and merge conflicts don't count.
   */
  reviewPolicy?: "met" | "unmet" | "none";
  /** Latest auto-restack status the backend posted on the PR (backend/src/stacks), if any. */
  restack?: { state: "pending" | "succeeded" | "failed"; description: string; date: Date };
  /** False when the PR cannot be opened in this environment (local mode without a snapshot). */
  openable: boolean;
}

/** A team (or group) the current user belongs to; reviews requested from it count as requested from you. */
export interface MyGroup {
  id: string;
  name: string;
}

/** Hub row facts that come from the PR's policy evaluations; shared by the list (`details`) and the PR page. */
export function policyFacts(policies: Pick<PolicyStatus, "name" | "blocking" | "state">[]): Pick<PrSummary, "checks" | "reviewPolicy"> {
  const states = policies.filter((p) => /build/i.test(p.name)).map((p) => p.state);
  const checks: PrSummary["checks"] =
    states.length === 0
      ? "none"
      : states.some((s) => s === "rejected" || s === "broken")
        ? "failing"
        : states.some((s) => s === "queued" || s === "running")
          ? "pending"
          : "passing";
  const reviews = policies.filter((p) => p.blocking && /minimum number of reviewers|required reviewers/i.test(p.name) && p.state !== "notApplicable");
  const reviewPolicy: PrSummary["reviewPolicy"] = reviews.length === 0 ? "none" : reviews.every((p) => p.state === "approved") ? "met" : "unmet";
  return { checks, reviewPolicy };
}

/** Active (unresolved) human discussion threads, as counted in the hub. */
export function activeComments(threads: Pick<Thread, "status" | "kind">[]): number {
  return threads.filter((t) => t.kind === "comment" && (t.status === "active" || t.status === "pending")).length;
}

/** A row's details merged into the map of fetched details, as a new map for React state. */
export function withDetails(details: ReadonlyMap<number, Partial<PrSummary>>, id: number, extra: Partial<PrSummary>): Map<number, Partial<PrSummary>> {
  return new Map(details).set(id, { ...details.get(id), ...extra });
}

/** "review": only what decides a PR's section (its policies). "full": also comment counts and restack status. */
export type DetailScope = "review" | "full";

export interface PrListSource {
  readonly kind: "ado" | "mock";
  readonly currentUser: Identity;
  list(): Promise<PrSummary[]>;
  /** Teams the current user belongs to. */
  myGroups(): Promise<MyGroup[]>;
  /**
   * Extra per-PR facts that cost one or more API calls; called for visible rows only. "review" fetches only what
   * decides the PR's section (reviewPolicy, and checks from the same call), for your PRs in collapsed sections.
   */
  details?(pr: PrSummary, scope?: DetailScope): Promise<Partial<Pick<PrSummary, "checks" | "comments" | "size" | "restack" | "reviewPolicy">>>;
  /** Link to the native Azure DevOps page for creating a pull request, when available. */
  newPullRequestUrl?: string;
}

export class MockPrListSource implements PrListSource {
  readonly kind = "mock";
  readonly currentUser: Identity;
  private readonly rows: PrSummary[];
  private readonly groups: MyGroup[];
  /** PR id -> dev-data snapshot id */
  readonly snapshots = new Map<number, string>();
  /** The demo's default trunk patterns, so its synthetic stacks into uat and release/00-* read as stacks. */
  readonly trunkBranches?: string[];

  private constructor(list: PrListSnapshot) {
    this.currentUser = list.currentUser;
    this.trunkBranches = list.trunkBranches;
    this.groups = list.currentUserGroups ?? [];
    this.rows = list.pullRequests.map((p) => {
      if (p.snapshot) this.snapshots.set(p.pullRequestId, p.snapshot);
      return {
        id: p.pullRequestId,
        title: p.title,
        repository: { id: p.repository.id, name: p.repository.name, projectName: p.repository.project.name },
        createdBy: p.createdBy,
        creationDate: new Date(p.creationDate),
        updatedDate: new Date(p.updatedDate),
        closedDate: p.closedDate ? new Date(p.closedDate) : undefined,
        status: p.status === 2 ? "abandoned" : p.status === 3 ? "completed" : "active",
        isDraft: p.isDraft,
        sourceBranch: p.sourceRefName.replace(/^refs\/heads\//, ""),
        targetBranch: p.targetRefName.replace(/^refs\/heads\//, ""),
        reviewers: p.reviewers.map((r) => ({ ...r, vote: asVote(r.vote) })),
        labels: p.labels,
        size: p.size,
        checks: p.checks,
        comments: p.comments,
        restack: p.restack && { ...p.restack, date: new Date(p.restack.date) },
        openable: !!p.snapshot,
      };
    });
  }

  static async fetch(url: string): Promise<MockPrListSource> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load the mock PR list ${url}: ${res.status}. Run npm run ext:mock.`);
    return new MockPrListSource((await res.json()) as PrListSnapshot);
  }

  async list(): Promise<PrSummary[]> {
    return this.rows.map((r) => ({ ...r, reviewers: r.reviewers.map((x) => ({ ...x })) }));
  }

  async myGroups(): Promise<MyGroup[]> {
    return this.groups;
  }

  /** In-memory tag rename (to a name) or deletion (null) across the demo's pull requests. */
  replaceLabel(from: string, to: string | null): void {
    const key = from.toLowerCase();
    for (const row of this.rows) {
      const kept = row.labels.filter((l) => l.toLowerCase() !== key);
      if (kept.length !== row.labels.length) row.labels = to ? [...kept, to] : kept;
    }
  }

  /** Every label on the demo's pull requests. */
  get labels(): string[] {
    return this.rows.flatMap((r) => r.labels);
  }
}

// ---------- inbox sections (Graphite-style) ----------

export type SectionId = "needs-review" | "returned" | "approved" | "waiting" | "drafts" | "reviewed" | "completed" | "other";

export interface InboxSection {
  id: SectionId;
  title: string;
  /** Shown when the section is empty. */
  empty: string;
  prs: PrSummary[];
}

export const SECTION_META: Record<SectionId, { title: string; empty: string; icon: string }> = {
  "needs-review": { title: "Needs your review", empty: "Nothing waiting on you.", icon: "ReviewSolid" },
  returned: { title: "Returned to you", empty: "No changes requested on your pull requests.", icon: "Reply" },
  approved: { title: "Approved", empty: "None of your pull requests are approved yet.", icon: "CompletedSolid" },
  waiting: { title: "Waiting for review", empty: "None of your pull requests are waiting.", icon: "Clock" },
  drafts: { title: "Drafts", empty: "No drafts.", icon: "EditNote" },
  reviewed: { title: "You reviewed", empty: "No open pull requests you have voted on.", icon: "Accept" },
  completed: { title: "Recently completed", empty: "Nothing completed recently.", icon: "BranchMerged" },
  other: { title: "Other active", empty: "No other active pull requests.", icon: "BranchPullRequest" },
};

export const SECTION_ORDER: SectionId[] = ["needs-review", "returned", "approved", "waiting", "drafts", "reviewed", "completed", "other"];

/** Your teams that were asked to review this PR. */
export function requestedVia(pr: PrSummary, groups: ReadonlySet<string>): Reviewer[] {
  return pr.reviewers.filter((r) => groups.has(r.id));
}

/**
 * Assigns each PR to the first matching section. A review requested from one of your teams counts as
 * requested from you until you vote yourself (Azure DevOps then adds you as a reviewer with your vote).
 */
export function sectionOf(pr: PrSummary, me: Identity, groups: ReadonlySet<string> = new Set()): SectionId {
  const mine = pr.createdBy.id === me.id;
  const myVote = pr.reviewers.find((r) => r.id === me.id);
  if (pr.status !== "active") return "completed";
  if (mine) {
    if (pr.isDraft) return "drafts";
    if (pr.reviewers.some((r) => r.vote < 0)) return "returned";
    if (reviewsDone(pr, groups)) return "approved";
    return "waiting";
  }
  if (pr.isDraft) return "other";
  if (myVote && myVote.vote !== 0) return "reviewed";
  if (myVote || requestedVia(pr, groups).length > 0) return "needs-review";
  return "other";
}

/**
 * True when the PR needs no more reviews, even if it can't merge yet (failing build, conflicts): every required
 * reviewer approved, and the branch's reviewer policies pass, or without them at least one other person approved.
 */
function reviewsDone(pr: PrSummary, groups: ReadonlySet<string>): boolean {
  const approves = (r: Reviewer) => r.vote >= 5;
  if (!pr.reviewers.filter((r) => r.isRequired).every(approves)) return false;
  if (pr.reviewPolicy && pr.reviewPolicy !== "none") return pr.reviewPolicy === "met";
  return pr.reviewers.some((r) => approves(r) && !groups.has(r.id));
}

export function involvesMe(pr: PrSummary, me: Identity, groups: ReadonlySet<string>): boolean {
  return pr.createdBy.id === me.id || pr.reviewers.some((r) => r.id === me.id || groups.has(r.id));
}

export function inboxSections(prs: PrSummary[], me: Identity, groups: ReadonlySet<string> = new Set()): InboxSection[] {
  const buckets = new Map<SectionId, PrSummary[]>(SECTION_ORDER.map((id) => [id, []]));
  for (const pr of prs) {
    const section = sectionOf(pr, me, groups);
    // Completed PRs only matter when they involve you.
    if (section === "completed" && !involvesMe(pr, me, groups)) continue;
    buckets.get(section)!.push(pr);
  }
  const recency = (p: PrSummary) => (p.updatedDate ?? p.closedDate ?? p.creationDate).getTime();
  return SECTION_ORDER.map((id) => ({
    id,
    ...SECTION_META[id],
    prs: buckets.get(id)!.sort((a, b) => recency(b) - recency(a)),
  }));
}

/** Case-insensitive match on title, number, author, branches, repository and tags. */
export function matchesQuery(pr: PrSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    pr.title,
    `#${pr.id}`,
    `!${pr.id}`,
    String(pr.id),
    pr.createdBy.displayName,
    pr.createdBy.uniqueName,
    pr.sourceBranch,
    pr.targetBranch,
    pr.repository.name,
    ...pr.labels,
  ]
    .join("\n")
    .toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}
