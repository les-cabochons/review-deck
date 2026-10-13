import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { hubPatch, onHubPatch, readHubSnapshot, rememberPr, resetHubCache, withRecentPatches, writeHubSnapshot } from "../src/data/hubCache";
import { policyFacts, type PrSummary, sectionOf } from "../src/data/list";
import type { Identity, PrOverview } from "../src/data/model";

const me: Identity = { id: "me", displayName: "Me", uniqueName: "me@x" };
const ana: Identity = { id: "ana", displayName: "Ana", uniqueName: "ana@x" };

function memoryStorage() {
  const items = new Map<string, string>();
  return () => ({ getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) });
}

const row = (id: number, over: Partial<PrSummary> = {}): PrSummary => ({
  id,
  title: `PR ${id}`,
  repository: { id: "r", name: "repo", projectName: "p" },
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

const overview = (pr: PrSummary, over: Partial<PrOverview["pr"]> = {}): PrOverview => ({
  pr: { ...pr, description: "", repository: { ...pr.repository, projectId: "p" }, ...over },
  iterations: [],
  threads: [
    { id: 1, status: "active", published: new Date(), updated: new Date(), comments: [], kind: "comment" },
    { id: 2, status: "fixed", published: new Date(), updated: new Date(), comments: [], kind: "comment" },
    { id: 3, status: "active", published: new Date(), updated: new Date(), comments: [], kind: "vote" },
  ],
  commits: [],
  policies: [{ id: "b", name: "Build", state: "approved", blocking: true }],
  workItems: [],
});

beforeEach(() => resetHubCache());

test("Given a saved hub, then a reload reads it back with dates and details intact", () => {
  const storage = memoryStorage();
  const restack = { state: "failed" as const, description: "conflict", date: new Date("2026-10-02T00:00:00Z") };
  writeHubSnapshot("s", { prs: [row(1)], details: new Map([[1, { checks: "passing", restack }]]), groups: [{ id: "t", name: "Team" }], listedAt: Date.now() }, storage);
  resetHubCache(); // a new page: only sessionStorage survives
  const snap = readHubSnapshot("s", storage)!;
  assert.equal(snap.prs[0].creationDate.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(snap.details.get(1)?.restack?.date.getTime(), restack.date.getTime());
  assert.deepEqual(snap.groups, [{ id: "t", name: "Team" }]);
  assert.equal(readHubSnapshot("other", storage), null);
});

test("Given a snapshot from many hours ago, then the hub starts from a skeleton instead", () => {
  const storage = memoryStorage();
  writeHubSnapshot("s", { prs: [row(1)], details: new Map(), groups: [], listedAt: 0 }, storage);
  assert.equal(readHubSnapshot("s", storage, 13 * 3_600_000), null);
});

test("Given I vote on a PR page, then the cached hub already shows it under You reviewed", () => {
  const storage = memoryStorage();
  const pr = row(7);
  writeHubSnapshot("s", { prs: [pr], details: new Map(), groups: [], listedAt: Date.now() }, storage);
  assert.equal(sectionOf(pr, me), "needs-review");
  const seen: number[] = [];
  onHubPatch("s", (p) => seen.push(p.id));

  rememberPr("s", hubPatch(overview(pr, { reviewers: [{ ...me, vote: 10, isRequired: false }] })), storage);

  const snap = readHubSnapshot("s", storage)!;
  assert.equal(sectionOf(snap.prs[0], me), "reviewed");
  assert.deepEqual(snap.details.get(7), { comments: 1, checks: "passing", reviewPolicy: "none" });
  assert.deepEqual(seen, [7]);
});

test("Given a list requested before my vote, then the vote stays on top of it; a later list wins", () => {
  const pr = row(7);
  rememberPr("s", hubPatch(overview(pr, { reviewers: [{ ...me, vote: -5, isRequired: false }] }), 1000), memoryStorage());
  assert.equal(withRecentPatches("s", [pr], 500)[0].reviewers[0].vote, -5);
  assert.equal(withRecentPatches("s", [pr], 2000)[0].reviewers[0].vote, 0);
});

test("Given a PR completed from its page, then it moves to Recently completed with a closed date", () => {
  const pr = row(7, { createdBy: me, reviewers: [] });
  rememberPr("s", hubPatch(overview(pr, { status: "completed" }), 1000), memoryStorage());
  const [done] = withRecentPatches("s", [pr], 0);
  assert.equal(sectionOf(done, me), "completed");
  assert.equal(done.closedDate?.getTime(), 1000);
});

test("Given policy evaluations, then builds give checks and blocking reviewer policies give the review policy", () => {
  assert.deepEqual(policyFacts([]), { checks: "none", reviewPolicy: "none" });
  assert.deepEqual(
    policyFacts([
      { name: "Build", blocking: true, state: "running" },
      { name: "Minimum number of reviewers", blocking: true, state: "approved" },
      { name: "Required reviewers", blocking: true, state: "notApplicable" },
    ]),
    { checks: "pending", reviewPolicy: "met" },
  );
  assert.deepEqual(
    policyFacts([
      { name: "Build", blocking: false, state: "broken" },
      { name: "Build", blocking: true, state: "approved" },
      { name: "Minimum number of reviewers", blocking: true, state: "queued" },
      { name: "Required reviewers", blocking: false, state: "rejected" },
    ]),
    { checks: "failing", reviewPolicy: "unmet" },
  );
});
