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
    setTimeout(() => this.onmessage?.({ data: message }));
  }
  terminate() {}
}
Object.assign(globalThis, { Worker: AnalysisWorker });
// The build's log lines.
console.debug = console.info = () => {};

function grouped(job: AnalysisJob, diff: string): ReviewResult {
  const files = parseDiff(diff);
  const ids = files.flatMap((f) => f.hunks.map((h) => h.id));
  return {
    title: job.title,
    description: job.description,
    files,
    hunks: new Map(),
    pairs: [],
    groups: [{ id: "g1", kind: "semantic", hunkIds: ids, title: "The reader's grouping", rationale: "Grouped on this page." }],
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
      if (state.failing) throw new Error("Simulated save failure");
      state.doc = withSaved(state.doc, key, review, options) ?? state.doc;
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
