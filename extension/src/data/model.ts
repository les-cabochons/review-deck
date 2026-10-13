// Normalized view model for the review page. Both the Azure DevOps REST source and the
// offline snapshot source produce these shapes, so views never see raw REST types.

export interface Identity {
  id: string;
  displayName: string;
  uniqueName: string;
  imageUrl?: string;
}

/** Picker images may be relative to the Azure DevOps host, not the extension iframe. */
export function identityImageUrl(image: string | undefined, hostUrl: string): string | undefined {
  return image ? new URL(image, hostUrl).href : undefined;
}

/** Azure DevOps vote values: 10 approved, 5 approved with suggestions, 0 none, -5 waiting for author, -10 rejected. */
export type Vote = 10 | 5 | 0 | -5 | -10;

export interface Reviewer extends Identity {
  vote: Vote;
  isRequired: boolean;
}

export type PrStatus = "active" | "abandoned" | "completed";

/** Azure DevOps merge types: merge (no fast-forward), squash, rebase and fast-forward, rebase with merge commit. */
export type MergeStrategy = "noFastForward" | "squash" | "rebase" | "rebaseMerge";
export const MERGE_STRATEGIES: MergeStrategy[] = ["noFastForward", "squash", "rebase", "rebaseMerge"];

/** Azure DevOps' merge check for the source and target branches. */
export type MergeStatus = "notSet" | "queued" | "conflicts" | "succeeded" | "rejectedByPolicy" | "failure";

export interface CompletionOptions {
  mergeStrategy: MergeStrategy;
  deleteSourceBranch: boolean;
  transitionWorkItems: boolean;
  mergeCommitMessage: string;
  /** Completes despite unmet required policies; Azure DevOps records the reason. Ignored by auto-complete. */
  bypassReason?: string;
}

export interface PullRequest {
  id: number;
  title: string;
  description: string;
  status: PrStatus;
  isDraft: boolean;
  createdBy: Identity;
  creationDate: Date;
  sourceBranch: string;
  targetBranch: string;
  repository: { id: string; name: string; projectId: string; projectName: string };
  reviewers: Reviewer[];
  labels: string[];
  /** The source head as of this load. Completing sends it, so a push since then makes Azure DevOps refuse the merge. */
  headCommit: string;
  mergeStatus: MergeStatus;
  /** Set once completion is requested: Azure DevOps merges in the background and the PR stays active until it's done. */
  completionQueued?: Date;
  /** Why the last merge attempt failed, from Azure DevOps. */
  mergeFailure?: string;
  /** Set while auto-complete is on: it completes the PR with `completionOptions` once policies pass. */
  autoCompleteSetBy?: Identity;
  completionOptions?: CompletionOptions;
  closedBy?: Identity;
}

export interface Iteration {
  id: number;
  createdDate: Date;
  author: Identity;
  description: string;
  headCommit: string;
  baseCommit: string;
  commitIds: string[];
}

export type ChangeType = "add" | "edit" | "delete" | "rename";

export interface FileChange {
  changeTrackingId?: number;
  /** Repo path without the leading slash. */
  path: string;
  originalPath?: string;
  changeType: ChangeType;
  oldObjectId?: string;
  newObjectId?: string;
}

export interface Comment {
  id: number;
  parentId: number;
  author: Identity;
  content: string;
  published: Date;
  isSystem: boolean;
  likes: number;
}

export type ThreadStatus = "active" | "fixed" | "wontFix" | "closed" | "byDesign" | "pending" | "unknown";

export interface FileAnchor {
  /** Repo path without the leading slash. */
  path: string;
  side: "left" | "right";
  line: number;
  endLine: number;
}

export interface Thread {
  iterationContext?: { firstComparingIteration: number; secondComparingIteration: number };
  id: number;
  status: ThreadStatus;
  published: Date;
  updated: Date;
  comments: Comment[];
  file?: FileAnchor;
  /** "comment" = human discussion; "vote"/"system" = events rendered in the timeline only. */
  kind: "comment" | "vote" | "system";
  vote?: Vote;
}

export interface Commit {
  id: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: Date;
}

export type PolicyState = "approved" | "rejected" | "running" | "queued" | "notApplicable" | "broken";

export interface PolicyStatus {
  id: string;
  name: string;
  detail?: string;
  state: PolicyState;
  blocking: boolean;
}

export interface WorkItemRef {
  id: string;
  url: string;
  title?: string;
}

export interface PrOverview {
  pr: PullRequest;
  iterations: Iteration[];
  threads: Thread[];
  commits: Commit[];
  policies: PolicyStatus[];
  workItems: WorkItemRef[];
}

export interface NewThread {
  content: string;
  file?: FileAnchor;
  comparison?: { iteration: number; compareTo: number; changeTrackingId: number };
}

export interface PrActions {
  createThread(input: NewThread): Promise<void>;
  reply(threadId: number, parentId: number, content: string): Promise<void>;
  setThreadStatus(threadId: number, status: ThreadStatus): Promise<void>;
  setVote(vote: Vote): Promise<void>;
  searchReviewers(query: string): Promise<Identity[]>;
  addReviewer(who: Identity, required: boolean): Promise<void>;
  setReviewerRequired(id: string, required: boolean): Promise<void>;
  removeReviewer(id: string): Promise<void>;
  addTag(name: string): Promise<void>;
  removeTag(name: string): Promise<void>;
  setDescription(description: string): Promise<void>;
  /** Queues the merge into the target branch, provided the source head is still `headCommit`. */
  complete(options: CompletionOptions, headCommit: string): Promise<void>;
  /** Turns auto-complete on with these options, or off with null. */
  setAutoComplete(options: CompletionOptions | null): Promise<void>;
  abandon(): Promise<void>;
  reactivate(): Promise<void>;
  setDraft(isDraft: boolean): Promise<void>;
  /** Merge types the target branch's policies allow; all of them when none limit it or they can't be read. */
  allowedMergeStrategies(repositoryId: string, targetBranch: string): Promise<MergeStrategy[]>;
}

/** Both sources implement the same read and write contracts. */
export interface PrSource {
  readonly kind: "ado" | "mock";
  readonly currentUser: Identity;
  readonly actions: PrActions;
  load(): Promise<PrOverview>;
  /** Changes between iteration `compareTo` (0 = PR base) and iteration `iteration`. */
  getChanges(iteration: number, compareTo: number): Promise<FileChange[]>;
  getBlob(objectId: string): Promise<string>;
  getThreads(iteration: number, compareTo: number): Promise<Thread[]>;
}

const MERGE_STATUS: MergeStatus[] = ["notSet", "queued", "conflicts", "succeeded", "rejectedByPolicy", "failure"];
export const mergeStatusFromNumber = (n: number | undefined): MergeStatus => MERGE_STATUS[n ?? 0] ?? "notSet";

const THREAD_STATUS: ThreadStatus[] = ["unknown", "active", "fixed", "wontFix", "closed", "byDesign", "pending"];
export const threadStatusFromNumber = (n: number): ThreadStatus => THREAD_STATUS[n] ?? "unknown";

export const VOTE_LABEL: Record<Vote, string> = {
  10: "Approved",
  5: "Approved with suggestions",
  0: "No vote",
  "-5": "Waiting for author",
  "-10": "Rejected",
} as Record<Vote, string>;

export function asVote(n: number): Vote {
  return ([10, 5, 0, -5, -10] as const).find((v) => v === n) ?? 0;
}

export function branchName(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}
