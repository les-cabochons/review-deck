import { asVote, type Identity, type PrStatus, type Reviewer } from "./model";
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
  /** False when the PR cannot be opened in this environment (local mode without a snapshot). */
  openable: boolean;
}

/** A team (or group) the current user belongs to; reviews requested from it count as requested from you. */
export interface MyGroup {
  id: string;
  name: string;
}

export interface PrListSource {
  readonly kind: "ado" | "mock";
  readonly currentUser: Identity;
  list(): Promise<PrSummary[]>;
  /** Teams the current user belongs to. */
  myGroups(): Promise<MyGroup[]>;
  /** Extra per-PR facts that cost one or more API calls; called for visible rows only. */
  details?(pr: PrSummary): Promise<Partial<Pick<PrSummary, "checks" | "comments" | "size">>>;
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

  private constructor(list: PrListSnapshot) {
    this.currentUser = list.currentUser;
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
    if (pr.reviewers.some((r) => r.vote >= 5 && !groups.has(r.id))) return "approved";
    return "waiting";
  }
  if (pr.isDraft) return "other";
  if (myVote && myVote.vote !== 0) return "reviewed";
  if (myVote || requestedVia(pr, groups).length > 0) return "needs-review";
  return "other";
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
