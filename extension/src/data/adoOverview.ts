import type { WebApiTagDefinition } from "azure-devops-extension-api/Core";
import type { GitCommitRef, GitPullRequest, GitPullRequestCommentThread, GitPullRequestIteration } from "azure-devops-extension-api/Git";
import type { PolicyEvaluationRecord } from "azure-devops-extension-api/Policy";
import type { ResourceRef } from "azure-devops-extension-api/WebApi";
import { fromCompletionOptionsJson, isNoOne } from "./adoActions";
import { thread as threadFromJson } from "./mockSource";
import { asVote, type Identity, mergeStatusFromNumber, type PolicyState, type PolicyStatus, type PrOverview, type PrStatus, type Thread } from "./model";
import type { ThreadJson } from "./snapshot";

/** PolicyEvaluationStatus by number. */
const POLICY_STATE: PolicyState[] = ["queued", "running", "approved", "rejected", "notApplicable", "broken"];
const PR_STATUS: Record<number, PrStatus> = { 1: "active", 2: "abandoned", 3: "completed" };

/**
 * The REST reads behind a pull request's page, each bound to the PR (adoSource.ts binds them to the host's clients),
 * so the order the page gets its data in is testable without Azure DevOps.
 */
export interface OverviewReads {
  pullRequest(): Promise<GitPullRequest>;
  /** With each update's commits. */
  iterations(): Promise<GitPullRequestIteration[]>;
  threads(): Promise<GitPullRequestCommentThread[]>;
  commits(): Promise<GitCommitRef[]>;
  labels(): Promise<WebApiTagDefinition[]>;
  workItems(): Promise<ResourceRef[]>;
  policies(): Promise<PolicyEvaluationRecord[]>;
}

/** What the five later reads answered: the discussion, commits, tags, work items and checks. */
interface OverviewDetails {
  threads: GitPullRequestCommentThread[];
  commits: GitCommitRef[];
  labels: WebApiTagDefinition[];
  workItems: ResourceRef[];
  policies: PolicyEvaluationRecord[];
}

/**
 * One load of a pull request's page. Its seven REST calls start together, but the page gets to draw in two stages:
 * `partial` resolves once the PR and its updates are in (the title, description, reviewers, and the latest update
 * the Files tab opens on), and `full` once the threads, commits, tags, work items and policies have followed.
 * Azure DevOps answers each call in 250 to 500 ms, and the heavy ones (the threads of a long discussion, the
 * commits) can take longer still, so a page that waited for all seven sat on its skeleton for the slowest.
 */
export class OverviewLoad {
  readonly partial: Promise<PrOverview>;
  /** Rejects if any read but the policies failed. */
  readonly full: Promise<PrOverview>;
  private done = false;

  constructor(reads: OverviewReads) {
    const first = Promise.all([reads.pullRequest(), reads.iterations()]);
    // Policies can't always be read (permissions): the page shows none rather than failing.
    const details = Promise.all([reads.threads(), reads.commits(), reads.labels(), reads.workItems(), reads.policies().catch(() => [])]);
    this.partial = first.then(([pr, iterations]) => toOverview(pr, iterations, null));
    this.full = Promise.all([first, details]).then(([[pr, iterations], [threads, commits, labels, workItems, policies]]) =>
      toOverview(pr, iterations, { threads, commits, labels, workItems, policies }),
    );
    const settle = () => void (this.done = true);
    this.full.then(settle, settle);
    // A failure is reported through `full`, where it's awaited; these two share its causes.
    this.partial.catch(() => {});
    details.catch(() => {});
  }

  /** `full`, with `partial` handed to `onPartial` ahead of it, unless the load is already done (nothing to show first). */
  result(onPartial?: (overview: PrOverview) => void): Promise<PrOverview> {
    if (onPartial && !this.done) this.partial.then((overview) => !this.done && onPartial(overview), () => {});
    return this.full;
  }
}

/** The page's view of the REST answers; without `details` (still loading) the overview is marked partial. */
export function toOverview(pr: GitPullRequest, iterations: GitPullRequestIteration[], details: OverviewDetails | null): PrOverview {
  const overview: PrOverview = {
    pr: {
      id: pr.pullRequestId,
      title: pr.title,
      description: pr.description ?? "",
      status: PR_STATUS[pr.status] ?? "active",
      isDraft: !!pr.isDraft,
      createdBy: identity(pr.createdBy),
      creationDate: new Date(pr.creationDate),
      sourceBranch: pr.sourceRefName.replace(/^refs\/heads\//, ""),
      targetBranch: pr.targetRefName.replace(/^refs\/heads\//, ""),
      repository: {
        id: pr.repository.id,
        name: pr.repository.name,
        projectId: pr.repository.project.id,
        projectName: pr.repository.project.name,
      },
      reviewers: (pr.reviewers ?? []).map((r) => ({ ...identity(r), vote: asVote(r.vote), isRequired: !!r.isRequired })),
      labels: (details?.labels ?? []).filter((l) => l.active !== false).map((l) => l.name),
      headCommit: pr.lastMergeSourceCommit?.commitId ?? iterations.at(-1)?.sourceRefCommit.commitId ?? "",
      mergeStatus: mergeStatusFromNumber(pr.mergeStatus),
      autoCompleteSetBy: realIdentity(pr.autoCompleteSetBy),
      completionOptions: fromCompletionOptionsJson(pr.completionOptions),
      completionQueued: pr.completionQueueTime ? new Date(pr.completionQueueTime) : undefined,
      mergeFailure: pr.mergeFailureMessage || undefined,
      closedBy: realIdentity(pr.closedBy),
    },
    iterations: iterations.map((it) => ({
      id: it.id,
      createdDate: new Date(it.createdDate),
      author: identity(it.author),
      description: it.description ?? "",
      headCommit: it.sourceRefCommit.commitId,
      baseCommit: it.commonRefCommit.commitId,
      commitIds: (it.commits ?? []).map((c) => c.commitId),
    })),
    threads: toThreads(details?.threads ?? []),
    commits: (details?.commits ?? []).map((c) => ({
      id: c.commitId,
      message: c.comment,
      authorName: c.author?.name ?? "",
      authorEmail: c.author?.email ?? "",
      date: new Date(c.author?.date ?? Date.now()),
    })),
    policies: (details?.policies ?? []).map(policyStatus),
    workItems: (details?.workItems ?? []).map((w) => ({ id: w.id, url: w.url })),
  };
  if (!details) overview.partial = true;
  return overview;
}

/** A policy evaluation from the REST API, normalized; shared with the PR list's details. */
export function policyStatus(p: PolicyEvaluationRecord): PolicyStatus {
  return {
    id: p.evaluationId,
    name: p.configuration?.type?.displayName ?? "Policy",
    detail: typeof p.configuration?.settings?.displayName === "string" ? p.configuration.settings.displayName : undefined,
    state: POLICY_STATE[p.status] ?? "queued",
    blocking: !!p.configuration?.isBlocking,
  };
}

/** The live threads from the REST API, as the page's. */
export function toThreads(threads: GitPullRequestCommentThread[]): Thread[] {
  return threads.filter((t) => !t.isDeleted).map((t) => threadFromJson(toThreadJson(t)));
}

interface IdentityLike {
  id?: string;
  displayName?: string;
  uniqueName?: string;
  imageUrl?: string;
}

function identity(i: IdentityLike | undefined): Identity {
  return {
    id: i?.id ?? "",
    displayName: i?.displayName ?? "Unknown",
    uniqueName: i?.uniqueName ?? "",
    imageUrl: i?.imageUrl,
  };
}

/** Optional identities (auto-complete, closed by) are missing or the empty identity when unset. */
function realIdentity(i: IdentityLike | undefined): Identity | undefined {
  return isNoOne(i?.id) ? undefined : identity(i);
}

/** Converts a REST thread into the snapshot JSON shape, so one mapper (mockSource.thread) handles both. */
function toThreadJson(t: GitPullRequestCommentThread): ThreadJson {
  const date = (d: Date | string | undefined) => (d ? new Date(d).toISOString() : new Date(0).toISOString());
  return {
    pullRequestThreadContext: t.pullRequestThreadContext
      ? {
          changeTrackingId: t.pullRequestThreadContext.changeTrackingId,
          iterationContext: t.pullRequestThreadContext.iterationContext,
        }
      : undefined,
    id: t.id,
    publishedDate: date(t.publishedDate),
    lastUpdatedDate: date(t.lastUpdatedDate),
    status: t.status ?? 0,
    threadContext: t.threadContext
      ? {
          filePath: t.threadContext.filePath,
          leftFileStart: t.threadContext.leftFileStart ?? undefined,
          leftFileEnd: t.threadContext.leftFileEnd ?? undefined,
          rightFileStart: t.threadContext.rightFileStart ?? undefined,
          rightFileEnd: t.threadContext.rightFileEnd ?? undefined,
        }
      : undefined,
    comments: (t.comments ?? [])
      .filter((c) => !c.isDeleted)
      .map((c) => ({
        id: c.id,
        parentCommentId: c.parentCommentId,
        author: { ...identity(c.author) },
        content: c.content ?? "",
        publishedDate: date(c.publishedDate),
        lastUpdatedDate: date(c.lastUpdatedDate),
        commentType: c.commentType ?? 1,
        usersLiked: (c.usersLiked ?? []).map((u) => identity(u)),
      })),
    properties: (t.properties ?? {}) as ThreadJson["properties"],
  };
}
