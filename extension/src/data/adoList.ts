import { getClient } from "azure-devops-extension-api";
import { type GitPullRequest, type GitPullRequestSearchCriteria, GitRestClient, PullRequestStatus } from "azure-devops-extension-api/Git";
import { CoreRestClient } from "azure-devops-extension-api/Core";
import { PolicyRestClient } from "azure-devops-extension-api/Policy";
import { activeComments, type DetailScope, type MyGroup, policyFacts, type PrListSource, type PrSummary } from "./list";
import { policyStatus } from "./adoSource";
import type { CatalogProject, ListScope, RepoCatalog } from "./repoSelection";
import { asVote, type Identity, identityImageUrl, type PrStatus, threadStatusFromNumber } from "./model";

const PR_STATUS: Record<number, PrStatus> = { 1: "active", 2: "abandoned", 3: "completed" };
const RECENT_DAYS = 14;
const PROJECT_PAGE = 500;
const PROJECT_CONCURRENCY = 6;

/** Lists pull requests in chosen projects and repositories, or across the organization, through the Azure DevOps REST API. */
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

  get currentProjectId(): string {
    return this.projectId;
  }

  async list(scope: ListScope = { projects: [this.projectId], repos: [] }): Promise<PrSummary[]> {
    // No organization-wide PR query in the REST API: ask each project (or repository), a few at a time.
    // A project you can't read Git in (or with Repos turned off) just contributes nothing.
    const projects = scope === "organization" ? (await this.projects()).map((p) => p.id) : scope.projects;
    const repos = scope === "organization" ? [] : scope.repos;
    const queries = [
      ...projects.map((id) => () => this.query((c, top) => this.git.getPullRequestsByProject(id, c, undefined, 0, top))),
      // Repository ids are unique across the organization, so no project is needed.
      ...repos.map((id) => () => this.query((c, top) => this.git.getPullRequests(id, c, undefined, undefined, 0, top))),
    ];
    const lists: PrSummary[][] = [];
    const worker = async () => {
      for (let q = queries.shift(); q; q = queries.shift()) lists.push(await q().catch(() => []));
    };
    await Promise.all(Array.from({ length: Math.min(PROJECT_CONCURRENCY, queries.length) }, worker));
    return [...new Map(lists.flat().map((p) => [p.id, p])).values()];
  }

  /** Active pull requests, and your recently completed ones, from one project or repository. */
  private async query(fetch: (criteria: GitPullRequestSearchCriteria, top: number) => Promise<GitPullRequest[]>): Promise<PrSummary[]> {
    const criteria = (c: Partial<GitPullRequestSearchCriteria>) => c as GitPullRequestSearchCriteria;
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    const [active, mineDone, reviewedDone] = await Promise.all([
      fetch(criteria({ status: PullRequestStatus.Active }), 300),
      fetch(criteria({ status: PullRequestStatus.Completed, creatorId: this.currentUser.id }), 25),
      fetch(criteria({ status: PullRequestStatus.Completed, reviewerId: this.currentUser.id }), 25),
    ]);
    const done = [...mineDone, ...reviewedDone].filter((p) => !p.closedDate || new Date(p.closedDate) >= since);
    const unique = new Map<number, GitPullRequest>();
    for (const p of [...active, ...done]) unique.set(p.pullRequestId, p);
    return [...unique.values()].map((p) => this.summary(p));
  }

  /** Every project you can see and its enabled repositories: one call for the projects, one for every repository. */
  async catalog(): Promise<RepoCatalog> {
    const [projects, repos] = await Promise.all([this.projects(), this.git.getRepositories()]);
    const byProject = new Map<string, CatalogProject>(projects.map((p) => [p.id, { id: p.id, name: p.name, repos: [] }]));
    for (const r of repos) {
      const project = r.project?.id && byProject.get(r.project.id);
      if (project && !r.isDisabled) project.repos.push({ id: r.id, name: r.name, projectId: project.id });
    }
    const catalog = [...byProject.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const p of catalog) p.repos.sort((a, b) => a.name.localeCompare(b.name));
    return catalog;
  }

  /** Every well-formed project in the organization that you can see. */
  private async projects(): Promise<{ id: string; name: string }[]> {
    const all: { id: string; name: string }[] = [];
    for (;;) {
      const page = await this.core.getProjects(undefined, PROJECT_PAGE, all.length);
      all.push(...page.map((p) => ({ id: p.id, name: p.name })));
      if (page.length < PROJECT_PAGE) return all;
    }
  }

  /** Every team you belong to in the organization; a team reviewer's id is the team's identity id. */
  async myGroups(): Promise<MyGroup[]> {
    const teams = await this.core.getAllTeams(true, 1000);
    return teams.map((t) => ({ id: t.id, name: t.name }));
  }

  async details(pr: PrSummary, scope: DetailScope = "full"): Promise<Partial<Pick<PrSummary, "checks" | "comments" | "restack" | "reviewPolicy">>> {
    const project = pr.repository.projectId;
    const full = scope === "full";
    const [threads, evaluations, statuses] = await Promise.all([
      full ? this.git.getThreads(pr.repository.id, pr.id, project).catch(() => []) : [],
      this.policy.getPolicyEvaluations(project, `vstfs:///CodeReview/CodeReviewId/${project}/${pr.id}`).catch(() => []),
      full ? this.git.getPullRequestStatuses(pr.repository.id, pr.id, project).catch(() => []) : [],
    ]);
    const facts = policyFacts(evaluations.map(policyStatus));
    if (!full) return facts;
    // CommentType 3 is a system comment (votes, pushes); a thread of only those isn't a discussion.
    const comments = activeComments(
      threads
        .filter((t) => !t.isDeleted)
        .map((t) => ({ status: threadStatusFromNumber(t.status), kind: (t.comments ?? []).some((c) => c.commentType !== 3) ? "comment" : "system" }) as const),
    );
    return { ...facts, comments, restack: latestRestack(statuses) };
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
