import type { PrOverview } from "./model";

/**
 * The pull requests this browser opened last, so opening one again (from the hub, a link, or a reload) paints it at
 * once while it reloads, instead of a skeleton for the second Azure DevOps' REST calls take. Per host scope
 * (organization, project and user), one localStorage item per PR plus an index of when each was kept, and ignored
 * once it is many hours old, as the hub's (hubCache.ts).
 */
type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "review-deck.pr.v1";
/** Pull requests kept per scope, most recently opened first. */
const MAX_PRS = 10;
/** A PR with this many characters of overview (hundreds of long threads) isn't kept: storage is a few MB in all. */
const MAX_CHARS = 1_000_000;
const MAX_AGE_MS = 12 * 3_600_000;
const browserStore = () => window.localStorage;

/** [PR id, when it was kept], most recent first. */
type Index = [number, number][];

export function readPrSnapshot(scope: string, id: number, storage: () => CacheStorage = browserStore, now = Date.now()): PrOverview | null {
  try {
    const kept = readIndex(storage(), scope).find(([pr]) => pr === id);
    if (!kept || now - kept[1] >= MAX_AGE_MS) return null;
    const raw = storage().getItem(itemKey(scope, id));
    return raw ? withDates(JSON.parse(raw) as PrOverview) : null;
  } catch {
    return null;
  }
}

/** Keeps what the PR page just loaded; drops the PRs opened longest ago beyond the few kept. */
export function writePrSnapshot(scope: string, overview: PrOverview, storage: () => CacheStorage = browserStore, now = Date.now()): void {
  try {
    const store = storage();
    const id = overview.pr.id;
    const others = readIndex(store, scope).filter(([pr]) => pr !== id);
    const json = JSON.stringify(overview);
    if (json.length > MAX_CHARS) {
      store.removeItem(itemKey(scope, id));
      store.setItem(indexKey(scope), JSON.stringify(others));
      return;
    }
    const index: Index = [[id, now], ...others];
    for (const [pr] of index.splice(MAX_PRS)) store.removeItem(itemKey(scope, pr));
    // Full storage: make room by dropping the oldest, down to this PR alone.
    for (;;) {
      try {
        store.setItem(itemKey(scope, id), json);
        break;
      } catch (e) {
        const oldest = index.length > 1 ? index.pop() : undefined;
        if (!oldest) throw e;
        store.removeItem(itemKey(scope, oldest[0]));
      }
    }
    store.setItem(indexKey(scope), JSON.stringify(index));
  } catch {
    // Denied or full storage: the next open shows the skeleton, as it does the first time.
  }
}

const indexKey = (scope: string) => `${KEY}:${scope}`;
const itemKey = (scope: string, id: number) => `${KEY}:${scope}:${id}`;

function readIndex(store: CacheStorage, scope: string): Index {
  let index: unknown = [];
  try {
    index = JSON.parse(store.getItem(indexKey(scope)) ?? "[]");
  } catch {
    // Garbage: start over.
  }
  return Array.isArray(index) ? index.filter((e): e is [number, number] => Array.isArray(e) && typeof e[0] === "number" && typeof e[1] === "number") : [];
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
