/**
 * Turns some local demo PRs into stacks, so the stack UI can be tried without Azure DevOps.
 *
 *   npx tsx scripts/build-stack-mock.ts      (after npm run ext:mock, which it modifies in place)
 *
 * Stacks (branch targets are synthetic; the diffs are unchanged):
 *   main:          !17563 <- !17826 <- !17901 <- !18665, and !18666 forking off !17826
 *   uat:           !18672 <- !18671
 *   release/00-q4: !18669 <- !18668
 *   orphan:        !18667 into t3/merged-parent, a branch with no open PR (its parent merged)
 * The demo's trunk patterns become main, dev, uat, *\/00-*. Re-run npm run ext:mock to undo.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrListSnapshot } from "../extension/src/data/listSnapshot.js";
import type { PrSnapshot } from "../extension/src/data/snapshot.js";
import { ROOT } from "../src/node/fixtures.js";

const data = join(ROOT, "extension", "dev-data");
const listPath = join(data, "pr-list.json");
const list = JSON.parse(readFileSync(listPath, "utf8")) as PrListSnapshot;
const byId = new Map(list.pullRequests.map((p) => [p.pullRequestId, p]));
const ref = (branch: string) => `refs/heads/${branch}`;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** id -> [source, target]; a missing PR is skipped with a warning. */
const layers: Record<number, [string, string]> = {
  17563: ["t3/storage-cleanup-controls", "main"],
  17826: ["t3/fix-subagent-thread-popover", "t3/storage-cleanup-controls"],
  17901: ["t3/sc-host-settings", "t3/fix-subagent-thread-popover"],
  18665: ["feat/custom-header-backdrop", "t3/sc-host-settings"],
  18666: ["fix/18640-pull-requests-numeric-q", "t3/fix-subagent-thread-popover"],
  18672: ["fix/web-startup-draft-redirect", "uat"],
  18671: ["fix/terminal-legacy-history-collision", "fix/web-startup-draft-redirect"],
  18669: ["fix/terminal-history-long-thread-ids", "release/00-q4"],
  18668: ["archive-subagent-descendants", "fix/terminal-history-long-thread-ids"],
  18667: ["t3code/mobile-open-existing-project", "t3/merged-parent"],
};

for (const [id, [source, target]] of Object.entries(layers)) {
  const pr = byId.get(Number(id));
  if (!pr) {
    console.warn(`!${id} isn't in the mock list; skipped`);
    continue;
  }
  pr.status = 1;
  pr.sourceRefName = ref(source);
  pr.targetRefName = ref(target);
  if (pr.snapshot && existsSync(join(data, `${pr.snapshot}.json`))) {
    const path = join(data, `${pr.snapshot}.json`);
    const snap = JSON.parse(readFileSync(path, "utf8")) as PrSnapshot;
    snap.pullRequest.sourceRefName = pr.sourceRefName;
    snap.pullRequest.targetRefName = pr.targetRefName;
    writeFileSync(path, JSON.stringify(snap));
  }
}

// The synthetic huge PR copies !17901 and its branch; give it its own so it isn't a second layer.
const huge = byId.get(99999);
if (huge) huge.sourceRefName = ref("perf/huge-copy");

const status = (id: number, state: "pending" | "succeeded" | "failed", description: string, hours: number) => {
  const pr = byId.get(id);
  if (pr) pr.restack = { state, description, date: hoursAgo(hours) };
};
status(17826, "succeeded", "Restacked onto t3/storage-cleanup-controls (3 commits)", 5);
status(17901, "succeeded", "Restacked onto t3/fix-subagent-thread-popover (12 commits)", 2);
status(18665, "failed", "Conflict restacking onto t3/sc-host-settings; branch left unchanged. See the comment for how to rebase locally.", 2);

list.trunkBranches = ["main", "dev", "uat", "*/00-*"];
list.source.note += " Stacks and restack statuses are synthetic (scripts/build-stack-mock.ts).";
writeFileSync(listPath, JSON.stringify(list, null, 1));
console.log(`pr-list.json: ${Object.keys(layers).length} stacked PRs, trunks ${list.trunkBranches.join(", ")}`);
