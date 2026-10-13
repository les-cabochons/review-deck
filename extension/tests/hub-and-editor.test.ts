import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxSections, matchesQuery, type PrSummary, requestedVia, sectionOf } from "../src/data/list";
import type { Identity, Vote } from "../src/data/model";
import { code, insertMention, link, mentionQuery, prefixLines, quote, wrap } from "../src/ui/editor/format";

const me: Identity = { id: "me", displayName: "Me", uniqueName: "me@example.test" };
const other: Identity = { id: "ana", displayName: "Ana", uniqueName: "ana@example.test" };

function pr(id: number, overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    id,
    title: `PR ${id}`,
    repository: { id: "repo", name: "repo", projectId: "project", projectName: "project" },
    createdBy: other,
    creationDate: new Date(2026, 0, id),
    status: "active",
    isDraft: false,
    sourceBranch: `feature/${id}`,
    targetBranch: "main",
    reviewers: [],
    labels: [],
    openable: true,
    ...overrides,
  };
}
const reviewer = (who: Identity, vote: Vote, isRequired = false) => ({ ...who, vote, isRequired });

test("Given PRs in every state, then each lands in the first matching inbox section", () => {
  assert.equal(sectionOf(pr(1, { reviewers: [reviewer(me, 0)] }), me), "needs-review");
  assert.equal(sectionOf(pr(2, { reviewers: [reviewer(me, 10)] }), me), "reviewed");
  assert.equal(sectionOf(pr(3, { createdBy: me, reviewers: [reviewer(other, -5)] }), me), "returned");
  assert.equal(sectionOf(pr(4, { createdBy: me, reviewers: [reviewer(other, 10), reviewer(me, 0)] }), me), "approved");
  assert.equal(sectionOf(pr(5, { createdBy: me }), me), "waiting");
  assert.equal(sectionOf(pr(6, { createdBy: me, isDraft: true, reviewers: [reviewer(other, -10)] }), me), "drafts");
  assert.equal(sectionOf(pr(7, { status: "completed", createdBy: me }), me), "completed");
  assert.equal(sectionOf(pr(8), me), "other");
  // A draft someone asked me to look at is not "needs your review" yet.
  assert.equal(sectionOf(pr(9, { isDraft: true, reviewers: [reviewer(me, 0)] }), me), "other");
});

test("Given completed PRs, then only ones that involve you appear, newest first", () => {
  const sections = inboxSections(
    [
      pr(1, { status: "completed", createdBy: me, closedDate: new Date(2026, 1, 1) }),
      pr(2, { status: "completed" }),
      pr(3, { status: "completed", reviewers: [reviewer(me, 10)], closedDate: new Date(2026, 1, 5) }),
    ],
    me,
  );
  assert.deepEqual(
    sections.find((s) => s.id === "completed")!.prs.map((p) => p.id),
    [3, 1],
  );
});

test("Given a search, then every term must match title, number, author, branch or tag", () => {
  const p = pr(42, { title: "Fix cache eviction", labels: ["perf"], createdBy: { ...other, displayName: "Ana Lopez" } });
  assert.ok(matchesQuery(p, ""));
  assert.ok(matchesQuery(p, "cache"));
  assert.ok(matchesQuery(p, "#42"));
  assert.ok(matchesQuery(p, "!42 ana"));
  assert.ok(matchesQuery(p, "feature/42 perf"));
  assert.ok(!matchesQuery(p, "cache bob"));
});

test("Given toolbar actions, then markdown is wrapped, toggled and prefixed around the selection", () => {
  const s = { text: "make this bold", start: 10, end: 14 };
  const bold = wrap(s, "**");
  assert.equal(bold.text, "make this **bold**");
  assert.deepEqual([bold.start, bold.end], [12, 16]);
  assert.equal(wrap(bold, "**").text, "make this bold", "applying again removes the markers");

  const empty = wrap({ text: "", start: 0, end: 0 }, "_", "_", "italic text");
  assert.equal(empty.text, "_italic text_");
  assert.equal(empty.text.slice(empty.start, empty.end), "italic text");

  const lines = { text: "one\ntwo\nthree", start: 0, end: 7 };
  assert.equal(prefixLines(lines, "numbered").text, "1. one\n2. two\nthree");
  assert.equal(prefixLines(prefixLines(lines, "bullet"), "bullet").text, "one\ntwo\nthree");
  assert.equal(prefixLines({ text: "- a", start: 0, end: 3 }, "checklist").text, "- [ ] a", "switching kinds replaces the prefix");

  const l = link({ text: "see docs", start: 4, end: 8 });
  assert.equal(l.text, "see [docs](url)");
  assert.equal(l.text.slice(l.start, l.end), "url");

  assert.equal(code({ text: "a\nb", start: 0, end: 3 }).text, "\n```\na\nb\n```\n");
  assert.equal(quote("line one\nline two", "Ana"), "> **Ana** wrote:\n>\n> line one\n> line two\n\n");
});

test("Given an @ being typed, then the query is detected and replaced by an Azure DevOps mention token", () => {
  const typing = { text: "thanks @an", start: 10, end: 10 };
  assert.deepEqual(mentionQuery(typing), { query: "an", start: 7 });
  assert.equal(mentionQuery({ text: "mail me@host", start: 12, end: 12 }), null, "emails are not mentions");
  const done = insertMention(typing, 7, "ana-id");
  assert.equal(done.text, "thanks @<ana-id> ");
  assert.equal(done.start, done.text.length);
});

test("Given my PR, then it is approved only once it needs no more reviews", () => {
  const approved = (overrides: Partial<PrSummary>) => sectionOf(pr(1, { createdBy: me, ...overrides }), me);
  assert.equal(approved({ reviewers: [reviewer(other, 10), reviewer(me, 0, true)] }), "waiting", "a required reviewer hasn't voted");
  assert.equal(approved({ reviewers: [reviewer(other, 5, true), reviewer(me, 0)] }), "approved", "every required reviewer approved");
  assert.equal(approved({ reviewers: [reviewer(other, 10)], reviewPolicy: "unmet" }), "waiting", "the minimum number of reviewers isn't met");
  assert.equal(approved({ reviewers: [reviewer(other, 10), reviewer(me, 0)], reviewPolicy: "met" }), "approved");
  assert.equal(approved({ reviewers: [reviewer(other, 0, true)], reviewPolicy: "met" }), "waiting", "required reviewers block even without a policy");
  assert.equal(approved({ reviewers: [reviewer(other, 10)], reviewPolicy: "none" }), "approved");
});

test("Given a review requested from one of my teams, then it needs my review until I vote myself", () => {
  const team: Identity = { id: "team-web", displayName: "[repo]\Web", uniqueName: "repo\Web" };
  const groups = new Set([team.id]);
  const viaTeam = pr(1, { reviewers: [reviewer(team, 0, true)] });
  assert.equal(sectionOf(viaTeam, me), "other", "without team membership it is someone else's review");
  assert.equal(sectionOf(viaTeam, me, groups), "needs-review");
  assert.deepEqual(requestedVia(viaTeam, groups).map((r) => r.id), ["team-web"]);
  // Azure DevOps adds me as a reviewer with my vote once I vote on behalf of the team.
  assert.equal(sectionOf(pr(2, { reviewers: [reviewer(team, 10, true), reviewer(me, 10)] }), me, groups), "reviewed");
  assert.equal(sectionOf(pr(3, { isDraft: true, reviewers: [reviewer(team, 0)] }), me, groups), "other");
  // A team's vote on my own PR doesn't count as an approval of it by someone else.
  assert.equal(sectionOf(pr(4, { createdBy: me, reviewers: [reviewer(team, 10)] }), me, groups), "waiting");
  const sections = inboxSections([pr(5, { status: "completed", reviewers: [reviewer(team, 10)] })], me, groups);
  assert.equal(sections.find((s) => s.id === "completed")!.prs.length, 1, "completed team reviews involve me");
});
