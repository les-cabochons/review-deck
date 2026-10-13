import { getClient } from "azure-devops-extension-api";
import { type GitPullRequestCommentThread, GitRestClient } from "azure-devops-extension-api/Git";
import { type PolicyEvaluationRecord, PolicyRestClient } from "azure-devops-extension-api/Policy";
import { IdentityServiceIds, type IVssIdentityService } from "azure-devops-extension-api/Identities";
import { getHost, getService } from "azure-devops-extension-sdk";
import type { IIdentity as PickerIdentity } from "azure-devops-ui/IdentityPicker";
import { createAdoActions } from "./adoActions";
import { thread as threadFromJson } from "./mockSource";
import {
  asVote,
  identityImageUrl,
  type ChangeType,
  type FileChange,
  type Identity,
  type PolicyState,
  type PolicyStatus,
  type PrOverview,
  type PrSource,
  type PrStatus,
  type PrActions,
  type Thread,
} from "./model";
import type { ThreadJson } from "./snapshot";

// VersionControlChangeType flags
const ADD = 1;
const DELETE = 16;
const RENAME = 8;
/** PolicyEvaluationStatus by number. */
const POLICY_STATE: PolicyState[] = ["queued", "running", "approved", "rejected", "notApplicable", "broken"];

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
const PR_STATUS: Record<number, PrStatus> = { 1: "active", 2: "abandoned", 3: "completed" };

interface IdentityLike {
  id?: string;
  displayName?: string;
  uniqueName?: string;
  imageUrl?: string;
}

/** Reads and writes a pull request through the host's authenticated REST clients. */
export class AdoPrSource implements PrSource {
  readonly kind = "ado";
  readonly actions: PrActions;
  private readonly git = getClient(GitRestClient);
  private readonly policy = getClient(PolicyRestClient);

  constructor(
    private readonly projectId: string,
    private readonly repositoryId: string,
    private readonly pullRequestId: number,
    readonly currentUser: Identity,
  ) {
    this.actions = createAdoActions(this.git, { project: projectId, repo: repositoryId, pr: pullRequestId }, currentUser, async (query) => {
      if (query.trim().length < 2) return [];
      const service = await getService<IVssIdentityService>(IdentityServiceIds.IdentityService);
      const results = await service.searchIdentitiesAsync(query.trim(), ["user", "group"]);
      return results
        .map((result) => {
          const person = result as PickerIdentity;
          // localId is the Azure DevOps identity GUID. originId belongs to the backing directory.
          return {
            id: person.localId ?? "",
            displayName: person.displayName ?? person.signInAddress ?? person.entityId,
            uniqueName: person.signInAddress ?? person.mail ?? "",
            imageUrl: identityImageUrl(person.image, `https://dev.azure.com/${encodeURIComponent(getHost().name)}/`),
          };
        })
        .filter((person) => !!person.id);
    });
  }

  async load(): Promise<PrOverview> {
    const { git, projectId: project, repositoryId: repo, pullRequestId: id } = this;
    const [pr, iterations, threads, commits, labels, workItems, policies] = await Promise.all([
      git.getPullRequest(repo, id, project),
      git.getPullRequestIterations(repo, id, project, true),
      git.getThreads(repo, id, project),
      git.getPullRequestCommits(repo, id, project),
      git.getPullRequestLabels(repo, id, project),
      git.getPullRequestWorkItemRefs(repo, id, project),
      this.policy.getPolicyEvaluations(project, `vstfs:///CodeReview/CodeReviewId/${project}/${id}`).catch(() => []),
    ]);
    return {
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
        labels: labels.filter((l) => l.active !== false).map((l) => l.name),
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
      threads: threads.filter((t) => !t.isDeleted).map((t) => threadFromJson(toThreadJson(t))),
      commits: commits.map((c) => ({
        id: c.commitId,
        message: c.comment,
        authorName: c.author?.name ?? "",
        authorEmail: c.author?.email ?? "",
        date: new Date(c.author?.date ?? Date.now()),
      })),
      policies: policies.map(policyStatus),
      workItems: workItems.map((w) => ({ id: w.id, url: w.url })),
    };
  }

  async getChanges(iteration: number, compareTo: number): Promise<FileChange[]> {
    const out: FileChange[] = [];
    for (let skip = 0; ; skip += 2000) {
      const page = await this.git.getPullRequestIterationChanges(
        this.repositoryId,
        this.pullRequestId,
        iteration,
        this.projectId,
        2000,
        skip,
        compareTo,
      );
      for (const c of page.changeEntries ?? []) {
        if (!c.item?.path || (c.item as { isFolder?: boolean }).isFolder) continue;
        const flags = c.changeType as number;
        const changeType: ChangeType = flags & ADD ? "add" : flags & DELETE ? "delete" : flags & RENAME ? "rename" : "edit";
        out.push({
          changeTrackingId: c.changeTrackingId,
          path: c.item.path.replace(/^\//, ""),
          originalPath: c.originalPath?.replace(/^\//, ""),
          changeType,
          oldObjectId: changeType === "add" ? undefined : c.item.originalObjectId,
          newObjectId: changeType === "delete" ? undefined : c.item.objectId,
        });
      }
      if (!page.nextSkip) break;
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async getBlob(objectId: string): Promise<string> {
    const buffer = await this.git.getBlobContent(this.repositoryId, objectId, this.projectId);
    return new TextDecoder().decode(buffer);
  }

  async getThreads(iteration: number, compareTo: number): Promise<Thread[]> {
    const threads = await this.git.getThreads(this.repositoryId, this.pullRequestId, this.projectId, iteration, compareTo || iteration);
    return threads.filter((t) => !t.isDeleted).map((t) => threadFromJson(toThreadJson(t)));
  }
}

function identity(i: IdentityLike | undefined): Identity {
  return {
    id: i?.id ?? "",
    displayName: i?.displayName ?? "Unknown",
    uniqueName: i?.uniqueName ?? "",
    imageUrl: i?.imageUrl,
  };
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
