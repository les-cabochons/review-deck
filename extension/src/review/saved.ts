// Finished groupings, saved so reopening a PR skips the analysis (parsing, embeddings, LLM titles). Azure DevOps
// iterations never change, so a comparison's diff, and so its grouping, is fixed; AppHost.savedReviews() keeps
// each PR's latest one, and ignores ones for another comparison or saved by another extension version.
import type { FileDiff, Group, HunkInfo, MechanicalInfo, ReviewResult } from "../../../src/core/types";
import { parseDiff } from "../../../src/diff/parse";

/** Bump when the saved shape changes. */
const FORMAT = 1;

/** Which comparison of which pull request; iterations are numbered per PR, 0 = the PR's base. */
export interface ReviewKey {
  repo: string;
  pr: number;
  iteration: number;
  compareTo: number;
}

/** Where finished groupings are kept (AppHost.savedReviews). Neither method rejects: saving is only a speed-up. */
export interface SavedReviews {
  /** The saved grouping, unchecked (restoreReview checks it), or null. */
  load(key: ReviewKey): Promise<unknown>;
  save(key: ReviewKey, review: SavedReview): Promise<void>;
}

/** How the grouping was made; a saved one is reused only if it was made the way the page would make it now. */
export interface ReviewMode {
  /** Embeddings from the backend. */
  semantic: boolean;
  /** LLM titles (the project opted in) rather than heuristic ones. */
  llmTitles: boolean;
}

/** The mode the analysis runs in with this backend and project setting (see analyze in analysis.ts). */
export function reviewMode(backend: unknown, aiTitles: boolean): ReviewMode {
  return { semantic: !!backend, llmTitles: !!backend && aiTitles };
}

export interface SavedReview {
  format: number;
  mode: ReviewMode;
  groups: Group[];
  merges: ReviewResult["merges"];
  options: ReviewResult["options"];
  /** The hunk facts the page shows, only for hunks that have any (most have none). */
  hunks: Record<string, { symbol?: string; isTest?: true; mechanical?: MechanicalInfo }>;
}

/** The analysis that `result` needs saved, or null if it fell back somewhere (backend down, titles failed): the next open retries. */
export function packReview(result: ReviewResult, mode: ReviewMode): SavedReview | null {
  if (result.warnings.length > 0) return null;
  const hunks: SavedReview["hunks"] = {};
  for (const [id, h] of result.hunks) {
    if (!h.symbol && !h.isTest && !h.mechanical) continue;
    hunks[id] = { ...(h.symbol && { symbol: h.symbol }), ...(h.isTest && { isTest: true }), ...(h.mechanical && { mechanical: h.mechanical }) };
  }
  return { format: FORMAT, mode, groups: result.groups, merges: result.merges, options: result.options, hunks };
}

/**
 * The saved grouping on top of a freshly parsed diff, or null if it doesn't fit: another format or mode, or
 * groups that don't cover exactly this diff's hunks.
 */
export function restoreReview(saved: unknown, mode: ReviewMode, meta: { title: string; description: string }, diff: string): ReviewResult | null {
  const s = saved as Partial<SavedReview> | null | undefined;
  if (s?.format !== FORMAT || !Array.isArray(s.groups) || s.mode?.semantic !== mode.semantic || s.mode.llmTitles !== mode.llmTitles) return null;
  const files = parseDiff(diff);
  const hunks = new Map<string, HunkInfo>();
  for (const file of files) for (const hunk of file.hunks) hunks.set(hunk.id, hunkInfo(file, hunk, s.hunks?.[hunk.id]));
  const grouped = s.groups.flatMap((g) => g.hunkIds);
  if (grouped.length !== hunks.size || !grouped.every((id) => hunks.has(id))) return null;
  return {
    ...meta,
    files,
    hunks,
    pairs: [],
    groups: s.groups,
    merges: s.merges ?? [],
    timings: {},
    options: s.options!,
    warnings: [],
  };
}

/** Only what the page reads; the rest feeds the analysis, which a saved grouping skips. */
function hunkInfo(file: FileDiff, hunk: HunkInfo["hunk"], saved: SavedReview["hunks"][string] | undefined): HunkInfo {
  return {
    hunk,
    file,
    language: null,
    isTest: saved?.isTest === true,
    symbol: saved?.symbol ?? null,
    enclosing: [],
    defines: new Set(),
    impacts: new Set(),
    references: new Set(),
    tokens: new Set(),
    fileImports: new Set(),
    commentOnly: false,
    addedDecls: [],
    removedDecls: [],
    mechanical: saved?.mechanical ?? null,
    text: "",
  };
}
