import { MAX_AGE_MS } from "./hubCache";
import type { PrOverview } from "./model";

/**
 * The pull requests this browser opened last, so opening one again (from the hub, a link, or a reload) paints it at
 * once while it reloads, instead of a skeleton for the second Azure DevOps' REST calls take. One localStorage item per
 * PR and host scope (organization, project and user), and one index of them all, which keeps their total well within
 * what the browser allows: the hub's rows and pending review drafts share that storage. Ignored once many hours old,
 * like the hub's (hubCache.ts), and dropped at the next save.
 */
type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "review-deck.pr.v1";
/** Pull requests kept in all, across organizations, projects and users. */
const MAX_PRS = 10;
/** Characters kept in all: browsers allow an origin about 5 MB of localStorage, and this is a fraction of it. */
const MAX_TOTAL_CHARS = 1_500_000;
/** A PR with more characters of overview than this (hundreds of long threads) isn't kept. */
const MAX_CHARS = 500_000;
const browserStore = () => window.localStorage;

/** One kept PR: `<scope>:<PR id>`, when it was kept, and its size. */
interface Entry {
  key: string;
  at: number;
  chars: number;
}

export function readPrSnapshot(scope: string, id: number, storage: () => CacheStorage = browserStore, now = Date.now()): PrOverview | null {
  try {
    const kept = readIndex(storage()).find((e) => e.key === entryKey(scope, id));
    if (!kept || now - kept.at >= MAX_AGE_MS) return null;
    const raw = storage().getItem(itemKey(kept.key));
    return raw ? withDates(JSON.parse(raw) as PrOverview) : null;
  } catch {
    return null;
  }
}

/** Keeps what the PR page just loaded, first; drops what's too old, and the PRs opened longest ago beyond the limits. */
export function writePrSnapshot(scope: string, overview: PrOverview, storage: () => CacheStorage = browserStore, now = Date.now()): void {
  try {
    const store = storage();
    const key = entryKey(scope, overview.pr.id);
    const json = JSON.stringify(overview);
    const kept: Entry[] = json.length <= MAX_CHARS ? [{ key, at: now, chars: json.length }] : [];
    let total = kept[0]?.chars ?? 0;
    for (const e of readIndex(store)) {
      if (e.key === key) continue;
      if (now - e.at < MAX_AGE_MS && kept.length < MAX_PRS && total + e.chars <= MAX_TOTAL_CHARS) {
        kept.push(e);
        total += e.chars;
      } else store.removeItem(itemKey(e.key));
    }
    while (kept[0]?.key === key) {
      try {
        store.setItem(itemKey(key), json);
        break;
      } catch {
        // Full all the same (the hub's rows, drafts): drop the oldest to make room, and at last this one.
        store.removeItem(itemKey((kept.length > 1 ? kept.pop() : kept.shift())!.key));
      }
    }
    if (kept[0]?.key !== key) store.removeItem(itemKey(key));
    store.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Denied storage: the next open shows the skeleton, as it does the first time.
  }
}

const entryKey = (scope: string, id: number) => `${scope}:${id}`;
const itemKey = (key: string) => `${KEY}:${key}`;

/** The kept PRs, most recently opened first. */
function readIndex(store: CacheStorage): Entry[] {
  let index: unknown = [];
  try {
    index = JSON.parse(store.getItem(KEY) ?? "[]");
  } catch {
    // Garbage: start over.
  }
  return Array.isArray(index)
    ? index.filter((e): e is Entry => typeof e?.key === "string" && typeof e.at === "number" && typeof e.chars === "number")
    : [];
}

/** JSON keeps dates as strings. */
function withDates(o: PrOverview): PrOverview {
  const { pr } = o;
  return {
    ...o,
    pr: { ...pr, creationDate: new Date(pr.creationDate), completionQueued: pr.completionQueued && new Date(pr.completionQueued) },
    iterations: o.iterations.map((it) => ({ ...it, createdDate: new Date(it.createdDate) })),
    threads: o.threads.map((t) => ({
      ...t,
      published: new Date(t.published),
      updated: new Date(t.updated),
      comments: t.comments.map((c) => ({ ...c, published: new Date(c.published) })),
    })),
    commits: o.commits.map((c) => ({ ...c, date: new Date(c.date) })),
  };
}
