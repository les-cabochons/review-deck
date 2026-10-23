import type { FileDiff } from "../../../src/core/types";
import type { FileChange } from "../data/model";

/**
 * Viewed chunks saved locally. Each key is a hunk id (`<path>#<n>`) and its value is the version of the chunk's file
 * when it was ticked. The guided view shows a file's chunks in different concerns, so each chunk is ticked on its own.
 */
export type ViewedHunks = Record<string, string>;

/** Both sides identify what was reviewed, including renames and changes after a force push. */
export function fileVersion(change: FileChange): string {
  return JSON.stringify([change.changeType, change.originalPath, change.oldObjectId, change.newObjectId]);
}

export function parseViewed(raw: string | null): ViewedHunks {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, version]) => typeof version === "string"));
  } catch {
    return {};
  }
}

function versionsByPath(changes: FileChange[]): Map<string, string> {
  return new Map(changes.map(change => [change.path, fileVersion(change)]));
}

/** Ids of the chunks ticked at their file's current version. */
export function viewedHunkIds(saved: ViewedHunks, files: FileDiff[], changes: FileChange[]): Set<string> {
  const versions = versionsByPath(changes);
  return new Set(files.flatMap(file => {
    const version = versions.get(file.path);
    return version === undefined ? [] : file.hunks.filter(hunk => saved[hunk.id] === version).map(hunk => hunk.id);
  }));
}

export function setHunksViewed(saved: ViewedHunks, files: FileDiff[], changes: FileChange[], hunkIds: string[], checked: boolean): ViewedHunks {
  const next = { ...saved };
  const selected = new Set(hunkIds);
  const versions = versionsByPath(changes);
  for (const file of files) {
    const version = versions.get(file.path);
    if (version === undefined) continue;
    for (const hunk of file.hunks) {
      if (!selected.has(hunk.id)) continue;
      if (checked) next[hunk.id] = version;
      else delete next[hunk.id];
    }
  }
  return next;
}

/** Paths of the files whose every chunk is viewed. */
export function fullyViewedFiles(files: FileDiff[], viewedHunks: ReadonlySet<string>): Set<string> {
  return new Set(files.filter(file => file.hunks.every(hunk => viewedHunks.has(hunk.id))).map(file => file.path));
}

export function viewedStatus(hunkIds: string[], viewed: ReadonlySet<string>): { checked: boolean; mixed: boolean } {
  const unique = [...new Set(hunkIds)];
  const count = unique.filter(id => viewed.has(id)).length;
  return { checked: unique.length > 0 && count === unique.length, mixed: count > 0 && count < unique.length };
}
