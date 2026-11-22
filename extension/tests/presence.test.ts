import assert from "node:assert/strict";
import { test } from "node:test";
import { DRAFTS_KEPT_MS, HERE_MS, type PresenceRecord, STALE_MS, staleRecords, whoIsOn } from "../src/data/presence";

const NOW = Date.UTC(2026, 10, 21, 15);
const PR = 482;
const MARIE = { id: "u-marie", displayName: "Marie Tremblay" };
const SAM = { id: "u-sam", displayName: "Samuel Côté" };
const ME = "u-me";

function record(over: Partial<PresenceRecord> & Pick<PresenceRecord, "id" | "user">): PresenceRecord {
  return { pr: PR, seenAt: NOW - 10_000, tab: "overview", drafts: 0, ...over };
}

/** The people on PR (482), from `records`. */
const on = (records: unknown[]) => whoIsOn(records, ME, NOW).get(PR) ?? [];

test("Given a page that checked in seconds ago, then its person is here, on its tab", () => {
  assert.deepEqual(on([record({ id: "b1", user: SAM, tab: "files" })]), [{ who: SAM, here: true, tab: "files", drafts: 0 }]);
});

test("Given a page that stopped checking in and holds no drafts, then its person is gone", () => {
  assert.deepEqual(on([record({ id: "b1", user: SAM, seenAt: NOW - HERE_MS - 1 })]), []);
});

test("Given a reviewer who closed the page with drafts, then they show as away with their review in progress", () => {
  const since = NOW - 86_400_000;
  const people = on([record({ id: "b1", user: MARIE, left: true, drafts: 2, draftsSince: since })]);
  assert.deepEqual(people, [{ who: MARIE, here: false, drafts: 2, draftsSince: since }]);
});

test("Given one person on two browsers, then they show once, here from the open one, with both browsers' drafts", () => {
  const people = on([
    record({ id: "laptop", user: MARIE, left: true, seenAt: NOW - 5_000, drafts: 2, draftsSince: NOW - 3_600_000 }),
    record({ id: "desktop", user: MARIE, seenAt: NOW - 20_000, tab: "files", drafts: 1, draftsSince: NOW - 60_000 }),
  ]);
  assert.deepEqual(people, [{ who: MARIE, here: true, tab: "files", drafts: 3, draftsSince: NOW - 3_600_000 }]);
});

test("Given records of a project's pull requests, then each PR gets its own people, for the hub's rows", () => {
  const people = whoIsOn([record({ id: "b1", user: SAM }), record({ id: "b2", user: MARIE, pr: 485, drafts: 1 })], ME, NOW);
  assert.deepEqual([...people.keys()].sort(), [482, 485]);
  assert.deepEqual(people.get(485)?.map((p) => p.who.displayName), ["Marie Tremblay"]);
});

test("Given your own records, then you are not listed", () => {
  assert.deepEqual(on([record({ id: "b1", user: { id: ME, displayName: "Me" }, drafts: 4 })]), []);
});

test("Given several people, then those reviewing come first, then those here, then those away", () => {
  const people = on([
    record({ id: "b1", user: { id: "u-a", displayName: "Ana" }, left: true, drafts: 1 }),
    record({ id: "b2", user: SAM }),
    record({ id: "b3", user: MARIE, drafts: 3 }),
  ]);
  assert.deepEqual(
    people.map((p) => p.who.displayName),
    ["Marie Tremblay", "Samuel Côté", "Ana"],
  );
});

test("Given records anyone in the organization could write, then malformed ones are skipped and pictures need https", () => {
  const people = on([
    null,
    { id: "b1", pr: PR, user: { id: "u-x" }, seenAt: NOW },
    { id: "b2", pr: PR, user: SAM, seenAt: "yesterday" },
    { id: "b3", pr: "482", user: SAM, seenAt: NOW },
    record({ id: "b4", user: { ...MARIE, imageUrl: "javascript:alert(1)" }, tab: "settings" as never, drafts: -4 }),
  ]);
  assert.deepEqual(people, [{ who: MARIE, here: true, tab: "overview", drafts: 0 }]);
});

test("Given leftovers of closed pages, then those past keeping are swept, and the rest stay", () => {
  const records = [
    record({ id: "fresh", user: SAM }),
    record({ id: "closed-tab", user: SAM, seenAt: NOW - STALE_MS }),
    record({ id: "review-yesterday", user: MARIE, left: true, drafts: 2, seenAt: NOW - 86_400_000 }),
    record({ id: "review-given-up", user: MARIE, left: true, drafts: 2, seenAt: NOW - DRAFTS_KEPT_MS }),
  ];
  assert.deepEqual(staleRecords(records, NOW), ["closed-tab", "review-given-up"]);
  // A review past keeping no longer shows either.
  assert.deepEqual(on([records[3]]), []);
});
