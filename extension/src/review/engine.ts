import { structuredPatch } from "diff";
import { mergeConfig } from "../../../src/core/config";
import type { FileProvider, ReviewResult } from "../../../src/core/types";
import { SyntaxParsers } from "../../../src/parse/treesitter";
import { runPipeline } from "../../../src/pipeline";
import type { FileChange, PrSource } from "../data/model";

/** Old/new text for every changed file, keyed by repo path. `null` = absent on that side. */
export interface FileContents {
  old: string | null;
  new: string | null;
  binary: boolean;
  tooLarge: boolean;
}

export interface ReviewModel {
  result: ReviewResult;
  changes: FileChange[];
  contents: Map<string, FileContents>;
}

const MAX_DIFF_LINES = 20_000;

let parsersPromise: Promise<SyntaxParsers> | null = null;

/** tree-sitter WASM files ship in ../assets relative to the page (see extension/build.mjs). */
function parsers(): Promise<SyntaxParsers> {
  const asset = (name: string) => new URL(`../assets/${name}`, document.baseURI).toString();
  parsersPromise ??= SyntaxParsers.create(
    { typescript: asset("tree-sitter-typescript.wasm"), tsx: asset("tree-sitter-tsx.wasm") },
    { locateFile: (file: string) => asset(file) },
  );
  return parsersPromise;
}

/**
 * Loads both sides of every changed file, builds a git-style unified diff, and runs the semantic
 * pipeline on it (structural signals + heuristic titles; embeddings and LLM titles are Node-only for now).
 */
export async function buildReview(
  source: PrSource,
  meta: { title: string; description: string },
  iteration: number,
  compareTo: number,
): Promise<ReviewModel> {
  const changes = await source.getChanges(iteration, compareTo);
  const contents = new Map<string, FileContents>();
  await Promise.all(
    changes.map(async (c) => {
      const [oldText, newText] = await Promise.all([
        c.oldObjectId ? source.getBlob(c.oldObjectId) : Promise.resolve(null),
        c.newObjectId ? source.getBlob(c.newObjectId) : Promise.resolve(null),
      ]);
      const binary = [oldText, newText].some((t) => t !== null && t.includes("\u0000"));
      const lines = Math.max(countLines(oldText), countLines(newText));
      contents.set(c.path, { old: oldText, new: newText, binary, tooLarge: lines > MAX_DIFF_LINES });
    }),
  );

  const diff = changes.map((c) => fileDiff(c, contents.get(c.path)!)).join("");
  const byPath = new Map<string, FileContents>();
  for (const c of changes) {
    byPath.set(`new:${c.path}`, contents.get(c.path)!);
    if (c.originalPath) byPath.set(`old:${c.originalPath}`, contents.get(c.path)!);
    else byPath.set(`old:${c.path}`, contents.get(c.path)!);
  }
  const files: FileProvider = {
    async get(path, side) {
      const entry = byPath.get(`${side}:${path}`);
      if (!entry || entry.binary || entry.tooLarge) return null;
      return side === "old" ? entry.old : entry.new;
    },
  };

  const result = await runPipeline(
    { title: meta.title, description: meta.description, diff, files },
    mergeConfig({ semantic: { enabled: false } }),
    { parsers: await parsers() },
  );
  return { result, changes, contents };
}

function countLines(text: string | null): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
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
