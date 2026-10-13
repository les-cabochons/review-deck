import type { CherryPickResult, CommitInfo, RestackPr, RestackRepo } from "../../../src/stack/restack.js";
import { shortBranch } from "../../../src/stack/branches.js";
import type { AdoClient } from "./ado.js";

const ZERO = "0000000000000000000000000000000000000000";
/** Longest layer the server walks commit by commit; longer ones are left for a local rebase. */
const MAX_LAYER_COMMITS = 200;
const CHERRY_PICK_TIMEOUT_MS = 90_000;
/** PR status context: one "restack" check per PR, updated in place. */
export const STATUS_CONTEXT = { genre: "review-deck", name: "restack" };

interface AdoPr {
  pullRequestId: number;
  title: string;
  sourceRefName: string;
  targetRefName: string;
}

/** RestackRepo over Azure DevOps REST (Git refs, commits, merge bases, cherry-picks, PRs). */
export class AdoRepo implements RestackRepo {
  private readonly root: string;

  constructor(
    private readonly ado: AdoClient,
    readonly projectId: string,
    readonly repositoryId: string,
  ) {
    this.root = `${encodeURIComponent(projectId)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/`;
  }

  async activePrsInto(branch: string): Promise<RestackPr[]> {
    const { value } = await this.ado.get<{ value: AdoPr[] }>(`${this.root}pullrequests`, {
      "searchCriteria.targetRefName": ref(branch),
      "searchCriteria.status": "active",
      $top: "100",
    });
    return value.map((p) => ({ id: p.pullRequestId, title: p.title, sourceBranch: p.sourceRefName, targetBranch: p.targetRefName }));
  }

  async getPr(id: number): Promise<RestackPr & { status: string; lastSourceCommit: string | null }> {
    const p = await this.ado.get<AdoPr & { status: string; lastMergeSourceCommit?: { commitId: string } }>(`${this.root}pullrequests/${id}`);
    return { id, title: p.title, sourceBranch: p.sourceRefName, targetBranch: p.targetRefName, status: p.status, lastSourceCommit: p.lastMergeSourceCommit?.commitId ?? null };
  }

  async branchTip(branch: string): Promise<string | null> {
    const name = ref(branch);
    // filter is a prefix match ("heads/a" also returns "heads/ab"), so pick the exact ref.
    const { value } = await this.ado.get<{ value: { name: string; objectId: string }[] }>(`${this.root}refs`, { filter: name.slice("refs/".length) });
    return value.find((r) => r.name.toLowerCase() === name.toLowerCase())?.objectId ?? null;
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    const { value } = await this.ado.get<{ value: { commitId: string }[] }>(`${this.root}commits/${a}/mergebases`, { otherCommitId: b });
    return value[0]?.commitId ?? null;
  }

  /**
   * Walks first parents from `tip` back to `exclude` (the layer's merge base). Layers are linear
   * (a merge commit stops the walk and is returned, which the engine refuses), so this is exact.
   */
  async commitsBetween(tip: string, exclude: string): Promise<CommitInfo[]> {
    const out: CommitInfo[] = [];
    for (let id = tip; id !== exclude; ) {
      if (out.length >= MAX_LAYER_COMMITS) throw new Error(`this layer has more than ${MAX_LAYER_COMMITS} commits`);
      const commit = await this.ado.get<{ commitId: string; parents?: string[] }>(`${this.root}commits/${id}`);
      const parents = commit.parents ?? [];
      out.unshift({ id: commit.commitId, parents: parents.length });
      if (parents.length !== 1) break;
      id = parents[0];
    }
    return out;
  }

  async cherryPick(commits: string[], onto: string, generatedBranch: string): Promise<CherryPickResult> {
    type Op = { cherryPickId: number; status: string; detailedStatus?: { conflict?: boolean; failureMessage?: string; timedout?: boolean } };
    let op = await this.ado.post<Op>(`${this.root}cherryPicks`, {
      source: { commitList: commits.map((commitId) => ({ commitId })) },
      ontoRefName: ref(onto),
      generatedRefName: ref(generatedBranch),
      repository: { id: this.repositoryId },
    });
    const deadline = Date.now() + CHERRY_PICK_TIMEOUT_MS;
    while (op.status === "queued" || op.status === "inProgress") {
      if (Date.now() > deadline) return { ok: false, conflict: false, message: "the server-side cherry-pick timed out" };
      await new Promise((r) => setTimeout(r, 1000));
      op = await this.ado.get<Op>(`${this.root}cherryPicks/${op.cherryPickId}`);
    }
    if (op.status !== "completed") {
      const d = op.detailedStatus ?? {};
      return { ok: false, conflict: !!d.conflict, message: d.failureMessage || (d.timedout ? "the server-side cherry-pick timed out" : `cherry-pick ${op.status}`) };
    }
    const commit = await this.branchTip(generatedBranch);
    if (!commit) return { ok: false, conflict: false, message: "the cherry-pick finished but its branch is missing" };
    return { ok: true, commit };
  }

  async moveBranch(branch: string, from: string, to: string): Promise<"ok" | "stale" | "forbidden"> {
    const result = await this.updateRef(branch, from, to);
    if (result.success) return "ok";
    if (result.updateStatus === "staleOldObjectId") return "stale";
    if (result.updateStatus === "forcePushRequired" || result.updateStatus === "writePermissionRequired" || result.updateStatus === "rejectedByPolicy") return "forbidden";
    throw new Error(`moving ${branch} failed: ${result.updateStatus}${result.customMessage ? ` (${result.customMessage})` : ""}`);
  }

  async deleteBranch(branch: string, at: string): Promise<void> {
    await this.updateRef(branch, at, ZERO);
  }

  async retarget(prId: number, branch: string): Promise<void> {
    await this.ado.patch(`${this.root}pullrequests/${prId}`, { targetRefName: ref(branch) });
  }

  async report(prId: number, state: "pending" | "succeeded" | "failed", description: string): Promise<void> {
    await this.ado.post(`${this.root}pullRequests/${prId}/statuses`, { state, description, context: STATUS_CONTEXT });
  }

  async comment(prId: number, text: string): Promise<void> {
    await this.ado.post(`${this.root}pullRequests/${prId}/threads`, { comments: [{ parentCommentId: 0, content: text, commentType: 1 }], status: "active" });
  }

  private async updateRef(branch: string, oldObjectId: string, newObjectId: string) {
    const { value } = await this.ado.post<{ value: { success: boolean; updateStatus: string; customMessage?: string }[] }>(`${this.root}refs`, [
      { name: ref(branch), oldObjectId, newObjectId },
    ]);
    return value[0];
  }
}

function ref(branch: string): string {
  return `refs/heads/${shortBranch(branch)}`;
}
