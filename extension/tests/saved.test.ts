import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewResult } from "../../src/core/types";
import { carrySummary, GuideTooLarge, keepsPublished, packReview, type ReviewKey, type ReviewMode, restoreReview, reviewMode, type SavedReview, savedFor, withSaved } from "../src/review/saved";

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

test("Given a hunk with affected code, then reopening the saved grouping still lists it, and a guide saved without it or with a malformed one lists none", () => {
  const mode = reviewMode({}, true);
  const fresh = analyzed();
  fresh.hunks.get("src/api.ts#0")!.affected = ["loadUser", "Client.send"];
  const saved = JSON.parse(JSON.stringify(packReview(fresh, mode)));
  assert.deepEqual(restored(saved, mode).hunks.get("src/api.ts#0")!.affected, ["loadUser", "Client.send"]);
  // A hunk with no fact to show isn't saved at all, and restores with an empty list.
  assert.equal(saved.hunks["src/api.test.ts#0"].affected, undefined);
  assert.deepEqual(restored(saved, mode).hunks.get("src/api.test.ts#0")!.affected, []);
  // Saved documents are written by other versions and apps, so the page reads only names.
  saved.hunks["src/api.ts#0"].affected = ["loadUser", 3, null];
  assert.deepEqual(restored(saved, mode).hunks.get("src/api.ts#0")!.affected, ["loadUser"]);
  saved.hunks["src/api.ts#0"].affected = "loadUser";
  assert.deepEqual(restored(saved, mode).hunks.get("src/api.ts#0")!.affected, []);
});

test("Given a hunk with a safety finding, then reopening the saved grouping still shows it, and a finding that isn't whole is dropped", () => {
  const mode = reviewMode({}, true);
  const fresh = analyzed();
  const finding = { kind: "secret", severity: "high", rule: "AWS access key", message: "Looks like a real credential.", line: 2 } as const;
  fresh.hunks.get("src/api.ts#0")!.findings = [finding];
  const saved = JSON.parse(JSON.stringify(packReview(fresh, mode)));
  assert.deepEqual(restored(saved, mode).hunks.get("src/api.ts#0")!.findings, [finding]);
  assert.deepEqual(restored(saved, mode).hunks.get("src/api.test.ts#0")!.findings, []);
  // Saved documents are written by other versions and apps: the page renders only findings it can read.
  saved.hunks["src/api.ts#0"].findings = [finding, { ...finding, severity: "critical" }, { rule: "No message" }, "text", null];
  assert.deepEqual(restored(saved, mode).hunks.get("src/api.ts#0")!.findings, [finding]);
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
  // Regrouped after editing the description: the reader asked for the new one, even if it fell back.
  const edited = { ...failing, description: "1. Rename `get` in `src/api.ts`" };
  assert.equal((savedFor(withSaved(complete, key, packReview(edited, mode)), key) as { madeWith: { description: string } }).madeWith.description, edited.description);
  // Made another way (the project turned AI titles off since), it is no use to anyone now: replace it.
  assert.equal((savedFor(withSaved(complete, key, packReview(failing, reviewMode({}, false))), key) as { fellBack?: true }).fellBack, true);
  // A complete one replaces one that fell back, and one that fell back an older one that did too.
  const fellBack = withSaved(null, key, packReview(failing, mode, 1));
  assert.equal((savedFor(withSaved(fellBack, key, packReview(analyzed(), mode)), key) as { fellBack?: true }).fellBack, undefined);
  assert.equal((savedFor(withSaved(fellBack, key, packReview(failing, mode, 2)), key) as { savedAt: number }).savedAt, 2);
});

test("Given a huge PR, then its other saved comparisons are dropped before its document grows too large, but the new one is always kept", () => {
  const sized = (chars: number) => {
    const review = packReview(analyzed(), reviewMode({}, true));
    review.groups = [{ ...review.groups[0], rationale: "x".repeat(chars) }];
    return review;
  };
  const key = (compareTo: number): ReviewKey => ({ repo: "r", pr: 7, iteration: 5, compareTo });
  let doc: unknown = null;
  for (const compareTo of [0, 1, 2, 3]) doc = withSaved(doc, key(compareTo), sized(100_000));
  assert.deepEqual((doc as { compareTo: number }[]).map((c) => c.compareTo), [3, 2]);
  // The new one counts too: alongside it, no other fits.
  assert.deepEqual(withSaved(doc, key(4), sized(200_000))!.map((c) => c.compareTo), [4]);
  // Larger than the budget alone, it is still saved, by itself.
  assert.deepEqual(withSaved(doc, key(5), sized(300_000))!.map((c) => c.compareTo), [5]);
});

/** A guide as Ajour's Publish guide writes it: Ajour's own mode (no backend, agent titles), with a summary. */
function publishedFromAjour(overrides: Record<string, unknown> = {}) {
  return JSON.parse(
    JSON.stringify({
      ...packReview(analyzed(), { semantic: false, llmTitles: true }),
      madeWith: { ...meta, app: "ajour" },
      summary: {
        problem: { text: "Callers can't tell a fetch helper from a getter.", source: "ticket", ticket: { id: "#12", title: "Rename get", url: "https://dev.azure.com/o/p/_workitems/edit/12" } },
        kinds: ["refactor", "breaking"],
        breaking: [{ text: "`get` is gone from the public API.", hunkIds: ["src/api.ts#0"] }],
        risks: [],
        tests: [{ text: "The rename is covered.", hunkIds: ["src/api.test.ts#0"] }],
        leftovers: [],
      },
      ...overrides,
    }),
  );
}

test("Given a guide published from Ajour for this diff, then it shows whatever the reader's backend and AI-title settings, labelled, with its summary", () => {
  const saved = publishedFromAjour();
  for (const mode of [reviewMode({}, true), reviewMode({}, false), reviewMode(null, true)]) {
    const r = restoreReview(saved, mode, diff);
    if (!("result" in r)) assert.fail(`not restored: ${r.skipped}`);
    assert.equal(r.published, "ajour");
    assert.deepEqual(r.result.groups.map((g) => g.title), ["Rename get to fetchJson"]);
    assert.deepEqual(r.summary, saved.summary);
  }
  // Ajour's guide never goes stale the way a fallback grouping does.
  assert.equal(skipped({ ...saved, fellBack: true, savedAt: 0 }, reviewMode({}, true), diff, 365 * 86_400_000), null);
});

test("Given a guide published from Ajour for other hunks (a new push), then the PR is grouped again, and that grouping replaces it", () => {
  const saved = publishedFromAjour();
  const pushed = diff.replace(/diff --git a\/src\/api\.test\.ts[\s\S]*/, "");
  assert.match(skipped(saved, reviewMode({}, true), pushed)!, /don't cover this diff/);
  const key: ReviewKey = { repo: "r", pr: 7, iteration: 3, compareTo: 0 };
  const regrouped = packReview(restored(publishedFromAjour({ groups: [{ ...saved.groups[0], hunkIds: ["src/api.ts#0"] }] }), reviewMode({}, true), pushed), reviewMode({}, true));
  assert.equal(keepsPublished(savedFor(withSaved(null, key, saved), key), regrouped), false);
  assert.deepEqual((savedFor(withSaved(withSaved(null, key, saved), key, regrouped), key) as SavedReview).madeWith, regrouped.madeWith);
});

test("Given a guide published from Ajour, then a reader's own grouping never replaces it on its own, and Publish does", () => {
  const key: ReviewKey = { repo: "r", pr: 7, iteration: 3, compareTo: 0 };
  const doc = withSaved(null, key, publishedFromAjour());
  const own = packReview(analyzed(), reviewMode({}, true));
  // Regroup: the reader's guide is theirs for the session.
  assert.equal(keepsPublished(savedFor(doc, key), own), true);
  assert.equal(withSaved(doc, key, own), null);
  // A fallback, an edited description or another mode change nothing.
  assert.equal(withSaved(doc, key, { ...own, fellBack: true, madeWith: { title: "New", description: "Edited" } }), null);
  // Publish replaces it for everyone, and from then on it is Review Deck's own guide.
  const published = savedFor(withSaved(doc, key, own, { publish: true }), key) as SavedReview;
  assert.equal(published.madeWith.app, undefined);
  assert.equal(keepsPublished(published, own), false);
  // Another comparison's grouping keeps it.
  assert.equal((savedFor(withSaved(doc, { ...key, compareTo: 2 }, own), key) as SavedReview).madeWith.app, "ajour");
});

test("Given a published guide among a PR's saved comparisons, then the others are dropped before it when the document is full", () => {
  const key = (iteration: number): ReviewKey => ({ repo: "r", pr: 7, iteration, compareTo: 0 });
  const own = packReview(analyzed(), reviewMode({}, true));
  let doc: unknown = withSaved(null, key(3), publishedFromAjour());
  for (const it of [4, 5, 6, 7, 8]) doc = withSaved(doc, key(it), own);
  assert.deepEqual((doc as { iteration: number }[]).map((c) => c.iteration), [8, 3, 7, 6]);
});

test("Given a saved guide's summary, then it round-trips, an entry without one still loads, and a malformed one loses only its bad parts", () => {
  const saved = publishedFromAjour();
  assert.deepEqual((restoreReview(saved, reviewMode(null, false), diff) as { summary?: unknown }).summary, saved.summary);
  // Saved before summaries, or by Review Deck itself.
  const plain = restoreReview(JSON.parse(JSON.stringify(packReview(analyzed(), reviewMode({}, true)))), reviewMode({}, true), diff);
  assert.ok("result" in plain);
  assert.equal(plain.summary, undefined);
  assert.equal(plain.published, undefined);
  const odd = restoreReview(
    publishedFromAjour({
      summary: {
        problem: { text: "Inferred from the commits.", source: "inferred", ticket: { id: "1", title: "x", url: "javascript:alert(1)" } },
        kinds: ["refactor", "chores"],
        breaking: [{ text: "Gone.", hunkIds: ["src/api.ts#0", "src/missing.ts#3"] }, { text: 4, hunkIds: [] }],
        risks: "none",
      },
    }),
    reviewMode({}, true),
    diff,
  );
  assert.ok("result" in odd);
  assert.deepEqual(odd.summary, {
    problem: { text: "Inferred from the commits.", source: "inferred" },
    kinds: ["refactor"],
    breaking: [{ text: "Gone.", hunkIds: ["src/api.ts#0"] }],
    risks: [],
    tests: [],
    leftovers: [],
  });
  // No problem to state: no summary, but the guide still shows.
  const none = restoreReview(publishedFromAjour({ summary: { kinds: ["fix"] } }), reviewMode({}, true), diff);
  assert.ok("result" in none);
  assert.equal(none.summary, undefined);
});

test("Given a published guide with a malformed group, then it isn't shown or kept, and a Regroup replaces it, without throwing", () => {
  const key: ReviewKey = { repo: "r", pr: 7, iteration: 3, compareTo: 0 };
  const good = publishedFromAjour();
  const own = packReview(analyzed(), reviewMode({}, true));
  const malformed = [
    [null, { hunkIds: ["src/api.ts#0", "src/api.test.ts#0"] }],
    [{ ...good.groups[0], hunkIds: ["src/api.ts#0", 4] }],
    [{ ...good.groups[0], hunkIds: "src/api.ts#0" }],
    ...(["id", "kind", "title", "rationale"] as const).map((field) => [{ ...good.groups[0], [field]: undefined }]),
  ];
  for (const groups of malformed) {
    const saved = publishedFromAjour({ groups });
    assert.match(skipped(saved, reviewMode({}, true))!, /incomplete/, JSON.stringify(groups));
    assert.equal(keepsPublished(saved, own), false, JSON.stringify(groups));
    assert.equal((savedFor(withSaved(withSaved(null, key, saved), key, own), key) as SavedReview).madeWith.app, undefined);
  }
});

test("Given groups that repeat a hunk id, then they don't cover a diff with another hunk, even with as many ids", () => {
  const twice = (saved: SavedReview) => ({ ...saved, groups: [{ ...saved.groups[0], hunkIds: ["src/api.ts#0", "src/api.ts#0"] }] });
  const own = packReview(analyzed(), reviewMode({}, true));
  assert.match(skipped(twice(own), reviewMode({}, true))!, /don't cover this diff/);
  assert.match(skipped(twice(publishedFromAjour()), reviewMode({}, true))!, /don't cover this diff/);
  assert.equal(keepsPublished(twice(publishedFromAjour()), own), false);
  assert.equal(keepsPublished(publishedFromAjour(), twice(own)), false);
});

test("Given summary lines that are empty or only spaces, then they are left out, and the text of the others is trimmed", () => {
  const summary = (problem: string, lines: string[]) => {
    const r = restoreReview(
      publishedFromAjour({
        summary: { problem: { text: problem, source: "inferred" }, kinds: [], breaking: lines.map((text) => ({ text, hunkIds: [] })), risks: [], tests: [], leftovers: [{ text: "", hunkIds: [] }] },
      }),
      reviewMode({}, true),
      diff,
    );
    assert.ok("result" in r);
    return r.summary;
  };
  assert.deepEqual(summary("  Fixes the rename. ", ["", "   ", " Gone. "]), {
    problem: { text: "Fixes the rename.", source: "inferred" },
    kinds: [],
    breaking: [{ text: "Gone.", hunkIds: [] }],
    risks: [],
    tests: [],
    leftovers: [],
  });
  // No problem to state: no summary, but the guide still shows.
  assert.equal(summary("", ["Gone."]), undefined);
  assert.equal(summary(" \n ", ["Gone."]), undefined);
});

test("Given a regrouping of the same hunks as a saved guide with a summary, then it carries the summary, whoever made the saved one, and what Publish saves has it", () => {
  const key: ReviewKey = { repo: "r", pr: 7, iteration: 3, compareTo: 0 };
  const published = publishedFromAjour();
  const own = carrySummary(published, packReview(analyzed(), reviewMode({}, true)));
  assert.deepEqual(own.summary, published.summary);
  assert.equal(own.madeWith.app, undefined);
  const saved = savedFor(JSON.parse(JSON.stringify(withSaved(withSaved(null, key, published), key, own, { publish: true }))), key);
  assert.deepEqual((restoreReview(saved, reviewMode({}, true), diff) as { summary?: unknown }).summary, published.summary);
  // After that Publish the saved guide is Review Deck's own, and the next regrouping still carries its summary.
  assert.equal((saved as SavedReview).madeWith.app, undefined);
  assert.deepEqual(carrySummary(saved, packReview(analyzed(), reviewMode({}, true))).summary, published.summary);
  // Only a whole saved guide for the same hunks gives its summary.
  const pushed = diff.replace(/diff --git a\/src\/api\.test\.ts[\s\S]*/, "");
  const regrouped = packReview(restored(publishedFromAjour({ groups: [{ ...published.groups[0], hunkIds: ["src/api.ts#0"] }] }), reviewMode({}, true), pushed), reviewMode({}, true));
  assert.equal(carrySummary(published, regrouped).summary, undefined);
  assert.equal(carrySummary(packReview(analyzed(), reviewMode({}, true)), packReview(analyzed(), reviewMode({}, true))).summary, undefined);
  assert.equal(carrySummary({ ...published, groups: [null] }, packReview(analyzed(), reviewMode({}, true))).summary, undefined);
});

test("Given a published guide for another comparison, then it survives the size limits: a save that doesn't fit beside it is declined, and other guides go first", () => {
  const key = (compareTo: number): ReviewKey => ({ repo: "r", pr: 7, iteration: 5, compareTo });
  const rationale = (chars: number) => [{ ...packReview(analyzed(), reviewMode({}, true)).groups[0], rationale: "x".repeat(chars) }];
  const own = (chars: number) => ({ ...packReview(analyzed(), reviewMode({}, true)), groups: rationale(chars) });
  const doc = withSaved(null, key(0), publishedFromAjour({ groups: rationale(100_000) }));
  // Reproduced in review: this dropped the published guide, with no Publish clicked.
  assert.throws(() => withSaved(doc, key(1), own(200_000)), GuideTooLarge);
  // A Publish for another comparison doesn't take its place either.
  assert.throws(() => withSaved(doc, key(1), own(200_000), { publish: true }), GuideTooLarge);
  // One that fits is saved beside it, and the next one drops it rather than the published guide.
  const two = withSaved(doc, key(1), own(100_000))!;
  assert.deepEqual(two.map((c) => c.compareTo), [1, 0]);
  assert.deepEqual(withSaved(two, key(2), own(100_000))!.map((c) => c.compareTo), [2, 0]);
  // Alone, a guide over the budget is still saved, by itself.
  assert.deepEqual(withSaved(withSaved(null, key(1), own(100_000)), key(2), own(300_000))!.map((c) => c.compareTo), [2]);
});

test("Given a saved guide with malformed hunk facts, then it shows without them, and nothing the page renders is anything but text", () => {
  const ids = ["src/api.ts#0", "src/api.test.ts#0"];
  const facts = (saved: unknown) => {
    const result = restored(saved, reviewMode({}, true));
    return ids.map((id) => result.hunks.get(id)!);
  };
  // As found in review: an object as the symbol, and one as a mechanical reason.
  const [api, apiTest] = facts(publishedFromAjour({ hunks: { "src/api.ts#0": { symbol: { bad: "data" } }, "src/api.test.ts#0": { mechanical: { kind: "generated", reason: { bad: "data" } } } } }));
  assert.equal(api.symbol, null);
  assert.equal(apiTest.mechanical, null);
  // Every hunk fact the page renders (symbol, test tag, mechanical reason and kind), with each malformed value, on
  // both kinds of guide.
  for (const value of [{ bad: "data" }, 4, ["x"], null, "yes", "", " "]) {
    // "yes" is a fine symbol or reason, but not a test tag.
    const text = value === "yes" ? 4 : value;
    const entries = [value, { symbol: text, isTest: value, mechanical: value }, { mechanical: { kind: value, reason: "Lockfile" } }, { mechanical: { kind: "lockfile", reason: text } }];
    for (const entry of entries) {
      const hunks = Object.fromEntries(ids.map((id) => [id, entry]));
      for (const saved of [publishedFromAjour({ hunks }), { ...JSON.parse(JSON.stringify(packReview(analyzed(), reviewMode({}, true)))), hunks }]) {
        for (const info of facts(saved)) {
          const what = JSON.stringify(entry);
          assert.equal(info.symbol, null, what);
          assert.equal(info.isTest, false, what);
          assert.equal(info.mechanical, null, what);
        }
      }
    }
  }
  // Well-formed facts still come through, and only what the page reads.
  const [kept] = facts(publishedFromAjour({ hunks: { "src/api.ts#0": { symbol: "fetchJson", isTest: true, mechanical: { kind: "lockfile", reason: "Lockfile", extra: {} } } } }));
  assert.deepEqual([kept.symbol, kept.isTest, kept.mechanical], ["fetchJson", true, { kind: "lockfile", reason: "Lockfile" }]);
  // A group's title source, shown as an icon, is dropped when it isn't one the page knows.
  const [group] = restored(publishedFromAjour({ groups: [{ ...publishedFromAjour().groups[0], titleSource: { bad: "data" } }] }), reviewMode({}, true)).groups;
  assert.equal(group.titleSource, undefined);
  // Malformed facts alone leave a published guide in place: it still shows.
  assert.equal(keepsPublished(publishedFromAjour({ hunks: { "src/api.ts#0": { symbol: { bad: "data" } } } }), packReview(analyzed(), reviewMode({}, true))), true);
});

test("Given a published guide missing what the page needs (options, merges or the hunk record), then it isn't shown or kept, and a Regroup replaces it", () => {
  const key: ReviewKey = { repo: "r", pr: 7, iteration: 3, compareTo: 0 };
  const own = packReview(analyzed(), reviewMode({}, true));
  for (const broken of [{ options: null }, { options: "x" }, { merges: "x" }, { merges: [null] }, { hunks: "x" }, { hunks: [] }, { hunks: null }]) {
    const saved = publishedFromAjour(broken);
    assert.match(skipped(saved, reviewMode({}, true))!, /incomplete/, JSON.stringify(broken));
    assert.equal(keepsPublished(saved, own), false, JSON.stringify(broken));
    assert.equal((savedFor(withSaved(withSaved(null, key, saved), key, own), key) as SavedReview).madeWith.app, undefined);
  }
});

test("Given a guide saved with its relations, then reopening restores them, without links to hunks no longer in the diff", () => {
  const mode = reviewMode({}, true);
  const result = analyzed();
  result.relations = {
    links: [],
    flows: { g1: [{ from: "src/api.ts#0", to: "src/api.test.ts#0", symbols: ["fetchJson"] }, { from: "src/api.ts#0", to: "src/gone.ts#0", symbols: ["x"] }] },
  };
  const saved = JSON.parse(JSON.stringify(packReview(result, mode)));
  assert.deepEqual(restored(saved, mode).relations, { links: [], flows: { g1: [{ from: "src/api.ts#0", to: "src/api.test.ts#0", symbols: ["fetchJson"] }] } });
});

test("Given a guide saved before relations were recorded, then it still restores, without relations", () => {
  const mode = reviewMode({}, true);
  const saved = JSON.parse(JSON.stringify(packReview(analyzed(), mode)));
  delete saved.relations;
  assert.equal(restored(saved, mode).relations, undefined);
});
