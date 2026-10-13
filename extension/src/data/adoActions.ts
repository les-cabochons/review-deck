import type {
  Comment,
  GitPullRequest,
  GitPullRequestCommentThread,
  GitRestClient,
  IdentityRefWithVote,
} from "azure-devops-extension-api/Git";
import type { CompletionOptionsJson } from "./snapshot";
import {
  type CompletionOptions,
  type Identity,
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
>;

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
    if (
      !comparison ||
      comparison.changeTrackingId <= 0 ||
      comparison.iteration <= 0 ||
      comparison.compareTo < 0 ||
      comparison.compareTo >= comparison.iteration ||
      !file.path ||
      file.line < 1 ||
      file.endLine < file.line
    ) {
      throw new Error("The line comment needs a valid file and update comparison. Reload the diff and try again.");
    }
    const start = { line: file.line, offset: 1 };
    const end = { line: file.endLine, offset: 1 };
    payload.threadContext = {
      filePath: `/${file.path.replace(/^\/+/, "")}`,
      leftFileStart: file.side === "left" ? start : null,
      leftFileEnd: file.side === "left" ? end : null,
      rightFileStart: file.side === "right" ? start : null,
      rightFileEnd: file.side === "right" ? end : null,
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
  reads: { searchReviewers: PrActions["searchReviewers"]; mergePolicies: () => Promise<MergePolicy[]> },
): PrActions {
  const { project, repo, pr } = scope;
  const update = (body: Record<string, unknown>) => git.updatePullRequest(body as unknown as GitPullRequest, repo, pr, project);
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
  };
}
