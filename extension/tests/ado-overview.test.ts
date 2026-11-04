import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitCommitRef, GitPullRequest, GitPullRequestCommentThread, GitPullRequestIteration } from "azure-devops-extension-api/Git";
import type { PolicyEvaluationRecord } from "azure-devops-extension-api/Policy";
import { OverviewLoad, type OverviewReads } from "../src/data/adoOverview";
import type { PrOverview } from "../src/data/model";

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

const ana = { id: "u2", displayName: "Ana Lima", uniqueName: "ana@contoso.com" };

const PULL_REQUEST = {
  pullRequestId: 471,
  title: "Retry failed uploads",
  description: "Retries uploads that fail with a 5xx.",
  status: 1,
  isDraft: false,
  createdBy: ana,
  creationDate: "2026-10-01T00:00:00Z",
  sourceRefName: "refs/heads/retry-uploads",
  targetRefName: "refs/heads/main",
  repository: { id: "users-sdk", name: "users-sdk", project: { id: "p1", name: "Storefront" } },
  reviewers: [{ ...ana, vote: 10, isRequired: true }],
  mergeStatus: 3,
  lastMergeSourceCommit: { commitId: "abc" },
} as unknown as GitPullRequest;

const ITERATIONS = [
  { id: 1, createdDate: "2026-10-01T00:00:00Z", author: ana, sourceRefCommit: { commitId: "aaa" }, commonRefCommit: { commitId: "base" }, commits: [{ commitId: "aaa" }] },
  { id: 2, createdDate: "2026-10-02T00:00:00Z", author: ana, sourceRefCommit: { commitId: "abc" }, commonRefCommit: { commitId: "base" }, commits: [{ commitId: "abc" }, { commitId: "abd" }] },
] as unknown as GitPullRequestIteration[];

const THREADS = [
  { id: 5, status: 1, publishedDate: "2026-10-02T01:00:00Z", lastUpdatedDate: "2026-10-02T01:00:00Z", comments: [{ id: 1, parentCommentId: 0, author: ana, content: "Add a test", commentType: 1 }], properties: {} },
] as unknown as GitPullRequestCommentThread[];

const COMMITS = [{ commitId: "abc", comment: "Retry on 5xx", author: { name: "Ana Lima", email: "ana@contoso.com", date: "2026-10-02T00:00:00Z" } }] as unknown as GitCommitRef[];

const POLICIES = [{ evaluationId: "e1", status: 2, configuration: { isBlocking: true, type: { displayName: "Build" }, settings: {} } }] as unknown as PolicyEvaluationRecord[];

/** The seven reads, answered by the test. `first` are the PR and its updates, `rest` everything else. */
function stub() {
  const pending = {
    pullRequest: deferred<GitPullRequest>(),
    iterations: deferred<GitPullRequestIteration[]>(),
    threads: deferred<GitPullRequestCommentThread[]>(),
    commits: deferred<GitCommitRef[]>(),
    labels: deferred<{ name: string; active: boolean }[]>(),
    workItems: deferred<{ id: string; url: string }[]>(),
    policies: deferred<PolicyEvaluationRecord[]>(),
  };
  const reads = Object.fromEntries(Object.entries(pending).map(([name, d]) => [name, () => d.promise])) as unknown as OverviewReads;
  return {
    reads,
    pending,
    first() {
      pending.pullRequest.resolve(PULL_REQUEST);
      pending.iterations.resolve(ITERATIONS);
    },
    rest() {
      pending.threads.resolve(THREADS);
      pending.commits.resolve(COMMITS);
      pending.labels.resolve([{ name: "perf", active: true }, { name: "old", active: false }]);
      pending.workItems.resolve([{ id: "12", url: "https://x/12" }]);
      pending.policies.resolve(POLICIES);
    },
  };
}

/** Lets the answers given so far reach their callbacks. */
const settle = () => new Promise((ok) => setTimeout(ok, 0));

test("Given the PR and its updates answer before the rest, then the page gets them first, marked partial, and the whole once the rest is in", async () => {
  const s = stub();
  const seen: PrOverview[] = [];
  const whole = new OverviewLoad(s.reads).result((p) => seen.push(p));
  s.first();
  await settle();
  assert.equal(seen.length, 1);
  const partial = seen[0];
  assert.equal(partial.partial, true);
  assert.equal(partial.pr.title, "Retry failed uploads");
  assert.equal(partial.pr.headCommit, "abc");
  assert.deepEqual(partial.pr.reviewers.map((r) => [r.displayName, r.vote, r.isRequired]), [["Ana Lima", 10, true]]);
  // The Files tab opens on the latest update, whose commits are counted before their messages are in.
  assert.deepEqual(partial.iterations.map((it) => [it.id, it.commitIds.length]), [[1, 1], [2, 2]]);
  assert.deepEqual([partial.threads, partial.commits, partial.pr.labels, partial.workItems, partial.policies], [[], [], [], [], []]);

  s.rest();
  const full = await whole;
  assert.equal(full.partial, undefined);
  assert.equal(full.threads[0].comments[0].content, "Add a test");
  assert.equal(full.commits[0].message, "Retry on 5xx");
  assert.deepEqual(full.pr.labels, ["perf"]);
  assert.deepEqual(full.workItems, [{ id: "12", url: "https://x/12" }]);
  assert.deepEqual(full.policies.map((p) => [p.name, p.state, p.blocking]), [["Build", "approved", true]]);
  // The partial came once; the whole didn't pass through the callback.
  assert.equal(seen.length, 1);
});

test("Given a load that finished before the page asked for it (a prefetch), then the page gets the whole only", async () => {
  const s = stub();
  const load = new OverviewLoad(s.reads);
  s.first();
  s.rest();
  await load.full;
  await settle();
  let partials = 0;
  const whole = await load.result(() => partials++);
  await settle();
  assert.equal(partials, 0);
  assert.equal(whole.partial, undefined);
});

test("Given the rest fails after the PR is in, then the page keeps what it got and the load fails", async () => {
  const s = stub();
  const seen: PrOverview[] = [];
  const whole = new OverviewLoad(s.reads).result((p) => seen.push(p));
  s.first();
  await settle();
  s.pending.threads.reject(new Error("TF401019: the repository is not found"));
  await assert.rejects(whole, /TF401019/);
  assert.equal(seen.length, 1);
});

test("Given a PR that can't be read, then there's no partial and the load fails", async () => {
  const s = stub();
  const seen: PrOverview[] = [];
  const whole = new OverviewLoad(s.reads).result((p) => seen.push(p));
  s.pending.pullRequest.reject(new Error("TF401180: not permitted"));
  await assert.rejects(whole, /TF401180/);
  assert.equal(seen.length, 0);
});

test("Given policies that can't be read, then the page shows none rather than failing", async () => {
  const s = stub();
  const load = new OverviewLoad(s.reads);
  s.first();
  s.pending.threads.resolve([]);
  s.pending.commits.resolve([]);
  s.pending.labels.resolve([]);
  s.pending.workItems.resolve([]);
  s.pending.policies.reject(new Error("403"));
  assert.deepEqual((await load.full).policies, []);
});
