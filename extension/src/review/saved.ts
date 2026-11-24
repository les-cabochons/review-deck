// Finished guided views, saved so the PR is grouped once: reopening it, or anyone else opening it, skips the
// analysis (parsing, embeddings, LLM titles). Azure DevOps iterations never change, so a comparison's diff is fixed,
// and a saved view is reused as long as it covers exactly that diff's hunks, across extension versions too. Editing
// the title or description doesn't drop it either: the page shows it and offers to regroup (`madeWith`). An analysis
// that fell back (backend down, a spending cap reached) is saved too, so an outage doesn't regroup on every open, and
// is grouped again after a while (`fellBack`). AppHost.savedReviews() keeps one document per PR with the comparisons last grouped (savedFor, withSaved).
// A guide published from Ajour (`madeWith.app`) shows whatever the reader's settings and is never replaced on its own:
// a reader who regroups keeps their guide for the session, and only Publish puts theirs in its place (keepsPublished).
// Nor is it dropped to make room for another comparison: a guide that doesn't fit beside it isn't saved (GuideTooLarge).
import type { FileDiff, Group, HunkInfo, MechanicalInfo, ReviewRelations, ReviewResult, TitleSource } from "../../../src/core/types";
import { parseDiff } from "../../../src/diff/parse";
import { readRelations } from "../../../src/relations/relations";

/**
 * Bump when the saved shape changes, or to have every PR grouped again (saved views outlive extension versions).
 * 2: the description guides grouping. 3: groups record who wrote their title (`titleSource`).
 * 4: the title and description the grouping was made with (`madeWith`), instead of a hash that discarded it on edits.
 * Still 4 with `madeWith.app` and `summary`: both are optional, and readers before them ignore fields they don't know.
 */
const FORMAT = 4;

/** Comparisons kept per PR, most recently grouped first: the default one, plus the few others reviewers opened. */
const MAX_COMPARISONS = 4;
/**
 * A PR's document keeps other comparisons only while it stays under this many characters. Published guides always
 * stay: the new one fits beside them or isn't saved (GuideTooLarge). Alone, it always fits.
 */
const MAX_DOC_CHARS = 256_000;

/** How long a guided view made while the backend failed is reused before the next open groups again. */
const RETRY_FALLBACK_MS = 60 * 60 * 1000;

/** Which comparison of which pull request; iterations are numbered per PR, 0 = the PR's base. */
export interface ReviewKey {
  repo: string;
  pr: number;
  iteration: number;
  compareTo: number;
}

/**
 * Where finished groupings are kept (AppHost.savedReviews). Neither method rejects, saving being only a speed-up,
 * except a Publish (`publish`), which its reader asked for and is told about when it fails.
 */
export interface SavedReviews {
  /** The saved grouping, unchecked (restoreReview checks it), or null. */
  load(key: ReviewKey): Promise<unknown>;
  /**
   * `publish`: replace even a published guide (withSaved). Resolves false if `review` isn't saved, nor anything in its
   * place (it doesn't fit beside the published guides, or the save failed): the page then keeps it for the session.
   */
  save(key: ReviewKey, review: SavedReview, options?: { publish?: boolean }): Promise<boolean>;
}

/** Thrown by withSaved: the guide doesn't fit in the PR's document beside the guides published for its other comparisons. */
export class GuideTooLarge extends Error {
  constructor(chars: number) {
    super(`the guided view doesn't fit beside the published guides (${chars} characters, over ${MAX_DOC_CHARS})`);
    this.name = "GuideTooLarge";
  }
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

/** The apps that publish guides for Review Deck to show. Absent, Review Deck grouped it. */
export type PublishingApp = "ajour";

/** The kinds of change a summary names, in the order they show. */
export const CHANGE_KINDS = ["breaking", "feature", "fix", "refactor", "performance", "tests", "docs", "dependencies", "build"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** One line of a summary, with the hunks it is about (`path#n`, as in the guide's groups). */
export interface SummaryItem {
  text: string;
  hunkIds: string[];
}

/** What the change is about, shown above the guide: written by the app that published it (Ajour). */
export interface GuideSummary {
  /** What the PR fixes: from its linked ticket, or inferred from the commits and code. */
  problem: { text: string; source: "ticket" | "inferred"; ticket?: { id: string; title: string; url: string } };
  kinds: ChangeKind[];
  breaking: SummaryItem[];
  /** Migrations, security and auth, data deletion, concurrency. */
  risks: SummaryItem[];
  /** Which concerns have tests, and which changed code has none. */
  tests: SummaryItem[];
  /** TODOs, debug output, commented-out code and skipped tests the PR adds. */
  leftovers: SummaryItem[];
}

export interface SavedReview {
  format: number;
  /** Ignored for a published guide: it shows whatever mode the page groups in. */
  mode: ReviewMode;
  /**
   * The PR's title and description when it was grouped; the page offers to regroup once they differ. `app`: the app
   * that published it, which makes it stay until a reader publishes another (keepsPublished).
   */
  madeWith: { title: string; description: string; app?: PublishingApp };
  /** Shown above the guide; only published guides have one. */
  summary?: GuideSummary;
  /** When it was grouped (ms since the epoch). */
  savedAt: number;
  /** Made without part of `mode` (embeddings or LLM titles failed): reused for RETRY_FALLBACK_MS only. */
  fellBack?: true;
  groups: Group[];
  merges: ReviewResult["merges"];
  options: ReviewResult["options"];
  /**
   * The hunk facts the page shows, only for hunks that have any (most have none). `affected` was added without a
   * new format: a guide saved before it lists no affected code until the PR is grouped again.
   */
  hunks: Record<string, { symbol?: string; isTest?: true; mechanical?: MechanicalInfo; affected?: string[] }>;
  /**
   * How the concerns connect (src/relations). Optional, so the format stays 4: guides saved before it, and guides
   * another app published without it, show their concerns without links, and the page says why.
   */
  relations?: ReviewRelations;
}

/** What `result` needs saved, made in `mode`; one that fell back somewhere (backend down, titles failed) says so. */
export function packReview(result: ReviewResult, mode: ReviewMode, now = Date.now()): SavedReview {
  const hunks: SavedReview["hunks"] = {};
  for (const [id, h] of result.hunks) {
    if (!h.symbol && !h.isTest && !h.mechanical && h.affected.length === 0) continue;
    hunks[id] = {
      ...(h.symbol && { symbol: h.symbol }),
      ...(h.isTest && { isTest: true }),
      ...(h.mechanical && { mechanical: h.mechanical }),
      ...(h.affected.length > 0 && { affected: h.affected }),
    };
  }
  const madeWith = { title: result.title, description: result.description };
  const fellBack = result.warnings.length > 0 ? { fellBack: true as const } : {};
  const relations = result.relations ? { relations: result.relations } : {};
  return { format: FORMAT, mode, madeWith, savedAt: now, ...fellBack, groups: result.groups, merges: result.merges, options: result.options, hunks, ...relations };
}

/** Where `review` came from, if another app published it (see SavedReview.madeWith). */
function publishedBy(review: unknown): PublishingApp | null {
  return (review as Partial<SavedReview> | null)?.madeWith?.app === "ajour" ? "ajour" : null;
}

/**
 * Whether `saved` is a published guide that saving `review` leaves in place: it is for the same hunks, so it still
 * shows for everyone, and `review` is only its reader's. One for other hunks (a new push, another diff), or that
 * restoreReview couldn't read, is no use now.
 */
export function keepsPublished(saved: unknown, review: SavedReview): boolean {
  const groups = publishedBy(saved) && readable(saved);
  return !!groups && covers(groups, idsOf(review));
}

/**
 * `review`, a regrouping, with the summary of `saved` if that is a whole guide for the same hunks: the summary goes
 * wherever the guide goes, whether `saved` is still the published guide or the one a Publish saved in its place.
 */
export function carrySummary(saved: unknown, review: SavedReview): SavedReview {
  const groups = readable(saved);
  if (!groups || !covers(groups, idsOf(review))) return review;
  const summary = readSummary((saved as Partial<SavedReview>).summary, idsOf(review));
  return summary ? { ...review, summary } : review;
}

const idsOf = (review: SavedReview): ReadonlySet<string> => new Set(review.groups.flatMap((g) => g.hunkIds));

const TITLE_SOURCES: readonly unknown[] = ["llm", "description", "heuristic"] satisfies TitleSource[];
const MECHANICAL_KINDS: readonly unknown[] = ["lockfile", "generated", "rename", "binary", "whitespace", "dependency-manifest"] satisfies MechanicalInfo["kind"][];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The groups of a saved entry in this format, if it holds everything the page needs: the title and description it was
 * made with, whole groups (`id`, `kind`, `title` and `rationale` strings, `hunkIds` an array of strings), its
 * `options`, and its `merges` and `hunks` if it has them. Null if any is missing or malformed. Optional parts that
 * are malformed are dropped instead: a title source the page doesn't know, and hunk facts (factsOf).
 */
function readable(saved: unknown): Group[] | null {
  const s = saved as Partial<SavedReview> | null | undefined;
  if (s?.format !== FORMAT || typeof s.madeWith?.title !== "string" || typeof s.madeWith.description !== "string" || !Array.isArray(s.groups)) return null;
  if (!isRecord(s.options) || ("hunks" in s && !isRecord(s.hunks))) return null;
  const merge = (m: unknown) => isRecord(m) && typeof m.from === "string" && typeof m.into === "string" && typeof m.symbol === "string";
  if (s.merges !== undefined && !(Array.isArray(s.merges) && s.merges.every(merge))) return null;
  const valid = (g: Partial<Group> | null) =>
    typeof g?.id === "string" &&
    typeof g.kind === "string" &&
    typeof g.title === "string" &&
    typeof g.rationale === "string" &&
    Array.isArray(g.hunkIds) &&
    g.hunkIds.every((id) => typeof id === "string");
  const groups = s.groups as (Partial<Group> | null)[];
  if (!groups.every(valid)) return null;
  return (groups as Group[]).map(({ titleSource, ...g }) => (TITLE_SOURCES.includes(titleSource) ? { ...g, titleSource } : g));
}

/**
 * A saved hunk's facts, keeping only those that hold what the page renders: a symbol's text, the test tag, a
 * known mechanical kind with its reason, and the names of the unchanged code it affects. A guide saved before
 * `affected` existed has none.
 */
function factsOf(saved: unknown): SavedReview["hunks"][string] {
  if (!isRecord(saved)) return {};
  const m = saved.mechanical;
  const mechanical = isRecord(m) && MECHANICAL_KINDS.includes(m.kind) && typeof m.reason === "string" && m.reason.trim() ? ({ kind: m.kind, reason: m.reason } as MechanicalInfo) : null;
  return {
    ...(typeof saved.symbol === "string" && saved.symbol.trim() && { symbol: saved.symbol }),
    ...(saved.isTest === true && { isTest: true as const }),
    ...(mechanical && { mechanical }),
    ...(Array.isArray(saved.affected) && { affected: saved.affected.filter((name): name is string => typeof name === "string") }),
  };
}

/** Whether `groups` hold exactly the hunks `ids`, each once. */
function covers(groups: Group[], ids: ReadonlySet<string>): boolean {
  const grouped = groups.flatMap((g) => g.hunkIds);
  return grouped.length === ids.size && new Set(grouped).size === ids.size && grouped.every((id) => ids.has(id));
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
 * A PR's saved views with `review` as `key`'s comparison's, first, then the guides published for other comparisons,
 * then as many of the others as fit, most recently grouped first, so switching comparisons doesn't evict the one
 * everyone else opens. Null if there's nothing to save: a guide published for the same hunks is saved and this isn't
 * a Publish, or `review` fell back, and a complete one made the same way, from the same title and description, is
 * saved. Throws GuideTooLarge if `review` doesn't fit beside the published guides, Publish or not: they are never
 * dropped to make room.
 */
export function withSaved(comparisons: unknown, key: ReviewKey, review: SavedReview, options: { publish?: boolean } = {}): SavedComparison[] | null {
  const saved = Array.isArray(comparisons)
    ? (comparisons as Partial<SavedComparison>[]).filter((c): c is SavedComparison => !!c?.review && typeof c.iteration === "number" && typeof c.compareTo === "number")
    : [];
  const same = (c: SavedComparison) => c.iteration === key.iteration && c.compareTo === key.compareTo;
  const current = saved.find(same)?.review;
  if (!options.publish && keepsPublished(current, review)) return null;
  // E.g. two reviewers grouped it at once and only one reached the backend: everyone keeps getting the complete one.
  // A Regroup after editing the description still replaces it: that's the grouping its reader asked for.
  if (!options.publish && review.fellBack && current && !current.fellBack && current.format === review.format && sameMode(current.mode, review.mode) && sameText(current.madeWith, review.madeWith)) {
    return null;
  }
  const others = saved.filter((c) => !same(c));
  const published = others.filter((c) => publishedBy(c.review));
  const kept: SavedComparison[] = [{ iteration: key.iteration, compareTo: key.compareTo, review }, ...published];
  let chars = kept.reduce((sum, c) => sum + JSON.stringify(c).length, 0);
  if (published.length > 0 && chars > MAX_DOC_CHARS) throw new GuideTooLarge(chars);
  for (const c of others.filter((c) => !publishedBy(c.review))) {
    chars += JSON.stringify(c).length;
    if (kept.length >= MAX_COMPARISONS || chars > MAX_DOC_CHARS) break;
    kept.push(c);
  }
  return kept;
}

/**
 * A saved guided view on top of the diff, with the app that published it and its summary if it has them, or why the
 * page groups the PR again instead (logged by buildReview).
 */
export type Restored = { result: ReviewResult; published?: PublishingApp; summary?: GuideSummary } | { skipped: string };

/**
 * The saved grouping on top of a freshly parsed diff, unless it doesn't fit: another format or mode, made while the
 * backend failed over RETRY_FALLBACK_MS ago, or groups that don't cover exactly this diff's hunks. Its title and
 * description are the ones it was made with. A published guide fits in any mode, and for good.
 */
export function restoreReview(saved: unknown, mode: ReviewMode, diff: string, now = Date.now()): Restored {
  const s = saved as Partial<SavedReview> | null | undefined;
  if (s?.format !== FORMAT) return { skipped: `it was saved in format ${s?.format ?? "none"}, and this version reads ${FORMAT}` };
  const published = publishedBy(s);
  if (!published && !sameMode(s.mode, mode)) {
    return { skipped: `it was made ${describeMode(s.mode)}, and the page now groups ${describeMode(mode)}` };
  }
  const groups = readable(s);
  if (!groups) return { skipped: "it is incomplete" };
  if (!published && s.fellBack && !(now - (s.savedAt ?? 0) < RETRY_FALLBACK_MS)) return { skipped: "it was made while the backend was failing, over an hour ago" };
  const files = parseDiff(diff);
  const hunks = new Map<string, HunkInfo>();
  const facts = (id: string) => factsOf(s.hunks && Object.hasOwn(s.hunks, id) ? s.hunks[id] : undefined);
  for (const file of files) for (const hunk of file.hunks) hunks.set(hunk.id, hunkInfo(file, hunk, facts(hunk.id)));
  if (!covers(groups, new Set(hunks.keys()))) return { skipped: "its groups don't cover this diff's changes" };
  const result: ReviewResult = {
    title: s.madeWith!.title,
    description: s.madeWith!.description,
    files,
    hunks,
    pairs: [],
    groups,
    merges: s.merges ?? [],
    timings: {},
    options: s.options!,
    warnings: [],
  };
  const relations = readRelations(s.relations, new Set(groups.map((g) => g.id)), new Set(hunks.keys()));
  if (relations) result.relations = relations;
  const summary = readSummary(s.summary, new Set(hunks.keys()));
  return { result, ...(published && { published }), ...(summary && { summary }) };
}

/**
 * The summary as written by another app, checked line by line: its text is trimmed, a line without any is left out,
 * hunk ids not in this diff (`ids`) are dropped, and so is a ticket link that isn't http(s). Without a problem to
 * state, there is none.
 */
function readSummary(raw: unknown, ids: ReadonlySet<string>): GuideSummary | null {
  const s = raw as Record<string, unknown> | null | undefined;
  const problem = s?.problem as Record<string, unknown> | undefined;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const stated = text(problem?.text);
  if (!s || !stated || (problem!.source !== "ticket" && problem!.source !== "inferred")) return null;
  const t = problem!.ticket as Record<string, unknown> | undefined;
  const ticket =
    typeof t?.id === "string" && typeof t.title === "string" && typeof t.url === "string" && /^https?:\/\//i.test(t.url) ? { id: t.id, title: t.title, url: t.url } : null;
  const items = (list: unknown): SummaryItem[] =>
    (Array.isArray(list) ? (list as (Record<string, unknown> | null)[]) : []).flatMap((item) =>
      text(item?.text)
        ? [{ text: text(item!.text), hunkIds: (Array.isArray(item!.hunkIds) ? (item!.hunkIds as unknown[]) : []).filter((id): id is string => typeof id === "string" && ids.has(id)) }]
        : [],
    );
  return {
    problem: { text: stated, source: problem!.source, ...(ticket && { ticket }) },
    kinds: (Array.isArray(s.kinds) ? (s.kinds as unknown[]) : []).filter((k): k is ChangeKind => (CHANGE_KINDS as readonly unknown[]).includes(k)),
    breaking: items(s.breaking),
    risks: items(s.risks),
    tests: items(s.tests),
    leftovers: items(s.leftovers),
  };
}

function sameMode(a: Partial<ReviewMode> | undefined, b: ReviewMode): boolean {
  return a?.semantic === b.semantic && a.llmTitles === b.llmTitles;
}

function sameText(a: Partial<SavedReview["madeWith"]> | undefined, b: SavedReview["madeWith"]): boolean {
  return a?.title === b.title && a.description === b.description;
}

function describeMode(mode: Partial<ReviewMode> | undefined): string {
  return `${mode?.semantic ? "with" : "without"} embeddings and ${mode?.llmTitles ? "with" : "without"} AI titles`;
}

/** Only what the page reads (`saved`, checked by factsOf); the rest feeds the analysis, which a saved grouping skips. */
function hunkInfo(file: FileDiff, hunk: HunkInfo["hunk"], saved: SavedReview["hunks"][string]): HunkInfo {
  return {
    hunk,
    file,
    language: null,
    isTest: saved.isTest === true,
    symbol: saved.symbol ?? null,
    enclosing: [],
    defines: new Set(),
    impacts: new Set(),
    affected: saved.affected ?? [],
    references: new Set(),
    tokens: new Set(),
    fileImports: new Set(),
    commentOnly: false,
    addedDecls: [],
    removedDecls: [],
    mechanical: saved.mechanical ?? null,
    text: "",
  };
}
