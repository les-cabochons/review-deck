import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeConfig } from "../../src/core/config";
import type { ReviewResult } from "../../src/core/types";
import { createNodeParsers } from "../../src/node/parsers";
import { runPipeline } from "../../src/pipeline";
import type { FileChange } from "../src/data/model";
import { buildDiff, type FileContents } from "../src/review/analysis";

const parsers = await createNodeParsers();

/** The guided view of a PR given as its files' old and new text (null: absent on that side), built as the page does. */
async function grouped(files: Record<string, [string | null, string | null]>): Promise<ReviewResult> {
  const changes: FileChange[] = Object.entries(files).map(([path, [before, after]]) => ({
    path,
    changeType: before === null ? "add" : after === null ? "delete" : "edit",
  }));
  const contents = new Map<string, FileContents>(Object.entries(files).map(([path, [before, after]]) => [path, { old: before, new: after, binary: false, tooLarge: false }]));
  const texts: Record<string, [string | null, string | null]> = files;
  return runPipeline(
    { title: "Order notes", description: "", diff: buildDiff(changes, contents), files: { get: async (path, side) => texts[path]?.[side === "old" ? 0 : 1] ?? null } },
    mergeConfig({}),
    { parsers },
  );
}

/** Each concern's level and reason, keyed by one of its files. */
function levels(result: ReviewResult): Record<string, string> {
  return Object.fromEntries(
    result.groups.map((g) => [result.hunks.get(g.hunkIds[0])!.file.path, g.level ? `${g.level}: ${g.levelReason}` : "none"]),
  );
}

test("Given a PR with a migration that drops a column, a lockfile and ordinary code, then the migration's concern is must read, the lockfile's is skip, and the code has no level", async () => {
  const result = await grouped({
    "db/migrations/007_orders.sql": [null, "ALTER TABLE orders DROP COLUMN legacy_code;\nUPDATE orders SET status = 'open';\n"],
    "package-lock.json": ['{ "lockfileVersion": 3 }\n', '{ "lockfileVersion": 3, "packages": {} }\n'],
    // Two linked changes, so they form a concern of their own instead of joining the migration under "Other changes".
    "src/notes.ts": ["export const LIMIT = 80;\n", "export const LIMIT = 80;\nexport function trimNote(text: string) { return text.trim().slice(0, LIMIT); }\n"],
    "src/orders.ts": [
      'export function addNote(order: Order, text: string) { order.notes.push(text); }\n',
      'import { trimNote } from "./notes";\nexport function addNote(order: Order, text: string) { order.notes.push(trimNote(text)); }\n',
    ],
  });
  assert.deepEqual(levels(result), {
    "src/notes.ts": "none",
    "db/migrations/007_orders.sql": "must: Safety rules hit: Drops a column, Writes rows without WHERE.",
    "package-lock.json": "skip: Mechanical changes: nothing to review line by line.",
  });
});

test("Given a concern that only changes comments, then it is one to skim", async () => {
  const result = await grouped({
    "src/notes.ts": ["// Trims.\nexport function note(text: string) { return text.trim(); }\n", "// Trims the note's text.\nexport function note(text: string) { return text.trim(); }\n"],
  });
  assert.deepEqual(levels(result), { "src/notes.ts": "skim: Comments only: no code changes." });
});
