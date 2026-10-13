/**
 * Builds a fictional demo for the local dev mode, for screenshots and demos that mustn't show real
 * people or code. The PRs are the synthetic ones in fixtures/prs (the toy "acme-users-sdk" repo);
 * the organization, people, comments, votes and checks are invented.
 *
 *   npx tsx scripts/build-demo-mock.ts
 *
 * Output: extension/dev-data/pr-list.json and extension/dev-data/demo-<n>.json, replacing the
 * t3code mock. Run `npm run ext:mock` (and scripts/build-stack-mock.ts) to get that back.
 * The dev shell's breadcrumb (extension/dev/index.html) still names the real organization;
 * the Marketplace screenshots rename it to contoso / Storefront before capturing.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrListSnapshot, PrSummaryJson } from "../extension/src/data/listSnapshot.js";
import type { IdentityJson, PrSnapshot, ThreadJson } from "../extension/src/data/snapshot.js";
import { FIXTURES, ROOT } from "../src/node/fixtures.js";

const OUT = join(ROOT, "extension", "dev-data");
const BASE = join(FIXTURES, "sample-repo");
const REPO = { id: "users-sdk", name: "users-sdk", project: { id: "storefront", name: "Storefront" } };
const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const sha = (s: string) => createHash("sha1").update(s).digest("hex");

const COLORS = ["#0078d4", "#8764b8", "#038387", "#ca5010", "#498205", "#c239b3", "#986f0b"];
function person(name: string): IdentityJson {
  const initials = name.split(" ").map((p) => p[0]).join("");
  const color = COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/><text x="32" y="41" font-family="Segoe UI,Arial,sans-serif" font-size="24" font-weight="600" fill="white" text-anchor="middle">${initials}</text></svg>`;
  const handle = name.toLowerCase().replace(/ /g, ".");
  return { id: handle, displayName: name, uniqueName: `${handle}@contoso.com`, imageUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
}
const ME = person("Jordan Rivera");
const PRIYA = person("Priya Natarajan");
const MARCUS = person("Marcus Lee");
const SOFIA = person("Sofia Alvarez");
const TOM = person("Tom Becker");
const AIKO = person("Aiko Tanaka");
const DANIEL = person("Daniel Okafor");
const TEAM = { id: "team-sdk", name: "SDK Team" };
const TEAM_REVIEWER = { id: TEAM.id, displayName: `[Storefront]\\${TEAM.name}`, uniqueName: `Storefront\\${TEAM.name}` };

/** A demo PR backed by a fixture, so it can be opened. */
interface Openable {
  fixture: string;
  id: number;
  title: string;
  description: string;
  author: IdentityJson;
  source: string;
  target: string;
  reviewers: PrSummaryJson["reviewers"];
  labels: string[];
  hours: number;
  checks: PrSummaryJson["checks"];
  isDraft?: boolean;
  threads?: (file: (path: string, needle: string) => ThreadJson["threadContext"]) => { by: IdentityJson; text: string; at?: ThreadJson["threadContext"]; replies?: { by: IdentityJson; text: string }[]; status?: number }[];
}

const r = (who: IdentityJson, vote: number, isRequired = false) => ({ ...who, vote, isRequired });

const OPENABLE: Openable[] = [
  {
    fixture: "pr6",
    id: 482,
    title: "Trace requests with X-Request-Id and add a cache kill-switch",
    description: [
      "## Problem",
      "",
      "When a call to the users API fails, support can't match the error a customer reports to a line in the server logs. Separately, ops asked for a way to turn the user cache off during incidents without a deploy.",
      "",
      "## Fix",
      "",
      "- **Request IDs.** Every request now sends an `X-Request-Id` header, and `HttpError` carries it, so a failure can be traced end to end.",
      "- **Cache kill-switch.** `CACHE_ENABLED=false` makes the cache store nothing and every lookup miss.",
      "- **baseUrl validation.** `HttpClient` rejects a `baseUrl` that isn't http(s) at construction instead of failing on the first request.",
      "- Removes `sleep()` from `utils/time.ts`, which nothing used.",
      "",
      "## Verification",
      "",
      "New unit tests for the header, the validation and the disabled cache. `npm test` passes.",
    ].join("\n"),
    author: PRIYA,
    source: "priya/request-ids",
    target: "priya/http-retry",
    reviewers: [r(ME, 0, true), r(MARCUS, 5), r(SOFIA, 0)],
    labels: ["area:http", "size:M"],
    hours: 3,
    checks: "passing",
    threads: (at) => [
      {
        by: MARCUS,
        text: "This wraps after 65k requests in the same millisecond. Fine for logs, but would `crypto.randomUUID()` be simpler?",
        at: at("src/utils/ids.ts", "counter = (counter + 1)"),
        replies: [{ by: PRIYA, text: "The short format is what the gateway logs already use, so I'd keep it. I'll add a comment saying why." }],
      },
      {
        by: SOFIA,
        text: "Should we trim a trailing slash here too? `https://api.contoso.com/` currently ends up with `//users`.",
        at: at("src/http/client.ts", "baseUrl must be an http(s) URL"),
      },
      { by: MARCUS, text: "Nice, the kill-switch is exactly what we asked for in the last incident review. Approving with one suggestion above." },
    ],
  },
  {
    fixture: "pr1",
    id: 479,
    title: "Retry idempotent requests with backoff; rename UserRecord to User",
    description: "Retries GET, PUT and DELETE on network errors and 5xx responses, with exponential backoff (new `retries` config option). Also renames `UserRecord` to `User` across the SDK.",
    author: PRIYA,
    source: "priya/http-retry",
    target: "main",
    reviewers: [r(MARCUS, 10, true), r(ME, 10)],
    labels: ["area:http", "size:L"],
    hours: 20,
    checks: "passing",
  },
  {
    fixture: "pr5",
    id: 485,
    title: "Add the update-user endpoint and cache hit/miss stats",
    description: "Adds `PUT /users/:id` (client, service, validation and tests) and hit/miss counters on the user cache. Also tightens the email regex, adds JSDoc to the public modules and bumps TypeScript.",
    author: PRIYA,
    source: "priya/update-user",
    target: "priya/request-ids",
    reviewers: [r(ME, 0, true)],
    labels: ["area:users", "size:L"],
    hours: 1,
    checks: "pending",
  },
  {
    fixture: "pr2",
    id: 476,
    title: "Add user search and replace stray console.log calls",
    description: "Adds `UserService.searchUsers()` with a regenerated route, moves the remaining `console.log` calls to the scoped logger, and bumps vitest.",
    author: SOFIA,
    source: "sofia/user-search",
    target: "main",
    reviewers: [r(ME, 0), r(TOM, -5)],
    labels: ["area:users", "size:M"],
    hours: 26,
    checks: "failing",
  },
  {
    fixture: "pr3",
    id: 471,
    title: "Move buildQueryString to utils/query",
    description: "Moves `buildQueryString` out of the HTTP client into `src/utils/query.ts`, with its tests. Also raises the default timeout to 15 s.",
    author: ME,
    source: "jordan/query-utils",
    target: "main",
    reviewers: [r(MARCUS, -5, true), r(AIKO, 0)],
    labels: ["refactor", "size:S"],
    hours: 30,
    checks: "passing",
  },
  {
    fixture: "pr4",
    id: 487,
    title: "Fix truncate() returning one character too many",
    description: "`truncate()` appended the ellipsis after slicing to `max`, so results were `max + 1` long. Includes a regression test.",
    author: TOM,
    source: "tom/fix-truncate",
    target: "main",
    reviewers: [r(ME, 0, true)],
    labels: ["bug", "size:XS"],
    hours: 2,
    checks: "passing",
  },
  {
    fixture: "pr8",
    id: 486,
    title: "Add a chunk() array helper",
    description: "A small utility for batching user IDs into pages of at most 100.",
    author: AIKO,
    source: "aiko/chunk-helper",
    target: "main",
    reviewers: [r(ME, 0), r(DANIEL, 10)],
    labels: ["size:XS"],
    hours: 5,
    checks: "passing",
  },
  {
    fixture: "pr7",
    id: 474,
    title: "Clarify the invalid email message",
    description: "Says what a valid email looks like instead of just \"invalid\".",
    author: ME,
    source: "jordan/email-copy",
    target: "main",
    reviewers: [r(SOFIA, 10)],
    labels: ["size:XS"],
    hours: 22,
    checks: "passing",
  },
  {
    fixture: "pr9",
    id: 480,
    title: "Bump vitest from 1.5.0 to 1.5.3",
    description: "Dependency update: manifest range and lockfile only.",
    author: DANIEL,
    source: "deps/vitest-1.5.3",
    target: "main",
    reviewers: [{ ...TEAM_REVIEWER, vote: 0, isRequired: true }],
    labels: ["dependencies", "size:XS"],
    hours: 8,
    checks: "passing",
  },
];

/** Hub-only PRs, to fill the inbox sections. */
const extra = (
  id: number, title: string, author: IdentityJson, source: string, reviewers: PrSummaryJson["reviewers"], labels: string[],
  size: [number, number, number], checks: PrSummaryJson["checks"], hours: number, status = 1, isDraft = false,
) => ({ pullRequestId: id, title, author, source, reviewers, labels, size, checks, hours, status, isDraft });
const EXTRAS = [
  extra(488, "Paginate listUsers with continuation tokens", MARCUS, "marcus/paginate-users", [r(ME, 0, true), r(AIKO, 0)], ["area:users", "size:M"], [6, 142, 38], "passing", 4),
  extra(484, "Surface rate-limit headers on HttpError", DANIEL, "daniel/rate-limits", [r(ME, 0)], ["area:http", "size:S"], [3, 61, 9], "failing", 7),
  extra(483, "Document the retry and timeout options", AIKO, "aiko/retry-docs", [{ ...TEAM_REVIEWER, vote: 0, isRequired: true }], ["docs", "size:XS"], [2, 48, 6], "passing", 9),
  extra(481, "Cache users by email as well as by ID", TOM, "tom/cache-by-email", [r(ME, 10), r(PRIYA, 0)], ["area:users", "size:M"], [4, 97, 22], "passing", 18),
  extra(478, "Drop Node 18 from the test matrix", ME, "jordan/drop-node-18", [r(DANIEL, 0, true)], ["ci", "size:XS"], [1, 3, 12], "pending", 11),
  extra(477, "Typed errors for 404 and 409 responses", ME, "jordan/typed-errors", [r(PRIYA, 5), r(MARCUS, 0)], ["area:http", "size:S"], [4, 88, 14], "passing", 28),
  extra(489, "Experiment: generate the client from OpenAPI", ME, "jordan/openapi-spike", [], ["spike", "size:XL"], [38, 2104, 611], "none", 6, 1, true),
  extra(490, "Configurable logger sink", SOFIA, "sofia/logger-sink", [r(TOM, 0)], ["size:S"], [3, 54, 11], "passing", 12),
  extra(475, "Retry 429 responses after Retry-After", MARCUS, "marcus/retry-after", [r(PRIYA, 0, true)], ["area:http", "size:S"], [3, 72, 8], "passing", 34),
  extra(470, "Remove the deprecated getUserByName()", PRIYA, "priya/remove-get-by-name", [r(ME, 10)], ["size:S"], [4, 6, 58], "passing", 52, 3),
  extra(468, "Validate display names", SOFIA, "sofia/display-names", [r(ME, 10), r(TOM, 10)], ["area:users", "size:S"], [3, 41, 4], "passing", 75, 3),
  extra(466, "Add a CHANGELOG and release script", DANIEL, "daniel/changelog", [r(ME, 5)], ["ci", "size:M"], [5, 133, 2], "passing", 96, 3),
  extra(463, "Move tests to vitest workspaces", AIKO, "aiko/vitest-workspaces", [r(MARCUS, 10)], ["ci", "size:M"], [7, 64, 51], "passing", 120, 3),
];

/** Fixture file at the base (sample-repo) or after the PR (overlay, else base for untouched content). */
function fixtureFiles(fixture: string) {
  const dir = join(FIXTURES, "prs", fixture);
  const spec = JSON.parse(readFileSync(join(dir, "pr.json"), "utf8")) as { renames: { from: string; to: string }[]; deletes?: string[] };
  const diff = readFileSync(join(dir, "diff.patch"), "utf8");
  const paths = new Set<string>();
  for (const m of diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) paths.add(m[1]).add(m[2]);
  const renamedFrom = new Map(spec.renames.map((x) => [x.to, x.from]));
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const before = (p: string) => read(join(BASE, p));
  const after = (p: string) =>
    spec.deletes?.includes(p) ? null : read(join(dir, "files", p)) ?? (spec.renames.some((x) => x.from === p) ? null : read(join(BASE, renamedFrom.get(p) ?? p)));
  return { paths: [...paths], before, after, renames: Object.fromEntries(spec.renames.map((x) => [`/${x.to}`, `/${x.from}`])), diff };
}

function snapshot(pr: Openable): { snap: PrSnapshot; size: PrSummaryJson["size"]; comments: number } {
  const files = fixtureFiles(pr.fixture);
  const blobs: Record<string, string> = {};
  const tree = (read: (p: string) => string | null) => {
    const out: Record<string, string> = {};
    for (const p of files.paths) {
      const text = read(p);
      if (text === null) continue;
      const oid = sha(`blob ${text}`);
      blobs[oid] = text;
      out[`/${p}`] = oid;
    }
    return out;
  };
  const trees = { "0": tree(files.before), "1": tree(files.after) };
  const base = sha(`${pr.id} base`);
  const commitId = sha(`${pr.id} head`);
  const created = hoursAgo(pr.hours + 20);

  let threadId = 1;
  let commentId = 1;
  const comment = (by: IdentityJson, content: string, date: string, parent = 0, commentType = 1) =>
    ({ id: commentId++, parentCommentId: parent, author: by, content, publishedDate: date, lastUpdatedDate: date, commentType, usersLiked: [] });
  const at = (path: string, needle: string) => {
    const line = (files.after(path) ?? "").split("\n").findIndex((l) => l.includes(needle)) + 1;
    if (line === 0) throw new Error(`${pr.fixture}: "${needle}" isn't in ${path}`);
    const pos = { line, offset: 1 };
    return { filePath: `/${path}`, rightFileStart: pos, rightFileEnd: pos };
  };
  const threads: ThreadJson[] = [];
  (pr.threads?.(at) ?? []).forEach((t, i) => {
    const date = hoursAgo(pr.hours + 6 - i);
    const first = comment(t.by, t.text, date);
    const replies = (t.replies ?? []).map((x, j) => comment(x.by, x.text, hoursAgo(pr.hours + 5 - i - j), first.id));
    threads.push({ id: threadId++, publishedDate: date, lastUpdatedDate: (replies.at(-1) ?? first).publishedDate, status: t.status ?? 1, threadContext: t.at, comments: [first, ...replies], properties: {} });
  });
  for (const v of pr.reviewers.filter((x) => x.vote !== 0 && x.id !== ME.id)) {
    const date = hoursAgo(pr.hours + 1);
    threads.push({
      id: threadId++, publishedDate: date, lastUpdatedDate: date, status: 0,
      comments: [comment(v, `${v.displayName} voted ${v.vote}`, date, 0, 3)],
      properties: {
        CodeReviewThreadType: { $type: "System.String", $value: "VoteUpdate" },
        CodeReviewVoteResult: { $type: "System.String", $value: String(v.vote) },
        CodeReviewVotedByIdentity: { $type: "System.String", $value: v.id },
      },
    });
  }

  const build = pr.checks === "passing" ? "approved" : pr.checks === "failing" ? "rejected" : "running";
  const approvals = pr.reviewers.filter((x) => x.vote >= 5).length;
  const active = threads.filter((t) => t.status === 1).length;
  const policies = [
    { evaluationId: "min-reviewers", status: approvals >= 1 ? "approved" : "rejected", configuration: { isBlocking: true, type: { displayName: "Minimum number of reviewers" }, settings: { minimumApproverCount: 1 } } },
    { evaluationId: "comments", status: active === 0 ? "approved" : "rejected", configuration: { isBlocking: true, type: { displayName: "Comment requirements" }, settings: {} } },
    { evaluationId: "build", status: build, configuration: { isBlocking: true, type: { displayName: "Build" }, settings: { displayName: "users-sdk CI" } } },
    { evaluationId: "lint", status: "approved", configuration: { isBlocking: false, type: { displayName: "Build" }, settings: { displayName: "Lint" } } },
  ];

  const adds = (files.diff.match(/^\+(?!\+\+)/gm) ?? []).length;
  const dels = (files.diff.match(/^-(?!--)/gm) ?? []).length;
  const snap: PrSnapshot = {
    source: { github: "", note: "Fictional demo built by scripts/build-demo-mock.ts from fixtures/prs." },
    pullRequest: {
      pullRequestId: pr.id,
      title: pr.title,
      description: pr.description,
      status: 1,
      isDraft: !!pr.isDraft,
      createdBy: pr.author,
      creationDate: created,
      sourceRefName: `refs/heads/${pr.source}`,
      targetRefName: `refs/heads/${pr.target}`,
      mergeStatus: 3,
      repository: REPO,
      reviewers: pr.reviewers,
      labels: pr.labels.map((name, i) => ({ id: String(i), name, active: true })),
    },
    iterations: [{
      id: 1, author: pr.author, createdDate: created, updatedDate: created, description: pr.title,
      sourceRefCommit: { commitId }, commonRefCommit: { commitId: base }, targetRefCommit: { commitId: base },
      commits: [{ commitId, comment: pr.title }], reason: 2,
    }],
    trees,
    renames: files.renames,
    blobs,
    threads,
    commits: [{ commitId, comment: `${pr.title}\n\n${pr.description}`, author: { name: pr.author.displayName, email: pr.author.uniqueName, date: created } }],
    workItems: pr.id === 482 ? [{ id: "1204", url: "", title: "Trace failed API calls to server logs" }] : [],
    policies,
  };
  return { snap, size: { files: Object.keys(trees["1"]).length, adds, dels }, comments: threads.filter((t) => t.comments[0].commentType === 1).length };
}

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".json")) rmSync(join(OUT, f));

const pullRequests: PrSummaryJson[] = [];
for (const pr of OPENABLE) {
  const { snap, size, comments } = snapshot(pr);
  const name = `demo-${pr.id}`;
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(snap));
  pullRequests.push({
    pullRequestId: pr.id, title: pr.title, status: 1, isDraft: !!pr.isDraft, createdBy: pr.author,
    creationDate: snap.pullRequest.creationDate, updatedDate: hoursAgo(pr.hours), closedDate: null,
    sourceRefName: snap.pullRequest.sourceRefName, targetRefName: snap.pullRequest.targetRefName,
    repository: REPO, reviewers: pr.reviewers, labels: pr.labels, size, checks: pr.checks, comments, snapshot: name,
  });
}
for (const x of EXTRAS) {
  pullRequests.push({
    pullRequestId: x.pullRequestId, title: x.title, status: x.status, isDraft: x.isDraft, createdBy: x.author,
    creationDate: hoursAgo(x.hours + 30), updatedDate: hoursAgo(x.hours), closedDate: x.status === 1 ? null : hoursAgo(x.hours),
    sourceRefName: `refs/heads/${x.source}`, targetRefName: "refs/heads/main", repository: REPO, reviewers: x.reviewers,
    labels: x.labels, size: { files: x.size[0], adds: x.size[1], dels: x.size[2] }, checks: x.checks, comments: x.pullRequestId % 4, snapshot: null,
  });
}
const byId = new Map(pullRequests.map((p) => [p.pullRequestId, p]));
byId.get(482)!.restack = { state: "succeeded", description: "Restacked onto priya/http-retry (2 commits)", date: hoursAgo(2) };
byId.get(485)!.restack = { state: "succeeded", description: "Restacked onto priya/request-ids (1 commit)", date: hoursAgo(1) };

const list: PrListSnapshot = {
  source: { github: "", note: "Fictional demo built by scripts/build-demo-mock.ts." },
  trunkBranches: ["main", "release/*"],
  currentUser: ME,
  currentUserGroups: [TEAM],
  pullRequests: pullRequests.sort((a, b) => b.updatedDate.localeCompare(a.updatedDate)),
};
writeFileSync(join(OUT, "pr-list.json"), JSON.stringify(list, null, 1));
console.log(`demo: ${OPENABLE.length} openable PRs, ${pullRequests.length} in the list -> ${OUT}`);
