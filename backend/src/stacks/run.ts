import { isTrunk } from "../../../src/stack/branches.js";
import { Restacker, type RestackOutcome } from "../../../src/stack/restack.js";
import { AdoClient } from "./ado.js";
import { AdoRepo } from "./adoRepo.js";
import type { RestackJob } from "./hooks.js";
import { stackSettings } from "./settings.js";

/** Runs one queued restack job against Azure DevOps. */
export async function runRestackJob(job: RestackJob, log: (message: string) => void): Promise<RestackOutcome[]> {
  const ado = new AdoClient(job.organization);
  const settings = await stackSettings(ado, job.projectId);
  if (!settings.autoRestack) {
    log(`auto-restack is off for project ${job.projectId}; ignoring ${job.kind}`);
    return [];
  }
  const repo = new AdoRepo(ado, job.projectId, job.repositoryId);
  const restacker = new Restacker(repo, { trunkPatterns: settings.trunkBranches, log });
  if (job.kind === "push") {
    // A push to a trunk branch only matters to PRs stacked directly on it, which are bottoms: they
    // stay where they are (Azure DevOps shows them as behind, like any PR into main).
    if (isTrunk(job.branch, settings.trunkBranches)) return [];
    return restacker.branchMoved(job.branch, job.oldTip, job.newTip);
  }
  const pr = await repo.getPr(job.pullRequestId);
  if (pr.status !== "completed" || !pr.lastSourceCommit) return [];
  return restacker.prCompleted(pr, pr.lastSourceCommit);
}
