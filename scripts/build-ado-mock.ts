/**
 * Builds Azure DevOps-shaped mock data for the extension's local dev mode from a real GitHub PR
 * listed in fixtures/real (uses `gh` for PR metadata and the blobless clone for file contents).
 *
 *   npx tsx scripts/build-ado-mock.ts [t3code-17901 ...]
 *
 * Output: extension/dev-data/<id>.json, a PrSnapshot (see extension/src/data/snapshot.ts).
 * GitHub concepts are mapped onto ADO ones: commits -> iterations, reviews -> votes + vote
 * system threads, review comments -> file threads, issue comments -> general threads,
 * check runs -> policy evaluations. The PR is presented as active so the action UI is exercised.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrSnapshot } from "../extension/src/data/snapshot.js";
import { ensureRealRepo, listRealPrIds, ROOT } from "../src/node/fixtures.js";

const OUT = join(ROOT, "extension", "dev-data");
const ids = process.argv.slice(2).length ? process.argv.slice(2) : listRealPrIds();

const sh = (cmd: string, args: string[], cwd?: string) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const ghJson = <T>(...args: string[]): T => JSON.parse(sh("gh", args)) as T;

interface GhUser {
  login: string;
  avatar_url?: string;
}
interface GhPr {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  createdAt: string;
  baseRefName: string;
  headRefName: string;
  isDraft: boolean;
  labels: { name: string }[];
  commits: { oid: string; messageHeadline: string; messageBody: string; committedDate: string; authors: { login: string; name: string; email: string }[] }[];
  statusCheckRollup: { name?: string; context?: string; conclusion?: string; state?: string; status?: string }[];
}
interface GhReview {
  id: number;
  user: GhUser;
  state: string;
  body: string;
  submitted_at: string;
}
interface GhComment {
  id: number;
  user: GhUser;
  body: string;
  created_at: string;
  updated_at: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  side?: "LEFT" | "RIGHT";
  in_reply_to_id?: number;
}

mkdirSync(OUT, { recursive: true });
for (const id of ids) {
  const { spec, dir } = ensureRealRepo(id);
  const [owner, repo] = new URL(spec.url).pathname.split("/").filter(Boolean);
  const number = Number(spec.url.split("/").pop());
  const slug = `${owner}/${repo}`;

  const pr = ghJson<GhPr>(
    "pr", "view", String(number), "-R", slug,
    "--json", "number,title,body,author,createdAt,baseRefName,headRefName,isDraft,labels,commits,statusCheckRollup",
  );
  const reviews = ghJson<GhReview[]>("api", `repos/${slug}/pulls/${number}/reviews`, "--paginate");
  const reviewComments = ghJson<GhComment[]>("api", `repos/${slug}/pulls/${number}/comments`, "--paginate");
  const issueComments = ghJson<GhComment[]>("api", `repos/${slug}/issues/${number}/comments`, "--paginate");

  // PR head commits are fetched by ref; fall back to the squash commit if they are gone.
  let commits = pr.commits;
  try {
    sh("git", ["-C", dir, "fetch", "-q", "origin", `pull/${number}/head`]);
    sh("git", ["-C", dir, "cat-file", "-e", `${commits[0].oid}^{commit}`]);
  } catch {
    commits = [];
  }
  const base = commits.length ? sh("git", ["-C", dir, "rev-parse", `${commits[0].oid}^`]).trim() : `${spec.commit}^`;
  const heads = commits.length ? iterationHeads(commits.map((c) => c.oid)) : [spec.commit];

  // Trees: path -> blob id for every path the PR touches, at the base and at each iteration head.
  const touched = new Set<string>();
  for (const h of heads) {
    for (const line of sh("git", ["-C", dir, "diff", "--name-only", "--no-renames", base, h]).split("\n")) if (line) touched.add(line);
  }
  const treeAt = (rev: string) => {
    const out: Record<string, string> = {};
    const listing = sh("git", ["-C", dir, "ls-tree", "-r", rev, "--", ...touched]);
    for (const line of listing.split("\n")) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
      if (m) out[`/${m[2]}`] = m[1];
    }
    return out;
  };
  const trees: PrSnapshot["trees"] = { "0": treeAt(base) };
  heads.forEach((h, i) => (trees[String(i + 1)] = treeAt(h)));

  const blobs: Record<string, string> = {};
  for (const tree of Object.values(trees)) {
    for (const oid of Object.values(tree)) {
      if (!blobs[oid]) blobs[oid] = sh("git", ["-C", dir, "cat-file", "blob", oid]);
    }
  }

  const renames: Record<string, string> = {};
  for (const line of sh("git", ["-C", dir, "diff", "--name-status", "-M", base, heads[heads.length - 1]]).split("\n")) {
    const m = /^R\d+\t(.+)\t(.+)$/.exec(line);
    if (m) renames[`/${m[2]}`] = `/${m[1]}`;
  }

  const identity = (login: string, avatar?: string) => ({
    id: login,
    displayName: login,
    uniqueName: login,
    imageUrl: avatar ?? `https://github.com/${login}.png?size=64`,
  });
  const author = identity(pr.author.login);

  // Reviewers: latest decisive review state per user.
  const votes = new Map<string, number>();
  for (const r of [...reviews].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))) {
    if (r.user.login === pr.author.login) continue;
    const vote = r.state === "APPROVED" ? 10 : r.state === "CHANGES_REQUESTED" ? -5 : (votes.get(r.user.login) ?? 0);
    votes.set(r.user.login, vote);
  }

  const iterations = heads.map((h, i) => {
    const commit = commits.find((c) => c.oid === h);
    const date = commit?.committedDate ?? pr.createdAt;
    return {
      id: i + 1,
      author,
      createdDate: date,
      updatedDate: date,
      description: commit?.messageHeadline ?? pr.title,
      sourceRefCommit: { commitId: h },
      commonRefCommit: { commitId: base },
      targetRefCommit: { commitId: base },
      commits: commits
        .slice(i === 0 ? 0 : commits.findIndex((c) => c.oid === heads[i - 1]) + 1, commits.findIndex((c) => c.oid === h) + 1)
        .map((c) => ({ commitId: c.oid, comment: c.messageHeadline })),
      reason: i === 0 ? 2 : 1,
    };
  });

  let threadId = 1;
  let commentId = 1;
  const threads: PrSnapshot["threads"] = [];
  const text = (u: GhUser, body: string, date: string, parent = 0) => ({
    id: commentId++,
    parentCommentId: parent,
    author: identity(u.login, u.avatar_url),
    content: body,
    publishedDate: date,
    lastUpdatedDate: date,
    commentType: 1,
    usersLiked: [],
  });

  for (const c of issueComments) {
    threads.push({ id: threadId++, publishedDate: c.created_at, lastUpdatedDate: c.updated_at, status: 1, comments: [text(c.user, c.body, c.created_at)], properties: {} });
  }
  const roots = reviewComments.filter((c) => !c.in_reply_to_id);
  for (const root of roots) {
    const replies = reviewComments.filter((c) => c.in_reply_to_id === root.id);
    const line = root.line ?? root.original_line ?? 1;
    const pos = { line, offset: 1 };
    const first = text(root.user, root.body, root.created_at);
    const thread = {
      id: threadId++,
      publishedDate: root.created_at,
      lastUpdatedDate: (replies.at(-1) ?? root).updated_at,
      status: replies.length > 0 ? 2 : 1,
      threadContext: {
        filePath: `/${root.path}`,
        ...(root.side === "LEFT" ? { leftFileStart: pos, leftFileEnd: pos } : { rightFileStart: pos, rightFileEnd: pos }),
      },
      comments: [first, ...replies.map((r) => text(r.user, r.body, r.created_at, first.id))],
      properties: {},
    };
    threads.push(thread);
  }
  for (const r of reviews) {
    if (r.body?.trim()) {
      threads.push({ id: threadId++, publishedDate: r.submitted_at, lastUpdatedDate: r.submitted_at, status: 1, comments: [text(r.user, r.body, r.submitted_at)], properties: {} });
    }
    if (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED") {
      const vote = r.state === "APPROVED" ? 10 : -5;
      threads.push({
        id: threadId++,
        publishedDate: r.submitted_at,
        lastUpdatedDate: r.submitted_at,
        status: 0,
        comments: [{ ...text(r.user, `${r.user.login} voted ${vote}`, r.submitted_at), commentType: 3 }],
        properties: {
          CodeReviewThreadType: { $type: "System.String", $value: "VoteUpdate" },
          CodeReviewVoteResult: { $type: "System.String", $value: String(vote) },
          CodeReviewVotedByIdentity: { $type: "System.String", $value: r.user.login },
        },
      });
    }
  }

  const checks = pr.statusCheckRollup.slice(0, 6).map((c, i) => {
    const outcome = (c.conclusion ?? c.state ?? c.status ?? "").toUpperCase();
    const status = outcome === "SUCCESS" ? "approved" : outcome === "FAILURE" ? "rejected" : outcome === "SKIPPED" || outcome === "NEUTRAL" ? "notApplicable" : "running";
    return { evaluationId: `check-${i}`, status, configuration: { isBlocking: i < 2, type: { displayName: "Build" }, settings: { displayName: c.name ?? c.context ?? "check" } } };
  });
  const approvals = [...votes.values()].filter((v) => v >= 5).length;
  const activeThreads = threads.filter((t) => t.status === 1 && t.comments[0]?.commentType !== 3).length;
  const policies = [
    { evaluationId: "min-reviewers", status: approvals >= 1 ? "approved" : "rejected", configuration: { isBlocking: true, type: { displayName: "Minimum number of reviewers" }, settings: { minimumApproverCount: 1 } } },
    { evaluationId: "comments", status: activeThreads === 0 ? "approved" : "rejected", configuration: { isBlocking: true, type: { displayName: "Comment requirements" }, settings: {} } },
    ...checks,
  ];

  const snapshot: PrSnapshot = {
    source: { github: spec.url, note: "Mock built from a GitHub PR; shown as active." },
    pullRequest: {
      pullRequestId: number,
      title: pr.title,
      description: pr.body,
      status: 1,
      isDraft: pr.isDraft,
      createdBy: author,
      creationDate: pr.createdAt,
      sourceRefName: `refs/heads/${pr.headRefName}`,
      targetRefName: `refs/heads/${pr.baseRefName}`,
      mergeStatus: 3,
      repository: { id: repo, name: repo, project: { id: owner, name: owner } },
      reviewers: [...votes].map(([login, vote]) => ({ ...identity(login), vote, isRequired: false })),
      labels: pr.labels.map((l, i) => ({ id: String(i), name: l.name, active: true })),
    },
    iterations,
    trees,
    renames,
    blobs,
    threads,
    commits: commits.map((c) => ({
      commitId: c.oid,
      comment: [c.messageHeadline, c.messageBody].filter(Boolean).join("\n\n"),
      author: { name: c.authors[0]?.name || c.authors[0]?.login || "unknown", email: c.authors[0]?.email ?? "", date: c.committedDate },
    })),
    workItems: [],
    policies,
  };
  const file = join(OUT, `${id}.json`);
  writeFileSync(file, JSON.stringify(snapshot));
  console.log(`${id}: ${iterations.length} iterations, ${Object.keys(blobs).length} blobs, ${threads.length} threads -> ${file}`);
}

/** At most 5 iterations: group PR commits evenly, each iteration ending at a commit. */
function iterationHeads(oids: string[]): string[] {
  const n = Math.min(5, oids.length);
  return Array.from({ length: n }, (_, i) => oids[Math.round(((i + 1) * oids.length) / n) - 1]);
}
