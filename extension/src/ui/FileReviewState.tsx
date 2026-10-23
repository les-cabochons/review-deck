import * as React from "react";
import type { FileDiff } from "../../../src/core/types";
import type { FileChange } from "../data/model";
import { readLocal, writeLocal } from "./preferences";
import { parseViewed, setHunksViewed, viewedFiles, viewedHunks, viewedStatus } from "./viewed";

/**
 * Viewed and fold state, kept per chunk (hunk id). A guided card is one chunk and an A–Z file card is all of a
 * file's chunks, so ticking a card in one concern leaves the file's chunks in other concerns untouched.
 */
interface FileReviewState {
  /** Ids of the viewed chunks. */
  viewed: Set<string>;
  /** Paths of the files whose every chunk is viewed. */
  viewedFiles: Set<string>;
  setViewed(hunkIds: string[], checked: boolean): void;
  /**
   * Whether every chunk in `hunkIds` is folded to its file header. Deleted files' chunks and viewed chunks start
   * folded; ticking Viewed folds, unticking unfolds.
   */
  collapsed(hunkIds: string[]): boolean;
  setCollapsed(hunkIds: string[], collapsed: boolean): void;
  /**
   * A concern's fold: the reader's choice, else `fallback` or whether every chunk in it was already viewed
   * when the comparison opened. Ticking chunks one by one never folds the concern being read.
   */
  groupCollapsed(id: string, hunkIds: string[], fallback: boolean): boolean;
  setGroupCollapsed(id: string, collapsed: boolean): void;
}

const Context = React.createContext<FileReviewState | null>(null);

export const FileReviewProvider: React.FC<{ storageKey: string; changes: FileChange[]; files: FileDiff[] }> = ({ storageKey, changes, files, children }) => {
  const [saved, setSaved] = React.useState(() => parseViewed(readLocal(storageKey)));
  const viewed = React.useMemo(() => viewedHunks(saved, files, changes), [saved, files, changes]);
  const fullyViewed = React.useMemo(() => viewedFiles(files, viewed), [files, viewed]);
  const deleted = React.useMemo(() => new Set(files.filter(f => f.status === "deleted").flatMap(f => f.hunks.map(h => h.id))), [files]);
  // Only the reader's choices are stored, so each chunk's default applies until they toggle it.
  const [foldChoices, setFoldChoices] = React.useState(new Map<string, boolean>());
  const setCollapsed = React.useCallback((hunkIds: string[], closed: boolean) => {
    setFoldChoices(previous => {
      const next = new Map(previous);
      for (const id of hunkIds) next.set(id, closed);
      return next;
    });
  }, []);
  const setViewed = React.useCallback((hunkIds: string[], checked: boolean) => {
    setSaved(previous => {
      const next = setHunksViewed(previous, files, changes, hunkIds, checked);
      writeLocal(storageKey, JSON.stringify(next));
      return next;
    });
    setCollapsed(hunkIds, checked);
  }, [files, changes, storageKey, setCollapsed]);
  const collapsed = React.useCallback(
    (hunkIds: string[]) => hunkIds.every(id => foldChoices.get(id) ?? (deleted.has(id) || viewed.has(id))),
    [foldChoices, deleted, viewed],
  );
  const [groupChoices, setGroupChoices] = React.useState(new Map<string, boolean>());
  // Files arrive after the provider mounts; the first non-empty list is what was viewed on opening.
  const viewedOnOpen = React.useRef<Set<string> | null>(null);
  if (!viewedOnOpen.current && files.length) viewedOnOpen.current = viewed;
  const groupCollapsed = React.useCallback(
    (id: string, hunkIds: string[], fallback: boolean) =>
      groupChoices.get(id) ?? (fallback || viewedStatus(hunkIds, viewedOnOpen.current ?? new Set()).checked),
    [groupChoices],
  );
  const setGroupCollapsed = React.useCallback((id: string, closed: boolean) => {
    setGroupChoices(previous => new Map(previous).set(id, closed));
  }, []);
  return <Context.Provider value={{ viewed, viewedFiles: fullyViewed, setViewed, collapsed, setCollapsed, groupCollapsed, setGroupCollapsed }}>
    {children}
  </Context.Provider>;
};

export function useFileReview(): FileReviewState {
  const state = React.useContext(Context);
  if (!state) throw new Error("File review controls need a FileReviewProvider.");
  return state;
}

/** Ticks the chunks in `hunkIds`; mixed when only some of them are viewed. */
export const ViewedCheckbox: React.FC<{ hunkIds: string[]; label: string; onChange?: (checked: boolean) => void }> = ({ hunkIds, label, onChange }) => {
  const { viewed, setViewed } = useFileReview();
  const { checked, mixed } = viewedStatus(hunkIds, viewed);
  const input = React.useRef<HTMLInputElement>(null);
  React.useLayoutEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <label className={`viewed-control${checked ? " is-viewed" : ""}`}>
    <input ref={input} type="checkbox" checked={checked} aria-checked={mixed ? "mixed" : checked}
      aria-label={label} onChange={event => {
        setViewed(hunkIds, event.target.checked);
        onChange?.(event.target.checked);
      }} />
    <span>Viewed</span>
  </label>;
};
