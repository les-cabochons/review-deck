import { structuredPatch } from "diff";
import { mergeConfig } from "../../core/config.js";
import type { FileProvider, HunkInfo } from "../../core/types.js";
import { parseDiff } from "../../diff/parse.js";
import { createNodeParsers } from "../../node/parsers.js";
import { analyzeHunks } from "../hunks.js";

const parsers = await createNodeParsers();

/**
 * The analysed hunks of one file, in file order, parsed with the real grammar for `path`. `before` is null for a
 * file the change adds, `after` for one it deletes.
 */
export async function analyzeFile(path: string, before: string[] | null, after: string[] | null): Promise<HunkInfo[]> {
  const [oldText, newText] = [before?.join("\n") ?? "", after?.join("\n") ?? ""];
  const patch = structuredPatch(path, path, oldText, newText, "", "", { context: 0 });
  const diff = [
    `diff --git a/${path} b/${path}`,
    ...(before ? [] : ["new file mode 100644"]),
    ...(after ? [] : ["deleted file mode 100644"]),
    `--- ${before ? `a/${path}` : "/dev/null"}`,
    `+++ ${after ? `b/${path}` : "/dev/null"}`,
    ...patch.hunks.flatMap((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines]),
    "",
  ].join("\n");
  return analyzeDiff(diff, { get: async (_path, side) => (side === "old" ? (before ? oldText : null) : after ? newText : null) });
}

/** The analysed hunks of a hand-written diff, for what `analyzeFile` can't express (binary files). */
export async function analyzeDiff(diff: string, files: FileProvider = { get: async () => null }): Promise<HunkInfo[]> {
  return [...(await analyzeHunks(parseDiff(diff), files, parsers, mergeConfig({}))).values()];
}
