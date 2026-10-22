import { isTrunk } from "../../../src/stack/branches.js";
import { Restacker, type RestackOutcome } from "../../../src/stack/restack.js";
import { AdoClient } from "./ado.js";
import { AdoRepo } from "./adoRepo.js";
import type { JobBase, RestackJob } from "./hooks.js";
import { stackSettings } from "./settings.js";

/** Runs one queued restack job against Azure DevOps. */
export async function runRestackJob(job: RestackJob, log: (message: string) => void): Promise<RestackOutcome[]> {
  const ado = new AdoClient(job.organization);
  const settings = await stackSettings(ado, job.projectId, job.extensionId, log);
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

/**
 * Restacks one PR on request (the PR page's "Restack" button), whether or not auto-restack is on:
 * a retry after a failure, or a stack the hooks missed. Uses the project's trunk branches.
 */
export async function runManualRestack(request: JobBase & { pullRequestId: number }, log: (message: string) => void): Promise<RestackOutcome[]> {
  const ado = new AdoClient(request.organization);
  const settings = await stackSettings(ado, request.projectId, request.extensionId, log);
  const repo = new AdoRepo(ado, request.projectId, request.repositoryId);
  const pr = await repo.getPr(request.pullRequestId);
  if (pr.status !== "active") throw new ManualRestackError(`!${pr.id} isn't active, so there's nothing to restack.`);
  return new Restacker(repo, { trunkPatterns: settings.trunkBranches, log }).restackPr(pr);
}

/** A request that can't be carried out, with a message for the user. */
export class ManualRestackError extends Error {}
