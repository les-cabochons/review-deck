import assert from "node:assert/strict";
import { test } from "node:test";
import type { BlobLoad } from "../src/data/blobs";
import { blobIds, FileReads, type FileReadsSource } from "../src/data/fileReads";
import type { FileChange } from "../src/data/model";

/** A REST answer the test gives when it chooses to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const CHANGES: FileChange[] = [
  { path: "src/retry.ts", changeType: "add", newObjectId: "c2" },
  { path: "src/upload.ts", changeType: "edit", oldObjectId: "b1", newObjectId: "b2" },
];
const IDS = ["c2", "b1", "b2"];
const LOADED: BlobLoad = { blobs: new Map([["c2", "retry"], ["b1", "old upload"], ["b2", "new upload"]]), stats: { cached: 0, zipped: 3, single: 0, calls: 1 } };

/** The two reads, answered by the test; each call is one entry in `changes` or `blobs`, in the order made. */
function stub() {
  const changes: { iteration: number; compareTo: number; answer: ReturnType<typeof deferred<FileChange[]>> }[] = [];
  const blobs: { ids: string[]; signal: AbortSignal; answer: ReturnType<typeof deferred<BlobLoad>> }[] = [];
  const source: FileReadsSource = {
    changes: (iteration, compareTo) => {
      const answer = deferred<FileChange[]>();
      changes.push({ iteration, compareTo, answer });
      return answer.promise;
    },
    blobs: (ids, signal) => {
      const answer = deferred<BlobLoad>();
      // As the loader does: a cancelled read stops with an abort error.
      signal.addEventListener("abort", () => answer.reject(new DOMException("Aborted", "AbortError")));
      blobs.push({ ids, signal, answer });
      return answer.promise;
    },
  };
  return { reads: new FileReads(source), changes, blobs };
}

/** Lets the answers given so far reach their callbacks. */
const settle = () => new Promise((ok) => setTimeout(ok, 0));

test("Given the prefetch's reads start before the build asks, then the build takes them over instead of reading again, and the next build reads again", async () => {
  const s = stub();
  s.reads.prime(2);
  assert.deepEqual(s.changes.map((c) => [c.iteration, c.compareTo]), [[2, 0]]);
  s.changes[0].answer.resolve(CHANGES);
  await settle();
  // The blobs follow the changes without being asked for.
  assert.deepEqual(s.blobs.map((b) => b.ids), [IDS]);

  const build = new AbortController();
  assert.equal(await s.reads.getChanges(2, 0), CHANGES);
  // The same blobs in another order are the same read.
  const loading = s.reads.getBlobs(["b2", "b1", "c2", "b1"], build.signal);
  s.blobs[0].answer.resolve(LOADED);
  assert.equal(await loading, LOADED);
  assert.equal(s.changes.length, 1);
  assert.equal(s.blobs.length, 1);

  // Taken: a later build (Regroup, or back to this comparison) reads for itself.
  void s.reads.getChanges(2, 0);
  void s.reads.getBlobs(IDS);
  assert.equal(s.changes.length, 2);
  assert.equal(s.blobs.length, 2);
});

test("Given the build asks before the prefetch's reads start, then the prefetch takes the build's reads and starts none", async () => {
  const s = stub();
  const build = new AbortController();
  const changes = s.reads.getChanges(2, 0);
  s.reads.prime(2);
  assert.equal(s.changes.length, 1);
  s.changes[0].answer.resolve(CHANGES);
  await changes;
  const blobs = s.reads.getBlobs(blobIds(CHANGES), build.signal);
  await settle();
  assert.equal(s.blobs.length, 1);
  s.blobs[0].answer.resolve(LOADED);
  assert.equal(await blobs, LOADED);
});

test("Given a prefetched read that failed, then the build reads again, and the prefetch's failure is reported nowhere", async () => {
  const s = stub();
  s.reads.prime(2);
  s.changes[0].answer.reject(new Error("TF401019: the repository is not found"));
  await settle();
  const again = s.reads.getChanges(2, 0);
  assert.equal(s.changes.length, 2);
  s.changes[1].answer.resolve(CHANGES);
  assert.equal(await again, CHANGES);
  assert.equal(s.blobs.length, 0);

  // The same for the blobs: the changes came, the zip didn't.
  const t = stub();
  t.reads.prime(2);
  t.changes[0].answer.resolve(CHANGES);
  await settle();
  t.blobs[0].answer.reject(new Error("zip unavailable"));
  await settle();
  const blobs = t.reads.getBlobs(IDS);
  assert.equal(t.blobs.length, 2);
  t.blobs[1].answer.resolve(LOADED);
  assert.equal(await blobs, LOADED);
});

test("Given a build cancelled while holding a read, then what's left of the read stops and the next build reads again", async () => {
  const s = stub();
  s.reads.prime(2);
  s.changes[0].answer.resolve(CHANGES);
  await settle();
  const build = new AbortController();
  const held = s.reads.getBlobs(IDS, build.signal);
  build.abort();
  assert.equal(s.blobs[0].signal.aborted, true);
  await assert.rejects(held, { name: "AbortError" });
  void s.reads.getBlobs(IDS);
  assert.equal(s.blobs.length, 2);

  // A build's own read, cancelled before anyone took it, isn't handed to the prefetch, which starts no other.
  const t = stub();
  const first = new AbortController();
  const own = t.reads.getBlobs(IDS, first.signal);
  first.abort();
  await assert.rejects(own, { name: "AbortError" });
  t.reads.prime(2);
  t.changes[0].answer.resolve(CHANGES);
  await settle();
  assert.equal(t.blobs.length, 1);
});

test("Given the page left while the build waited for the prefetched changes, then the blobs read primed for it stops and nothing else starts", async () => {
  const s = stub();
  s.reads.prime(2);
  const build = new AbortController();
  // As buildReview does: the blobs right after the changes, with the build's signal.
  const building = s.reads.getChanges(2, 0).then((changes) => s.reads.getBlobs(blobIds(changes), build.signal));
  build.abort();
  s.changes[0].answer.resolve(CHANGES);
  await assert.rejects(building, { name: "AbortError" });
  assert.equal(s.blobs.length, 1);
  assert.equal(s.blobs[0].signal.aborted, true);
});

test("Given a build cancelled while waiting for its changes, when another build already reads the same blobs, then the cancelled build leaves that read alone", async () => {
  const s = stub();
  const old = new AbortController();
  // The reader picks another comparison with the same files (a rename only) while the first build waits for its changes.
  const cancelled = s.reads.getChanges(1, 0).then((changes) => s.reads.getBlobs(blobIds(changes), old.signal));
  old.abort();
  const current = s.reads.getBlobs(IDS, new AbortController().signal);
  s.changes[0].answer.resolve(CHANGES);
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(s.blobs.length, 1);
  assert.equal(s.blobs[0].signal.aborted, false);
  s.blobs[0].answer.resolve(LOADED);
  assert.equal(await current, LOADED);
});

test("Given a build from the kept copy whose reads are done before the PR's updates land, then the prefetch reads nothing again", async () => {
  const s = stub();
  const changes = s.reads.getChanges(2, 0);
  s.changes[0].answer.resolve(CHANGES);
  const blobs = s.reads.getBlobs(blobIds(await changes), new AbortController().signal);
  s.blobs[0].answer.resolve(LOADED);
  assert.equal(await blobs, LOADED);
  s.reads.prime(2);
  await settle();
  assert.equal(s.changes.length, 1);
  assert.equal(s.blobs.length, 1);
});

test("Given a build on another comparison (a kept copy behind the PR), then both read, and the prefetch's reads wait for the build to move to the latest update", async () => {
  const s = stub();
  s.reads.prime(2);
  const older = s.reads.getChanges(1, 0);
  assert.deepEqual(s.changes.map((c) => c.iteration), [2, 1]);
  s.changes[0].answer.resolve(CHANGES);
  s.changes[1].answer.resolve([]);
  await older;
  await settle();
  s.blobs[0].answer.resolve(LOADED);
  // A push since the copy was kept: the page moves to update 2, whose reads are done.
  assert.equal(await s.reads.getChanges(2, 0), CHANGES);
  assert.equal(await s.reads.getBlobs(IDS), LOADED);
  assert.equal(s.changes.length, 2);
  assert.equal(s.blobs.length, 1);
});

test("Given changed files, then the blobs read are both sides of each, in the order the files come", () => {
  assert.deepEqual(blobIds(CHANGES), IDS);
  assert.deepEqual(blobIds([{ path: "gone.ts", changeType: "delete", oldObjectId: "d1" }]), ["d1"]);
});
