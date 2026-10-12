// Normalized view model for the review page. Both the Azure DevOps REST source and the
// offline snapshot source produce these shapes, so views never see raw REST types.

export interface Identity {
  id: string;
  displayName: string;
  uniqueName: string;
  imageUrl?: string;
}

/** Azure DevOps vote values: 10 approved, 5 approved with suggestions, 0 none, -5 waiting for author, -10 rejected. */
export type Vote = 10 | 5 | 0 | -5 | -10;

export interface Reviewer extends Identity {
  vote: Vote;
  isRequired: boolean;
}

export type PrStatus = "active" | "abandoned" | "completed";

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

/** Where the page gets its data. Read-only for milestone 1; write methods arrive in milestone 2. */
export interface PrSource {
  readonly kind: "ado" | "mock";
  load(): Promise<PrOverview>;
  /** Changes between iteration `compareTo` (0 = PR base) and iteration `iteration`. */
  getChanges(iteration: number, compareTo: number): Promise<FileChange[]>;
  getBlob(objectId: string): Promise<string>;
}

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
