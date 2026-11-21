import assert from "node:assert/strict";
import { test } from "node:test";
import { HERE_MS, type PresenceRecord, whoIsOn } from "../src/data/presence";

const NOW = Date.UTC(2026, 10, 21, 15);
const MARIE = { id: "u-marie", displayName: "Marie Tremblay" };
const SAM = { id: "u-sam", displayName: "Samuel Côté" };
const ME = "u-me";

function record(over: Partial<PresenceRecord> & Pick<PresenceRecord, "id" | "user">): PresenceRecord {
  return { seenAt: NOW - 10_000, tab: "overview", drafts: 0, ...over };
}

test("Given a page that checked in seconds ago, then its person is here, on its tab", () => {
  const people = whoIsOn([record({ id: "b1", user: SAM, tab: "files" })], ME, NOW);
  assert.deepEqual(people, [{ who: SAM, here: true, tab: "files", drafts: 0 }]);
});

test("Given a page that stopped checking in and holds no drafts, then its person is gone", () => {
  assert.deepEqual(whoIsOn([record({ id: "b1", user: SAM, seenAt: NOW - HERE_MS - 1 })], ME, NOW), []);
});

test("Given a reviewer who closed the page with drafts, then they show as away with their review in progress", () => {
  const since = NOW - 86_400_000;
  const people = whoIsOn([record({ id: "b1", user: MARIE, left: true, drafts: 2, draftsSince: since })], ME, NOW);
  assert.deepEqual(people, [{ who: MARIE, here: false, drafts: 2, draftsSince: since }]);
});

test("Given one person on two browsers, then they show once, here from the open one, with both browsers' drafts", () => {
  const people = whoIsOn(
    [
      record({ id: "laptop", user: MARIE, left: true, seenAt: NOW - 5_000, drafts: 2, draftsSince: NOW - 3_600_000 }),
      record({ id: "desktop", user: MARIE, seenAt: NOW - 20_000, tab: "files", drafts: 1, draftsSince: NOW - 60_000 }),
    ],
    ME,
    NOW,
  );
  assert.deepEqual(people, [{ who: MARIE, here: true, tab: "files", drafts: 3, draftsSince: NOW - 3_600_000 }]);
});

test("Given your own records, then you are not listed", () => {
  assert.deepEqual(whoIsOn([record({ id: "b1", user: { id: ME, displayName: "Me" }, drafts: 4 })], ME, NOW), []);
});

test("Given several people, then those reviewing come first, then those here, then those away", () => {
  const people = whoIsOn(
    [
      record({ id: "b1", user: { id: "u-a", displayName: "Ana" }, left: true, drafts: 1 }),
      record({ id: "b2", user: SAM }),
      record({ id: "b3", user: MARIE, drafts: 3 }),
    ],
    ME,
    NOW,
  );
  assert.deepEqual(
    people.map((p) => p.who.displayName),
    ["Marie Tremblay", "Samuel Côté", "Ana"],
  );
});

test("Given records anyone in the organization could write, then malformed ones are skipped and pictures need https", () => {
  const people = whoIsOn(
    [
      null,
      { id: "b1", user: { id: "u-x" }, seenAt: NOW },
      { id: "b2", user: SAM, seenAt: "yesterday" },
      record({ id: "b3", user: { ...MARIE, imageUrl: "javascript:alert(1)" }, tab: "settings" as never, drafts: -4 }),
    ],
    ME,
    NOW,
  );
  assert.deepEqual(people, [{ who: MARIE, here: true, tab: "overview", drafts: 0 }]);
});
