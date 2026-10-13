type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
const browserStorage = () => window.localStorage;

/** Where a user's preferences live beyond this browser, e.g. their Azure DevOps extension data. */
export interface PreferenceStore {
  load(): Promise<Record<string, string>>;
  save(values: Record<string, string>): Promise<void>;
}

interface Synced {
  store: PreferenceStore;
  /** Saved or changed this session; also what reads fall back to when localStorage is denied. */
  values: Record<string, string>;
  /** Read from this browser, so preferences from before syncing are saved along with the next change. */
  seen: Record<string, string>;
  loaded: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
}
let synced: Synced | null = null;

export function readPreference<T extends string>(key: string, initial: T, storage: () => PreferenceStorage = browserStorage): T {
  try {
    const value = storage().getItem(`semantic-review.${key}`) as T | null;
    if (synced && value) synced.seen[key] = value;
    if (value) return value;
  } catch {
    // Denied storage: fall back to the synced copy.
  }
  return (synced?.values[key] as T | undefined) || initial;
}

export function writePreference(key: string, value: string, storage: () => PreferenceStorage = browserStorage): void {
  try {
    storage().setItem(`semantic-review.${key}`, value);
  } catch {
    // Preferences still apply for this page session when storage is denied or full.
  }
  if (!synced) return;
  synced.values[key] = value;
  const state = synced;
  clearTimeout(state.timer);
  // Batch quick toggles into one save, and never save before the user's values have loaded (that would drop them).
  state.timer = setTimeout(() => {
    void state.loaded
      .then(() => state.store.save({ ...state.seen, ...state.values }))
      .catch((e) => console.warn("[semantic-pr] could not save preferences:", e));
  }, 500);
}

/**
 * Follows the user across browsers: their saved preferences replace this browser's, and later changes
 * are saved back. Waits at most `wait` ms so a slow host never delays the page; values that arrive later
 * apply on the next load.
 */
export async function connectPreferences(store: PreferenceStore, wait = 1500, storage: () => PreferenceStorage = browserStorage): Promise<void> {
  const state: Synced = { store, values: {}, seen: {}, loaded: Promise.resolve() };
  state.loaded = store
    .load()
    .then((saved) => {
      // Keep anything the user changed while loading; that change is saved next.
      for (const [key, value] of Object.entries(saved)) {
        if (key in state.values) continue;
        state.values[key] = value;
        try {
          storage().setItem(`semantic-review.${key}`, value);
        } catch {
          // Reads fall back to state.values.
        }
      }
    })
    .catch((e) => console.warn("[semantic-pr] could not load preferences:", e));
  synced = state;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([state.loaded, new Promise<void>((resolve) => (timer = setTimeout(resolve, wait)))]);
  clearTimeout(timer);
}
