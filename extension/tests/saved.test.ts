import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewResult } from "../../src/core/types";
import { packReview, type ReviewKey, type ReviewMode, restoreReview, reviewMode, savedFor, withSaved } from "../src/review/saved";

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

/** The restored grouping, failing the test with the reason if the saved one wasn't used. */
function restored(saved: unknown, mode: ReviewMode, d = diff, now?: number): ReviewResult {
  const r = restoreReview(saved, mode, d, now);
  if (!("result" in r)) assert.fail(`not restored: ${r.skipped}`);
  return r.result;
}

/** Why the saved grouping wasn't used, or null if it was. */
function skipped(saved: unknown, mode: ReviewMode, d = diff, now?: number): string | null {
  const r = restoreReview(saved, mode, d, now);
  return "skipped" in r ? r.skipped : null;
}

/** What a fresh analysis of `diff` gives, with the hunk facts the page shows. */
function analyzed(): ReviewResult {
  const result = restored(
    {
      format: 4,
      mode: { semantic: true, llmTitles: true },
      madeWith: meta,
      savedAt: 0,
      groups: [{ id: "g1", kind: "semantic", hunkIds: ["src/api.ts#0", "src/api.test.ts#0"], title: "Rename get to fetchJson", rationale: "Same rename." }],
      merges: [],
      options: { semantic: true, titler: "llm:backend", weights: { structural: 1, testPairing: 1, lexical: 1, semantic: 1, path: 1, description: 1 }, minEdgeWeight: 0.1 },
      hunks: {},
    },
    { semantic: true, llmTitles: true },
  );
  result.hunks.get("src/api.ts#0")!.symbol = "fetchJson";
  result.hunks.get("src/api.test.ts#0")!.isTest = true;
  return result;
}

test("Given a saved grouping for the same diff and mode, then reopening shows it with the hunks' symbols and test tags", () => {
  const mode = reviewMode({}, true);
  const saved = JSON.parse(JSON.stringify(packReview(analyzed(), mode)));
  const result = restored(saved, mode);
  assert.deepEqual(
    result.groups.map((g) => [g.title, g.hunkIds]),
    [["Rename get to fetchJson", ["src/api.ts#0", "src/api.test.ts#0"]]],
  );
  assert.equal(result.hunks.get("src/api.ts#0")!.symbol, "fetchJson");
  assert.equal(result.hunks.get("src/api.test.ts#0")!.isTest, true);
  assert.equal(result.hunks.get("src/api.test.ts#0")!.file.path, "src/api.test.ts");
});

test("Given a grouping made another way, or for other hunks, then the PR is analyzed again, saying why", () => {
  const saved = packReview(analyzed(), reviewMode({}, true));
  // The project turned AI titles off, or the page has no backend.
  assert.match(skipped(saved, reviewMode({}, false))!, /with AI titles, and the page now groups with embeddings and without AI titles/);
  assert.match(skipped(saved, reviewMode(null, true))!, /now groups without embeddings/);
  // The diff came out differently (e.g. another diff library version).
  assert.match(skipped(saved, reviewMode({}, true), diff.replace(/diff --git a\/src\/api\.test\.ts[\s\S]*/, ""))!, /don't cover this diff/);
  // Saved in an older shape (format 3 kept only a hash of the title and description).
  assert.match(skipped({ ...saved, format: 3 }, reviewMode({}, true))!, /format 3/);
  assert.match(skipped({ ...saved, madeWith: undefined }, reviewMode({}, true))!, /incomplete/);
  assert.match(skipped(null, reviewMode({}, true))!, /format none/);
});

test("Given the title or description was edited since it was grouped, then reopening still shows the saved view, made with the old ones", () => {
  const mode = reviewMode({}, true);
  const saved = JSON.parse(JSON.stringify(packReview(analyzed(), mode)));
  // The page compares these with the PR's current ones and offers to regroup.
  const result = restored(saved, mode);
  assert.equal(result.groups[0].title, "Rename get to fetchJson");
  assert.deepEqual({ title: result.title, description: result.description }, meta);
});

test("Given an analysis that fell back (backend down, titles failed), then it is reused for an hour, and the next open after that groups again", () => {
  const result = analyzed();
  result.warnings.push("llm:backend titler failed, fell back to heuristic: 502");
  const mode = reviewMode({}, true);
  const saved = JSON.parse(JSON.stringify(packReview(result, mode, 1_000)));
  // An outage or a spent cap doesn't make every open group the PR again.
  assert.equal(restored(saved, mode, diff, 1_000 + 59 * 60_000).groups[0].title, "Rename get to fetchJson");
  assert.match(skipped(saved, mode, diff, 1_000 + 61 * 60_000)!, /backend was failing/);
  // One made with everything it asked for is reused for good.
  assert.equal(skipped(packReview(analyzed(), mode, 1_000), mode, diff, 1_000 + 365 * 86_400_000), null);
});

test("Given guided views saved for several comparisons of a PR, then each reopens its own, and grouping one keeps the others", () => {
  const review = packReview(analyzed(), reviewMode({}, true));
  const key = (iteration: number, compareTo: number): ReviewKey => ({ repo: "r", pr: 7, iteration, compareTo });
  const latest = withSaved(null, key(3, 0), review);
  // A reviewer looks at what changed since update 2: the default comparison stays for everyone else.
  const both = JSON.parse(JSON.stringify(withSaved(latest, key(3, 2), { ...review, groups: [] })));
  assert.deepEqual((savedFor(both, key(3, 0)) as typeof review).groups, review.groups);
  assert.deepEqual((savedFor(both, key(3, 2)) as typeof review).groups, []);
  assert.equal(savedFor(both, key(2, 0)), null);
  // Grouping a comparison again replaces its view and moves it first; only the most recent few are kept.
  assert.deepEqual(withSaved(both, key(3, 0), review)!.map((c) => [c.iteration, c.compareTo]), [[3, 0], [3, 2]]);
  let many: unknown = both;
  for (const it of [4, 5, 6, 7]) many = withSaved(many, key(it, 0), review);
  assert.deepEqual((many as { iteration: number }[]).map((c) => c.iteration), [7, 6, 5, 4]);
  // A document saved before comparisons were kept together holds none of them.
  assert.equal(savedFor(undefined, key(3, 0)), null);
});

test("Given a complete guided view is saved, then one that fell back (another reviewer's backend timed out) doesn't replace it", () => {
  const mode = reviewMode({}, true);
  const key: ReviewKey = { repo: "r", pr: 7, iteration: 3, compareTo: 0 };
  const failing = analyzed();
  failing.warnings.push("semantic signal skipped: embedding service returned 503");
  const complete = withSaved(null, key, packReview(analyzed(), mode));
  assert.equal(withSaved(complete, key, packReview(failing, mode)), null);
  // Made another way (the project turned AI titles off since), it is no use to anyone now: replace it.
  assert.equal((savedFor(withSaved(complete, key, packReview(failing, reviewMode({}, false))), key) as { fellBack?: true }).fellBack, true);
  // A complete one replaces one that fell back, and one that fell back an older one that did too.
  const fellBack = withSaved(null, key, packReview(failing, mode, 1));
  assert.equal((savedFor(withSaved(fellBack, key, packReview(analyzed(), mode)), key) as { fellBack?: true }).fellBack, undefined);
  assert.equal((savedFor(withSaved(fellBack, key, packReview(failing, mode, 2)), key) as { savedAt: number }).savedAt, 2);
});

test("Given a huge PR, then its other saved comparisons are dropped before its document grows too large, but the new one is always kept", () => {
  const huge = packReview(analyzed(), reviewMode({}, true));
  huge.groups = [{ ...huge.groups[0], rationale: "x".repeat(150_000) }];
  const key = (compareTo: number): ReviewKey => ({ repo: "r", pr: 7, iteration: 5, compareTo });
  let doc: unknown = null;
  for (const compareTo of [0, 1, 2, 3]) doc = withSaved(doc, key(compareTo), huge);
  assert.deepEqual((doc as { compareTo: number }[]).map((c) => c.compareTo), [3, 2]);
});
