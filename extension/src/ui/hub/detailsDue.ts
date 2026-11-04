import type { HubSnapshot } from "../../data/hubCache";
import type { DetailRecord, DetailScope, PrSummary } from "../../data/list";

/**
 * How long a row's fetched details (checks, comment count, review policy) stand. Every list refresh used to fetch
 * them again for each row on screen, three REST calls a row. The hub refreshes its list whenever a PR page gives
 * way to it, so a hub of 20 rows cost 60 calls per return, in the way of the next PR's own calls. With three
 * minutes, a look at a PR and back costs no detail calls, and a return after a review of some minutes fetches
 * them again. A build or a comment is at most three minutes late on a hub in use, which Azure DevOps' own list
 * doesn't show at all. A vote doesn't wait that long (`rowKey`), and the Refresh button fetches everything anew.
 */
export const DETAILS_FRESH_MS = 3 * 60_000;

/**
 * The row facts the policy evaluations follow: the reviewers, their votes and whether they're required, and the
 * target branch (policies are set per branch). A list refresh that changes them makes the fetched details due
 * again, so a vote that just landed moves your PR to Approved without waiting out DETAILS_FRESH_MS.
 */
export function rowKey(pr: Partial<Pick<PrSummary, "reviewers" | "targetBranch">>): string {
  const reviewers = (pr.reviewers ?? []).map((r) => `${r.id}:${r.vote}${r.isRequired ? "!" : ""}`).sort();
  return [pr.targetBranch ?? "", ...reviewers].join("\n");
}

/** Whether `pr`'s details must be fetched (again) to show `want`. */
export function detailsDue(record: DetailRecord | undefined, pr: Pick<PrSummary, "reviewers" | "targetBranch">, want: DetailScope, now: number): boolean {
  if (!record) return true;
  if (record.scope !== "full" && record.scope !== want) return true;
  if (record.row !== rowKey(pr)) return true;
  return now - record.at >= DETAILS_FRESH_MS;
}

/**
 * Records for the details the hub kept from its last visit, as they were saved with them. A list refresh keeps the
 * details of rows it doesn't fetch again, so the list's age says nothing about theirs. Details saved without a
 * record (by an older version, or patched in while the hub wasn't open) have none, and are due.
 */
export function keptRecords(snap: Pick<HubSnapshot, "details" | "fetched">): Map<number, DetailRecord> {
  return new Map([...(snap.fetched ?? [])].filter(([id]) => snap.details.has(id)));
}
