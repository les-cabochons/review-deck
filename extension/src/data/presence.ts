/**
 * Who else has a pull request open, and who has a review in progress on it. Azure DevOps doesn't tell an extension
 * who is on a page, so every open PR page saves a small record for its browser every so often (ui/presence) and reads
 * the others'. A record says when its page last checked in and how many unsent draft comments that browser holds
 * (ui/review/PendingReview.tsx). Draft text never leaves the browser.
 *
 * The records of a project's pull requests are kept together, so the hub reads all its rows' people in one call per
 * project. Every read also deletes a few records that are past keeping (`staleRecords`): a page closed with its tab
 * doesn't always get to remove its own.
 */

/** How often a visible PR page saves its record and reads the others', and a visible hub reads them. */
export const CHECK_IN_MS = 30_000;
/** A record that checked in this recently is someone on the page now: two missed check-ins, plus the clocks' drift. */
export const HERE_MS = 75_000;
/** A record without drafts not seen for this long is left over from a page that closed without removing it. */
export const STALE_MS = 10 * 60_000;
/** A review in progress not seen for this long is given up on: its record is deleted and stops showing. */
export const DRAFTS_KEPT_MS = 30 * 86_400_000;
/** Records one read deletes at most, so a backlog of leftovers is cleared over a few reads, not in a burst of calls. */
export const SWEEP_MAX = 10;

export type PresenceTab = "overview" | "files" | "commits" | "infra";

/** One browser's record for one pull request, as its page saves it. */
export interface PresenceRecord {
  /** `<pr>.<browser id>`: one record per pull request, person and browser. */
  id: string;
  /** The pull request's id. */
  pr: number;
  user: { id: string; displayName: string; imageUrl?: string };
  /** When the page last checked in, by its own clock (ms since the epoch). */
  seenAt: number;
  /** The page closed with drafts left: the record stays only to show the review in progress. */
  left?: boolean;
  /** The tab the page shows. */
  tab: PresenceTab;
  /** Unsent draft comments and replies in this browser. */
  drafts: number;
  /** When the oldest of those drafts was written (ms since the epoch). Absent without drafts. */
  draftsSince?: number;
}

/** One person on a pull request, from all their browsers' records. */
export interface Presence {
  who: { id: string; displayName: string; imageUrl?: string };
  /** On the page now: one of their pages checked in within HERE_MS and didn't close. */
  here: boolean;
  /** The tab of their most recent page that is here. */
  tab?: PresenceTab;
  /** Unsent drafts across their browsers. More than zero means a review in progress. */
  drafts: number;
  /** When their oldest unsent draft was written. */
  draftsSince?: number;
}

/**
 * Saves and reads the records of one project's pull requests. AdoHost keeps them in extension data, which anyone in
 * the organization can read and write, so `list` returns them unparsed and `whoIsOn` checks each one.
 */
export interface PresenceStore {
  /** Saves a browser's record over its last one. */
  save(record: PresenceRecord): Promise<void>;
  /** Removes a record. */
  remove(id: string): Promise<void>;
  /** Every record of the project. */
  list(): Promise<unknown[]>;
}

const TABS: readonly string[] = ["overview", "files", "commits", "infra"] satisfies PresenceTab[];

/**
 * The people on each pull request besides `me`, by PR id: those here now, and those away with a review in progress.
 * Records that are malformed, neither here nor holding drafts, or holding drafts past DRAFTS_KEPT_MS are left out.
 * Reviewing first, then here, then away, each by name.
 */
export function whoIsOn(records: unknown[], me: string, now: number): Map<number, Presence[]> {
  /** Per PR and person: when the record that named them was seen, and when the page that gave the tab was. */
  const prs = new Map<number, Map<string, { person: Presence; namedAt: number; tabAt: number }>>();
  for (const raw of records) {
    const record = readRecord(raw);
    if (!record || record.user.id === me) continue;
    const here = !record.left && now - record.seenAt < HERE_MS;
    if (!here && (!record.drafts || now - record.seenAt >= DRAFTS_KEPT_MS)) continue;
    const people = prs.get(record.pr) ?? new Map();
    prs.set(record.pr, people);
    const entry = people.get(record.user.id) ?? { person: { who: record.user, here: false, drafts: 0 }, namedAt: -Infinity, tabAt: -Infinity };
    const { person } = entry;
    // The newest record names them: a changed display name or picture shows on the next check-in.
    if (record.seenAt > entry.namedAt) [person.who, entry.namedAt] = [record.user, record.seenAt];
    if (here && record.seenAt > entry.tabAt) [person.here, person.tab, entry.tabAt] = [true, record.tab, record.seenAt];
    // Each browser holds its own drafts, so they add up.
    person.drafts += record.drafts;
    if (record.draftsSince !== undefined) person.draftsSince = Math.min(person.draftsSince ?? Infinity, record.draftsSince);
    people.set(record.user.id, entry);
  }
  const rank = (p: Presence) => (p.here ? (p.drafts ? 0 : 1) : 2);
  const sorted = (people: Map<string, { person: Presence }>) =>
    [...people.values()].map((e) => e.person).sort((a, b) => rank(a) - rank(b) || a.who.displayName.localeCompare(b.who.displayName));
  return new Map([...prs].map(([pr, people]) => [pr, sorted(people)]));
}

/** Ids of the records past keeping: without drafts and not seen for STALE_MS, or with drafts for DRAFTS_KEPT_MS. */
export function staleRecords(records: unknown[], now: number): string[] {
  return records.flatMap((raw) => {
    const record = readRecord(raw);
    return record && now - record.seenAt >= (record.drafts ? DRAFTS_KEPT_MS : STALE_MS) ? [record.id] : [];
  });
}

/** Deletes up to SWEEP_MAX records past keeping, one at a time. Never rejects: a leftover is tried again next read. */
export async function sweep(store: PresenceStore, records: unknown[], now: number): Promise<void> {
  for (const id of staleRecords(records, now).slice(0, SWEEP_MAX)) await store.remove(id).catch(() => {});
}

/** A record from shared storage, or null if it isn't one. Pictures are kept only over https. */
function readRecord(raw: unknown): PresenceRecord | null {
  const r = raw as Partial<Record<keyof PresenceRecord, unknown>> | null;
  const user = r?.user as Partial<Record<keyof PresenceRecord["user"], unknown>> | null | undefined;
  if (typeof r?.id !== "string" || typeof user?.id !== "string" || typeof user.displayName !== "string") return null;
  if (typeof r.pr !== "number" || !Number.isSafeInteger(r.pr) || r.pr <= 0) return null;
  if (typeof r.seenAt !== "number" || !Number.isFinite(r.seenAt)) return null;
  const drafts = typeof r.drafts === "number" && Number.isInteger(r.drafts) && r.drafts > 0 ? r.drafts : 0;
  const imageUrl = typeof user.imageUrl === "string" && user.imageUrl.startsWith("https://") ? user.imageUrl : undefined;
  return {
    id: r.id,
    pr: r.pr,
    user: { id: user.id, displayName: user.displayName, ...(imageUrl ? { imageUrl } : {}) },
    seenAt: r.seenAt,
    left: r.left === true,
    tab: typeof r.tab === "string" && TABS.includes(r.tab) ? (r.tab as PresenceTab) : "overview",
    drafts,
    draftsSince: drafts && typeof r.draftsSince === "number" && Number.isFinite(r.draftsSince) ? r.draftsSince : undefined,
  };
}
