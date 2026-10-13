// PR state, review state and checks: icons and labels shared by hub rows and the stack panel.
import type { PrSummary } from "../data/list";

export const STATE_ICON: Record<string, { icon: string; className: string; label: string }> = {
  draft: { icon: "BranchRequestDraft", className: "state-draft", label: "Draft" },
  active: { icon: "BranchPullRequest", className: "state-active", label: "Active" },
  completed: { icon: "BranchMerged", className: "state-completed", label: "Completed" },
  abandoned: { icon: "BranchRequestClosed", className: "state-abandoned", label: "Abandoned" },
};

export function reviewState(pr: PrSummary): { label: string; tone: string } {
  if (pr.status === "completed") return { label: "Merged", tone: "merged" };
  if (pr.status === "abandoned") return { label: "Abandoned", tone: "error" };
  if (pr.isDraft) return { label: "Draft", tone: "neutral" };
  if (pr.reviewers.some((r) => r.vote === -10)) return { label: "Rejected", tone: "error" };
  if (pr.reviewers.some((r) => r.vote === -5)) return { label: "Waiting for author", tone: "warning" };
  if (pr.reviewers.some((r) => r.vote >= 5)) return { label: "Approved", tone: "success" };
  if (pr.reviewers.length === 0) return { label: "No reviewers", tone: "neutral" };
  return { label: "Review pending", tone: "neutral" };
}

export const CHECKS: Record<string, { icon: string; tone: string; label: string }> = {
  passing: { icon: "CompletedSolid", tone: "success", label: "Checks passing" },
  failing: { icon: "StatusErrorFull", tone: "error", label: "Checks failing" },
  pending: { icon: "ProgressLoopOuter", tone: "info", label: "Checks running" },
  none: { icon: "CircleRing", tone: "neutral", label: "No checks" },
};

/** The state key for STATE_ICON: drafts are shown apart from other active PRs. */
export function stateKey(pr: PrSummary): string {
  return pr.isDraft && pr.status === "active" ? "draft" : pr.status;
}
