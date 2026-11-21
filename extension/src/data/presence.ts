/**
 * Who else has a pull request open, and who has a review in progress on it. Azure DevOps doesn't tell an extension
 * who is on a page, so every open PR page saves a small record for its browser every so often (ui/presence) and reads
 * the others'. A record says when its page last checked in and how many unsent draft comments that browser holds
 * (ui/review/PendingReview.tsx). Draft text never leaves the browser.
 */

/** How often a visible PR page saves its record and reads the others'. */
export const CHECK_IN_MS = 30_000;
/** A record that checked in this recently is someone on the page now: two missed check-ins, plus the clocks' drift. */
export const HERE_MS = 75_000;

export type PresenceTab = "overview" | "files" | "commits";

/** One browser's record for one pull request, as its page saves it. */
export interface PresenceRecord {
  /** The browser's own random id, and the record's id: one record per person and browser. */
  id: string;
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
 * Saves and reads the records of one pull request. AdoHost keeps them in extension data, which anyone in the
 * organization can read and write, so `list` returns them unparsed and `whoIsOn` checks each one.
 */
export interface PresenceStore {
  /** Saves this browser's record over its last one. */
  save(record: PresenceRecord): Promise<void>;
  /** Removes a browser's record. */
  remove(id: string): Promise<void>;
  /** Every browser's record for the PR. */
  list(): Promise<unknown[]>;
}

const TABS: readonly string[] = ["overview", "files", "commits"] satisfies PresenceTab[];

/**
 * The people on a pull request besides `me`, from its records: those here now, and those away with a review in
 * progress. Records that are malformed, or neither here nor holding drafts, are left out. Reviewing first, then
 * here, then away, each by name.
 */
export function whoIsOn(records: unknown[], me: string, now: number): Presence[] {
  /** Per person: when the record that named them was seen, and when the page that gave the tab was. */
  const people = new Map<string, { person: Presence; namedAt: number; tabAt: number }>();
  for (const raw of records) {
    const record = readRecord(raw);
    if (!record || record.user.id === me) continue;
    const here = !record.left && now - record.seenAt < HERE_MS;
    if (!here && !record.drafts) continue;
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
  return [...people.values()].map((e) => e.person).sort((a, b) => rank(a) - rank(b) || a.who.displayName.localeCompare(b.who.displayName));
}

/** A record from shared storage, or null if it isn't one. Pictures are kept only over https. */
function readRecord(raw: unknown): PresenceRecord | null {
  const r = raw as Partial<Record<keyof PresenceRecord, unknown>> | null;
  const user = r?.user as Partial<Record<keyof PresenceRecord["user"], unknown>> | null | undefined;
  if (typeof r?.id !== "string" || typeof user?.id !== "string" || typeof user.displayName !== "string") return null;
  if (typeof r.seenAt !== "number" || !Number.isFinite(r.seenAt)) return null;
  const drafts = typeof r.drafts === "number" && Number.isInteger(r.drafts) && r.drafts > 0 ? r.drafts : 0;
  const imageUrl = typeof user.imageUrl === "string" && user.imageUrl.startsWith("https://") ? user.imageUrl : undefined;
  return {
    id: r.id,
    user: { id: user.id, displayName: user.displayName, ...(imageUrl && { imageUrl }) },
    seenAt: r.seenAt,
    left: r.left === true,
    tab: typeof r.tab === "string" && TABS.includes(r.tab) ? (r.tab as PresenceTab) : "overview",
    drafts,
    draftsSince: drafts && typeof r.draftsSince === "number" && Number.isFinite(r.draftsSince) ? r.draftsSince : undefined,
  };
}
