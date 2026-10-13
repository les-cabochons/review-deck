// JSON shape of an offline PR snapshot (local dev mode). Mirrors the Azure DevOps REST
// models loosely (dates as ISO strings, enums as numbers) so the same view code renders both.

/** Completion options as Azure DevOps stores them on a pull request (older ones only set squashMerge). */
export interface CompletionOptionsJson {
  mergeStrategy?: number;
  squashMerge?: boolean;
  deleteSourceBranch?: boolean;
  transitionWorkItems?: boolean;
  mergeCommitMessage?: string;
  bypassPolicy?: boolean;
  bypassReason?: string;
}

export interface IdentityJson {
  id: string;
  displayName: string;
  uniqueName: string;
  imageUrl?: string;
}

export interface CommentJson {
  id: number;
  parentCommentId: number;
  author: IdentityJson;
  content: string;
  publishedDate: string;
  lastUpdatedDate: string;
  /** 1 text, 3 system */
  commentType: number;
  usersLiked: IdentityJson[];
}

export interface PositionJson {
  line: number;
  offset: number;
}

export interface ThreadJson {
  pullRequestThreadContext?: {
    changeTrackingId: number;
    iterationContext: { firstComparingIteration: number; secondComparingIteration: number };
  };
  id: number;
  publishedDate: string;
  lastUpdatedDate: string;
  /** CommentThreadStatus: 0 unknown, 1 active, 2 fixed, 3 won't fix, 4 closed, 5 by design, 6 pending */
  status: number;
  threadContext?: {
    filePath: string;
    leftFileStart?: PositionJson;
    leftFileEnd?: PositionJson;
    rightFileStart?: PositionJson;
    rightFileEnd?: PositionJson;
  };
  comments: CommentJson[];
  properties: Record<string, { $type: string; $value: string }>;
}

export interface PrSnapshot {
  source: { github: string; note: string };
  pullRequest: {
    pullRequestId: number;
    title: string;
    description: string;
    /** PullRequestStatus: 1 active, 2 abandoned, 3 completed */
    status: number;
    isDraft: boolean;
    createdBy: IdentityJson;
    creationDate: string;
    sourceRefName: string;
    targetRefName: string;
    mergeStatus: number;
    repository: { id: string; name: string; project: { id: string; name: string } };
    reviewers: (IdentityJson & { vote: number; isRequired: boolean })[];
    labels: { id: string; name: string; active: boolean }[];
    lastMergeSourceCommit?: { commitId: string };
    autoCompleteSetBy?: IdentityJson;
    completionOptions?: CompletionOptionsJson;
    closedBy?: IdentityJson;
    completionQueueTime?: string;
    mergeFailureMessage?: string;
  };
  iterations: {
    id: number;
    author: IdentityJson;
    createdDate: string;
    updatedDate: string;
    description: string;
    sourceRefCommit: { commitId: string };
    commonRefCommit: { commitId: string };
    targetRefCommit: { commitId: string };
    commits: { commitId: string; comment: string }[];
    reason: number;
  }[];
  /** Iteration id ("0" = base) -> repo path ("/a/b.ts") -> blob id, for every path the PR touches. */
  trees: Record<string, Record<string, string>>;
  /** New path -> old path for renames (base -> latest). */
  renames: Record<string, string>;
  blobs: Record<string, string>;
  threads: ThreadJson[];
  commits: { commitId: string; comment: string; author: { name: string; email: string; date: string } }[];
  workItems: { id: string; url: string; title?: string }[];
  policies: {
    evaluationId: string;
    status: string;
    configuration: { isBlocking: boolean; type: { displayName: string }; settings: Record<string, unknown> };
  }[];
}
