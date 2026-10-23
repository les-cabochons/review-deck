import assert from "node:assert/strict";
import { test } from "node:test";
import type { Identity, PrOverview } from "../src/data/model";
import { readPrSnapshot, writePrSnapshot } from "../src/data/prCache";

const ana: Identity = { id: "ana", displayName: "Ana", uniqueName: "ana@x" };

/** localStorage in memory, refusing writes past `quota` characters in all, as a browser's full storage does. */
function memoryStorage(quota = Infinity) {
  const items = new Map<string, string>();
  const used = () => [...items].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const storage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const before = items.get(k);
      items.set(k, v);
      if (used() > quota) {
        if (before === undefined) items.delete(k);
        else items.set(k, before);
        throw new DOMException("full", "QuotaExceededError");
      }
    },
    removeItem: (k: string) => void items.delete(k),
  };
  return Object.assign(() => storage, { items });
}

const overview = (id: number, description = ""): PrOverview => ({
  pr: {
    id,
    title: `PR ${id}`,
    description,
    status: "active",
    isDraft: false,
    createdBy: ana,
    creationDate: new Date("2026-10-01T00:00:00Z"),
    sourceBranch: "feature",
    targetBranch: "main",
    repository: { id: "r", name: "repo", projectId: "p", projectName: "Project" },
    reviewers: [],
    labels: [],
    headCommit: "abc",
    mergeStatus: "succeeded",
    completionQueued: new Date("2026-10-03T00:00:00Z"),
  },
  iterations: [{ id: 2, createdDate: new Date("2026-10-02T00:00:00Z"), author: ana, description: "", headCommit: "abc", baseCommit: "def", commitIds: [] }],
  threads: [
    {
      id: 1,
      status: "active",
      published: new Date("2026-10-02T01:00:00Z"),
      updated: new Date("2026-10-02T02:00:00Z"),
      comments: [{ id: 1, parentId: 0, author: ana, content: "2026-10-02T01:00:00Z", published: new Date("2026-10-02T01:00:00Z"), isSystem: false, likes: 0 }],
      kind: "comment",
    },
  ],
  commits: [{ id: "abc", message: "Fix", authorName: "Ana", authorEmail: "ana@x", date: new Date("2026-10-02T00:30:00Z") }],
  policies: [],
  workItems: [],
});

test("Given a PR opened before in this browser, then opening it again reads it back as it was, dates included", () => {
  const storage = memoryStorage();
  writePrSnapshot("s", overview(7), storage);
  const kept = readPrSnapshot("s", 7, storage)!;
  assert.deepEqual(kept, overview(7));
  assert.ok(kept.threads[0].comments[0].published instanceof Date);
  // A comment that reads like a date stays text.
  assert.equal(kept.threads[0].comments[0].content, "2026-10-02T01:00:00Z");
  // Another PR, project or user: nothing kept.
  assert.equal(readPrSnapshot("s", 8, storage), null);
  assert.equal(readPrSnapshot("other", 7, storage), null);
});

test("Given a PR kept many hours ago, then it opens on the skeleton instead", () => {
  const storage = memoryStorage();
  writePrSnapshot("s", overview(7), storage, 0);
  assert.notEqual(readPrSnapshot("s", 7, storage, 11 * 3_600_000), null);
  assert.equal(readPrSnapshot("s", 7, storage, 13 * 3_600_000), null);
});

/** The PR items in storage, besides the index. */
const items = (storage: ReturnType<typeof memoryStorage>) => [...storage.items.keys()].filter((k) => k.startsWith("review-deck.pr.v1:")).sort();

test("Given more PRs opened than are kept, in any project or organization, then the ones opened longest ago are dropped from storage", () => {
  const storage = memoryStorage();
  for (let id = 1; id <= 12; id++) writePrSnapshot(id % 2 ? "org/a" : "org/b", overview(id), storage, id);
  // Opening an old one again makes it the most recent.
  writePrSnapshot("org/a", overview(3), storage, 13);
  writePrSnapshot("org/b", overview(14), storage, 14);
  const kept = (scope: string) => [...Array(15).keys()].filter((id) => readPrSnapshot(scope, id, storage, 15));
  assert.deepEqual(kept("org/a"), [3, 5, 7, 9, 11]);
  assert.deepEqual(kept("org/b"), [6, 8, 10, 12, 14]);
  assert.equal(items(storage).length, 10);
});

test("Given large PRs, then the ones opened longest ago go once they'd pass the total kept", () => {
  const storage = memoryStorage();
  for (let id = 1; id <= 5; id++) writePrSnapshot("s", overview(id, "x".repeat(400_000)), storage, id);
  // 1.5M characters in all: three of 400K fit.
  assert.deepEqual([...Array(6).keys()].filter((id) => readPrSnapshot("s", id, storage, 6)), [3, 4, 5]);
  assert.equal(items(storage).length, 3);
});

test("Given PRs kept many hours ago, then the next save deletes them from storage", () => {
  const storage = memoryStorage();
  writePrSnapshot("s", overview(1), storage, 0);
  writePrSnapshot("s", overview(2), storage, 1);
  writePrSnapshot("s", overview(3), storage, 13 * 3_600_000);
  assert.deepEqual(items(storage), ["review-deck.pr.v1:s:3"]);
});

test("Given full storage, then older PRs make room for the one just opened, and one too large to keep isn't", () => {
  const size = JSON.stringify(overview(1)).length;
  const storage = memoryStorage(size * 1.5);
  writePrSnapshot("s", overview(1), storage, 1);
  writePrSnapshot("s", overview(2), storage, 2);
  assert.equal(readPrSnapshot("s", 1, storage, 3), null);
  assert.notEqual(readPrSnapshot("s", 2, storage, 3), null);
  // Hundreds of long threads: not kept, and an older copy of it goes too.
  const big = memoryStorage();
  writePrSnapshot("s", overview(2), big, 3);
  writePrSnapshot("s", overview(2, "x".repeat(500_001)), big, 4);
  assert.equal(readPrSnapshot("s", 2, big, 5), null);
  assert.equal(big.items.has("review-deck.pr.v1:s:2"), false);
});

test("Given room for the PR but not for the index, then the PR isn't left in storage unlisted", () => {
  const size = JSON.stringify(overview(1)).length;
  const storage = memoryStorage(size + "review-deck.pr.v1:s:1".length + 30);
  writePrSnapshot("s", overview(1), storage, 1);
  assert.equal(readPrSnapshot("s", 1, storage, 2), null);
  assert.deepEqual(items(storage), []);
});

test("Given storage the browser denies, or garbage in it, then the PR opens on the skeleton without failing", () => {
  const denied = () => {
    throw new DOMException("denied", "SecurityError");
  };
  writePrSnapshot("s", overview(7), denied);
  assert.equal(readPrSnapshot("s", 7, denied), null);
  const storage = memoryStorage();
  storage().setItem("review-deck.pr.v1", "{not json");
  assert.equal(readPrSnapshot("s", 7, storage), null);
  writePrSnapshot("s", overview(7), storage);
  assert.notEqual(readPrSnapshot("s", 7, storage), null);
});
