import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewResult } from "../../src/core/types";
import { parseDiff } from "../../src/diff/parse";
import { LocalHost } from "../src/app/localHost";
import type { FileChange, PrSource } from "../src/data/model";
import { type AnalysisJob, type AnalysisMessage, buildDiff } from "../src/review/analysis";
import { buildReview, publishGuide } from "../src/review/engine";
import { type ReviewKey, restoreReview, reviewMode, type SavedReview, type SavedReviews, savedFor, withSaved } from "../src/review/saved";

// The page's globals the engine reads: the asset base, and the analysis worker. The worker restores a saved guide as
// the real one does (runJob), and stands in for the pipeline with one concern holding every hunk.
Object.assign(globalThis, { document: { baseURI: "http://127.0.0.1/dist/review.html" } });
class AnalysisWorker {
  onmessage: ((e: { data: AnalysisMessage }) => void) | null = null;
  onerror: unknown = null;
  postMessage(job: AnalysisJob) {
    const diff = buildDiff(job.changes, job.contents);
    const restored = job.saved ? restoreReview(job.saved, reviewMode(job.backend, job.aiTitles), diff) : null;
    const message: AnalysisMessage =
      restored && "result" in restored
        ? { type: "result", result: restored.result, restored: true, published: restored.published, summary: restored.summary }
        : { type: "result", result: grouped(job, diff), restored: false };
    setImmediate(() => this.onmessage?.({ data: message }));
  }
  terminate() {}
}
Object.assign(globalThis, { Worker: AnalysisWorker });
// The build's log lines.
console.debug = console.info = () => {};

/** The title the stand-in pipeline gives its one concern, so a test can tell one grouping from the next. */
let groupTitle = "The reader's grouping";

function grouped(job: AnalysisJob, diff: string): ReviewResult {
  const files = parseDiff(diff);
  const ids = files.flatMap((f) => f.hunks.map((h) => h.id));
  return {
    title: job.title,
    description: job.description,
    files,
    hunks: new Map(),
    pairs: [],
    groups: [{ id: "g1", kind: "semantic", hunkIds: ids, title: groupTitle, rationale: "Grouped on this page." }],
    merges: [],
    timings: {},
    options: { semantic: false, titler: "heuristic", weights: { structural: 1, testPairing: 1, lexical: 1, semantic: 0, path: 1, description: 1 }, minEdgeWeight: 0.1 },
    warnings: [],
  };
}

const changes: FileChange[] = [
  { path: "src/api.ts", changeType: "edit", oldObjectId: "a1", newObjectId: "a2" },
  { path: "src/api.test.ts", changeType: "edit", oldObjectId: "t1", newObjectId: "t2" },
];
const blobs = new Map([
  ["a1", "export function get() {}\nexport const x = 1;\n"],
  ["a2", "export function fetchJson() {}\nexport const x = 1;\n"],
  ["t1", "get();\n"],
  ["t2", "fetchJson();\n"],
]);
const source = {
  getChanges: async () => changes,
  getBlobs: async () => ({ blobs, stats: { cached: 0, zipped: 0, single: 0, calls: 0 } }),
} as unknown as PrSource;
const meta = { title: "Rename fetch helper", description: "" };

/** A PR's saved-reviews document, as a host keeps it; `failing` makes the next saves reject (the host's error). */
function memoryStore() {
  const state = { doc: null as unknown, saves: 0, failing: false };
  const store: SavedReviews = {
    load: async (key) => savedFor(state.doc, key),
    save: async (key, review, options) => {
      state.saves++;
      try {
        if (state.failing) throw new Error("Simulated save failure");
        state.doc = withSaved(state.doc, key, review, options) ?? state.doc;
        return true;
      } catch (e) {
        if (options?.publish) throw e;
        return false;
      }
    },
  };
  return { state, store };
}

const summary = {
  problem: { text: "Callers can't tell a fetch helper from a getter.", source: "inferred" },
  kinds: ["refactor"],
  breaking: [{ text: "`get` is gone.", hunkIds: ["src/api.ts#0"] }],
  risks: [],
  tests: [],
  leftovers: [],
};

/** The store holding, for `key`, a guide published from Ajour for this PR's hunks, with a summary. */
async function withPublished(key: ReviewKey) {
  const { state, store } = memoryStore();
  // Group once, to save a guide for exactly these hunks, then make it Ajour's.
  await buildReview(source, meta, key.iteration, key.compareTo, { saved: { store, key } });
  const saved = savedFor(state.doc, key) as SavedReview;
  state.doc = withSaved(null, key, JSON.parse(JSON.stringify({ ...saved, madeWith: { ...saved.madeWith, app: "ajour" }, summary })));
  state.saves = 0;
  return { state, store };
}

const open = (store: SavedReviews, key: ReviewKey, fresh = false) => buildReview(source, meta, key.iteration, key.compareTo, { saved: { store, key }, fresh });

test("Given a published guide, then a Regroup is the reader's own guide, kept in memory with its summary and reused on the next open, without saving", async () => {
  const key: ReviewKey = { repo: "r", pr: 1, iteration: 3, compareTo: 0 };
  const { state, store } = await withPublished(key);
  const shown = await open(store, key);
  assert.equal(shown.published, "ajour");
  assert.equal(shown.ownGuide, undefined);
  assert.deepEqual(shown.summary, summary);

  const regrouped = await open(store, key, true);
  assert.equal(regrouped.published, undefined);
  assert.equal(regrouped.result.groups[0].title, "The reader's grouping");
  assert.deepEqual(regrouped.ownGuide?.summary, summary);
  assert.deepEqual(regrouped.summary, summary);
  assert.equal((savedFor(state.doc, key) as SavedReview).madeWith.app, "ajour");
  assert.equal(state.saves, 0);

  const reopened = await open(store, key);
  assert.equal(reopened.result.groups[0].title, "The reader's grouping");
  assert.equal(reopened.ownGuide, regrouped.ownGuide);
  assert.deepEqual(reopened.summary, summary);
});

test("Given a reader's own guide, then a failed Publish rejects and keeps it, and Publish saves it, with its summary, for everyone", async () => {
  const key: ReviewKey = { repo: "r", pr: 2, iteration: 3, compareTo: 0 };
  const { state, store } = await withPublished(key);
  const { ownGuide } = await open(store, key, true);
  assert.ok(ownGuide);

  state.failing = true;
  await assert.rejects(publishGuide(store, key, ownGuide), /Simulated save failure/);
  assert.equal((await open(store, key)).ownGuide, ownGuide);

  state.failing = false;
  await publishGuide(store, key, ownGuide);
  const saved = savedFor(state.doc, key) as SavedReview;
  assert.equal(saved.madeWith.app, undefined);
  assert.equal(saved.groups[0].title, "The reader's grouping");
  // The session guide is gone: the next open shows what is saved, the summary still with it.
  const after = await open(store, key);
  assert.equal(after.ownGuide, undefined);
  assert.equal(after.published, undefined);
  assert.equal(after.result.groups[0].title, "The reader's grouping");
  assert.deepEqual(after.summary, summary);
});

test("Given the local page's store can't write, then a Publish rejects, and a plain save doesn't", async () => {
  const key: ReviewKey = { repo: "r", pr: 3, iteration: 3, compareTo: 0 };
  const { ownGuide } = await open((await withPublished(key)).store, key, true);
  const storage = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const store = LocalHost.prototype.savedReviews.call({} as LocalHost);
    await store.save(key, ownGuide!);
    await assert.rejects(store.save(key, ownGuide!, { publish: true }), /QuotaExceededError/);
  } finally {
    console.warn = warn;
  }
});

test("Given a guide published from Ajour, then Regroup, Publish and Regroup again keep its summary, saved for everyone", async () => {
  const key: ReviewKey = { repo: "r", pr: 4, iteration: 3, compareTo: 0 };
  const { state, store } = await withPublished(key);
  const { ownGuide } = await open(store, key, true);
  await publishGuide(store, key, ownGuide!);
  assert.equal((savedFor(state.doc, key) as SavedReview).madeWith.app, undefined);

  const again = await open(store, key, true);
  assert.equal(again.ownGuide, undefined);
  assert.deepEqual(again.summary, summary);
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual((savedFor(state.doc, key) as SavedReview).summary, summary);
  assert.deepEqual((await open(store, key)).summary, summary);
});

test("Given a guide published for another comparison, then a grouping too large to save beside it is declined, and kept for the session", async () => {
  const key: ReviewKey = { repo: "r", pr: 5, iteration: 3, compareTo: 0 };
  const other = { ...key, compareTo: 1 };
  const { state, store } = await withPublished(other);
  const published = savedFor(state.doc, other) as SavedReview;
  // A published guide that leaves less room than the reader's grouping needs.
  const large = { ...published, groups: [{ ...published.groups[0], rationale: "x".repeat(255_000) }] };
  state.doc = withSaved(null, other, large);

  const grouped = await open(store, key);
  assert.equal(grouped.ownGuide, undefined);
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(state.saves, 1);
  assert.equal(savedFor(state.doc, key), null);
  assert.equal((savedFor(state.doc, other) as SavedReview).madeWith.app, "ajour");
  // The next open shows the same grouping, from memory, without grouping or saving again.
  const reopened = await open(store, key);
  assert.equal(reopened.result.groups[0].title, "The reader's grouping");
  assert.equal(reopened.ownGuide, undefined);
  assert.equal(state.saves, 1);
});

/**
 * A store whose saves wait until the test settles them, in any order, as written or not. A Publish that isn't written
 * rejects, as the hosts' do.
 */
function heldStore(doc: unknown = null) {
  const state = { doc };
  const held: { title: string; publish: boolean; settled: boolean; settle: (written: boolean) => void }[] = [];
  const store: SavedReviews = {
    load: async (key) => savedFor(state.doc, key),
    save: (key, review, options) =>
      new Promise((resolve, reject) => {
        const save = {
          title: review.groups[0].title,
          publish: options?.publish === true,
          settled: false,
          settle: (written: boolean) => {
            save.settled = true;
            if (written) state.doc = withSaved(state.doc, key, review, options) ?? state.doc;
            if (written || !save.publish) resolve(written);
            else reject(new Error("Simulated save failure"));
          },
        };
        held.push(save);
      }),
  };
  return { state, store, held };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

async function grouping(store: SavedReviews, key: ReviewKey, title: string, fresh: boolean) {
  groupTitle = title;
  try {
    return await open(store, key, fresh);
  } finally {
    groupTitle = "The reader's grouping";
  }
}

test("Given a first save still pending when a Regroup's save succeeds, then the first save failing late doesn't bring the first grouping back", async () => {
  const key: ReviewKey = { repo: "r", pr: 6, iteration: 3, compareTo: 0 };
  const { state, store, held } = heldStore();
  await grouping(store, key, "First grouping", false);
  await grouping(store, key, "New regroup", true);
  assert.deepEqual(held.map((h) => h.title), ["First grouping", "New regroup"]);

  held[1].settle(true);
  await settled();
  held[0].settle(false);
  await settled();
  assert.equal((savedFor(state.doc, key) as SavedReview).groups[0].title, "New regroup");
  assert.equal((await open(store, key)).result.groups[0].title, "New regroup");
});

test("Given a first save still pending when a Regroup's save fails, then the first save succeeding late keeps the Regroup for the session", async () => {
  const key: ReviewKey = { repo: "r", pr: 7, iteration: 3, compareTo: 0 };
  const { state, store, held } = heldStore();
  await grouping(store, key, "First grouping", false);
  await grouping(store, key, "New regroup", true);

  held[1].settle(false);
  await settled();
  held[0].settle(true);
  await settled();
  assert.equal((savedFor(state.doc, key) as SavedReview).groups[0].title, "First grouping");
  assert.equal((await open(store, key)).result.groups[0].title, "New regroup");
});

const storedTitle = (doc: unknown, key: ReviewKey) => (savedFor(doc, key) as SavedReview | null)?.groups[0].title;

/** A PR's saved-reviews document holding, for `key`, a guide published from Ajour for this PR's hunks. */
async function publishedDoc(key: ReviewKey) {
  return (await withPublished(key)).state.doc;
}

test("Given a Publish still pending when the reader regroups, then a later grouping that saves shows on reopen, not the one before it", async () => {
  const key: ReviewKey = { repo: "r", pr: 8, iteration: 3, compareTo: 0 };
  const { state, store, held } = heldStore(await publishedDoc(key));
  const a = await grouping(store, key, "A", true);
  const publishing = publishGuide(store, key, a.ownGuide!);
  await grouping(store, key, "B", true);
  held[0].settle(true);
  await publishing;
  assert.equal(storedTitle(state.doc, key), "A");
  assert.equal((await open(store, key)).result.groups[0].title, "B");

  await grouping(store, key, "C", true);
  assert.deepEqual(held.map((h) => h.title), ["A", "C"]);
  held[1].settle(true);
  await settled();
  assert.equal(storedTitle(state.doc, key), "C");
  const reopened = await open(store, key);
  assert.equal(reopened.result.groups[0].title, "C");
  assert.equal(reopened.ownGuide, undefined);
});

/**
 * Plays one sequence of a reader's steps on a comparison: up to three groupings ("group", a Regroup), a Publish of the
 * latest one while it is the reader's own, and each save or Publish settling, written or not, in any order. `choose`
 * picks one of the steps open at each point; "stop" ends the sequence once nothing is pending.
 */
async function playSequence(key: ReviewKey, start: unknown, choose: (steps: string[]) => string) {
  const { state, store, held } = heldStore(start);
  const publishedTitle = storedTitle(start, key);
  const steps: string[] = [];
  let groupings = 0;
  let latest: Awaited<ReturnType<typeof open>> | undefined;
  let publishedLatest = false;
  let anyPublishWritten = false;
  const publishes: Promise<void>[] = [];
  for (;;) {
    const open_: string[] = [];
    if (groupings < 3) open_.push("group");
    if (latest?.ownGuide && !publishedLatest) open_.push("publish");
    held.forEach((h, i) => {
      if (!h.settled) open_.push(`write ${i}`, `fail ${i}`);
    });
    if (groupings > 0 && held.every((h) => h.settled)) open_.push("stop");
    const step = choose(open_);
    steps.push(step);
    if (step === "stop") break;
    if (step === "group") {
      latest = await grouping(store, key, `G${++groupings}`, true);
      publishedLatest = false;
    } else if (step === "publish") {
      publishedLatest = true;
      publishes.push(publishGuide(store, key, latest!.ownGuide!).catch(() => {}));
      await settled();
    } else {
      const [verdict, i] = step.split(" ");
      const save = held[Number(i)];
      if (verdict === "write" && save.publish) anyPublishWritten = true;
      save.settle(verdict === "write");
      await settled();
    }
    // Only a Publish replaces a published guide.
    if (publishedTitle && !anyPublishWritten) assert.equal(storedTitle(state.doc, key), publishedTitle, steps.join(", "));
  }
  await Promise.all(publishes);
  const saves = held.length;
  const reopened = await open(store, key);
  const label = steps.join(", ");
  assert.equal(reopened.result.groups[0].title, `G${groupings}`, label);
  // Reopening restores, from memory or from what is saved, without grouping or saving again.
  assert.equal(held.length, saves, label);
  // While the published guide is still saved, the latest grouping is the reader's own, which they can still Publish.
  if (publishedTitle && !anyPublishWritten) assert.equal(reopened.ownGuide?.groups[0].title, `G${groupings}`, label);
}

/** Plays every sequence playSequence allows, each on a comparison of its own; returns how many. */
async function everySequence(start: (key: ReviewKey) => Promise<unknown>, pr: number) {
  let played = 0;
  // Depth-first over the choices: each run replays the previous one's choices, then takes the next untried step.
  let choices: number[] = [];
  for (;;) {
    const counts: number[] = [];
    const key: ReviewKey = { repo: "r", pr, iteration: 3, compareTo: played };
    await playSequence(key, await start(key), (steps) => {
      const k = counts.length;
      counts.push(steps.length);
      return steps[choices[k] ?? 0];
    });
    played++;
    choices = counts.map((_, k) => choices[k] ?? 0);
    let k = choices.length - 1;
    while (k >= 0 && choices[k] === counts[k] - 1) k--;
    if (k < 0) return played;
    choices = [...choices.slice(0, k), choices[k] + 1];
  }
}

test("Given a published guide, then in every order of up to three groupings, Publishes and their outcomes, reopening shows the latest grouping, and the published guide stays until a Publish replaces it", async () => {
  // How many it played, so a change that stops it exploring fails here; the count without Publishes is checked below.
  assert.equal(await everySequence(publishedDoc, 100), 297);
});

test("Given nothing saved, then in every order of up to three groupings and their saves' outcomes, reopening shows the latest grouping", async () => {
  // n groupings, each saving: (2n - 1)!! orders of the saves settling after their grouping, times 2^n outcomes.
  assert.equal(await everySequence(async () => null, 101), 2 + 12 + 120);
});
