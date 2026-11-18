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

/** The title of the guide published from Ajour. */
const AJOUR = "Ajour's guide";

/** A guide published from Ajour for this PR's hunks, with a summary; a copy each time. */
async function ajourGuide(): Promise<SavedReview> {
  ajourTemplate ??= makeAjourGuide();
  return structuredClone(await ajourTemplate);
}
let ajourTemplate: Promise<SavedReview> | undefined;

async function makeAjourGuide(): Promise<SavedReview> {
  const key: ReviewKey = { repo: "r", pr: 0, iteration: 3, compareTo: 0 };
  const { state, store } = memoryStore();
  // Group once, to save a guide for exactly these hunks, then make it Ajour's.
  await buildReview(source, meta, key.iteration, key.compareTo, { saved: { store, key } });
  const saved = savedFor(state.doc, key) as SavedReview;
  return JSON.parse(JSON.stringify({ ...saved, groups: saved.groups.map((g) => ({ ...g, title: AJOUR })), madeWith: { ...saved.madeWith, app: "ajour" }, summary }));
}

/** The store holding, for `key`, a guide published from Ajour for this PR's hunks, with a summary. */
async function withPublished(key: ReviewKey) {
  const { state, store } = memoryStore();
  state.doc = withSaved(null, key, await ajourGuide());
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
 * A store whose writes wait until the test moves them on, each in two steps: the commit (the write reaching storage,
 * or failing) and the response (the page hearing of it). Both wait as long as the test likes, and any write may take
 * either step whenever it is open. A Publish that failed rejects, as the hosts' do.
 */
function heldStore(doc: unknown = null) {
  const state = { doc };
  const held: { title: string; publish: boolean; committed?: boolean; responded: boolean; commit: (written: boolean) => void; respond: () => void }[] = [];
  const store: SavedReviews = {
    load: async (key) => savedFor(state.doc, key),
    save: (key, review, options) =>
      new Promise((resolve, reject) => {
        const write: (typeof held)[number] = {
          title: review.groups[0].title,
          publish: options?.publish === true,
          responded: false,
          commit: (written) => {
            write.committed = written;
            if (written) state.doc = withSaved(state.doc, key, review, options) ?? state.doc;
          },
          respond: () => {
            write.responded = true;
            if (write.committed || !write.publish) resolve(write.committed === true);
            else reject(new Error("Simulated save failure"));
          },
        };
        held.push(write);
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

const storedTitle = (doc: unknown, key: ReviewKey) => (savedFor(doc, key) as SavedReview | null)?.groups[0].title;
const shownTitle = async (store: SavedReviews, key: ReviewKey) => (await open(store, key)).result.groups[0].title;

/** A PR's saved-reviews document holding, for `key`, a guide published from Ajour for this PR's hunks. */
async function publishedDoc(key: ReviewKey) {
  return (await withPublished(key)).state.doc;
}

test("Given a first save still pending when the reader regroups, then the Regroup's save waits for it, and a late failure doesn't bring the first grouping back", async () => {
  const key: ReviewKey = { repo: "r", pr: 6, iteration: 3, compareTo: 0 };
  const { state, store, held } = heldStore();
  await grouping(store, key, "First grouping", false);
  await grouping(store, key, "New regroup", true);
  assert.deepEqual(held.map((h) => h.title), ["First grouping"]);

  held[0].commit(false);
  held[0].respond();
  await settled();
  assert.deepEqual(held.map((h) => h.title), ["First grouping", "New regroup"]);
  assert.equal(await shownTitle(store, key), "New regroup");
  held[1].commit(true);
  held[1].respond();
  await settled();
  assert.equal(storedTitle(state.doc, key), "New regroup");
  assert.equal(await shownTitle(store, key), "New regroup");
});

test("Given a first save still pending when the reader regroups, then the first succeeding and the Regroup's save failing keeps the Regroup for the session", async () => {
  const key: ReviewKey = { repo: "r", pr: 7, iteration: 3, compareTo: 0 };
  const { state, store, held } = heldStore();
  await grouping(store, key, "First grouping", false);
  await grouping(store, key, "New regroup", true);

  held[0].commit(true);
  held[0].respond();
  await settled();
  held[1].commit(false);
  held[1].respond();
  await settled();
  assert.equal(storedTitle(state.doc, key), "First grouping");
  assert.equal(await shownTitle(store, key), "New regroup");
});

test("Given a Publish still pending when the reader regroups, then a later grouping that saves shows on reopen, not the one before it", async () => {
  const key: ReviewKey = { repo: "r", pr: 8, iteration: 3, compareTo: 0 };
  const { state, store, held } = heldStore(await publishedDoc(key));
  const a = await grouping(store, key, "A", true);
  const publishing = publishGuide(store, key, a.ownGuide!);
  await grouping(store, key, "B", true);
  held[0].commit(true);
  held[0].respond();
  await publishing;
  assert.equal(storedTitle(state.doc, key), "A");
  assert.equal(await shownTitle(store, key), "B");

  await grouping(store, key, "C", true);
  assert.deepEqual(held.map((h) => h.title), ["A", "C"]);
  held[1].commit(true);
  held[1].respond();
  await settled();
  assert.equal(storedTitle(state.doc, key), "C");
  const reopened = await open(store, key);
  assert.equal(reopened.result.groups[0].title, "C");
  assert.equal(reopened.ownGuide, undefined);
});

test("Given a write in flight, then of the writes asked for after it only the latest is made, and a Publish it replaces before it starts rejects", async () => {
  const key: ReviewKey = { repo: "r", pr: 9, iteration: 3, compareTo: 0 };
  const { state, store, held } = heldStore();
  await grouping(store, key, "G1", false);
  await grouping(store, key, "G2", true);
  await grouping(store, key, "G3", true);
  held[0].commit(true);
  held[0].respond();
  await settled();
  assert.deepEqual(held.map((h) => h.title), ["G1", "G3"]);
  held[1].commit(true);
  held[1].respond();
  await settled();
  assert.equal(storedTitle(state.doc, key), "G3");
  assert.equal(await shownTitle(store, key), "G3");

  // From a published guide: Publish A starts; B is the reader's own, and its Publish waits; A reaches storage; C, grouped
  // over A (now Review Deck's own), saves, and replaces B's Publish before it starts.
  const other: ReviewKey = { ...key, compareTo: 1 };
  const published = heldStore(await publishedDoc(other));
  const a = await grouping(published.store, other, "A", true);
  const publishingA = publishGuide(published.store, other, a.ownGuide!);
  const b = await grouping(published.store, other, "B", true);
  const publishingB = publishGuide(published.store, other, b.ownGuide!);
  published.held[0].commit(true);
  await grouping(published.store, other, "C", true);
  await assert.rejects(publishingB, /a newer grouping took its place/);
  published.held[0].respond();
  await publishingA;
  await settled();
  assert.deepEqual(published.held.map((h) => h.title), ["A", "C"]);
  // B is no longer on show: publishing it now rejects too, without writing.
  await assert.rejects(publishGuide(published.store, other, b.ownGuide!), /a newer grouping took its place/);
  assert.equal(published.held.length, 2);
});

/**
 * AdoHost.savedReviews over a data manager whose create and set each commit, then respond, when the test says;
 * `comparisons` is what the PR's document holds to begin with.
 */
async function adoStore(key: ReviewKey, comparisons: unknown = null) {
  Object.assign(globalThis, { window: { addEventListener() {}, parent: { postMessage() {} } }, self: globalThis });
  const { AdoHost } = await import("../src/app/adoHost");
  type Doc = { id: string; comparisons: unknown; __etag?: number };
  let doc: Doc | null = comparisons ? { id: `p.r.${key.pr}`, comparisons, __etag: 1 } : null;
  const writes: { title: string; commit: () => void; respond: () => void }[] = [];
  // The data manager's create and set: each commits, then responds, when the test says.
  const write = (next: Doc) =>
    new Promise<unknown>((resolve, reject) => {
      let respond = () => {};
      writes.push({
        title: storedTitle(next.comparisons, key)!,
        commit: () => {
          if (doc?.__etag !== next.__etag) {
            respond = () => reject(new Error("etag mismatch"));
            return;
          }
          doc = { ...next, __etag: (doc?.__etag ?? 0) + 1 };
          respond = () => resolve(doc);
        },
        respond: () => respond(),
      });
    });
  const data = {
    getDocument: async () => {
      if (!doc) throw Object.assign(new Error("Not found"), { status: 404 });
      return structuredClone(doc);
    },
    createDocument: (_: string, next: Doc) => write(next),
    setDocument: (_: string, next: Doc) => write(next),
  };
  const store = AdoHost.prototype.savedReviews.call({ project: { id: "p" }, data: async () => data } as unknown as InstanceType<typeof AdoHost>);
  return { store, writes, stored: () => storedTitle(doc?.comparisons, key) };
}

test("Given the Azure DevOps store, when the reader regroups A into B, then A's write can't land over B's, and reopening shows B", async () => {
  // The finding: B commits, then A commits over it; A's response arrives, then B's, which marked B stored while storage
  // held A. Each step below is the earliest the page allows: B's write starts only once A's response has arrived.
  const key: ReviewKey = { repo: "r", pr: 10, iteration: 3, compareTo: 0 };
  const { store, writes, stored } = await adoStore(key);

  await grouping(store, key, "A", false);
  await grouping(store, key, "B", true);
  await settled();
  assert.deepEqual(writes.map((w) => w.title), ["A"], "B's write waits for A's response");
  assert.equal(await shownTitle(store, key), "B");
  writes[0].commit();
  assert.equal(stored(), "A");
  assert.equal(await shownTitle(store, key), "B");
  writes[0].respond();
  await settled();
  assert.deepEqual(writes.map((w) => w.title), ["A", "B"]);
  assert.equal(await shownTitle(store, key), "B");
  writes[1].commit();
  assert.equal(stored(), "B");
  assert.equal(await shownTitle(store, key), "B");
  writes[1].respond();
  await settled();
  assert.equal(stored(), "B");
  assert.equal(await shownTitle(store, key), "B");
  assert.equal(writes.length, 2);
});

test("Given the Azure DevOps store and a published guide, when Publish B waits behind Publish A and the reader regroups into C, then B rejects without writing, and reopening shows C", async () => {
  // The finding: C is the reader's own (the published guide is still saved), so it queues no write to replace B's. A's
  // response arrived, B's Publish started and succeeded, and storage held B while the page showed C.
  const key: ReviewKey = { repo: "r", pr: 11, iteration: 3, compareTo: 0 };
  const { store, writes, stored } = await adoStore(key, await publishedDoc(key));
  const a = await grouping(store, key, "A", true);
  const publishingA = publishGuide(store, key, a.ownGuide!);
  const b = await grouping(store, key, "B", true);
  const publishingB = assert.rejects(publishGuide(store, key, b.ownGuide!), /a newer grouping took its place/);
  const c = await grouping(store, key, "C", true);
  assert.ok(c.ownGuide, "C is kept for the session, with no write of its own");
  await settled();
  assert.deepEqual(writes.map((w) => w.title), ["A"]);

  writes[0].commit();
  writes[0].respond();
  await publishingA;
  await publishingB;
  await settled();
  assert.deepEqual(writes.map((w) => w.title), ["A"], "B's Publish never starts");
  assert.equal(stored(), "A");
  const reopened = await open(store, key);
  assert.equal(reopened.result.groups[0].title, "C");
  assert.equal(reopened.ownGuide, c.ownGuide);

  // C, still on show, publishes.
  const publishingC = publishGuide(store, key, c.ownGuide!);
  await settled();
  writes[1].commit();
  writes[1].respond();
  await publishingC;
  assert.equal(stored(), "C");
  assert.equal(await shownTitle(store, key), "C");
});

test("Given a save in flight when a guide is published from Ajour, when the reader's Publish waits behind the save and they regroup again, then the Publish rejects without writing", async () => {
  const key: ReviewKey = { repo: "r", pr: 12, iteration: 3, compareTo: 0 };
  const { state, store, held } = heldStore();
  await grouping(store, key, "G1", false);
  // Another reader publishes from Ajour while G1's save is in flight: the next Regroups are the reader's own.
  state.doc = withSaved(state.doc, key, await ajourGuide(), { publish: true });
  const g2 = await grouping(store, key, "G2", true);
  assert.ok(g2.ownGuide);
  const publishing = assert.rejects(publishGuide(store, key, g2.ownGuide!), /a newer grouping took its place/);
  const g3 = await grouping(store, key, "G3", true);
  assert.ok(g3.ownGuide);

  held[0].commit(true);
  held[0].respond();
  await publishing;
  await settled();
  assert.deepEqual(held.map((h) => h.title), ["G1"], "G2's Publish never starts");
  assert.equal(storedTitle(state.doc, key), AJOUR);
  const reopened = await open(store, key);
  assert.equal(reopened.result.groups[0].title, "G3");
  assert.equal(reopened.ownGuide, g3.ownGuide);
});

/**
 * Plays one sequence of a reader's steps on a comparison: up to three groupings ("group", a Regroup), a Publish of the
 * latest one while it is the reader's own, a guide published from Ajour landing in storage ("ajour", once, from another
 * reader), and each write's commit (written or failed) and response, whenever they are open. A Regroup while a
 * published guide is saved is the reader's own and queues no write; "ajour" makes them possible from any start, and
 * lets a Publish wait behind a save. `choose` picks one of the steps open at each point; "stop" ends the sequence once
 * every write has had its response. After every step:
 * - a write starts only for the latest grouping, so storage never takes a grouping the page has moved past;
 * - one write at a time is in the store's hands;
 * - the published guide is still saved unless a Publish wrote after it landed;
 * - reopening shows the latest grouping, or the published guide if it landed since, without grouping or saving again;
 * - while the published guide is saved, a grouping made over it is the reader's own, which they can still Publish.
 */
async function playSequence(key: ReviewKey, start: unknown, ajour: SavedReview, choose: (steps: string[]) => string) {
  const { state, store, held } = heldStore(start);
  let publishedTitle = storedTitle(start, key);
  // A Publish wrote since the published guide landed.
  let publishWrote = false;
  let ajourLanded = false;
  // The published guide landed after the latest grouping.
  let landedSince = false;
  const steps: string[] = [];
  let groupings = 0;
  let latest: Awaited<ReturnType<typeof open>> | undefined;
  let publishedLatest = false;
  const publishes: Promise<void>[] = [];
  for (;;) {
    const open_: string[] = [];
    if (groupings < 3) open_.push("group");
    if (latest?.ownGuide && !publishedLatest) open_.push("publish");
    if (groupings > 0 && !ajourLanded && storedTitle(state.doc, key) !== AJOUR) open_.push("ajour");
    held.forEach((h, i) => {
      if (h.committed === undefined) open_.push(`commit ${i}`, `fail ${i}`);
      if (h.committed !== undefined && !h.responded) open_.push(`respond ${i}`);
    });
    if (groupings > 0 && held.every((h) => h.responded)) open_.push("stop");
    const step = choose(open_);
    steps.push(step);
    if (step === "stop") break;
    const started = held.length;
    if (step === "group") {
      latest = await grouping(store, key, `G${++groupings}`, true);
      publishedLatest = false;
      landedSince = false;
    } else if (step === "publish") {
      publishedLatest = true;
      publishes.push(publishGuide(store, key, latest!.ownGuide!).catch(() => {}));
    } else if (step === "ajour") {
      state.doc = withSaved(state.doc, key, ajour, { publish: true });
      publishedTitle = AJOUR;
      ajourLanded = landedSince = true;
      publishWrote = false;
    } else {
      const [action, i] = step.split(" ");
      const write = held[Number(i)];
      if (action === "respond") write.respond();
      else {
        write.commit(action === "commit");
        if (write.publish && action === "commit") publishWrote = true;
      }
    }
    await settled();
    const label = steps.join(", ");
    for (const write of held.slice(started)) assert.equal(write.title, `G${groupings}`, `${label}: a write starts only for the latest grouping`);
    assert.ok(held.filter((h) => !h.responded).length <= 1, `${label}: one write at a time`);
    if (publishedTitle && !publishWrote) assert.equal(storedTitle(state.doc, key), publishedTitle, `${label}: only a Publish replaces a published guide`);
    if (groupings === 0) continue;
    const writes = held.length;
    const reopened = await open(store, key);
    await settled();
    const shown = reopened.result.groups[0].title;
    if (landedSince) assert.ok([`G${groupings}`, AJOUR].includes(shown), `${label}: reopening shows ${shown}`);
    else assert.equal(shown, `G${groupings}`, label);
    assert.equal(held.length, writes, `${label}: reopening writes nothing`);
    if (publishedTitle && !publishWrote && !landedSince) assert.equal(reopened.ownGuide?.groups[0].title, `G${groupings}`, `${label}: the reader's own guide`);
  }
  await Promise.all(publishes);
}

/** Plays every sequence playSequence allows, each on a comparison of its own; returns how many. */
async function everySequence(start: (key: ReviewKey) => Promise<unknown>, pr: number) {
  const ajour = await ajourGuide();
  let played = 0;
  // Depth-first over the choices: each run replays the previous one's choices, then takes the next untried step.
  let choices: number[] = [];
  for (;;) {
    const counts: number[] = [];
    const key: ReviewKey = { repo: "r", pr, iteration: 3, compareTo: played };
    await playSequence(key, await start(key), ajour, (steps) => {
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

test("Given a published guide, then in every order of up to three groupings, Publishes, another Ajour publication, and their writes' commits and responses, only the latest grouping's write starts, reopening shows it, and a published guide stays until a Publish replaces it", async () => {
  // How many it played, so a change that stops it exploring fails here.
  assert.equal(await everySequence(publishedDoc, 100), 1829);
});

test("Given nothing saved, then in every order of up to three groupings, an Ajour publication that makes the next ones the reader's own, Publishes waiting behind saves, and their writes' commits and responses, only the latest grouping's write starts, and reopening shows it", async () => {
  assert.equal(await everySequence(async () => null, 101), 1734);
});
