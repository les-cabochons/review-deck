import type {
  Comment,
  GitAsyncRefOperationParameters,
  GitPullRequest,
  GitPullRequestCommentThread,
  GitRefFavorite,
  GitRestClient,
  IdentityRefWithVote,
  ShareNotificationContext,
} from "azure-devops-extension-api/Git";
import type { ArtifactFilter, NotificationRestClient, NotificationSubscriptionCreateParameters, SubscriptionQuery } from "azure-devops-extension-api/Notification";
import type { CompletionOptionsJson } from "./snapshot";
import {
  type CompletionOptions,
  type Identity,
  branchName,
  branchRef,
  isLineAnchor,
  MERGE_STRATEGIES,
  type MergeStrategy,
  type NewThread,
  type PrActions,
  type ThreadStatus,
} from "./model";

export type WriteClient = Pick<
  GitRestClient,
  | "createThread"
  | "createComment"
  | "updateThread"
  | "createPullRequestReviewer"
  | "getPullRequestReviewer"
  | "getPullRequestReviewers"
  | "deletePullRequestReviewer"
  | "createPullRequestLabel"
  | "deletePullRequestLabels"
  | "updatePullRequest"
  | "getRepository"
  | "sharePullRequest"
  | "getRefFavorites"
  | "createFavorite"
  | "deleteRefFavorite"
  | "getRefs"
  | "createCherryPick"
  | "getCherryPick"
>;

export type NotificationClient = Pick<NotificationRestClient, "querySubscriptions" | "createSubscription" | "deleteSubscription">;

// Enum values from azure-devops-extension-api, inlined: its enums are declared, not emitted.
/** RefFavoriteType.Ref */
const REF_FAVORITE = 2;
/** SubscriptionQueryFlags.IncludeFilterDetails */
const INCLUDE_FILTER_DETAILS = 8;
/** GitAsyncOperationStatus */
const OPERATION = { completed: 3, failed: 4, abandoned: 5 };
const CHERRY_PICK_POLL_MS = 1000;
const CHERRY_PICK_TIMEOUT_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const STATUS_NUMBER: Record<ThreadStatus, number> = {
  unknown: 0,
  active: 1,
  fixed: 2,
  wontFix: 3,
  closed: 4,
  byDesign: 5,
  pending: 6,
};

/** GitPullRequestMergeStrategy */
const STRATEGY_NUMBER: Record<MergeStrategy, number> = { noFastForward: 1, squash: 2, rebase: 3, rebaseMerge: 4 };
/** PullRequestStatus */
export const PR_STATUS_NUMBER = { active: 1, abandoned: 2, completed: 3 } as const;
/** The empty identity: what Azure DevOps returns for an unset auto-complete, and what clears it. */
const NO_ONE = "00000000-0000-0000-0000-000000000000";
export const isNoOne = (id: string | undefined): boolean => !id || id === NO_ONE;

export function fromCompletionOptionsJson(o: CompletionOptionsJson | null | undefined): CompletionOptions | undefined {
  if (!o) return undefined;
  const strategy = MERGE_STRATEGIES.find((m) => STRATEGY_NUMBER[m] === o.mergeStrategy) ?? (o.squashMerge ? "squash" : "noFastForward");
  return {
    mergeStrategy: strategy,
    deleteSourceBranch: !!o.deleteSourceBranch,
    transitionWorkItems: !!o.transitionWorkItems,
    mergeCommitMessage: o.mergeCommitMessage ?? "",
  };
}

/** The request body's completion options. Overriding policies needs a reason, and auto-complete never overrides. */
export function toCompletionOptionsJson(options: CompletionOptions, allowBypass: boolean): CompletionOptionsJson {
  const json: CompletionOptionsJson = {
    mergeStrategy: STRATEGY_NUMBER[options.mergeStrategy],
    deleteSourceBranch: options.deleteSourceBranch,
    transitionWorkItems: options.transitionWorkItems,
    mergeCommitMessage: options.mergeCommitMessage,
  };
  if (allowBypass && options.bypassReason !== undefined) {
    if (!options.bypassReason.trim()) throw new Error("Enter a reason for overriding the branch policies.");
    json.bypassPolicy = true;
    json.bypassReason = options.bypassReason.trim();
  }
  return json;
}

/** The "Require a merge strategy" (Limit merge types) branch policy. */
export const MERGE_POLICY_TYPE = "fa4e907d-c16b-4a4c-9dfa-4916e5d171ab";

export interface MergePolicy {
  isEnabled: boolean;
  isDeleted?: boolean;
  settings?: {
    scope?: { repositoryId?: string | null; refName?: string; matchKind?: string }[];
    useSquashMerge?: boolean;
    allowNoFastForward?: boolean;
    allowSquash?: boolean;
    allowRebase?: boolean;
    allowRebaseMerge?: boolean;
  };
}

const ALLOW_KEY = { noFastForward: "allowNoFastForward", squash: "allowSquash", rebase: "allowRebase", rebaseMerge: "allowRebaseMerge" } as const;

/** Merge types every merge policy covering this branch allows. No policy (or a nonsensical one) allows all. */
export function allowedStrategies(policies: MergePolicy[], repositoryId: string, targetBranch: string): MergeStrategy[] {
  const ref = `refs/heads/${targetBranch.replace(/^refs\/heads\//, "")}`;
  let allowed = [...MERGE_STRATEGIES];
  for (const policy of policies) {
    const settings = policy.settings ?? {};
    if (!policy.isEnabled || policy.isDeleted) continue;
    const covers = (settings.scope ?? []).some(
      (s) =>
        (!s.repositoryId || s.repositoryId === repositoryId) &&
        (!s.refName || (s.matchKind?.toLowerCase() === "prefix" ? ref.startsWith(s.refName) : ref === s.refName)),
    );
    if (!covers) continue;
    allowed = allowed.filter((m) => policyAllows(settings, m));
  }
  return allowed.length ? allowed : [...MERGE_STRATEGIES];
}

/** Current policies list the types they allow; older ones only say squash (true) or merge (false). */
function policyAllows(settings: NonNullable<MergePolicy["settings"]>, strategy: MergeStrategy): boolean {
  if (MERGE_STRATEGIES.some((m) => settings[ALLOW_KEY[m]] !== undefined)) return settings[ALLOW_KEY[strategy]] === true;
  if (settings.useSquashMerge !== undefined) return strategy === (settings.useSquashMerge ? "squash" : "noFastForward");
  return true;
}

export function requireContent(content: string): string {
  if (!content.trim()) throw new Error("Enter a comment before posting.");
  return content;
}

/** Base vs update N uses N on both sides. Azure DevOps interprets this as the common commit. */
export function threadPayload(input: NewThread): Partial<GitPullRequestCommentThread> {
  const payload: Partial<GitPullRequestCommentThread> = {
    comments: [{ parentCommentId: 0, content: requireContent(input.content), commentType: 1 } as Comment],
    status: 1,
  };
  if (input.file) {
    const { file, comparison } = input;
    const lines = isLineAnchor(file) ? file : null;
    if (
      !comparison ||
      comparison.changeTrackingId <= 0 ||
      comparison.iteration <= 0 ||
      comparison.compareTo < 0 ||
      comparison.compareTo >= comparison.iteration ||
      !file.path ||
      (lines && (lines.line < 1 || lines.endLine < lines.line))
    ) {
      throw new Error("The comment needs a valid file and update comparison. Reload the diff and try again.");
    }
    // A file-level comment is a file path with no positions.
    const start = lines && { line: lines.line, offset: 1 };
    const end = lines && { line: lines.endLine, offset: 1 };
    payload.threadContext = {
      filePath: `/${file.path.replace(/^\/+/, "")}`,
      leftFileStart: lines?.side === "left" ? start : null,
      leftFileEnd: lines?.side === "left" ? end : null,
      rightFileStart: lines?.side === "right" ? start : null,
      rightFileEnd: lines?.side === "right" ? end : null,
    } as GitPullRequestCommentThread["threadContext"];
    payload.pullRequestThreadContext = {
      changeTrackingId: comparison.changeTrackingId,
      iterationContext: {
        firstComparingIteration: comparison.compareTo || comparison.iteration,
        secondComparingIteration: comparison.iteration,
      },
    } as GitPullRequestCommentThread["pullRequestThreadContext"];
  }
  return payload;
}

/** Generated REST contracts require response fields on request bodies. Cast only at this boundary. */
export function createAdoActions(
  git: WriteClient,
  scope: { project: string; repo: string; pr: number },
  currentUser: Identity,
  reads: { searchReviewers: PrActions["searchReviewers"]; mergePolicies: () => Promise<MergePolicy[]>; notifications?: NotificationClient },
): PrActions {
  const { project, repo, pr } = scope;
  const update = (body: Record<string, unknown>) => git.updatePullRequest(body as unknown as GitPullRequest, repo, pr, project);
  // `repo` may be a name; favorites and follow subscriptions need the GUIDs.
  let repository: Promise<{ id: string; projectId: string }> | null = null;
  const repoIds = () => {
    repository ??= git.getRepository(repo, project).then((r) => ({ id: r.id, projectId: r.project.id }));
    repository.catch(() => (repository = null));
    return repository;
  };
  const favoriteOf = async (branch: string) => {
    const { id } = await repoIds();
    const favorites = await git.getRefFavorites(project, id, currentUser.id);
    return favorites.find((f) => f.type === REF_FAVORITE && f.name === branchRef(branch));
  };
  // Follow is a notification subscription on the artifact "{projectId}/{repoId}/{prId}".
  const followNotifications = () => {
    if (!reads.notifications) throw new Error("Following isn't available here.");
    return reads.notifications;
  };
  const followSubscription = async () => {
    const { id, projectId } = await repoIds();
    const artifactId = `${projectId}/${id}/${pr}`.toLowerCase();
    const query = { conditions: [{ subscriberId: currentUser.id, filter: { type: "Artifact" } }], queryFlags: INCLUDE_FILTER_DETAILS } as unknown as SubscriptionQuery;
    const subscriptions = await followNotifications().querySubscriptions(query);
    return subscriptions.find((s) => {
      const filter = s.filter as ArtifactFilter;
      return filter.artifactType === "PullRequestId" && filter.artifactId?.toLowerCase() === artifactId;
    });
  };
  return {
    async createThread(input) {
      await git.createThread(threadPayload(input) as GitPullRequestCommentThread, repo, pr, project);
    },
    async reply(threadId, parentId, content) {
      await git.createComment(
        { parentCommentId: parentId, content: requireContent(content), commentType: 1 } as Comment,
        repo,
        pr,
        threadId,
        project,
      );
    },
    async setThreadStatus(threadId, status) {
      await git.updateThread({ status: STATUS_NUMBER[status] } as GitPullRequestCommentThread, repo, pr, threadId, project);
    },
    async setVote(vote) {
      if (!currentUser.id) throw new Error("The signed-in user could not be identified.");
      const reviewers = await git.getPullRequestReviewers(repo, pr, project);
      const self = reviewers.find((reviewer) => reviewer.id === currentUser.id);
      await git.createPullRequestReviewer(
        { id: currentUser.id, vote, isRequired: !!self?.isRequired } as IdentityRefWithVote,
        repo, pr, currentUser.id, project,
      );
    },
    searchReviewers: reads.searchReviewers,
    async addReviewer(who, required) {
      await git.createPullRequestReviewer({ id: who.id, vote: 0, isRequired: required } as IdentityRefWithVote, repo, pr, who.id, project);
    },
    async setReviewerRequired(id, required) {
      // This endpoint is a PUT. Azure DevOps resets an omitted vote to zero.
      const reviewer = await git.getPullRequestReviewer(repo, pr, id, project);
      await git.createPullRequestReviewer({ id, vote: reviewer.vote, isRequired: required } as IdentityRefWithVote, repo, pr, id, project);
    },
    async removeReviewer(id) {
      await git.deletePullRequestReviewer(repo, pr, id, project);
    },
    async addTag(name) {
      if (!name.trim()) throw new Error("Enter a tag name.");
      await git.createPullRequestLabel({ name: name.trim() }, repo, pr, project);
    },
    async removeTag(name) {
      await git.deletePullRequestLabels(repo, pr, name, project);
    },
    async setDescription(description) {
      await update({ description });
    },
    async complete(options, headCommit) {
      if (!headCommit) throw new Error("The latest source commit is unknown. Refresh the pull request and try again.");
      await update({ status: PR_STATUS_NUMBER.completed, lastMergeSourceCommit: { commitId: headCommit }, completionOptions: toCompletionOptionsJson(options, true) });
    },
    async setAutoComplete(options) {
      if (!options) return void (await update({ autoCompleteSetBy: { id: NO_ONE } }));
      if (!currentUser.id) throw new Error("The signed-in user could not be identified.");
      await update({ autoCompleteSetBy: { id: currentUser.id }, completionOptions: toCompletionOptionsJson(options, false) });
    },
    async abandon() {
      await update({ status: PR_STATUS_NUMBER.abandoned });
    },
    async reactivate() {
      await update({ status: PR_STATUS_NUMBER.active });
    },
    async setDraft(isDraft) {
      await update({ isDraft });
    },
    async allowedMergeStrategies(repositoryId, targetBranch) {
      try {
        return allowedStrategies(await reads.mergePolicies(), repositoryId, targetBranch);
      } catch {
        return [...MERGE_STRATEGIES]; // Azure DevOps still enforces the policy when completing.
      }
    },
    async share(receivers, message) {
      if (!receivers.length) throw new Error("Add at least one person to share with.");
      await git.sharePullRequest({ message, receivers: receivers.map((r) => ({ id: r.id })) } as ShareNotificationContext, repo, pr, project);
    },
    async isFollowing() {
      return !!(await followSubscription());
    },
    async setFollowing(on) {
      const existing = await followSubscription();
      if (on && !existing) {
        const { id, projectId } = await repoIds();
        const filter = { type: "Artifact", artifactType: "PullRequestId", artifactId: `${projectId}/${id}/${pr}` };
        await followNotifications().createSubscription({ filter } as unknown as NotificationSubscriptionCreateParameters);
      } else if (!on && existing) await followNotifications().deleteSubscription(existing.id);
    },
    async isFavoriteBranch(branch) {
      return !!(await favoriteOf(branch));
    },
    async setFavoriteBranch(branch, on) {
      const existing = await favoriteOf(branch);
      if (on && !existing) {
        const { id } = await repoIds();
        await git.createFavorite({ name: branchRef(branch), repositoryId: id, type: REF_FAVORITE } as GitRefFavorite, project);
      } else if (!on && existing) await git.deleteRefFavorite(project, existing.id);
    },
    async searchBranches(query) {
      const refs = await git.getRefs(repo, project, "heads/", false, false, false, false, false, query.trim() || undefined);
      return refs.map((r) => branchName(r.name)).sort((a, b) => a.localeCompare(b));
    },
    async changeTarget(branch) {
      if (!branch.trim()) throw new Error("Pick a target branch.");
      await git.updatePullRequest({ targetRefName: branchRef(branch) } as GitPullRequest, repo, pr, project);
    },
    async cherryPick(onto, topic) {
      if (!onto.trim() || !topic.trim()) throw new Error("Pick a target branch and name the new branch.");
      const { id } = await repoIds();
      const params = { generatedRefName: branchRef(topic.trim()), ontoRefName: branchRef(onto), repository: { id }, source: { pullRequestId: pr } };
      let op = await git.createCherryPick(params as unknown as GitAsyncRefOperationParameters, project, id);
      const deadline = Date.now() + CHERRY_PICK_TIMEOUT_MS;
      while (op.status !== OPERATION.completed) {
        if (op.status === OPERATION.failed || op.status === OPERATION.abandoned) {
          const detail = op.detailedStatus;
          throw new Error(detail?.conflict ? "The changes conflict with the target branch. Cherry-pick them locally instead." : detail?.failureMessage || "The cherry-pick failed.");
        }
        if (Date.now() > deadline) throw new Error("The cherry-pick is taking too long. Check the branch later in Azure DevOps.");
        await sleep(CHERRY_PICK_POLL_MS);
        op = await git.getCherryPick(project, op.cherryPickId, id);
      }
    },
  };
}
