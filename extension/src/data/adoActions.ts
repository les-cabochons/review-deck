import type {
  Comment,
  GitPullRequest,
  GitPullRequestCommentThread,
  GitRestClient,
  IdentityRefWithVote,
} from "azure-devops-extension-api/Git";
import type { Identity, NewThread, PrActions, ThreadStatus } from "./model";

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
  searchReviewers: PrActions["searchReviewers"],
): PrActions {
  const { project, repo, pr } = scope;
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
    searchReviewers,
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
      await git.updatePullRequest({ description } as GitPullRequest, repo, pr, project);
    },
  };
}
