import { isTrunk, shortBranch } from "./branches.js";

/**
 * Auto-restack: keeps every layer of a stack based on the current tip of the layer below it, using
 * only server-side Git operations (no clone). Two events drive it:
 *
 * - A branch moved (someone pushed to a layer): each PR targeting that branch has its own commits
 *   cherry-picked onto the new tip, and its branch is moved there. That move is itself a branch
 *   move, so the layers above follow in turn.
 * - A PR completed (a layer merged): each PR on top of it is restacked onto the branch it merged
 *   into, then retargeted there. Works for squash merges: only commits not in the merged layer move.
 *
 * Conflicts, merge commits inside a layer, missing permissions and races stop that layer (and the
 * ones above it) with a failed PR status explaining what to do; nothing is ever force-moved blindly.
 */

/** A pull request as the restack engine sees it. Branch names may include `refs/heads/`. */
export interface RestackPr {
  id: number;
  title: string;
  sourceBranch: string;
  targetBranch: string;
}

export interface CommitInfo {
  id: string;
  parents: number;
}

export type CherryPickResult = { ok: true; commit: string } | { ok: false; conflict: boolean; message: string };

/** The PR a layer sits on: the one whose source is the layer's target branch. */
export interface ParentPr extends RestackPr {
  status: "active" | "completed" | "abandoned";
  /** Where its source branch was when it last merged (completed PRs). */
  lastSourceCommit: string | null;
}

/** Azure DevOps Git operations on one repository (backend/src/stacks/adoRepo.ts implements them over REST). */
export interface RestackRepo {
  /** Active PRs whose target is `branch`. */
  activePrsInto(branch: string): Promise<RestackPr[]>;
  /** The active PR from `branch`, else the most recent closed one, else null. */
  prFrom(branch: string): Promise<ParentPr | null>;
  /**
   * The commit `prId`'s source was based on at its last push (the merge base Azure DevOps recorded then),
   * or null. Unlike a merge base taken now, it still points into the parent's old history after the
   * parent was rewritten, so only the layer's own commits get replayed.
   */
  pushedBase(prId: number): Promise<string | null>;
  /** Commit the branch points at, or null if it doesn't exist. */
  branchTip(branch: string): Promise<string | null>;
  mergeBase(a: string, b: string): Promise<string | null>;
  /** Commits reachable from `tip` but not from `exclude`, oldest first. */
  commitsBetween(tip: string, exclude: string): Promise<CommitInfo[]>;
  /** Replays `commits` onto `onto` into a new branch `generatedBranch`. */
  cherryPick(commits: string[], onto: string, generatedBranch: string): Promise<CherryPickResult>;
  /** Moves `branch` from `from` to `to` (a non-fast-forward move: needs Force push). */
  moveBranch(branch: string, from: string, to: string): Promise<"ok" | "stale" | "forbidden">;
  deleteBranch(branch: string, at: string): Promise<void>;
  /** Changes the PR's target. Throws when it can't, e.g. another active PR already has that source and target. */
  retarget(prId: number, branch: string): Promise<void>;
  /** Posts the PR status shown with the PR's checks (one per PR, updated in place). */
  report(prId: number, state: "pending" | "succeeded" | "failed", description: string): Promise<void>;
  comment(prId: number, text: string): Promise<void>;
}

export interface RestackOptions {
  trunkPatterns: readonly string[];
  /** Prefix for the temporary branches cherry-picks write into. */
  scratchPrefix?: string;
  log?: (message: string) => void;
}

/** What happened to each PR, for logs and tests. */
export type RestackOutcome =
  | { pr: number; result: "restacked"; onto: string; commits: number; newTip: string }
  | { pr: number; result: "up-to-date" }
  | { pr: number; result: "failed"; reason: string };

const ZERO = "0000000000000000000000000000000000000000";
/** Stacks deeper than this are almost certainly a cycle in branch targets. */
const MAX_DEPTH = 25;

export class Restacker {
  private readonly outcomes: RestackOutcome[] = [];

  constructor(
    private readonly repo: RestackRepo,
    private readonly options: RestackOptions,
  ) {}

  /** Someone pushed to `branch`, moving it from `oldTip` to `newTip`. */
  async branchMoved(branch: string, oldTip: string, newTip: string): Promise<RestackOutcome[]> {
    await this.restackChildren(shortBranch(branch), oldTip, newTip, null, 0);
    return this.outcomes;
  }

  /** `pr` completed: it merged `sourceBranch` (last at `lastSourceCommit`) into its target. */
  async prCompleted(pr: RestackPr, lastSourceCommit: string): Promise<RestackOutcome[]> {
    const onto = shortBranch(pr.targetBranch);
    const ontoTip = await this.repo.branchTip(onto);
    if (!ontoTip) {
      this.log(`!${pr.id} completed into ${onto}, which no longer exists; nothing to restack`);
      return this.outcomes;
    }
    // Layers above now belong on the branch the merged layer went into.
    await this.restackChildren(shortBranch(pr.sourceBranch), lastSourceCommit, ontoTip, onto, 0);
    return this.outcomes;
  }

  /**
   * Someone asked to restack `pr` (a retry, or a stack auto-restack missed): rebases it on the current
   * tip of the layer below, or, when that layer merged, onto where it merged and retargets it. The
   * layers above follow. An up-to-date PR gets a succeeded status, clearing an earlier failure.
   */
  async restackPr(pr: RestackPr): Promise<RestackOutcome[]> {
    const target = shortBranch(pr.targetBranch);
    /** Ends without restacking: records the outcome and posts it as the PR's status. */
    const settle = async (state: "succeeded" | "failed", description: string) => {
      if (state === "failed") return this.fail(pr, description).then(() => this.outcomes);
      this.outcomes.push({ pr: pr.id, result: "up-to-date" });
      await this.repo.report(pr.id, state, truncate(description));
      return this.outcomes;
    };
    if (isTrunk(target, this.options.trunkPatterns)) return settle("succeeded", `Bottom of the stack: it targets ${target}, which is never restacked.`);

    const parent = await this.repo.prFrom(target);
    if (parent?.status === "abandoned") {
      return settle("failed", `The PR below (!${parent.id}) was abandoned. Retarget this PR to the branch it should go on.`);
    }
    let onto: string;
    let ontoTip: string | null;
    let oldParentTip: string | null;
    let retargetTo: string | null = null;
    if (parent?.status === "completed") {
      onto = retargetTo = shortBranch(parent.targetBranch);
      ontoTip = await this.repo.branchTip(onto);
      if (!ontoTip) return settle("failed", `The PR below (!${parent.id}) merged into ${onto}, which no longer exists. Retarget this PR.`);
      oldParentTip = parent.lastSourceCommit ?? (await this.repo.branchTip(target));
      if (!oldParentTip) return settle("failed", `Couldn't tell where ${target} was when !${parent.id} merged. Restack it locally.`);
    } else {
      // The layer below is open (or a branch without a PR): follow its current tip.
      onto = target;
      ontoTip = await this.repo.branchTip(target);
      if (!ontoTip) return settle("failed", `Couldn't restack: ${target} no longer exists and no merged PR came from it. Retarget this PR.`);
      const childTip = await this.repo.branchTip(shortBranch(pr.sourceBranch));
      oldParentTip = childTip && ((await this.onBranch(childTip, await this.repo.pushedBase(pr.id))) ?? (await this.repo.mergeBase(childTip, ontoTip)));
      if (!oldParentTip) return settle("failed", `Couldn't restack onto ${target}: this branch shares no history with it. Restack it locally.`);
    }
    try {
      await this.restackOne(pr, target, oldParentTip, ontoTip, retargetTo, 0);
    } catch (e) {
      await this.fail(pr, `Couldn't restack onto ${onto}: ${errorMessage(e)}`);
    }
    if (this.outcomes.some((o) => o.pr === pr.id && o.result === "up-to-date")) {
      await this.repo.report(pr.id, "succeeded", truncate(`Up to date with ${target}`));
    }
    return this.outcomes;
  }

  /**
   * Restacks the PRs into `branch`, whose previous tip was `oldTip`, onto `newTip`. With `retargetTo`,
   * the children also move their target to that branch (their parent merged).
   */
  private async restackChildren(branch: string, oldTip: string, newTip: string, retargetTo: string | null, depth: number): Promise<void> {
    if (oldTip === ZERO || newTip === ZERO) return; // branch created or deleted: nothing was stacked on the old tip
    if (depth >= MAX_DEPTH) {
      this.log(`stopped at ${branch}: stack deeper than ${MAX_DEPTH} layers`);
      return;
    }
    const children = await this.repo.activePrsInto(branch);
    for (const child of children) {
      // One layer's surprise (a REST error, a timeout) shows on that PR and doesn't stop its siblings.
      try {
        await this.restackOne(child, branch, oldTip, newTip, retargetTo, depth);
      } catch (e) {
        await this.fail(child, `Couldn't restack onto ${retargetTo ?? branch}: ${errorMessage(e)}`);
      }
    }
  }

  private async restackOne(child: RestackPr, parentBranch: string, oldParentTip: string, ontoTip: string, retargetTo: string | null, depth: number): Promise<void> {
    const source = shortBranch(child.sourceBranch);
    const ontoName = retargetTo ?? parentBranch;
    const fail = (reason: string) => this.fail(child, reason);

    if (isTrunk(source, this.options.trunkPatterns)) {
      // A PR *from* a trunk branch (e.g. dev -> uat) is a promotion, not a stack layer: never rewrite it.
      this.log(`!${child.id} comes from trunk branch ${source}; skipped`);
      return;
    }
    const childTip = await this.repo.branchTip(source);
    if (!childTip) return fail(`Couldn't restack: branch ${source} no longer exists.`);

    const alreadyOn = (await this.repo.mergeBase(childTip, ontoTip)) === ontoTip;
    if (alreadyOn && !retargetTo) {
      this.outcomes.push({ pr: child.id, result: "up-to-date" });
      return;
    }

    // The layer's own commits: reachable from it, but not from where its parent used to be.
    const base = await this.repo.mergeBase(childTip, oldParentTip);
    if (!base) return fail(`Couldn't restack onto ${ontoName}: this branch shares no history with ${parentBranch}. Restack it locally.`);
    const commits = alreadyOn ? [] : await this.repo.commitsBetween(childTip, base);
    if (commits.some((c) => c.parents > 1)) {
      return fail(`Couldn't restack onto ${ontoName}: this branch has merge commits, which can't be replayed on the server. Rebase it locally (git rebase ${ontoName}).`);
    }

    let newTip = childTip;
    if (!alreadyOn) {
      await this.repo.report(child.id, "pending", truncate(`Restacking onto ${ontoName}…`));
      if (commits.length === 0) {
        newTip = ontoTip; // everything in this layer is already below it (e.g. merged with its parent)
      } else {
        const scratch = `${this.options.scratchPrefix ?? "review-deck/restack"}/${child.id}-${ontoTip.slice(0, 8)}`;
        const picked = await this.repo.cherryPick(
          commits.map((c) => c.id),
          ontoName,
          scratch,
        );
        if (!picked.ok) {
          if (picked.conflict) {
            await this.repo.comment(
              child.id,
              `Auto-restack onto \`${ontoName}\` hit a conflict, so this branch was left unchanged. Rebase it locally:\n\n` +
                "```\n" +
                `git fetch && git switch ${source} && git rebase --onto origin/${ontoName} ${base.slice(0, 12)}\ngit push --force-with-lease\n` +
                "```",
            );
            return fail(`Conflict restacking onto ${ontoName}; branch left unchanged. See the comment for how to rebase locally.`);
          }
          return fail(`Couldn't restack onto ${ontoName}: ${picked.message}`);
        }
        newTip = picked.commit;
        await this.repo.deleteBranch(scratch, picked.commit).catch((e: unknown) => this.log(`couldn't delete ${scratch}: ${String(e)}`));
      }
      const moved = await this.repo.moveBranch(source, childTip, newTip);
      if (moved === "stale") return fail(`Couldn't restack: ${source} changed while restacking. Push again or restack locally.`);
      if (moved === "forbidden") return fail(`Couldn't restack: the restack service needs the "Force push" permission on ${source}.`);
    }
    const retargetProblem =
      retargetTo && shortBranch(child.targetBranch).toLowerCase() !== retargetTo.toLowerCase() ? await this.retarget(child, source, retargetTo) : null;

    if (retargetProblem) {
      await fail(retargetProblem);
    } else {
      this.outcomes.push({ pr: child.id, result: "restacked", onto: ontoName, commits: commits.length, newTip });
      await this.repo.report(child.id, "succeeded", truncate(`Restacked onto ${ontoName} (${plural(commits.length, "commit")})`));
    }
    // This layer moved, so the layers above follow.
    if (newTip !== childTip) await this.restackChildren(source, childTip, newTip, null, depth + 1);
  }

  /** Retargets `child` to `branch`; on failure, says why (most often a twin PR with the same source and target). */
  private async retarget(child: RestackPr, source: string, branch: string): Promise<string | null> {
    try {
      await this.repo.retarget(child.id, branch);
      return null;
    } catch (e) {
      const twin = (await this.repo.activePrsInto(branch).catch(() => [])).find(
        (p) => p.id !== child.id && shortBranch(p.sourceBranch).toLowerCase() === source.toLowerCase(),
      );
      return twin
        ? `Moved onto ${branch}, but couldn't retarget this PR: !${twin.id} already merges ${source} into ${branch}. Abandon one of them.`
        : `Moved onto ${branch}, but couldn't retarget this PR: ${errorMessage(e)}`;
    }
  }

  private async fail(child: RestackPr, reason: string): Promise<void> {
    this.outcomes.push({ pr: child.id, result: "failed", reason });
    this.log(`!${child.id}: ${reason}`);
    await this.repo.report(child.id, "failed", truncate(reason)).catch((e: unknown) => this.log(`couldn't report on !${child.id}: ${errorMessage(e)}`));
  }

  /** `commit` if `tip` contains it, else null. */
  private async onBranch(tip: string, commit: string | null): Promise<string | null> {
    return commit && (await this.repo.mergeBase(tip, commit)) === commit ? commit : null;
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Azure DevOps PR status descriptions are short; keep them readable in the checks list. */
function truncate(text: string): string {
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}
