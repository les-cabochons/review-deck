import * as React from "react";
import { preferencesLoaded, readPreference, writePreference } from "../preferences";

/**
 * Whether the reader wants the change diagrams: the map of concerns in Overview and the map inside each concern in
 * Files. Saved with the user's preferences, so hiding them follows the user to other browsers. One value for the
 * page: hiding a diagram anywhere hides them all, and the PR's ⋯ menu brings them back.
 */
const KEY = "changeDiagrams";
type Value = "shown" | "hidden";

let current: Value | null = null;
const listeners = new Set<(value: Value) => void>();

function set(value: Value) {
  current = value;
  writePreference(KEY, value);
  for (const listener of listeners) listener(value);
}

export function useDiagramsShown(): [boolean, (shown: boolean) => void] {
  const [value, setValue] = React.useState<Value>(() => (current ??= readPreference<Value>(KEY, "shown")));
  React.useEffect(() => {
    listeners.add(setValue);
    let live = true;
    // The user's synced value, once read, replaces this browser's (ui/preferences.ts).
    void preferencesLoaded().then(() => {
      if (!live) return;
      current = readPreference<Value>(KEY, "shown");
      setValue(current);
    });
    return () => {
      live = false;
      listeners.delete(setValue);
    };
  }, []);
  return [value === "shown", React.useCallback((shown: boolean) => set(shown ? "shown" : "hidden"), [])];
}
