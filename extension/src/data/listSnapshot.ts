// JSON shape of the PR hub's offline list (local dev mode), built by scripts/build-ado-mock-list.ts.
import type { IdentityJson } from "./snapshot.js";

export interface PrSummaryJson {
  pullRequestId: number;
  title: string;
  /** PullRequestStatus: 1 active, 2 abandoned, 3 completed */
  status: number;
  isDraft: boolean;
  createdBy: IdentityJson;
  creationDate: string;
  updatedDate: string;
  closedDate: string | null;
  sourceRefName: string;
  targetRefName: string;
  repository: { id: string; name: string; project: { id: string; name: string } };
  reviewers: (IdentityJson & { vote: number; isRequired: boolean; synthetic?: boolean })[];
  labels: string[];
  size: { files: number; adds: number; dels: number };
  checks: "passing" | "failing" | "pending" | "none";
  comments: number;
  /** dev-data snapshot id when the PR can be opened locally. */
  snapshot: string | null;
}

export interface PrListSnapshot {
  source: { github: string; note: string };
  currentUser: IdentityJson;
  /** Teams the local user belongs to (synthetic). */
  currentUserGroups?: { id: string; name: string }[];
  pullRequests: PrSummaryJson[];
}
