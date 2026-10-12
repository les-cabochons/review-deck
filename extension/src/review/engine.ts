import type { ReviewResult } from "../../../src/core/types";
import { parseDiff } from "../../../src/diff/parse";
import type { FileChange, PrSource } from "../data/model";
import type { AnalysisJob, AnalysisMessage, AnalysisProgress, FileContents } from "./analysis";

export type { AnalysisProgress, FileContents } from "./analysis";

export interface ReviewModel {
  comparison: { iteration: number; compareTo: number };
  result: ReviewResult;
  changes: FileChange[];
  contents: Map<string, FileContents>;
  /** False for the preview shown while the semantic pipeline runs: files and hunks only, no groups. */
  analyzed: boolean;
}

/** Git treats text containing a NUL character as binary. */
const NUL = String.fromCharCode(0);
const MAX_DIFF_LINES = 20_000;
/** Parallel blob requests; Azure DevOps throttles bursts, and a huge PR can have thousands of blobs. */
const FETCH_CONCURRENCY = 16;

export interface BuildOptions {
  /** Called once the diff is ready, before the semantic analysis (slow on huge PRs) finishes. */
  onPreview?: (model: ReviewModel) => void;
  /** Grouping progress, while the worker runs. */
  onProgress?: (progress: AnalysisProgress) => void;
  signal?: AbortSignal;
}

/**
 * Loads both sides of every changed file, then diffs them and runs the semantic pipeline
 * (structural signals + heuristic titles; embeddings and LLM titles are Node-only for now).
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
  const changes = await source.getChanges(iteration, compareTo);
  const contents = new Map<string, FileContents>();
  await forEachLimited(
    changes,
    FETCH_CONCURRENCY,
    async (c) => {
      const [oldText, newText] = await Promise.all([
        c.oldObjectId ? source.getBlob(c.oldObjectId) : Promise.resolve(null),
        c.newObjectId ? source.getBlob(c.newObjectId) : Promise.resolve(null),
      ]);
      const binary = [oldText, newText].some((t) => t !== null && t.includes(NUL));
      const lines = Math.max(countLines(oldText), countLines(newText));
      contents.set(c.path, { old: oldText, new: newText, binary, tooLarge: lines > MAX_DIFF_LINES });
    },
    options.signal,
  );
  const fetchMs = Math.round(performance.now() - started);
  const comparison = { iteration, compareTo };

  const job: AnalysisJob = { ...meta, changes, contents, assetBase: new URL("../assets/", document.baseURI).toString() };
  const result = await runAnalysis(job, options.signal, (message) => {
    if (message.type === "diff") options.onPreview?.({ result: previewResult(meta, message.diff), changes, contents, comparison, analyzed: false });
    else if (message.type === "progress") options.onProgress?.(message.progress);
  });
  console.debug("[semantic-pr] review built", { files: changes.length, hunks: result.hunks.size, fetchMs, totalMs: Math.round(performance.now() - started), ...result.timings });
  return { result, changes, contents, comparison, analyzed: true };
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
    options: { semantic: false, titler: "none", weights: { structural: 0, testPairing: 0, lexical: 0, semantic: 0, path: 0 }, minEdgeWeight: 0 },
    warnings: [],
  };
}

/** Runs the job in review-worker.js; falls back to the page if the worker can't start. */
function runAnalysis(
  job: AnalysisJob,
  signal: AbortSignal | undefined,
  onUpdate: (message: Extract<AnalysisMessage, { type: "diff" | "progress" }>) => void,
): Promise<ReviewResult> {
  return new Promise<ReviewResult>((resolve, reject) => {
    const receive = (message: AnalysisMessage) => {
      if (message.type === "diff" || message.type === "progress") onUpdate(message);
      else if (message.type === "result") resolve(message.result);
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
      console.warn("[semantic-pr] analysis worker unavailable, running on the page:", e.message);
      onPage();
    };
    worker.postMessage(job);
  });
}

async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      signal?.throwIfAborted();
      await fn(items[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

function countLines(text: string | null): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
