import assert from "node:assert/strict";
import { test } from "node:test";
import { isCompleting, mergeProblem } from "../src/data/completion";
import { allowedStrategies, createAdoActions, threadPayload, type WriteClient } from "../src/data/adoActions";
import { MOCK_USER, MockPrSource } from "../src/data/mockSource";
import type { CompletionOptions, NewThread, ThreadStatus, Vote } from "../src/data/model";
import { identityImageUrl } from "../src/data/model";
import type { PrSnapshot } from "../src/data/snapshot";
import { lineThreadInput } from "../src/ui/LineComments";

function snapshot(): PrSnapshot {
  return {
    source: { github: "local", note: "Write regression fixture" },
    pullRequest: {
      pullRequestId: 7,
      title: "Review fixture",
      description: "Original description",
      status: 1,
      isDraft: false,
      createdBy: { id: "author", displayName: "Author", uniqueName: "author@example.test" },
      creationDate: "2026-10-12T00:00:00Z",
      sourceRefName: "refs/heads/feature",
      targetRefName: "refs/heads/main",
      mergeStatus: 0,
      repository: { id: "repo", name: "repo", project: { id: "project", name: "project" } },
      reviewers: [{ ...MOCK_USER, vote: 10, isRequired: false }],
      labels: [],
    },
    iterations: [],
    trees: { "0": { "/src/a.ts": "old" }, "1": { "/src/b.ts": "new" } },
    renames: { "/src/b.ts": "/src/a.ts" },
    blobs: { old: "old text", new: "new text" },
    threads: [],
    commits: [],
    workItems: [],
    policies: [],
  };
}

test("Given a relative reviewer avatar, then its URL resolves against Azure DevOps instead of the extension CDN", () => {
  const host = "https://dev.azure.com/example/";
  assert.equal(identityImageUrl("/example/_apis/GraphProfile/MemberAvatars/person", host), "https://dev.azure.com/example/_apis/GraphProfile/MemberAvatars/person");
  assert.equal(identityImageUrl("https://avatars.example.test/person", host), "https://avatars.example.test/person");
  assert.equal(identityImageUrl(undefined, host), undefined);
});

function anchored(side: "left" | "right", compareTo = 0): NewThread {
  return {
    content: "Check this line",
    file: { path: "src/b.ts", side, line: 4, endLine: 4 },
    comparison: { iteration: 2, compareTo, changeTrackingId: 17 },
  };
}

test("Given a diff from a previous comparison, then commenting cannot anchor it to the newly selected update", () => {
  const review = {
    comparison: { iteration: 2, compareTo: 0 },
    changes: [{ path: "src/b.ts", changeType: "edit" as const, changeTrackingId: 17 }],
  };
  const file = { path: "src/b.ts", side: "right" as const, line: 4, endLine: 4 };
  assert.throws(() => lineThreadInput(review, { iteration: 2, compareTo: 1 }, file, "Stale diff"), /selected comparison/);
  const request = lineThreadInput(review, review.comparison, file, "Current diff");
  assert.deepEqual(request.comparison, { iteration: 2, compareTo: 0, changeTrackingId: 17 });
});

test("Given a base comparison, when posting on either side, then the payload anchors only that side and uses the common commit", () => {
  for (const side of ["left", "right"] as const) {
    const payload = threadPayload(anchored(side));
    assert.equal(payload.threadContext?.filePath, "/src/b.ts");
    assert.deepEqual(payload.threadContext?.[side === "left" ? "leftFileStart" : "rightFileStart"], { line: 4, offset: 1 });
    assert.equal(payload.threadContext?.[side === "left" ? "rightFileStart" : "leftFileStart"], null);
    assert.deepEqual(payload.pullRequestThreadContext?.iterationContext, { firstComparingIteration: 2, secondComparingIteration: 2 });
    assert.equal(payload.pullRequestThreadContext?.changeTrackingId, 17);
  }
});

test("Given an update-to-update comparison, then the thread retains both selected update IDs", () => {
  assert.deepEqual(threadPayload(anchored("right", 1)).pullRequestThreadContext?.iterationContext, {
    firstComparingIteration: 1,
    secondComparingIteration: 2,
  });
  assert.equal(threadPayload({ content: "General comment" }).threadContext, undefined);
});

test("Given missing tracking data or an empty comment, then posting fails before any write", () => {
  assert.throws(() => threadPayload({ content: "  " }), /Enter a comment/);
  const request = anchored("right");
  delete request.comparison;
  assert.throws(() => threadPayload(request), /valid file/);
  assert.throws(() => threadPayload(anchored("left", 2)), /valid file/);
});

function clientRecorder() {
  const calls: { method: string; args: unknown[] }[] = [];
  const client = Object.fromEntries(
    [
      "createThread",
      "createComment",
      "updateThread",
      "createPullRequestReviewer",
      "getPullRequestReviewer",
      "getPullRequestReviewers",
      "deletePullRequestReviewer",
      "createPullRequestLabel",
      "deletePullRequestLabels",
      "updatePullRequest",
    ].map((method) => [
      method,
      async (...args: unknown[]) => {
        calls.push({ method, args });
        if (method === "getPullRequestReviewer") return { id: args[2], vote: 5, isRequired: false };
        if (method === "getPullRequestReviewers") return [{ id: MOCK_USER.id, vote: 5, isRequired: true }];
        return {};
      },
    ]),
  ) as WriteClient;
  return { calls, client, actions: createAdoActions(client, { project: "project", repo: "repo", pr: 7 }, MOCK_USER, {
    searchReviewers: async () => [],
    mergePolicies: async () => [],
  }) };
}

function reviewerServer() {
  const { client, actions } = clientRecorder();
  const state = { id: MOCK_USER.id, vote: 5, isRequired: true };
  Object.assign(client, {
    getPullRequestReviewer: async () => ({ ...state }),
    getPullRequestReviewers: async () => [{ ...state }],
  });
  // Observed Azure DevOps PUT behavior: omitted vote becomes zero and omitted
  // isRequired becomes false. The adapter must retain the untouched field.
  client.createPullRequestReviewer = async (body) => {
    state.vote = body.vote ?? 0;
    state.isRequired = body.isRequired ?? false;
    return body;
  };
  return { state, actions };
}

test("Given Azure DevOps PUT defaults, when changing reviewer requirement, then their existing vote survives", async () => {
  const { state, actions } = reviewerServer();
  await actions.setReviewerRequired(MOCK_USER.id, false);
  assert.equal(state.isRequired, false);
  assert.equal(state.vote, 5);
});

test("Given a required reviewer, when changing their vote, then they remain required", async () => {
  const { state, actions } = reviewerServer();
  await actions.setVote(-5);
  assert.equal(state.vote, -5);
  assert.equal(state.isRequired, true);
});

test("Given a user who is not a reviewer, when voting, then they join as an optional reviewer", async () => {
  const { client, actions, calls } = clientRecorder();
  client.getPullRequestReviewers = async () => [];
  await actions.setVote(10);
  const body = calls.find((call) => call.method === "createPullRequestReviewer")?.args[0];
  assert.deepEqual(body, { id: MOCK_USER.id, vote: 10, isRequired: false });
});

test("Given a failed reviewer read, then changing requirement fails without overwriting their vote", async () => {
  const { client, actions, calls } = clientRecorder();
  client.getPullRequestReviewer = async () => { throw new Error("Forbidden"); };
  await assert.rejects(actions.setReviewerRequired(MOCK_USER.id, true), /Forbidden/);
  assert.equal(calls.some((call) => call.method === "createPullRequestReviewer"), false);
});

test("Given another reviewer, when changing required status, then the adapter retains their latest vote and omits unrelated fields", async () => {
  const { actions, calls } = clientRecorder();
  await actions.setReviewerRequired("another-user", true);
  assert.deepEqual(calls, [
    { method: "getPullRequestReviewer", args: ["repo", 7, "another-user", "project"] },
    { method: "createPullRequestReviewer", args: [{ id: "another-user", vote: 5, isRequired: true }, "repo", 7, "another-user", "project"] },
  ]);
});

test("Given a signed-in user, when voting, then the adapter writes that user's vote without changing required status", async () => {
  const { actions, calls } = clientRecorder();
  await actions.setVote(-5);
  assert.deepEqual(calls[0], { method: "getPullRequestReviewers", args: ["repo", 7, "project"] });
  assert.deepEqual(calls[1].args, [{ id: MOCK_USER.id, vote: -5, isRequired: true }, "repo", 7, MOCK_USER.id, "project"]);
});

test("Given replies and metadata edits, then the adapter uses the correct endpoints and minimal bodies", async () => {
  const { actions, calls } = clientRecorder();
  await actions.reply(9, 3, "Reply text");
  await actions.setThreadStatus(9, "fixed");
  await actions.setDescription("");
  await actions.addTag("  infrastructure  ");
  await actions.removeTag("infrastructure");
  assert.deepEqual(
    calls.map((c) => c.method),
    ["createComment", "updateThread", "updatePullRequest", "createPullRequestLabel", "deletePullRequestLabels"],
  );
  assert.deepEqual(calls[0].args, [{ parentCommentId: 3, content: "Reply text", commentType: 1 }, "repo", 7, 9, "project"]);
  assert.deepEqual(calls[1].args, [{ status: 2 }, "repo", 7, 9, "project"]);
  assert.deepEqual(calls[2].args[0], { description: "" });
  assert.deepEqual(calls[3].args[0], { name: "infrastructure" });
  assert.deepEqual(calls[4].args, ["repo", 7, "infrastructure", "project"]);
});

test("Given a rejected REST write, then the caller receives the failure", async () => {
  const { actions, client } = clientRecorder();
  client.createThread = async () => {
    throw new Error("Forbidden");
  };
  await assert.rejects(actions.createThread({ content: "My draft" }), /Forbidden/);
});

test("Given a local thread, when replying and resolving it, then reload returns the same parent, author, status and file anchor", async () => {
  const source = new MockPrSource(snapshot());
  await source.actions.createThread(anchored("left", 1));
  let thread = (await source.load()).threads[0];
  await source.actions.reply(thread.id, thread.comments[0].id, "A reply");
  await source.actions.setThreadStatus(thread.id, "fixed");
  thread = (await source.load()).threads[0];
  assert.equal(thread.status, "fixed");
  assert.deepEqual(thread.file, { path: "src/b.ts", side: "left", line: 4, endLine: 4 });
  assert.deepEqual(thread.iterationContext, { firstComparingIteration: 1, secondComparingIteration: 2 });
  assert.equal(thread.comments[1].parentId, thread.comments[0].id);
  assert.equal(thread.comments[1].author.id, MOCK_USER.id);
  assert.equal((await source.getThreads(2, 1)).length, 1);
  assert.equal((await source.getThreads(2, 0)).length, 0);
  assert.notEqual(thread.comments[1].id, thread.comments[0].id);
  await assert.rejects(source.actions.reply(thread.id, 999, "Lost parent"), /parent comment/);
});

test("Given all thread states, then each mock update round-trips through the normalized mapper", async () => {
  const source = new MockPrSource(snapshot());
  await source.actions.createThread({ content: "Discussion" });
  for (const status of ["active", "fixed", "wontFix", "closed", "byDesign", "pending"] as ThreadStatus[]) {
    await source.actions.setThreadStatus(1, status);
    assert.equal((await source.load()).threads[0].status, status);
  }
});

test("Given an approved reviewer, then changing requirement preserves their vote and all vote options round-trip", async () => {
  const source = new MockPrSource(snapshot());
  await source.actions.setReviewerRequired(MOCK_USER.id, true);
  assert.equal((await source.load()).pr.reviewers[0].vote, 10);
  for (const vote of [10, 5, 0, -5, -10] as Vote[]) {
    await source.actions.setVote(vote);
    const reviewer = (await source.load()).pr.reviewers[0];
    assert.equal(reviewer.vote, vote);
    assert.equal(reviewer.isRequired, true);
  }
});

test("Given local metadata edits, then add/remove/search and description edits persist across loads without mutating the fixture", async () => {
  const original = snapshot();
  const source = new MockPrSource(original);
  const who = (await source.actions.searchReviewers("Alex Engineer"))[0];
  assert.ok(who);
  await source.actions.addReviewer(who, true);
  assert.equal((await source.load()).pr.reviewers.find((r) => r.id === who.id)?.isRequired, true);
  await assert.rejects(source.actions.addReviewer(who, false), /already added/);
  await source.actions.removeReviewer(who.id);
  assert.equal(
    (await source.load()).pr.reviewers.some((r) => r.id === who.id),
    false,
  );
  await source.actions.addTag(" ready ");
  await assert.rejects(source.actions.addTag("READY"), /already added/);
  assert.deepEqual((await source.load()).pr.labels, ["ready"]);
  await source.actions.removeTag("ready");
  await source.actions.setDescription("");
  const data = await source.load();
  assert.deepEqual(data.pr.labels, []);
  assert.equal(data.pr.description, "");
  assert.equal(original.pullRequest.description, "Original description");
  assert.equal(original.pullRequest.reviewers[0].isRequired, false);
});

test("Given a renamed file, then mock comparisons keep a stable tracking ID", async () => {
  const source = new MockPrSource(snapshot());
  const first = await source.getChanges(1, 0);
  const repeated = await source.getChanges(1, 0);
  assert.equal(first[0].changeType, "rename");
  assert.equal(first[0].originalPath, "src/a.ts");
  assert.ok(first[0].changeTrackingId);
  assert.equal(first[0].changeTrackingId, repeated[0].changeTrackingId);
});

const SQUASH: CompletionOptions = { mergeStrategy: "squash", deleteSourceBranch: true, transitionWorkItems: false, mergeCommitMessage: "Merged PR 7: Review fixture" };

test("Given completion options, when completing, then the adapter pins the reviewed source commit and sends Azure DevOps' merge type number", async () => {
  const { actions, calls } = clientRecorder();
  await actions.complete(SQUASH, "abc123");
  assert.deepEqual(calls, [
    {
      method: "updatePullRequest",
      args: [
        {
          status: 3,
          lastMergeSourceCommit: { commitId: "abc123" },
          completionOptions: { mergeStrategy: 2, deleteSourceBranch: true, transitionWorkItems: false, mergeCommitMessage: "Merged PR 7: Review fixture" },
        },
        "repo",
        7,
        "project",
      ],
    },
  ]);
});

test("Given an override, then completing records the reason, rejects a blank one, and auto-complete never overrides", async () => {
  const { actions, calls } = clientRecorder();
  await actions.complete({ ...SQUASH, bypassReason: " hotfix " }, "abc123");
  const body = calls[0].args[0] as { completionOptions: Record<string, unknown> };
  assert.equal(body.completionOptions.bypassPolicy, true);
  assert.equal(body.completionOptions.bypassReason, "hotfix");
  await assert.rejects(actions.complete({ ...SQUASH, bypassReason: "  " }, "abc123"), /reason/);
  await assert.rejects(actions.complete(SQUASH, ""), /source commit/);
  await actions.setAutoComplete({ ...SQUASH, bypassReason: "hotfix" });
  const auto = calls.at(-1)?.args[0] as { autoCompleteSetBy: { id: string }; completionOptions: Record<string, unknown> };
  assert.equal(auto.autoCompleteSetBy.id, MOCK_USER.id);
  assert.equal(auto.completionOptions.bypassPolicy, undefined);
  assert.equal(calls.length, 2);
});

test("Given lifecycle actions, then each sends only the field it changes", async () => {
  const { actions, calls } = clientRecorder();
  await actions.setAutoComplete(null);
  await actions.abandon();
  await actions.reactivate();
  await actions.setDraft(true);
  await actions.setDraft(false);
  assert.deepEqual(
    calls.map((c) => c.args[0]),
    [{ autoCompleteSetBy: { id: "00000000-0000-0000-0000-000000000000" } }, { status: 2 }, { status: 1 }, { isDraft: true }, { isDraft: false }],
  );
});

test("Given merge type policies, then only the types every policy covering the target branch allows remain", () => {
  const policy = (scope: object, settings: object, isEnabled = true) => ({ isEnabled, settings: { scope: [scope], ...settings } });
  const exact = { repositoryId: "repo", refName: "refs/heads/main", matchKind: "Exact" };
  assert.deepEqual(allowedStrategies([], "repo", "main"), ["noFastForward", "squash", "rebase", "rebaseMerge"]);
  assert.deepEqual(allowedStrategies([policy(exact, { allowSquash: true, allowRebase: true })], "repo", "main"), ["squash", "rebase"]);
  assert.deepEqual(allowedStrategies([policy(exact, { useSquashMerge: true })], "repo", "refs/heads/main"), ["squash"]);
  assert.deepEqual(
    allowedStrategies([policy({ repositoryId: null, refName: "refs/heads/release/", matchKind: "Prefix" }, { allowRebase: true })], "repo", "release/1.0"),
    ["rebase"],
  );
  assert.equal(allowedStrategies([policy(exact, { allowSquash: true })], "other-repo", "main").length, 4);
  assert.equal(allowedStrategies([policy(exact, { allowSquash: true }, false)], "repo", "main").length, 4);
  assert.equal(allowedStrategies([policy(exact, { allowSquash: true })], "repo", "dev").length, 4);
  assert.deepEqual(allowedStrategies([policy(exact, { useSquashMerge: false })], "repo", "main"), ["noFastForward"], "classic policy: merge only");
  assert.deepEqual(allowedStrategies([policy(exact, { useSquashMerge: true, allowRebase: true })], "repo", "main"), ["rebase"], "allow flags win");
});

test("Given unreadable merge policies, then every merge type is offered and Azure DevOps enforces the rest", async () => {
  const { client } = clientRecorder();
  const actions = createAdoActions(client, { project: "project", repo: "repo", pr: 7 }, MOCK_USER, {
    searchReviewers: async () => [],
    mergePolicies: async () => { throw new Error("Forbidden"); },
  });
  assert.equal((await actions.allowedMergeStrategies("repo", "main")).length, 4);
});

function withHead(): PrSnapshot {
  const snap = snapshot();
  snap.pullRequest.lastMergeSourceCommit = { commitId: "head" };
  return snap;
}

test("Given a local PR, when completing, then it merges only at the loaded head, in the background, with the chosen options", async () => {
  const source = new MockPrSource(withHead());
  assert.equal((await source.load()).pr.headCommit, "head");
  await assert.rejects(source.actions.complete(SQUASH, "older"), /new commits/);
  await source.actions.complete(SQUASH, "head");
  let { pr } = await source.load();
  assert.equal(pr.status, "active", "the first read after completing still sees the merge queued");
  assert.ok(pr.completionQueued);
  ({ pr } = await source.load());
  assert.equal(pr.status, "completed");
  assert.equal(pr.completionQueued, undefined);
  assert.equal(pr.closedBy?.id, MOCK_USER.id);
  assert.deepEqual(pr.completionOptions, { ...SQUASH });
  await assert.rejects(source.actions.abandon(), /active/);
});

test("Given a required policy that hasn't passed, then completing needs an override, and auto-complete waits instead", async () => {
  const snap = withHead();
  snap.policies = [{ evaluationId: "build", status: "running", configuration: { isBlocking: true, type: { displayName: "Build" }, settings: {} } }];
  const source = new MockPrSource(snap);
  await assert.rejects(source.actions.complete(SQUASH, "head"), /Required policies/);
  await source.actions.setAutoComplete(SQUASH);
  let { pr } = await source.load();
  assert.equal(pr.autoCompleteSetBy?.id, MOCK_USER.id);
  assert.equal(pr.completionOptions?.mergeStrategy, "squash");
  await source.actions.setAutoComplete(null);
  assert.equal((await source.load()).pr.autoCompleteSetBy, undefined);
  await source.actions.complete({ ...SQUASH, bypassReason: "Build infra is down" }, "head");
  await source.load();
  ({ pr } = await source.load());
  assert.equal(pr.status, "completed");
});

test("Given a local PR, then draft, publish, abandon and reactivate round-trip, and a draft can't be completed", async () => {
  const source = new MockPrSource(withHead());
  await source.actions.setDraft(true);
  assert.equal((await source.load()).pr.isDraft, true);
  await assert.rejects(source.actions.complete(SQUASH, "head"), /Publish/);
  await source.actions.setDraft(false);
  await source.actions.abandon();
  let { pr } = await source.load();
  assert.equal(pr.status, "abandoned");
  assert.equal(pr.closedBy?.id, MOCK_USER.id);
  await assert.rejects(source.actions.setDraft(true), /active/);
  await source.actions.reactivate();
  ({ pr } = await source.load());
  assert.equal(pr.status, "active");
  assert.equal(pr.closedBy, undefined);
});

test("Given a queued completion, then the PR counts as completing until Azure DevOps reports a failure or conflicts", async () => {
  const source = new MockPrSource(withHead());
  await source.actions.complete(SQUASH, "head");
  const { pr } = await source.load();
  assert.equal(isCompleting(pr), true);
  assert.equal(mergeProblem(pr), null);
  assert.equal(isCompleting({ ...pr, mergeStatus: "conflicts" }), false);
  assert.equal(isCompleting({ ...pr, mergeFailure: "TF401179: rebase failed" }), false);
  assert.equal(mergeProblem({ ...pr, mergeFailure: "TF401179: rebase failed" }), "TF401179: rebase failed");
  assert.match(mergeProblem({ ...pr, mergeStatus: "rejectedByPolicy" }) ?? "", /policy/);
  assert.equal(isCompleting({ ...pr, status: "completed" }), false);
});
