import * as React from "react";
import type { Identity } from "../../data/model";
import { CHECK_IN_MS, type Presence, type PresenceRecord, type PresenceStore, type PresenceTab, sweep, whoIsOn } from "../../data/presence";
import { readLocal, writeLocal } from "../preferences";
import { storedDrafts } from "../review/PendingReview";
import { ago, Avatar, cx, plural } from "../util";

const TAB_NAMES: Record<PresenceTab, string> = { overview: "Overview", files: "Files", commits: "Commits" };

const Context = React.createContext<Presence[]>([]);

/** Others on the pull request: here now, or away with a review in progress. Empty outside a PresenceProvider. */
export function usePresence(): Presence[] {
  return React.useContext(Context);
}

/**
 * Checks in for this browser while the PR page shows, and gives the page who else is on the PR. Every CHECK_IN_MS a
 * visible page saves its record (its tab, and the drafts this browser holds) and reads everyone's. A hidden tab stops
 * until it shows again, so its person drops off after HERE_MS. Leaving removes the record, or, with drafts, marks it
 * left so the review in progress still shows.
 */
export const PresenceProvider: React.FC<{
  /** The store of the PR's project. */
  store: PresenceStore;
  pr: number;
  me: Identity;
  tab: PresenceTab;
  /** PendingReviewProvider's storageKey: the drafts saved under it are this browser's review in progress. */
  draftsKey: string;
  /** False until the PR's first full load, so check-ins never compete with the page's own first REST calls. */
  active: boolean;
}> = ({ store, pr, me, tab, draftsKey, active, children }) => {
  const [people, setPeople] = React.useState<Presence[]>([]);
  const [browser] = React.useState(browserId);
  const tabNow = React.useRef(tab);
  tabNow.current = tab;

  React.useEffect(() => {
    if (!active) return;
    const id = `${pr}.${browser}`;
    let stopped = false;
    let busy = false;
    let warned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** The last check-in's save. Leaving waits for it, or it could land after and undo what leaving wrote. */
    let saving: Promise<unknown> = Promise.resolve();
    // Once per page: a store that keeps failing would otherwise log at every check-in.
    const warn = (what: string, e: unknown) => {
      if (!warned) console.warn(`[review-deck] could not ${what} who is on the pull request:`, e);
      warned = true;
    };
    const record = (): PresenceRecord => {
      const drafts = storedDrafts(draftsKey);
      const since = Math.min(...drafts.map((d) => d.created).filter(Number.isFinite));
      return {
        id,
        pr,
        user: { id: me.id, displayName: me.displayName, ...(me.imageUrl ? { imageUrl: me.imageUrl } : {}) },
        seenAt: Date.now(),
        tab: tabNow.current,
        drafts: drafts.length,
        ...(drafts.length && Number.isFinite(since) ? { draftsSince: since } : {}),
      };
    };
    const tick = async () => {
      if (stopped || busy || document.hidden) return;
      busy = true;
      clearTimeout(timer);
      try {
        await (saving = store.save(record()));
      } catch (e) {
        warn("save", e);
      }
      try {
        const records = await store.list();
        if (!stopped) setPeople(whoIsOn(records, me.id, Date.now()).get(pr) ?? []);
        void sweep(store, records, Date.now());
      } catch (e) {
        warn("read", e);
      }
      busy = false;
      // A tab hidden meanwhile checks in again once it shows (onVisibility).
      if (!stopped && !document.hidden) timer = setTimeout(tick, CHECK_IN_MS);
    };
    const onVisibility = () => void tick();
    // Best effort: a closing page may not finish the call. Its record then ages out after HERE_MS.
    const leave = () => {
      const r = record();
      void saving
        .catch(() => {})
        .then(() => (r.drafts ? store.save({ ...r, left: true }) : store.remove(id)))
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", leave);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [active, store, pr, browser, me, draftsKey]);

  return <Context.Provider value={people}>{children}</Context.Provider>;
};

/** This browser's id, kept in local storage so each visit to a PR replaces its record instead of adding one. */
function browserId(): string {
  const saved = readLocal("presence.browser");
  if (saved) return saved;
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  writeLocal("presence.browser", id);
  return id;
}

const PENCIL = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M11 1.5l3.5 3.5-9 9H2v-3.5z" />
  </svg>
);

/** An avatar with a badge: a dot when the person is here now, a pencil when they have a review in progress. */
export const PresenceAvatar: React.FC<{ who: Presence["who"]; presence?: Presence; size?: number; tooltip?: boolean }> = ({ who, presence, size, tooltip }) => (
  <span className="presence-avatar">
    <Avatar who={who} size={size} tooltip={tooltip} />
    {presence && (
      <span className={cx("presence-badge", presence.drafts ? "reviewing" : "here", !presence.here && "away")} aria-hidden="true">
        {presence.drafts > 0 && PENCIL}
      </span>
    )}
  </span>
);

/** What a person is doing on the PR: "Reviewing now · 3 drafts", "Here now", or "Review started 2 hours ago · 2 drafts not sent". */
export function presenceStatus(p: Presence): string {
  if (p.here) return p.drafts ? `Reviewing now · ${plural(p.drafts, "draft")}` : "Here now";
  const started = p.draftsSince === undefined ? "Review started" : `Review started ${ago(new Date(p.draftsSince))}`;
  return `${started} · ${plural(p.drafts, "draft")} not sent`;
}

export const PresenceStatus: React.FC<{ presence: Presence }> = ({ presence }) => (
  <span className={cx("presence-status", presence.here && "here", presence.drafts > 0 && "reviewing")}>{presenceStatus(presence)}</span>
);

/**
 * The faces of `people`, and what each does on hover or focus. Nothing for no one. The PR header shows those here now,
 * a hub row everyone, the reviews in progress of people away included. `focusable` false leaves the keyboard to the
 * hub's rows (j/k), which the faces sit in.
 */
export const PresenceFaces: React.FC<{ people: Presence[]; size?: number; max?: number; label?: string; focusable?: boolean }> = ({
  people,
  size = 24,
  max = 4,
  label,
  focusable = true,
}) => {
  if (!people.length) return null;
  const summary = people.map((p) => `${p.who.displayName}, ${presenceStatus(p).toLowerCase()}`).join("; ");
  return (
    <div className="presence-stack" {...(focusable ? { tabIndex: 0 } : { role: "img" })} aria-label={summary}>
      <span className="presence-faces">
        {people.slice(0, max).map((p) => (
          <PresenceAvatar key={p.who.id} who={p.who} presence={p} size={size} tooltip={false} />
        ))}
        {people.length > max && <span className="presence-more">+{people.length - max}</span>}
      </span>
      {label && <span className="presence-label">{label}</span>}
      <div className="presence-card" aria-hidden="true">
        {people.map((p) => (
          <div key={p.who.id} className="presence-person">
            <Avatar who={p.who} size={20} tooltip={false} />
            <div>
              <strong>{p.who.displayName}</strong>
              <PresenceStatus presence={p} />
              {p.here && p.tab && <div className="muted">On {TAB_NAMES[p.tab]}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** The faces of the people on the PR page now, for its headers. Nothing when you're alone. */
export const PresenceStack: React.FC<{ size?: number; label?: boolean }> = ({ size, label = false }) => {
  const here = usePresence().filter((p) => p.here);
  return <PresenceFaces people={here} size={size} label={label ? `${here.length} here` : undefined} />;
};

/** People on the PR who aren't its reviewers: here now, or away with a review in progress. Nothing when there are none. */
export const OthersOnPr: React.FC<{ reviewers: { id: string }[] }> = ({ reviewers }) => {
  const others = usePresence().filter((p) => !reviewers.some((r) => r.id === p.who.id));
  if (!others.length) return null;
  return (
    <section className="side-section presence-others">
      <h3>Also on this pull request</h3>
      <ul className="people">
        {others.map((p) => (
          <li key={p.who.id}>
            <PresenceAvatar who={p.who} presence={p} />
            <div className="name">
              {p.who.displayName}
              <PresenceStatus presence={p} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
