// Diffing and the semantic pipeline as one job: runs in review-worker.js, or on the page as a fallback.
// Both steps are CPU-bound and grow with PR size, so neither should run on the page's main thread.
import { structuredPatch } from "diff";
import { mergeConfig } from "../../../src/core/config";
import type { FileProvider, ReviewResult } from "../../../src/core/types";
import { SyntaxParsers } from "../../../src/parse/treesitter";
import { type PipelineProgress, runPipeline } from "../../../src/pipeline";
import type { FileChange } from "../data/model";
import { type BackendService, RemoteEmbedder, RemoteTitler } from "./backend";
import { restoreReview, reviewMode } from "./saved";

/** Old/new text for every changed file, keyed by repo path. `null` = absent on that side. */
export interface FileContents {
  old: string | null;
  new: string | null;
  binary: boolean;
  tooLarge: boolean;
}

export interface AnalysisJob {
  title: string;
  description: string;
  changes: FileChange[];
  contents: Map<string, FileContents>;
  /** Absolute URL of the folder holding the tree-sitter .wasm files. */
  assetBase: string;
  /** The Azure Function: adds the semantic signal (hunk embeddings, a model inside the function) when set. */
  backend: BackendService | null;
  /** Also send changed lines to the backend's LLM for group titles. The project must have opted in. */
  aiTitles: boolean;
  /** A grouping saved for this comparison (saved.ts); used instead of the analysis if it still fits the diff. */
  saved: unknown;
}

/** How far grouping is: `fraction` 0–1 across all stages, `label` for the UI. */
export interface AnalysisProgress {
  fraction: number;
  label: string;
}

/** Worker -> page messages, in order: the diff (for the preview), progress updates, then the result or an error. */
export type AnalysisMessage =
  | { type: "diff"; diff: string }
  | { type: "progress"; progress: AnalysisProgress }
  | { type: "result"; result: ReviewResult; /** From the saved grouping, not a fresh analysis. */ restored: boolean }
  | { type: "error"; error: string };

/** Rough share of the pipeline's time per stage, measured on large PRs (parsing dominates). */
const STAGE_SPAN: Record<PipelineProgress["stage"], [number, number]> = { parse: [0, 0.65], score: [0.65, 0.95], group: [0.95, 1] };

function describe(p: PipelineProgress): AnalysisProgress {
  const [from, to] = STAGE_SPAN[p.stage];
  const fraction = from + (to - from) * (p.total ? p.done / p.total : 0);
  const label =
    p.stage === "parse"
      ? `Reading ${p.done.toLocaleString()} of ${p.total.toLocaleString()} files`
      : p.stage === "score"
        ? "Linking related changes"
        : "Building groups";
  return { fraction, label };
}

/** At most one progress message per interval, so updates don't flood the page. */
function throttled(send: (message: AnalysisMessage) => void, ms = 150): (p: PipelineProgress) => void {
  let last = 0;
  let stage = "";
  return (p) => {
    const now = Date.now();
    if (now - last < ms && p.stage === stage) return;
    last = now;
    stage = p.stage;
    send({ type: "progress", progress: describe(p) });
  };
}

export async function runJob(job: AnalysisJob, send: (message: AnalysisMessage) => void): Promise<void> {
  try {
    const diff = buildDiff(job.changes, job.contents);
    send({ type: "diff", diff });
    const meta = { title: job.title, description: job.description };
    const restored = job.saved ? restoreReview(job.saved, reviewMode(job.backend, job.aiTitles), meta, diff) : null;
    if (restored) send({ type: "result", result: restored, restored: true });
    else send({ type: "result", result: await analyze(job, diff, throttled(send)), restored: false });
  } catch (e) {
    send({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

let parsersPromise: Promise<SyntaxParsers> | null = null;

function parsers(assetBase: string): Promise<SyntaxParsers> {
  const asset = (name: string) => new URL(name, assetBase).toString();
  parsersPromise ??= SyntaxParsers.create(
    { typescript: asset("tree-sitter-typescript.wasm"), tsx: asset("tree-sitter-tsx.wasm") },
    { locateFile: (file: string) => asset(file) },
  );
  return parsersPromise;
}

async function analyze(job: AnalysisJob, diff: string, onProgress: (p: PipelineProgress) => void): Promise<ReviewResult> {
  const texts = new Map<string, string | null>();
  for (const c of job.changes) {
    const entry = job.contents.get(c.path)!;
    if (entry.binary || entry.tooLarge) continue;
    texts.set(`new:${c.path}`, entry.new);
    texts.set(`old:${c.originalPath ?? c.path}`, entry.old);
  }
  const files: FileProvider = {
    async get(path, side) {
      return texts.get(`${side}:${path}`) ?? null;
    },
  };
  const result = await runPipeline(
    { title: job.title, description: job.description, diff, files },
    mergeConfig({ semantic: { enabled: !!job.backend } }),
    {
      parsers: await parsers(job.assetBase),
      embedder: job.backend && new RemoteEmbedder(job.backend),
      titler: job.backend && job.aiTitles ? new RemoteTitler(job.backend) : undefined,
      onProgress,
    },
  );
  // The page never reads pair scores, and on a huge PR they are the bulk of the message.
  return { ...result, pairs: [] };
}

export function buildDiff(changes: FileChange[], contents: Map<string, FileContents>): string {
  return changes.map((c) => fileDiff(c, contents.get(c.path)!)).join("");
}

/** One file's section of a `git diff -M` style patch, so the shared diff parser can consume it. */
function fileDiff(change: FileChange, content: FileContents): string {
  const oldPath = change.originalPath ?? change.path;
  const head = [`diff --git a/${oldPath} b/${change.path}`];
  if (change.changeType === "add") head.push("new file mode 100644");
  if (change.changeType === "delete") head.push("deleted file mode 100644");
  if (change.changeType === "rename") {
    head.push(`similarity index ${content.old === content.new ? 100 : 90}%`, `rename from ${oldPath}`, `rename to ${change.path}`);
  }
  if (content.binary || content.tooLarge) {
    return `${[...head, `Binary files a/${oldPath} and b/${change.path} differ`].join("\n")}\n`;
  }
  if (content.old === content.new) return `${head.join("\n")}\n`;

  const patch = structuredPatch(oldPath, change.path, content.old ?? "", content.new ?? "", "", "", { context: 3 });
  const lines = [
    ...head,
    `--- ${change.changeType === "add" ? "/dev/null" : `a/${oldPath}`}`,
    `+++ ${change.changeType === "delete" ? "/dev/null" : `b/${change.path}`}`,
  ];
  for (const h of patch.hunks) {
    lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    lines.push(...h.lines);
  }
  return `${lines.join("\n")}\n`;
}
