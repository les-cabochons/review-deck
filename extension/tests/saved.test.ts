import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewResult } from "../../src/core/types";
import { packReview, restoreReview, reviewMode } from "../src/review/saved";

const meta = { title: "Rename fetch helper", description: "" };
const diff = [
  "diff --git a/src/api.ts b/src/api.ts",
  "--- a/src/api.ts",
  "+++ b/src/api.ts",
  "@@ -1,2 +1,2 @@",
  "-export function get() {}",
  "+export function fetchJson() {}",
  " export const x = 1;",
  "diff --git a/src/api.test.ts b/src/api.test.ts",
  "--- a/src/api.test.ts",
  "+++ b/src/api.test.ts",
  "@@ -1 +1 @@",
  "-get();",
  "+fetchJson();",
  "",
].join("\n");

/** What a fresh analysis of `diff` gives, with the hunk facts the page shows. */
function analyzed(): ReviewResult {
  const result = restoreReview(
    {
      format: 1,
      mode: { semantic: true, llmTitles: true },
      groups: [{ id: "g1", kind: "semantic", hunkIds: ["src/api.ts#0", "src/api.test.ts#0"], title: "Rename get to fetchJson", rationale: "Same rename." }],
      merges: [],
      options: { semantic: true, titler: "llm:backend", weights: { structural: 1, testPairing: 1, lexical: 1, semantic: 1, path: 1 }, minEdgeWeight: 0.1 },
      hunks: {},
    },
    { semantic: true, llmTitles: true },
    meta,
    diff,
  )!;
  result.hunks.get("src/api.ts#0")!.symbol = "fetchJson";
  result.hunks.get("src/api.test.ts#0")!.isTest = true;
  return result;
}

test("Given a saved grouping for the same diff and mode, then reopening shows it with the hunks' symbols and test tags", () => {
  const mode = reviewMode({}, true);
  const saved = JSON.parse(JSON.stringify(packReview(analyzed(), mode)));
  const restored = restoreReview(saved, mode, meta, diff)!;
  assert.deepEqual(
    restored.groups.map((g) => [g.title, g.hunkIds]),
    [["Rename get to fetchJson", ["src/api.ts#0", "src/api.test.ts#0"]]],
  );
  assert.equal(restored.hunks.get("src/api.ts#0")!.symbol, "fetchJson");
  assert.equal(restored.hunks.get("src/api.test.ts#0")!.isTest, true);
  assert.equal(restored.hunks.get("src/api.test.ts#0")!.file.path, "src/api.test.ts");
});

test("Given a grouping made another way, or for other hunks, then the PR is analyzed again", () => {
  const saved = packReview(analyzed(), reviewMode({}, true));
  // The project turned AI titles off, or the page has no backend.
  assert.equal(restoreReview(saved, reviewMode({}, false), meta, diff), null);
  assert.equal(restoreReview(saved, reviewMode(null, true), meta, diff), null);
  // The diff came out differently (e.g. another diff library version).
  assert.equal(restoreReview(saved, reviewMode({}, true), meta, diff.replace(/diff --git a\/src\/api\.test\.ts[\s\S]*/, "")), null);
  assert.equal(restoreReview({ ...saved, format: 0 }, reviewMode({}, true), meta, diff), null);
  assert.equal(restoreReview(null, reviewMode({}, true), meta, diff), null);
});

test("Given an analysis that fell back (backend down, titles failed), then it isn't saved, so the next open retries", () => {
  const result = analyzed();
  result.warnings.push("llm:backend titler failed, fell back to heuristic: 502");
  assert.equal(packReview(result, reviewMode({}, true)), null);
});
