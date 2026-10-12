/**
 * Builds the PR hub's local mock list from real GitHub PRs (uses `gh`).
 *
 *   npx tsx scripts/build-ado-mock-list.ts
 *
 * Output: extension/dev-data/pr-list.json (a PrListSnapshot; see extension/src/data/listSnapshot.ts).
 * GitHub's review data is mostly bots, so reviewer assignments and votes for the local "me" user are
 * synthesized deterministically from the PR number to populate every inbox section. Each synthesized
 * reviewer has `synthetic: true`. PRs with a full snapshot in dev-data/ are marked openable.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrListSnapshot, PrSummaryJson } from "../extension/src/data/listSnapshot.js";
import { listRealPrIds, ROOT } from "../src/node/fixtures.js";

const SLUG = "pingdotgg/t3code";
const ME = "juliusmarminge";
const HUMANS = ["maria-rcks", "mweinbach", "otavio", "flamboh", "PixPMusic"];
const OUT = join(ROOT, "extension", "dev-data");

interface GhListPr {
  number: number;
  title: string;
  author: { login: string };
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  isDraft: boolean;
  state: "OPEN" | "MERGED" | "CLOSED";
  headRefName: string;
  baseRefName: string;
  labels: { name: string }[];
  additions: number;
  deletions: number;
  changedFiles: number;
  latestReviews: { author: { login: string }; state: string }[];
  statusCheckRollup: { conclusion?: string; state?: string; status?: string }[];
  comments: unknown[];
}

const FIELDS =
  "number,title,author,createdAt,updatedAt,closedAt,mergedAt,isDraft,state,headRefName,baseRefName,labels,additions,deletions,changedFiles,latestReviews,statusCheckRollup,comments";
const gh = (args: string[]) => JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })) as GhListPr[];

const open = gh(["pr", "list", "-R", SLUG, "--state", "open", "--limit", "45", "--json", FIELDS]);
const merged = gh(["pr", "list", "-R", SLUG, "--state", "merged", "--limit", "15", "--json", FIELDS]);
const snapshotIds = listRealPrIds().filter((id) => existsSync(join(OUT, `${id}.json`)));
const snapshotNumbers = new Map(snapshotIds.map((id) => [Number(id.split("-").pop()), id]));
const withSnapshots = [...snapshotNumbers.keys()]
  .filter((n) => !open.some((p) => p.number === n))
  .map((n) => gh(["pr", "list", "-R", SLUG, "--state", "all", "--search", String(n), "--limit", "1", "--json", FIELDS])[0])
  .filter((p): p is GhListPr => !!p && snapshotNumbers.has(p.number));

const identity = (login: string) => ({ id: login, displayName: login, uniqueName: login, imageUrl: `https://github.com/${login}.png?size=64` });
const pick = <T>(xs: T[], n: number) => xs[n % xs.length];

function checks(p: GhListPr): PrSummaryJson["checks"] {
  const states = (p.statusCheckRollup ?? []).map((c) => (c.conclusion ?? c.state ?? c.status ?? "").toUpperCase());
  if (states.length === 0) return "none";
  if (states.some((s) => s === "FAILURE" || s === "ERROR" || s === "TIMED_OUT")) return "failing";
  if (states.some((s) => s === "IN_PROGRESS" || s === "QUEUED" || s === "PENDING" || s === "")) return "pending";
  return "passing";
}

function reviewers(p: GhListPr, active: boolean): PrSummaryJson["reviewers"] {
  const out = new Map<string, PrSummaryJson["reviewers"][number]>();
  for (const r of p.latestReviews ?? []) {
    const login = r.author.login;
    if (login === p.author.login || login.includes("[bot]") || !HUMANS.concat(ME).includes(login)) continue;
    out.set(login, { ...identity(login), vote: r.state === "APPROVED" ? 10 : r.state === "CHANGES_REQUESTED" ? -5 : 0, isRequired: false });
  }
  const n = p.number;
  if (p.author.login === ME) {
    // My PRs: one or two colleagues, with a vote pattern that cycles through approve / waiting / none.
    const a = pick(HUMANS, n);
    const b = pick(HUMANS, n + 2);
    const pattern = [10, -5, 0, 5, 0][n % 5];
    out.set(a, { ...identity(a), vote: pattern as never, isRequired: n % 2 === 0, synthetic: true });
    if (n % 3 === 0) out.set(b, { ...identity(b), vote: 0, isRequired: false, synthetic: true });
  } else if (active && (n % 3 === 0 || n % 7 === 0)) {
    // Others' PRs: I'm asked to review about a third of them; I've already voted on some.
    out.set(ME, { ...identity(ME), vote: (n % 7 === 0 ? 10 : 0) as never, isRequired: n % 2 === 0, synthetic: true });
  } else if (!active && n % 2 === 0) {
    out.set(ME, { ...identity(ME), vote: 10, isRequired: false, synthetic: true });
  }
  return [...out.values()];
}

function summary(p: GhListPr): PrSummaryJson {
  const snapshot = snapshotNumbers.get(p.number);
  // Snapshot PRs are presented as active, matching their snapshot files.
  const status = snapshot ? 1 : p.state === "OPEN" ? 1 : p.state === "MERGED" ? 3 : 2;
  return {
    pullRequestId: p.number,
    title: p.title,
    status,
    isDraft: p.isDraft,
    createdBy: identity(p.author.login),
    creationDate: p.createdAt,
    updatedDate: p.updatedAt,
    closedDate: snapshot ? null : (p.mergedAt ?? p.closedAt),
    sourceRefName: `refs/heads/${p.headRefName}`,
    targetRefName: `refs/heads/${p.baseRefName}`,
    repository: { id: "t3code", name: "t3code", project: { id: "pingdotgg", name: "pingdotgg" } },
    reviewers: reviewers(p, status === 1),
    labels: (p.labels ?? []).map((l) => l.name),
    size: { files: p.changedFiles, adds: p.additions, dels: p.deletions },
    checks: checks(p),
    comments: (p.comments ?? []).length,
    snapshot: snapshot ?? null,
  };
}

const all = [...withSnapshots, ...open, ...merged];
const unique = [...new Map(all.map((p) => [p.number, p])).values()];
const list: PrListSnapshot = {
  source: { github: `https://github.com/${SLUG}/pulls`, note: `Built from GitHub PRs as seen by ${ME}; reviewer votes marked synthetic are invented.` },
  currentUser: identity(ME),
  pullRequests: unique.map(summary),
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "pr-list.json"), JSON.stringify(list, null, 1));
console.log(`pr-list.json: ${list.pullRequests.length} PRs (${list.pullRequests.filter((p) => p.snapshot).length} openable)`);
