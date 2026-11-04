import { getClient } from "azure-devops-extension-api";
import { NotificationRestClient } from "azure-devops-extension-api/Notification";
import { GitRestClient } from "azure-devops-extension-api/Git";
import { PolicyRestClient } from "azure-devops-extension-api/Policy";
import { IdentityServiceIds, type IVssIdentityService } from "azure-devops-extension-api/Identities";
import { getHost, getService } from "azure-devops-extension-sdk";
import type { IIdentity as PickerIdentity } from "azure-devops-ui/IdentityPicker";
import { createAdoActions, MERGE_POLICY_TYPE, type MergePolicy } from "./adoActions";
import { OverviewLoad, type OverviewReads, toThreads } from "./adoOverview";
import { openBlobCache } from "./blobCache";
import { BlobLoader } from "./blobs";
import { type ChangeType, type FileChange, type Identity, identityImageUrl, type PrOverview, type PrSource, type PrActions, type Thread } from "./model";

// VersionControlChangeType flags
const ADD = 1;
const DELETE = 16;
const RENAME = 8;

/** Reads and writes a pull request through the host's authenticated REST clients. */
export class AdoPrSource implements PrSource {
  readonly kind = "ado";
  readonly actions: PrActions;
  private readonly git = getClient(GitRestClient);
  private readonly policy = getClient(PolicyRestClient);
  /** The page's seven reads, bound to this PR (adoOverview.ts loads them in the order the page shows them). */
  private readonly reads: OverviewReads;
  /** The load prefetch() started, for the next load(). */
  private prefetched: OverviewLoad | null = null;
  /** Both sides of the changed files, from kept blobs first, then one zip call per batch (data/blobs.ts). */
  private readonly blobs: BlobLoader;

  constructor(
    private readonly projectId: string,
    private readonly repositoryId: string,
    private readonly pullRequestId: number,
    readonly currentUser: Identity,
  ) {
    const { git, policy } = this;
    this.reads = {
      pullRequest: () => git.getPullRequest(repositoryId, pullRequestId, projectId),
      iterations: () => git.getPullRequestIterations(repositoryId, pullRequestId, projectId, true),
      threads: () => git.getThreads(repositoryId, pullRequestId, projectId),
      commits: () => git.getPullRequestCommits(repositoryId, pullRequestId, projectId),
      labels: () => git.getPullRequestLabels(repositoryId, pullRequestId, projectId),
      workItems: () => git.getPullRequestWorkItemRefs(repositoryId, pullRequestId, projectId),
      policies: () => policy.getPolicyEvaluations(projectId, `vstfs:///CodeReview/CodeReviewId/${projectId}/${pullRequestId}`),
    };
    this.blobs = new BlobLoader(
      { zip: (ids) => git.getBlobsZip(ids, repositoryId, projectId), one: (id) => git.getBlobContent(repositoryId, id, projectId) },
      // Per organization and user, not project, because a blob's id names its content wherever it is.
      openBlobCache(`${getHost().id}/${currentUser.id}`),
    );
    this.actions = createAdoActions(this.git, { project: projectId, repo: repositoryId, pr: pullRequestId }, currentUser, {
      notifications: getClient(NotificationRestClient),
      mergePolicies: async () => (await this.policy.getPolicyConfigurations(projectId, undefined, MERGE_POLICY_TYPE)) as MergePolicy[],
      searchReviewers: async (query) => {
        if (query.trim().length < 2) return [];
        const service = await getService<IVssIdentityService>(IdentityServiceIds.IdentityService);
        const results = await service.searchIdentitiesAsync(query.trim(), ["user", "group"]);
        return results
          .map((result) => {
            const person = result as PickerIdentity;
            // localId is the Azure DevOps identity GUID. originId belongs to the backing directory.
            return {
              id: person.localId ?? "",
              displayName: person.displayName ?? person.signInAddress ?? person.entityId,
              uniqueName: person.signInAddress ?? person.mail ?? "",
              imageUrl: identityImageUrl(person.image, `https://dev.azure.com/${encodeURIComponent(getHost().name)}/`),
            };
          })
          .filter((person) => !!person.id);
      },
    });
  }

  /** Starts the first load now (src/index.ts, while the page's code loads; the hub, on hover); the next load() returns it. */
  prefetch(): void {
    this.prefetched ??= new OverviewLoad(this.reads);
  }

  load(onPartial?: (overview: PrOverview) => void): Promise<PrOverview> {
    const prefetched = this.prefetched;
    this.prefetched = null;
    if (!prefetched) return new OverviewLoad(this.reads).result(onPartial);
    // A prefetch that failed (a network blip while hovering a row) is tried again now that it's asked for.
    return prefetched.result(onPartial).catch(() => new OverviewLoad(this.reads).result(onPartial));
  }

  async getChanges(iteration: number, compareTo: number): Promise<FileChange[]> {
    const out: FileChange[] = [];
    for (let skip = 0; ; skip += 2000) {
      const page = await this.git.getPullRequestIterationChanges(
        this.repositoryId,
        this.pullRequestId,
        iteration,
        this.projectId,
        2000,
        skip,
        compareTo,
      );
      for (const c of page.changeEntries ?? []) {
        if (!c.item?.path || (c.item as { isFolder?: boolean }).isFolder) continue;
        const flags = c.changeType as number;
        const changeType: ChangeType = flags & ADD ? "add" : flags & DELETE ? "delete" : flags & RENAME ? "rename" : "edit";
        out.push({
          changeTrackingId: c.changeTrackingId,
          path: c.item.path.replace(/^\//, ""),
          originalPath: c.originalPath?.replace(/^\//, ""),
          changeType,
          oldObjectId: changeType === "add" ? undefined : c.item.originalObjectId,
          newObjectId: changeType === "delete" ? undefined : c.item.objectId,
        });
      }
      if (!page.nextSkip) break;
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  getBlobs(objectIds: string[], signal?: AbortSignal) {
    return this.blobs.load(objectIds, signal);
  }

  async getThreads(iteration: number, compareTo: number): Promise<Thread[]> {
    return toThreads(await this.git.getThreads(this.repositoryId, this.pullRequestId, this.projectId, iteration, compareTo || iteration));
  }
}
