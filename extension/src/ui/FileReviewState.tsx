import * as React from "react";
import type { FileDiff } from "../../../src/core/types";
import type { FileChange } from "../data/model";
import { readLocal, writeLocal } from "./preferences";
import { parseViewed, setFilesViewed, viewedPaths, viewedStatus } from "./viewed";

interface FileReviewState {
  viewed: Set<string>;
  setViewed(paths: string[], checked: boolean): void;
  /** Files fold to their header. Deleted and viewed files start folded; ticking Viewed folds, unticking unfolds. */
  fileCollapsed(file: FileDiff): boolean;
  setFileCollapsed(path: string, collapsed: boolean): void;
  /**
   * A concern's fold: the reader's choice, else `fallback` or whether every file in it was already viewed
   * when the comparison opened. Ticking files one by one never folds the concern being read.
   */
  groupCollapsed(id: string, paths: string[], fallback: boolean): boolean;
  setGroupCollapsed(id: string, collapsed: boolean): void;
}

const Context = React.createContext<FileReviewState | null>(null);

export const FileReviewProvider: React.FC<{ storageKey: string; changes: FileChange[] }> = ({ storageKey, changes, children }) => {
  const [saved, setSaved] = React.useState(() => parseViewed(readLocal(storageKey)));
  const viewed = React.useMemo(() => viewedPaths(saved, changes), [saved, changes]);
  // Only the reader's choices are stored, so each file's default applies until they toggle it.
  const [fileChoices, setFileChoices] = React.useState(new Map<string, boolean>());
  const setViewed = React.useCallback((paths: string[], checked: boolean) => {
    setSaved(previous => {
      const next = setFilesViewed(previous, changes, paths, checked);
      writeLocal(storageKey, JSON.stringify(next));
      return next;
    });
    setFileChoices(previous => {
      const next = new Map(previous);
      for (const path of paths) next.set(path, checked);
      return next;
    });
  }, [changes, storageKey]);
  const fileCollapsed = React.useCallback(
    (file: FileDiff) => fileChoices.get(file.path) ?? (file.status === "deleted" || viewed.has(file.path)),
    [fileChoices, viewed],
  );
  const setFileCollapsed = React.useCallback((path: string, closed: boolean) => {
    setFileChoices(previous => new Map(previous).set(path, closed));
  }, []);
  const [groupChoices, setGroupChoices] = React.useState(new Map<string, boolean>());
  // Changes arrive after the provider mounts; the first non-empty list is what was viewed on opening.
  const viewedOnOpen = React.useRef<Set<string> | null>(null);
  if (!viewedOnOpen.current && changes.length) viewedOnOpen.current = viewed;
  const groupCollapsed = React.useCallback(
    (id: string, paths: string[], fallback: boolean) =>
      groupChoices.get(id) ?? (fallback || viewedStatus(paths, viewedOnOpen.current ?? new Set()).checked),
    [groupChoices],
  );
  const setGroupCollapsed = React.useCallback((id: string, closed: boolean) => {
    setGroupChoices(previous => new Map(previous).set(id, closed));
  }, []);
  return <Context.Provider value={{ viewed, setViewed, fileCollapsed, setFileCollapsed, groupCollapsed, setGroupCollapsed }}>
    {children}
  </Context.Provider>;
};

export function useFileReview(): FileReviewState {
  const state = React.useContext(Context);
  if (!state) throw new Error("File review controls need a FileReviewProvider.");
  return state;
}

export const ViewedCheckbox: React.FC<{ paths: string[]; label: string; onChange?: (checked: boolean) => void }> = ({ paths, label, onChange }) => {
  const { viewed, setViewed } = useFileReview();
  const { checked, mixed } = viewedStatus(paths, viewed);
  const input = React.useRef<HTMLInputElement>(null);
  React.useLayoutEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <label className={`viewed-control${checked ? " is-viewed" : ""}`}>
    <input ref={input} type="checkbox" checked={checked} aria-checked={mixed ? "mixed" : checked}
      aria-label={label} onChange={event => {
        setViewed(paths, event.target.checked);
        onChange?.(event.target.checked);
      }} />
    <span>Viewed</span>
  </label>;
};
