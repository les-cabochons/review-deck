// Where a pull request stands on its way to merged: shared by the completion controls and their tests.
import { MERGE_POLICY_TYPE, type PolicyStatus, type PullRequest } from "./model";

/**
 * Whether a check is the "Require a merge strategy" policy. Azure DevOps rejects it while the PR has no allowed merge
 * type saved, and judges it again on the merge type that completing or setting auto-complete sends.
 */
export function isMergeTypeCheck(policy: Pick<PolicyStatus, "typeId">): boolean {
  return policy.typeId === MERGE_POLICY_TYPE;
}

/**
 * Required policies that haven't passed (yet): completing now needs an override; auto-complete waits for them.
 * The merge type check is left out: the completion dialog sends a merge type, and offers only the allowed ones.
 */
export function unmetPolicies(policies: PolicyStatus[]): PolicyStatus[] {
  return policies.filter((p) => p.blocking && !isMergeTypeCheck(p) && p.state !== "approved" && p.state !== "notApplicable");
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
