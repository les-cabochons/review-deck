import type { ReviewResult } from "../../../src/core/types";
import { parseDiff } from "../../../src/diff/parse";
import { blobIds } from "../data/fileReads";
import type { FileChange, PrSource } from "../data/model";
import type { AnalysisJob, AnalysisMessage, AnalysisProgress, FileContents } from "./analysis";
import type { BackendService } from "./backend";
import { carrySummary, type GuideSummary, keepsPublished, packReview, type PublishingApp, type ReviewKey, reviewMode, type SavedReview, type SavedReviews } from "./saved";

export type { AnalysisProgress, FileContents } from "./analysis";

export interface ReviewModel {
  comparison: { iteration: number; compareTo: number };
  result: ReviewResult;
  changes: FileChange[];
  contents: Map<string, FileContents>;
  /** False for the preview shown while the semantic pipeline runs: files and hunks only, no groups. */
  analyzed: boolean;
  /** The guide on show was published from this app (saved.ts): the page labels it, and never replaces it on its own. */
  published?: PublishingApp;
  /** Shown above the guide; published guides may have one. */
  summary?: GuideSummary;
  /** The reader grouped the changes over a published guide: theirs shows for the session, and Publish (publishGuide) shares it. */
  ownGuide?: SavedReview;
}

/**
 * The latest grouping of a comparison, kept until the page closes. It shows on reopen while what is saved isn't it: a
 * reader's own guide over a published one (`own`, until a Publish of it), or one the store couldn't save.
 */
interface SessionGuide {
  guide: SavedReview;
  /** Counts the comparison's groupings, so a write that settles knows whether it was the latest's. */
  generation: number;
  own: boolean;
  /** The store last wrote this guide: what is saved shows instead. */
  stored: boolean;
}
const sessionGuides = new Map<string, SessionGuide>();
const guideId = (key: ReviewKey) => JSON.stringify([key.repo, key.pr, key.iteration, key.compareTo]);

/** A new grouping replaces the comparison's session guide; returns its generation. */
function keepGrouping(id: string, guide: SavedReview, own: boolean): number {
  const generation = (sessionGuides.get(id)?.generation ?? 0) + 1;
  sessionGuides.set(id, { guide, generation, own, stored: false });
  return generation;
}

/** Why a save or Publish that never reached the store was dropped. */
const SUPERSEDED = "a newer grouping took its place";

interface QueuedWrite {
  generation: number;
  /** Calls the store. */
  start: () => Promise<boolean>;
  resolve: (written: boolean) => void;
  reject: (error: unknown) => void;
}
/** Per comparison with a write in flight: the write that starts once it settles, if any. */
const writeQueues = new Map<string, { next?: QueuedWrite }>();

/**
 * Writes `generation`'s guide to the store once the comparison's write in flight, if any, has settled, so the store
 * takes each comparison's writes one at a time, in the order they were asked for. Only the newest waits: one it
 * replaces is dropped, and rejects with SUPERSEDED.
 *
 * A write is asked for only for the latest grouping (a save when it is grouped, a Publish while it is on show), so
 * writes run in the order of their groupings, and the latest's is the last. Its success alone marks the session guide
 * stored. An older write that settles after the latest was grouped changes nothing: the latest's write, if it has
 * one, is still to come.
 */
function queueWrite(id: string, generation: number, start: () => Promise<boolean>): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const write = { generation, start, resolve, reject };
    const queue = writeQueues.get(id);
    if (!queue) return runWrite(id, write);
    queue.next?.reject(new Error(SUPERSEDED));
    queue.next = write;
  });
}

function runWrite(id: string, write: QueuedWrite) {
  const queue: { next?: QueuedWrite } = {};
  writeQueues.set(id, queue);
  let started: Promise<boolean>;
  try {
    started = write.start();
  } catch (e) {
    started = Promise.reject(e);
  }
  started
    .then((written) => {
      const entry = sessionGuides.get(id);
      if (written && entry?.generation === write.generation) entry.stored = true;
      write.resolve(written);
    }, write.reject)
    .finally(() => {
      if (queue.next) runWrite(id, queue.next);
      else writeQueues.delete(id);
    });
}

/**
 * Puts the reader's own guide (ReviewModel.ownGuide) in place of the published one, for everyone. Rejects if it
 * couldn't, or if a newer grouping replaced the guide before its write started.
 */
export async function publishGuide(store: SavedReviews, key: ReviewKey, guide: SavedReview): Promise<void> {
  const id = guideId(key);
  const entry = sessionGuides.get(id);
  if (entry?.guide !== guide) throw new Error(SUPERSEDED);
  await queueWrite(id, entry.generation, () => store.save(key, guide, { publish: true }));
}

/** Git treats text containing a NUL character as binary. */
const NUL = String.fromCharCode(0);
const MAX_DIFF_LINES = 20_000;

export interface BuildOptions {
  /** Called once the diff is ready, before the semantic analysis (slow on huge PRs) finishes; not when a saved view fits. */
  onPreview?: (model: ReviewModel) => void;
  /** Grouping progress, while the worker runs. */
  onProgress?: (progress: AnalysisProgress) => void;
  signal?: AbortSignal;
  /** The Azure Function for embeddings (and LLM titles if `aiTitles`); without it, structural grouping and heuristic titles. */
  backend?: BackendService | null;
  /** The project allows sending changed lines to the LLM (ProjectSettings.aiTitles). */
  aiTitles?: boolean;
  /**
   * Reuses the guided view saved for this comparison (by anyone), and saves a fresh one for everyone, unless a guide
   * published for the same changes is saved: the fresh one is then the reader's own (ReviewModel.ownGuide). One the
   * store couldn't save is reused for the session instead.
   */
  saved?: { store: SavedReviews; key: ReviewKey };
  /** Analyze again even if a saved grouping fits ("Regroup"); the new one replaces it, or a published one for the session. */
  fresh?: boolean;
}

/**
 * Loads both sides of every changed file, then diffs them and runs the semantic pipeline
 * (structural signals and heuristic titles, plus embeddings from the Azure Function when configured, and its
 * LLM titles when the project opted in).
 * Diffing and analysis run in a Web Worker so huge PRs don't freeze the page.
 */
export async function buildReview(
  source: PrSource,
  meta: { title: string; description: string },
  iteration: number,
  compareTo: number,
  options: BuildOptions = {},
): Promise<ReviewModel> {
  const started = performance.now();
  const backend = options.backend ?? null;
  // Read while the files download; restoreReview (in the worker) checks it still fits. A Regroup reads it too, to keep
  // a published guide. A reader's own guide over a published one shows instead, for as long as the page is open, and
  // so does a guide that couldn't be saved.
  const key = options.saved?.key;
  const stored = options.saved ? options.saved.store.load(options.saved.key) : Promise.resolve(null);
  const session = key && !options.fresh ? sessionGuides.get(guideId(key)) : undefined;
  const own = session && !session.stored ? session.guide : undefined;
  const readersOwn = own && session?.own ? own : undefined;
  // On a link straight to the PR, both reads may already be under way (data/fileReads.ts): these then take them over.
  const changes = await source.getChanges(iteration, compareTo);
  const { blobs, stats: blobStats } = await source.getBlobs(blobIds(changes), options.signal);
  options.signal?.throwIfAborted();
  const contents = new Map<string, FileContents>();
  for (const c of changes) {
    const oldText = c.oldObjectId ? (blobs.get(c.oldObjectId) ?? null) : null;
    const newText = c.newObjectId ? (blobs.get(c.newObjectId) ?? null) : null;
    const binary = [oldText, newText].some((t) => t !== null && t.includes(NUL));
    const lines = Math.max(countLines(oldText), countLines(newText));
    contents.set(c.path, { old: oldText, new: newText, binary, tooLarge: lines > MAX_DIFF_LINES });
  }
  const fetchMs = Math.round(performance.now() - started);
  const comparison = { iteration, compareTo };

  const aiTitles = options.aiTitles === true;
  const storedNow = await stored;
  const saved = options.fresh ? null : (own ?? storedNow);
  const job: AnalysisJob = { ...meta, changes, contents, backend, aiTitles, saved, assetBase: new URL("../assets/", document.baseURI).toString() };
  const { result, restored, skipped, published, summary } = await runAnalysis(job, options.signal, (message) => {
    if (message.type === "diff") options.onPreview?.({ result: previewResult(meta, message.diff), changes, contents, comparison, analyzed: false });
    else if (message.type === "progress") options.onProgress?.(message.progress);
  });
  for (const warning of result.warnings) console.warn("[review-deck]", warning);
  console.debug("[review-deck] review built", { files: changes.length, hunks: result.hunks.size, restored, blobs: blobStats, fetchMs, totalMs: Math.round(performance.now() - started), ...result.timings });
  if (options.saved) console.info(`[review-deck] guided view: ${restored ? `reused ${own ? "the reader's own" : "the saved one"}` : `grouped ${whyGrouped(options.fresh, job.saved, skipped)}`}`);
  let ownGuide = restored ? readersOwn : undefined;
  let fresh: SavedReview | undefined;
  if (!restored && options.saved) {
    // A regrouping of the same hunks keeps the saved guide's summary, whether it is the published guide or the one a
    // Publish saved in its place.
    const review = carrySummary(storedNow, packReview(result, reviewMode(backend, aiTitles)));
    const id = guideId(options.saved.key);
    fresh = review;
    // Over a published guide for the same hunks, it is the reader's own, and isn't saved.
    const overPublished = keepsPublished(storedNow, review);
    const generation = keepGrouping(id, review, overPublished);
    if (overPublished) ownGuide = review;
    else {
      const saving = options.saved;
      // A save that a newer grouping's replaced before it started is dropped: nothing to report.
      void queueWrite(id, generation, () => saving.store.save(saving.key, review)).catch(() => {});
    }
  }
  const shownSummary = summary ?? fresh?.summary;
  return { result, changes, contents, comparison, analyzed: true, ...(published && { published }), ...(shownSummary && { summary: shownSummary }), ...(ownGuide && { ownGuide }) };
}

function whyGrouped(fresh: boolean | undefined, saved: unknown, skipped: string | undefined): string {
  if (fresh) return "again on request";
  return saved ? `again because the saved one doesn't fit: ${skipped ?? "unknown"}` : "for the first time (none saved for this comparison)";
}

/** Files and hunks straight from the diff (a few ms even for huge PRs), so the page can show them at once. */
function previewResult(meta: { title: string; description: string }, diff: string): ReviewResult {
  return {
    ...meta,
    files: parseDiff(diff),
    hunks: new Map(),
    pairs: [],
    groups: [],
    merges: [],
    timings: {},
    options: { semantic: false, titler: "none", weights: { structural: 0, testPairing: 0, lexical: 0, semantic: 0, path: 0, description: 0 }, minEdgeWeight: 0 },
    warnings: [],
  };
}

/** Runs the job in review-worker.js; falls back to the page if the worker can't start. */
function runAnalysis(
  job: AnalysisJob,
  signal: AbortSignal | undefined,
  onUpdate: (message: Extract<AnalysisMessage, { type: "diff" | "progress" }>) => void,
): Promise<Omit<Extract<AnalysisMessage, { type: "result" }>, "type">> {
  return new Promise((resolve, reject) => {
    const receive = (message: AnalysisMessage) => {
      if (message.type === "diff" || message.type === "progress") onUpdate(message);
      else if (message.type === "result") resolve(message);
      else reject(new Error(message.error));
    };
    const onPage = () => {
      if (!signal?.aborted) import("./analysis").then(({ runJob }) => runJob(job, receive), reject);
    };
    let worker: Worker;
    try {
      worker = new Worker(new URL("./review-worker.js", import.meta.url), { type: "module" });
    } catch {
      onPage();
      return;
    }
    const stop = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      stop();
      reject(new DOMException("Analysis cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (e: MessageEvent<AnalysisMessage>) => {
      if (e.data.type === "result" || e.data.type === "error") stop();
      receive(e.data);
    };
    // Fires when the worker script can't load (missing file, blocked by CSP): do the work on the page.
    worker.onerror = (e) => {
      e.preventDefault();
      stop();
      console.warn("[review-deck] analysis worker unavailable, running on the page:", e.message);
      onPage();
    };
    worker.postMessage(job);
  });
}

function countLines(text: string | null): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
