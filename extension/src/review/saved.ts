// Finished guided views, saved so the PR is grouped once: reopening it, or anyone else opening it, skips the
// analysis (parsing, embeddings, LLM titles). Azure DevOps iterations never change, so a comparison's diff is fixed,
// and a saved view is reused as long as it covers exactly that diff's hunks, across extension versions too. Editing
// the title or description doesn't drop it either: the page shows it and offers to regroup (`madeWith`). An analysis
// that fell back (backend down, a spending cap reached) is saved too, so an outage doesn't regroup on every open, and
// is grouped again after a while (`fellBack`). AppHost.savedReviews() keeps one document per PR with the comparisons last grouped (savedFor, withSaved).
import type { FileDiff, Group, HunkInfo, MechanicalInfo, ReviewResult } from "../../../src/core/types";
import { parseDiff } from "../../../src/diff/parse";

/**
 * Bump when the saved shape changes, or to have every PR grouped again (saved views outlive extension versions).
 * 2: the description guides grouping. 3: groups record who wrote their title (`titleSource`).
 * 4: the title and description the grouping was made with (`madeWith`), instead of a hash that discarded it on edits.
 */
const FORMAT = 4;

/** Comparisons kept per PR, most recently grouped first: the default one, plus the few others reviewers opened. */
const MAX_COMPARISONS = 4;

/** How long a guided view made while the backend failed is reused before the next open groups again. */
const RETRY_FALLBACK_MS = 60 * 60 * 1000;

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
  /** The PR's title and description when it was grouped; the page offers to regroup once they differ. */
  madeWith: { title: string; description: string };
  /** When it was grouped (ms since the epoch). */
  savedAt: number;
  /** Made without part of `mode` (embeddings or LLM titles failed): reused for RETRY_FALLBACK_MS only. */
  fellBack?: true;
  groups: Group[];
  merges: ReviewResult["merges"];
  options: ReviewResult["options"];
  /** The hunk facts the page shows, only for hunks that have any (most have none). */
  hunks: Record<string, { symbol?: string; isTest?: true; mechanical?: MechanicalInfo }>;
}

/** What `result` needs saved, made in `mode`; one that fell back somewhere (backend down, titles failed) says so. */
export function packReview(result: ReviewResult, mode: ReviewMode, now = Date.now()): SavedReview {
  const hunks: SavedReview["hunks"] = {};
  for (const [id, h] of result.hunks) {
    if (!h.symbol && !h.isTest && !h.mechanical) continue;
    hunks[id] = { ...(h.symbol && { symbol: h.symbol }), ...(h.isTest && { isTest: true }), ...(h.mechanical && { mechanical: h.mechanical }) };
  }
  const madeWith = { title: result.title, description: result.description };
  const fellBack = result.warnings.length > 0 ? { fellBack: true as const } : {};
  return { format: FORMAT, mode, madeWith, savedAt: now, ...fellBack, groups: result.groups, merges: result.merges, options: result.options, hunks };
}

/** One comparison's saved view, as AppHost.savedReviews() keeps them in the PR's document. */
export interface SavedComparison {
  iteration: number;
  compareTo: number;
  review: SavedReview;
}

/** The view saved for `key`'s comparison among a PR's (as read, so unchecked), or null. */
export function savedFor(comparisons: unknown, key: ReviewKey): unknown {
  if (!Array.isArray(comparisons)) return null;
  const c = (comparisons as Partial<SavedComparison>[]).find((c) => c?.iteration === key.iteration && c.compareTo === key.compareTo);
  return c?.review ?? null;
}

/**
 * A PR's saved views with `review` as `key`'s comparison's, first, then the others most recently grouped, so
 * switching comparisons doesn't evict the one everyone else opens.
 */
export function withSaved(comparisons: unknown, key: ReviewKey, review: SavedReview, max = MAX_COMPARISONS): SavedComparison[] {
  const others = Array.isArray(comparisons)
    ? (comparisons as Partial<SavedComparison>[]).filter(
        (c): c is SavedComparison => !!c?.review && typeof c.iteration === "number" && typeof c.compareTo === "number" && !(c.iteration === key.iteration && c.compareTo === key.compareTo),
      )
    : [];
  return [{ iteration: key.iteration, compareTo: key.compareTo, review }, ...others].slice(0, max);
}

/** A saved guided view on top of the diff, or why the page groups the PR again instead (logged by buildReview). */
export type Restored = { result: ReviewResult } | { skipped: string };

/**
 * The saved grouping on top of a freshly parsed diff, unless it doesn't fit: another format or mode, made while the
 * backend failed over RETRY_FALLBACK_MS ago, or groups that don't cover exactly this diff's hunks. Its title and
 * description are the ones it was made with.
 */
export function restoreReview(saved: unknown, mode: ReviewMode, diff: string, now = Date.now()): Restored {
  const s = saved as Partial<SavedReview> | null | undefined;
  if (s?.format !== FORMAT) return { skipped: `it was saved in format ${s?.format ?? "none"}, and this version reads ${FORMAT}` };
  if (s.mode?.semantic !== mode.semantic || s.mode.llmTitles !== mode.llmTitles) {
    return { skipped: `it was made ${describeMode(s.mode)}, and the page now groups ${describeMode(mode)}` };
  }
  if (!Array.isArray(s.groups) || typeof s.madeWith?.title !== "string" || typeof s.madeWith.description !== "string") return { skipped: "it is incomplete" };
  if (s.fellBack && !(now - (s.savedAt ?? 0) < RETRY_FALLBACK_MS)) return { skipped: "it was made while the backend was failing, over an hour ago" };
  const files = parseDiff(diff);
  const hunks = new Map<string, HunkInfo>();
  for (const file of files) for (const hunk of file.hunks) hunks.set(hunk.id, hunkInfo(file, hunk, s.hunks?.[hunk.id]));
  const grouped = s.groups.flatMap((g) => g.hunkIds);
  if (grouped.length !== hunks.size || !grouped.every((id) => hunks.has(id))) return { skipped: "its groups don't cover this diff's changes" };
  const result: ReviewResult = {
    title: s.madeWith.title,
    description: s.madeWith.description,
    files,
    hunks,
    pairs: [],
    groups: s.groups,
    merges: s.merges ?? [],
    timings: {},
    options: s.options!,
    warnings: [],
  };
  return { result };
}

function describeMode(mode: Partial<ReviewMode> | undefined): string {
  return `${mode?.semantic ? "with" : "without"} embeddings and ${mode?.llmTitles ? "with" : "without"} AI titles`;
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
