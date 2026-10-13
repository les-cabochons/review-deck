import { getClient } from "azure-devops-extension-api";
import { type GitPullRequest, type GitPullRequestSearchCriteria, GitRestClient, PullRequestStatus } from "azure-devops-extension-api/Git";
import { CoreRestClient } from "azure-devops-extension-api/Core";
import { PolicyRestClient } from "azure-devops-extension-api/Policy";
import type { ListScope, MyGroup, PrListSource, PrSummary } from "./list";
import { asVote, type Identity, identityImageUrl, type PrStatus } from "./model";

const PR_STATUS: Record<number, PrStatus> = { 1: "active", 2: "abandoned", 3: "completed" };
const RECENT_DAYS = 14;
const PROJECT_PAGE = 500;
const PROJECT_CONCURRENCY = 6;

/** Lists pull requests in the current project, or across the organization, through the Azure DevOps REST API. */
export class AdoPrListSource implements PrListSource {
  readonly kind = "ado";
  private readonly git = getClient(GitRestClient);
  private readonly policy = getClient(PolicyRestClient);
  private readonly core = getClient(CoreRestClient);

  constructor(
    private readonly projectId: string,
    readonly currentUser: Identity,
    private readonly hostUrl: string,
    readonly newPullRequestUrl?: string,
  ) {}

  async list(scope: ListScope = "project"): Promise<PrSummary[]> {
    if (scope === "project") return this.listProject(this.projectId);
    // No organization-wide PR query in the REST API: ask each project you can see, a few at a time.
    // A project you can't read Git in (or with Repos turned off) just contributes nothing.
    const projects = await this.projectIds();
    const lists: PrSummary[][] = [];
    const queue = [...projects];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) lists.push(await this.listProject(id).catch(() => []));
    };
    await Promise.all(Array.from({ length: Math.min(PROJECT_CONCURRENCY, queue.length) }, worker));
    return lists.flat();
  }

  private async listProject(project: string): Promise<PrSummary[]> {
    const criteria = (c: Partial<GitPullRequestSearchCriteria>) => c as GitPullRequestSearchCriteria;
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    const [active, mineDone, reviewedDone] = await Promise.all([
      this.git.getPullRequestsByProject(project, criteria({ status: PullRequestStatus.Active }), undefined, 0, 300),
      this.git.getPullRequestsByProject(project, criteria({ status: PullRequestStatus.Completed, creatorId: this.currentUser.id }), undefined, 0, 25),
      this.git.getPullRequestsByProject(project, criteria({ status: PullRequestStatus.Completed, reviewerId: this.currentUser.id }), undefined, 0, 25),
    ]);
    const done = [...mineDone, ...reviewedDone].filter((p) => !p.closedDate || new Date(p.closedDate) >= since);
    const unique = new Map<number, GitPullRequest>();
    for (const p of [...active, ...done]) unique.set(p.pullRequestId, p);
    return [...unique.values()].map((p) => this.summary(p));
  }

  /** Every well-formed project in the organization that you can see. */
  private async projectIds(): Promise<string[]> {
    const ids: string[] = [];
    for (;;) {
      const page = await this.core.getProjects(undefined, PROJECT_PAGE, ids.length);
      ids.push(...page.map((p) => p.id));
      if (page.length < PROJECT_PAGE) return ids;
    }
  }

  /** Every team you belong to in the organization; a team reviewer's id is the team's identity id. */
  async myGroups(): Promise<MyGroup[]> {
    const teams = await this.core.getAllTeams(true, 1000);
    return teams.map((t) => ({ id: t.id, name: t.name }));
  }

  async details(pr: PrSummary): Promise<Partial<Pick<PrSummary, "checks" | "comments" | "restack">>> {
    const project = pr.repository.projectId;
    const [threads, evaluations, statuses] = await Promise.all([
      this.git.getThreads(pr.repository.id, pr.id, project).catch(() => []),
      this.policy.getPolicyEvaluations(project, `vstfs:///CodeReview/CodeReviewId/${project}/${pr.id}`).catch(() => []),
      this.git.getPullRequestStatuses(pr.repository.id, pr.id, project).catch(() => []),
    ]);
    const comments = threads.filter(
      (t) => !t.isDeleted && (t.status === 1 || t.status === 6) && (t.comments ?? []).some((c) => c.commentType !== 3),
    ).length;
    // PolicyEvaluationStatus: 0 queued, 1 running, 2 approved, 3 rejected, 4 notApplicable, 5 broken
    const builds = evaluations.filter((e) => /build/i.test(e.configuration?.type?.displayName ?? ""));
    const states = builds.map((e) => e.status as number);
    const checks: PrSummary["checks"] =
      states.length === 0
        ? "none"
        : states.some((s) => s === 3 || s === 5)
          ? "failing"
          : states.some((s) => s === 0 || s === 1)
            ? "pending"
            : "passing";
    return { comments, checks, restack: latestRestack(statuses) };
  }

  private summary(p: GitPullRequest): PrSummary {
    const identity = (i: { id?: string; displayName?: string; uniqueName?: string; imageUrl?: string } | undefined): Identity => ({
      id: i?.id ?? "",
      displayName: i?.displayName ?? "Unknown",
      uniqueName: i?.uniqueName ?? "",
      imageUrl: identityImageUrl(i?.imageUrl, this.hostUrl),
    });
    return {
      id: p.pullRequestId,
      title: p.title,
      repository: { id: p.repository.id, name: p.repository.name, projectId: p.repository.project?.id ?? this.projectId, projectName: p.repository.project?.name ?? "" },
      createdBy: identity(p.createdBy),
      creationDate: new Date(p.creationDate),
      closedDate: p.closedDate ? new Date(p.closedDate) : undefined,
      status: PR_STATUS[p.status] ?? "active",
      isDraft: !!p.isDraft,
      sourceBranch: p.sourceRefName.replace(/^refs\/heads\//, ""),
      targetBranch: p.targetRefName.replace(/^refs\/heads\//, ""),
      reviewers: (p.reviewers ?? []).map((r) => ({ ...identity(r), vote: asVote(r.vote), isRequired: !!r.isRequired })),
      labels: (p.labels ?? []).filter((l) => l.active !== false).map((l) => l.name),
      openable: true,
    };
  }
}

/** GitStatusState: 1 pending, 2 succeeded, 3 failed, 4 error. The backend posts genre "semantic-pr", name "restack". */
function latestRestack(statuses: { context?: { genre?: string; name?: string }; state?: number; description?: string; creationDate?: Date }[]): PrSummary["restack"] {
  const ours = statuses.filter((s) => s.context?.genre === "semantic-pr" && s.context?.name === "restack");
  const latest = ours.sort((a, b) => new Date(b.creationDate ?? 0).getTime() - new Date(a.creationDate ?? 0).getTime())[0];
  if (!latest) return undefined;
  const state = latest.state === 1 ? "pending" : latest.state === 2 ? "succeeded" : "failed";
  return { state, description: latest.description ?? "", date: new Date(latest.creationDate ?? Date.now()) };
}
