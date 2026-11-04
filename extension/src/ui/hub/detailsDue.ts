import type { HubSnapshot } from "../../data/hubCache";
import { type DetailScope, detailScope, type PrSummary } from "../../data/list";

/**
 * How long a row's fetched details (checks, comment count, review policy) stand. Every list refresh used to fetch
 * them again for each row on screen, three REST calls a row, and the hub refreshes its list whenever a PR page
 * gives way to it: a hub of 20 rows cost 60 calls per return, in the way of the next PR's own calls. Three
 * minutes: a look at a PR and back costs no detail calls, a return after a review of some minutes fetches them
 * again, and a build or a comment is at most that late on a hub in use, which Azure DevOps' own list doesn't show
 * at all. A vote doesn't wait that long (`rowKey`), and the Refresh button fetches everything anew.
 */
export const DETAILS_FRESH_MS = 3 * 60_000;

/** What a row's details were last fetched with. */
export interface DetailRecord {
  scope: DetailScope;
  /** When they landed; the hub's kept details count from when its list was fetched. */
  at: number;
  /** `rowKey` of the row they were fetched for. */
  row: string;
}

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

/** Records for the details the hub kept from its last visit: fetched when its list was, for the rows as they were then. */
export function keptRecords(snap: Pick<HubSnapshot, "prs" | "details" | "listedAt">): Map<number, DetailRecord> {
  const rows = new Map(snap.prs.map((p) => [p.id, p]));
  const records = new Map<number, DetailRecord>();
  for (const [id, details] of snap.details) {
    const row = rows.get(id);
    if (row) records.set(id, { scope: detailScope(details), at: snap.listedAt, row: rowKey(row) });
  }
  return records;
}
