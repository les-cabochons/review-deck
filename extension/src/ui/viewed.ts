import type { FileChange } from "../data/model";

export type ViewedFiles = Record<string, string>;

/** Both sides identify what was reviewed, including renames and changes after a force push. */
export function fileVersion(change: FileChange): string {
  return JSON.stringify([change.changeType, change.originalPath, change.oldObjectId, change.newObjectId]);
}

export function parseViewed(raw: string | null): ViewedFiles {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, version]) => typeof version === "string"));
  } catch {
    return {};
  }
}

export function viewedPaths(saved: ViewedFiles, changes: FileChange[]): Set<string> {
  return new Set(changes.filter(change => saved[change.path] === fileVersion(change)).map(change => change.path));
}

export function setFilesViewed(saved: ViewedFiles, changes: FileChange[], paths: string[], checked: boolean): ViewedFiles {
  const next = { ...saved };
  const selected = new Set(paths);
  for (const change of changes) {
    if (!selected.has(change.path)) continue;
    if (checked) next[change.path] = fileVersion(change);
    else delete next[change.path];
  }
  return next;
}

export function viewedStatus(paths: string[], viewed: ReadonlySet<string>): { checked: boolean; mixed: boolean } {
  const unique = [...new Set(paths)];
  const count = unique.filter(path => viewed.has(path)).length;
  return { checked: unique.length > 0 && count === unique.length, mixed: count > 0 && count < unique.length };
}
