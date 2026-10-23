import * as React from "react";
import { preferencesLoaded, readPreference, writePreference } from "./preferences";

/**
 * A saved view preference as React state. It opens with this browser's value, since startup never waits for the
 * user's synced preferences (src/index.ts), and re-reads once those arrive, so a new browser picks up the user's
 * choices without a reload. A change made before they arrive wins: the sync never overwrites a value written in
 * the meantime (ui/preferences.ts connectPreferences).
 */
export function usePreference<T extends string>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = React.useState<T>(() => readPreference(key, initial));
  React.useEffect(() => {
    let live = true;
    void preferencesLoaded().then(() => live && setValue(readPreference(key, initial)));
    return () => {
      live = false;
    };
  }, [key]);
  const update = React.useCallback(
    (next: T) => {
      setValue(next);
      writePreference(key, next);
    },
    [key],
  );
  return [value, update];
}
