import assert from "node:assert/strict";
import { test } from "node:test";
import { DETAILS_FRESH_MS, type DetailRecord, detailsDue, keptRecords, rowKey } from "../src/ui/hub/detailsDue";
import { detailScope, type PrSummary } from "../src/data/list";
import type { Identity } from "../src/data/model";

const me: Identity = { id: "me", displayName: "Me", uniqueName: "me@x" };
const ana: Identity = { id: "ana", displayName: "Ana", uniqueName: "ana@x" };

const row = (id: number, over: Partial<PrSummary> = {}): PrSummary => ({
  id,
  title: `PR ${id}`,
  repository: { id: "r", name: "repo", projectId: "p", projectName: "p" },
  createdBy: ana,
  creationDate: new Date("2026-10-01T00:00:00Z"),
  status: "active",
  isDraft: false,
  sourceBranch: "feature",
  targetBranch: "main",
  reviewers: [{ ...me, vote: 0, isRequired: false }],
  labels: [],
  openable: true,
  ...over,
});

const fetched = (at: number, scope: DetailRecord["scope"] = "full", pr = row(1)): DetailRecord => ({ scope, at, row: rowKey(pr) });

test("Given details fetched a minute ago, then a list refresh leaves them; after DETAILS_FRESH_MS they're due again", () => {
  assert.equal(detailsDue(fetched(1000), row(1), "full", 1000 + 60_000), false);
  assert.equal(detailsDue(fetched(1000), row(1), "full", 1000 + DETAILS_FRESH_MS), true);
  assert.equal(detailsDue(undefined, row(1), "full", 1000), true);
});

test("Given only the review policy was fetched, then the row coming on screen fetches the rest, and a full fetch covers a review one", () => {
  assert.equal(detailsDue(fetched(0, "review"), row(1), "full", 1), true);
  assert.equal(detailsDue(fetched(0, "review"), row(1), "review", 1), false);
  assert.equal(detailsDue(fetched(0, "full"), row(1), "review", 1), false);
});

test("Given a vote, a required reviewer or a retarget since the fetch, then the details are due at once; a new title isn't", () => {
  const record = fetched(0);
  assert.equal(detailsDue(record, row(1, { reviewers: [{ ...me, vote: 10, isRequired: false }] }), "full", 1), true);
  assert.equal(detailsDue(record, row(1, { reviewers: [{ ...me, vote: 0, isRequired: true }] }), "full", 1), true);
  assert.equal(detailsDue(record, row(1, { reviewers: [{ ...me, vote: 0, isRequired: false }, { ...ana, vote: 0, isRequired: false }] }), "full", 1), true);
  assert.equal(detailsDue(record, row(1, { targetBranch: "release/1" }), "full", 1), true);
  assert.equal(detailsDue(record, row(1, { title: "Renamed", sourceBranch: "moved", labels: ["x"] }), "full", 1), false);
  // The same reviewers in another order are the same row.
  const two = [{ ...me, vote: 5, isRequired: false }, { ...ana, vote: -5, isRequired: true }];
  assert.equal(rowKey(row(1, { reviewers: two })), rowKey(row(1, { reviewers: [...two].reverse() })));
});

test("Given the hub's kept details, then they count as fetched when its list was, as full or review as they are, and only for listed rows", () => {
  const snap = {
    prs: [row(1), row(2)],
    details: new Map<number, Partial<PrSummary>>([
      [1, { comments: 2, checks: "passing", reviewPolicy: "none" }],
      [2, { checks: "passing", reviewPolicy: "met" }],
      [3, { comments: 0 }],
    ]),
    listedAt: 5000,
  };
  const records = keptRecords(snap);
  assert.deepEqual(records.get(1), { scope: "full", at: 5000, row: rowKey(row(1)) });
  assert.equal(records.get(2)?.scope, "review");
  assert.equal(records.has(3), false);
  assert.equal(detailsDue(records.get(1), row(1), "full", 5000 + 60_000), false);
  assert.equal(detailsDue(records.get(2), row(2), "full", 5000 + 60_000), true);
  assert.equal(detailScope({ comments: 0 }), "full");
  assert.equal(detailScope({ checks: "failing" }), "review");
});
