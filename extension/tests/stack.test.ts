import assert from "node:assert/strict";
import { test } from "node:test";
import { invalidTrunkPattern, isTrunk, parseTrunkPatterns } from "../../src/stack/branches";
import { type CherryPickResult, type CommitInfo, type RestackPr, type RestackRepo, Restacker } from "../../src/stack/restack";
import { stackFor, stackIndex, type StackPr } from "../../src/stack/stacks";

const TRUNKS = ["main", "dev", "uat", "*/00-*"];

test("trunk patterns: exact names, one-segment * and multi-segment **", () => {
  assert.ok(isTrunk("refs/heads/main", TRUNKS));
  assert.ok(isTrunk("UAT", TRUNKS));
  assert.ok(isTrunk("release/00-q4", TRUNKS));
  assert.ok(!isTrunk("a/b/00-x", TRUNKS));
  assert.ok(!isTrunk("feature/main-menu", TRUNKS));
  assert.ok(isTrunk("release/2026/q4", ["release/**"]));
  assert.deepEqual(parseTrunkPatterns(" main,\nrefs/heads/dev\n\n main , */00-*"), ["main", "dev", "*/00-*"]);
  assert.ok(invalidTrunkPattern("*/*"));
  assert.ok(invalidTrunkPattern("feat ure"));
  assert.equal(invalidTrunkPattern("*/00-*"), null);
});

const pr = (id: number, source: string, target: string, status: StackPr["status"] = "active"): StackPr => ({ id, repository: { id: "r" }, sourceBranch: source, targetBranch: target, status });

test("stacks follow source → target chains and stop at trunk branches", () => {
  const all = [pr(1, "a", "main"), pr(2, "b", "a"), pr(3, "c", "b"), pr(4, "solo", "main"), pr(5, "fix", "release/00-q4"), pr(6, "x", "gone")];
  const s = stackFor(all[1], all, TRUNKS)!;
  assert.deepEqual(s.layers.map((p) => p.id), [1, 2, 3]);
  assert.deepEqual(s.base, { branch: "main", trunk: true });
  assert.equal(s.parent?.id, 1);
  assert.deepEqual(s.children.map((p) => p.id), [3]);
  assert.equal(stackFor(all[3], all, TRUNKS), null, "a lone PR into a trunk isn't a stack");
  assert.equal(stackFor(all[4], all, TRUNKS), null, "*/00-* is a trunk");
  // Into a branch with no open PR (its parent merged or was abandoned): shown, with a non-trunk base.
  assert.deepEqual(stackFor(all[5], all, TRUNKS)!.base, { branch: "gone", trunk: false });
  const index = stackIndex(all, TRUNKS);
  assert.deepEqual(index.get(3), { index: 3, size: 3, bottomId: 1 });
  assert.equal(index.has(4), false);
});

test("stacks: forks, other repositories, closed PRs, and PRs from a trunk branch", () => {
  const all = [pr(1, "a", "main"), pr(2, "b", "a"), pr(3, "c", "a"), pr(4, "d", "a", "completed"), { ...pr(5, "e", "a"), repository: { id: "other" } }, pr(6, "main", "dev")];
  const s = stackFor(all[0], all, TRUNKS)!;
  assert.deepEqual(s.children.map((p) => p.id), [2, 3], "fork: both children, completed and other-repo PRs excluded");
  assert.deepEqual(s.layers.map((p) => p.id), [1, 2], "the path follows the first child");
  assert.deepEqual(stackFor(all[2], all, TRUNKS)!.layers.map((p) => p.id), [1, 3]);
  // main -> dev is a promotion between trunks: PR 1 (into main) must not stack on it.
  assert.equal(stackFor(all[5], all, TRUNKS), null);
});

// ---------- restack, against an in-memory Git repository ----------

interface Commit {
  id: string;
  parents: string[];
  /** One file per commit keeps conflicts easy to stage: cherry-picking onto a history that changed the same file conflicts. */
  file: string;
}

class FakeRepo implements RestackRepo {
  commits = new Map<string, Commit>();
  branches = new Map<string, string>();
  prs: (RestackPr & { status: "active" | "completed" })[] = [];
  statuses = new Map<number, { state: string; description: string }>();
  comments: { pr: number; text: string }[] = [];
  forcePushAllowed = true;
  private n = 0;

  commit(parents: string[], file: string): string {
    const id = `c${String(++this.n).padStart(39, "0")}`;
    this.commits.set(id, { id, parents, file });
    return id;
  }
  /** Appends commits touching `files` to `branch` (creating it from `from`). */
  push(branch: string, files: string[], from?: string): string {
    let tip = this.branches.get(branch) ?? (from ? this.branches.get(from)! : this.commit([], "root"));
    for (const f of files) tip = this.commit([tip], f);
    this.branches.set(branch, tip);
    return tip;
  }
  ancestors(id: string): Map<string, number> {
    const out = new Map<string, number>();
    const queue: [string, number][] = [[id, 0]];
    while (queue.length) {
      const [c, d] = queue.shift()!;
      if (out.has(c)) continue;
      out.set(c, d);
      for (const p of this.commits.get(c)!.parents) queue.push([p, d + 1]);
    }
    return out;
  }

  async activePrsInto(branch: string) {
    return this.prs.filter((p) => p.status === "active" && p.targetBranch === branch);
  }
  async branchTip(branch: string) {
    return this.branches.get(branch) ?? null;
  }
  async mergeBase(a: string, b: string) {
    const ofA = this.ancestors(a);
    const common = [...this.ancestors(b)].filter(([c]) => ofA.has(c)).sort((x, y) => x[1] - y[1]);
    return common[0]?.[0] ?? null;
  }
  async commitsBetween(tip: string, exclude: string): Promise<CommitInfo[]> {
    const excluded = this.ancestors(exclude);
    return [...this.ancestors(tip)]
      .filter(([c]) => !excluded.has(c))
      .sort((x, y) => y[1] - x[1])
      .map(([c]) => ({ id: c, parents: this.commits.get(c)!.parents.length }));
  }
  async cherryPick(commits: string[], onto: string, generatedBranch: string): Promise<CherryPickResult> {
    let tip = this.branches.get(onto)!;
    const ontoFiles = new Set([...this.ancestors(tip).keys()].map((c) => this.commits.get(c)!.file));
    for (const c of commits) {
      const file = this.commits.get(c)!.file;
      if (file.startsWith("conflict:") && ontoFiles.has(file)) return { ok: false, conflict: true, message: "conflict" };
      tip = this.commit([tip], file);
    }
    this.branches.set(generatedBranch, tip);
    return { ok: true, commit: tip };
  }
  async moveBranch(branch: string, from: string, to: string) {
    if (this.branches.get(branch) !== from) return "stale" as const;
    if (!this.forcePushAllowed) return "forbidden" as const;
    this.branches.set(branch, to);
    return "ok" as const;
  }
  async deleteBranch(branch: string) {
    this.branches.delete(branch);
  }
  async retarget(prId: number, branch: string) {
    this.prs.find((p) => p.id === prId)!.targetBranch = branch;
  }
  async report(prId: number, state: "pending" | "succeeded" | "failed", description: string) {
    this.statuses.set(prId, { state, description });
  }
  async comment(prId: number, text: string) {
    this.comments.push({ pr: prId, text });
  }

  /** True when `branch` contains `base`'s tip and still carries its own files. */
  isOn(branch: string, base: string): boolean {
    return this.ancestors(this.branches.get(branch)!).has(this.branches.get(base)!);
  }
  files(branch: string, since: string): string[] {
    const excluded = this.ancestors(this.branches.get(since)!);
    return [...this.ancestors(this.branches.get(branch)!)].filter(([c]) => !excluded.has(c)).sort((x, y) => y[1] - x[1]).map(([c]) => this.commits.get(c)!.file);
  }
}

/** main ← a (!1) ← b (!2) ← c (!3) */
function stackRepo() {
  const repo = new FakeRepo();
  repo.push("main", ["m1"]);
  repo.push("a", ["a1", "a2"], "main");
  repo.push("b", ["b1"], "a");
  repo.push("c", ["c1", "c2"], "b");
  repo.prs = [
    { id: 1, title: "A", sourceBranch: "a", targetBranch: "main", status: "active" },
    { id: 2, title: "B", sourceBranch: "b", targetBranch: "a", status: "active" },
    { id: 3, title: "C", sourceBranch: "c", targetBranch: "b", status: "active" },
  ];
  return repo;
}

test("restack: a push to the bottom layer cascades to every layer above", async () => {
  const repo = stackRepo();
  const old = repo.branches.get("a")!;
  const tip = repo.push("a", ["a3"]);
  const outcomes = await new Restacker(repo, { trunkPatterns: TRUNKS }).branchMoved("refs/heads/a", old, tip);
  assert.deepEqual(outcomes.map((o) => [o.pr, o.result]), [[2, "restacked"], [3, "restacked"]]);
  assert.ok(repo.isOn("b", "a") && repo.isOn("c", "b"));
  assert.deepEqual(repo.files("b", "a"), ["b1"], "only the layer's own commits move");
  assert.deepEqual(repo.files("c", "b"), ["c1", "c2"]);
  assert.equal(repo.statuses.get(3)?.state, "succeeded");
  assert.ok(![...repo.branches.keys()].some((b) => b.startsWith("semantic-pr/")), "scratch branches are cleaned up");
  // Replaying the same event finds everything up to date.
  const again = await new Restacker(repo, { trunkPatterns: TRUNKS }).branchMoved("a", old, tip);
  assert.deepEqual(again.map((o) => o.result), ["up-to-date"]);
});

test("restack: after a squash merge, layers above move onto the trunk and are retargeted", async () => {
  const repo = stackRepo();
  const aTip = repo.branches.get("a")!;
  // Squash-merge !1: main gets one new commit with a's changes; the a branch is deleted.
  repo.push("main", ["squash(a1,a2)"]);
  repo.branches.delete("a");
  repo.prs[0].status = "completed";
  const outcomes = await new Restacker(repo, { trunkPatterns: TRUNKS }).prCompleted(repo.prs[0], aTip);
  assert.deepEqual(outcomes.map((o) => [o.pr, o.result]), [[2, "restacked"], [3, "restacked"]]);
  assert.equal(repo.prs[1].targetBranch, "main", "!2 now targets main");
  assert.equal(repo.prs[2].targetBranch, "b", "!3 still targets b");
  assert.deepEqual(repo.files("b", "main"), ["b1"], "a's original commits don't come back after the squash");
  assert.ok(repo.isOn("c", "b"));
});

test("restack: a conflict stops that layer, comments with the local fix, and leaves the branch alone", async () => {
  const repo = new FakeRepo();
  repo.push("main", ["m1"]);
  repo.push("a", ["a1"], "main");
  const bTip = repo.push("b", ["conflict:x"], "a");
  repo.push("c", ["c1"], "b");
  repo.prs = [
    { id: 2, title: "B", sourceBranch: "b", targetBranch: "a", status: "active" },
    { id: 3, title: "C", sourceBranch: "c", targetBranch: "b", status: "active" },
  ];
  const old = repo.branches.get("a")!;
  const tip = repo.push("a", ["conflict:x"]);
  const outcomes = await new Restacker(repo, { trunkPatterns: TRUNKS }).branchMoved("a", old, tip);
  assert.deepEqual(outcomes.map((o) => [o.pr, o.result]), [[2, "failed"]], "!3 isn't touched when !2 couldn't move");
  assert.equal(repo.branches.get("b"), bTip);
  assert.equal(repo.statuses.get(2)?.state, "failed");
  assert.match(repo.comments[0].text, /git rebase --onto origin\/a/);
});

test("restack: refuses merge commits, trunk sources, and reports missing Force push", async () => {
  const repo = stackRepo();
  // A merge commit inside !2's layer.
  const side = repo.commit([repo.branches.get("a")!], "side");
  const merge = repo.commit([repo.branches.get("b")!, side], "merge");
  repo.branches.set("b", merge);
  const old = repo.branches.get("a")!;
  let tip = repo.push("a", ["a3"]);
  let outcomes = await new Restacker(repo, { trunkPatterns: TRUNKS }).branchMoved("a", old, tip);
  assert.equal(outcomes[0].result, "failed");
  assert.match((outcomes[0] as { reason: string }).reason, /merge commits/);

  const repo2 = stackRepo();
  repo2.forcePushAllowed = false;
  const old2 = repo2.branches.get("a")!;
  tip = repo2.push("a", ["a3"]);
  outcomes = await new Restacker(repo2, { trunkPatterns: TRUNKS }).branchMoved("a", old2, tip);
  assert.match((outcomes[0] as { reason: string }).reason, /Force push/);

  // dev -> uat is a promotion; a push to uat must never rewrite dev.
  const repo3 = new FakeRepo();
  repo3.push("uat", ["u1"]);
  const devTip = repo3.push("dev", ["d1"], "uat");
  repo3.prs = [{ id: 9, title: "Promote", sourceBranch: "dev", targetBranch: "uat", status: "active" }];
  const oldUat = repo3.branches.get("uat")!;
  tip = repo3.push("uat", ["hotfix"]);
  outcomes = await new Restacker(repo3, { trunkPatterns: TRUNKS }).branchMoved("uat", oldUat, tip);
  assert.deepEqual(outcomes, []);
  assert.equal(repo3.branches.get("dev"), devTip);
});

// ---------- service hooks (backend/src/stacks/hooks.ts) ----------

import { hookSecret, jobsFromHook, verifyHookSecret } from "../../backend/src/stacks/hooks";

test("hooks: git.push and completed PRs become restack jobs; everything else is ignored", () => {
  const repository = { id: "repo-1", project: { id: "proj-1" } };
  const push = jobsFromHook("cabochons", {
    eventType: "git.push",
    resource: {
      repository,
      refUpdates: [
        { name: "refs/heads/feature/a", oldObjectId: "1".repeat(40), newObjectId: "2".repeat(40) },
        { name: "refs/tags/v1", oldObjectId: "0".repeat(40), newObjectId: "3".repeat(40) },
      ],
    },
  });
  assert.deepEqual(push, [
    { organization: "cabochons", projectId: "proj-1", repositoryId: "repo-1", kind: "push", branch: "feature/a", oldTip: "1".repeat(40), newTip: "2".repeat(40) },
  ]);
  assert.deepEqual(jobsFromHook("cabochons", { eventType: "git.pullrequest.updated", resource: { repository, pullRequestId: 7, status: "completed" } }), [
    { organization: "cabochons", projectId: "proj-1", repositoryId: "repo-1", kind: "completed", pullRequestId: 7 },
  ]);
  assert.deepEqual(jobsFromHook("cabochons", { eventType: "git.pullrequest.updated", resource: { repository, pullRequestId: 7, status: "active" } }), []);
  assert.deepEqual(jobsFromHook("cabochons", { eventType: "workitem.updated" }), []);
  assert.deepEqual(jobsFromHook("cabochons", null), []);
});

test("hooks: the secret is per organization and checked in constant time", () => {
  const secret = hookSecret("key", "Cabochons");
  assert.ok(verifyHookSecret("key", "cabochons", secret), "organization names are case-insensitive");
  assert.ok(!verifyHookSecret("key", "other-org", secret));
  assert.ok(!verifyHookSecret("other-key", "cabochons", secret));
  assert.ok(!verifyHookSecret("key", "cabochons", ""));
});
