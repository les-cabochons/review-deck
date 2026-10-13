// Where a pull request stands on its way to merged: shared by the completion controls and their tests.
import type { PolicyStatus, PullRequest } from "./model";

/** Required policies that haven't passed (yet): completing now needs an override; auto-complete waits for them. */
export function unmetPolicies(policies: PolicyStatus[]): PolicyStatus[] {
  return policies.filter((p) => p.blocking && p.state !== "approved" && p.state !== "notApplicable");
}

/** Why the last merge attempt didn't go through, or null. Conflicts get their own notice. */
export function mergeProblem(pr: PullRequest): string | null {
  if (pr.mergeFailure) return pr.mergeFailure;
  if (pr.mergeStatus === "rejectedByPolicy") return "A branch policy rejected the merge.";
  if (pr.mergeStatus === "failure") return "Azure DevOps couldn't merge the branches.";
  return null;
}

/** Completion was requested and Azure DevOps is still merging; the PR stays active until that finishes or fails. */
export function isCompleting(pr: PullRequest): boolean {
  return pr.status === "active" && !!pr.completionQueued && pr.mergeStatus !== "conflicts" && !mergeProblem(pr);
}
