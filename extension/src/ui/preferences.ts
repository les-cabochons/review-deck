type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
const browserStorage = () => window.localStorage;

export function readPreference<T extends string>(key: string, initial: T, storage: () => PreferenceStorage = browserStorage): T {
  try {
    return (storage().getItem(`semantic-review.${key}`) as T) || initial;
  } catch {
    return initial;
  }
}

export function writePreference(key: string, value: string, storage: () => PreferenceStorage = browserStorage): void {
  try {
    storage().setItem(`semantic-review.${key}`, value);
  } catch {
    // Preferences still apply for this page session when storage is denied or full.
  }
}
