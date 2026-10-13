import {
  asVote,
  branchName,
  branchRef,
  isLineAnchor,
  MERGE_STRATEGIES,
  mergeStatusFromNumber,
  type Comment,
  type FileChange,
  type Identity,
  type PrActions,
  type PolicyState,
  type PrOverview,
  type PrSource,
  type Thread,
  threadStatusFromNumber,
} from "./model";
import type { CommentJson, IdentityJson, PrSnapshot, ThreadJson } from "./snapshot";
import {
  fromCompletionOptionsJson,
  PR_STATUS_NUMBER,
  requireContent,
  STATUS_NUMBER,
  threadPayload,
  toCompletionOptionsJson,
} from "./adoActions";

export const MOCK_USER: Identity = { id: "local-reviewer", displayName: "Local reviewer", uniqueName: "reviewer@example.test" };

/** Serves a PrSnapshot JSON (built by scripts/build-ado-mock.ts) for local development. */
export class MockPrSource implements PrSource {
  readonly kind = "mock";
  readonly actions: PrActions;
  private readonly snap: PrSnapshot;

  constructor(
    snapshot: PrSnapshot,
    readonly currentUser: Identity = MOCK_USER,
  ) {
    this.snap = structuredClone(snapshot);
    const findThread = (id: number) => {
      const thread = this.snap.threads.find((t) => t.id === id);
      if (!thread) throw new Error(`Thread ${id} no longer exists.`);
      return thread;
    };
    const findReviewer = (id: string) => {
      const reviewer = this.snap.pullRequest.reviewers.find((r) => r.id === id);
      if (!reviewer) throw new Error("This reviewer no longer exists.");
      return reviewer;
    };
    const newComment = (content: string, parentCommentId: number): CommentJson => {
      const now = new Date().toISOString();
      return {
        id: Math.max(0, ...this.snap.threads.flatMap((t) => t.comments.map((c) => c.id))) + 1,
        parentCommentId,
        author: this.currentUser,
        content: requireContent(content),
        publishedDate: now,
        lastUpdatedDate: now,
        commentType: 1,
        usersLiked: [],
      };
    };
    let following = false;
    const favorites = new Set<string>();
    const active = (doing: string) => {
      const pr = this.snap.pullRequest;
      if (pr.status !== PR_STATUS_NUMBER.active) throw new Error(`Only an active pull request can be ${doing}.`);
      return pr;
    };
    this.actions = {
      createThread: async (input) => {
        threadPayload(input); // same validation and iteration convention as the REST adapter
        const now = new Date().toISOString();
        this.snap.threads.push({
          id: Math.max(0, ...this.snap.threads.map((t) => t.id)) + 1,
          status: 1,
          publishedDate: now,
          lastUpdatedDate: now,
          properties: {},
          comments: [newComment(input.content, 0)],
          threadContext: input.file
            ? {
                filePath: `/${input.file.path}`,
                ...(isLineAnchor(input.file) && {
                  [input.file.side === "left" ? "leftFileStart" : "rightFileStart"]: { line: input.file.line, offset: 1 },
                  [input.file.side === "left" ? "leftFileEnd" : "rightFileEnd"]: { line: input.file.endLine, offset: 1 },
                }),
              }
            : undefined,
          pullRequestThreadContext: input.comparison
            ? {
                changeTrackingId: input.comparison.changeTrackingId,
                iterationContext: {
                  firstComparingIteration: input.comparison.compareTo || input.comparison.iteration,
                  secondComparingIteration: input.comparison.iteration,
                },
              }
            : undefined,
        });
      },
      reply: async (id, parentId, content) => {
        const thread = findThread(id);
        if (!thread.comments.some((c) => c.id === parentId)) throw new Error("The parent comment no longer exists.");
        thread.comments.push(newComment(content, parentId));
        thread.lastUpdatedDate = new Date().toISOString();
      },
      setThreadStatus: async (id, status) => {
        const thread = findThread(id);
        thread.status = STATUS_NUMBER[status];
        thread.lastUpdatedDate = new Date().toISOString();
      },
      setVote: async (vote) => {
        let reviewer = this.snap.pullRequest.reviewers.find((r) => r.id === this.currentUser.id);
        if (!reviewer) {
          reviewer = { ...this.currentUser, vote: 0, isRequired: false };
          this.snap.pullRequest.reviewers.push(reviewer);
        }
        reviewer.vote = vote;
      },
      searchReviewers: async (query) => {
        const people = new Map(
          [
            this.currentUser,
            this.snap.pullRequest.createdBy,
            ...this.snap.pullRequest.reviewers,
            ...this.snap.threads.flatMap((t) => t.comments.map((c) => c.author)),
            { id: "mock-engineer", displayName: "Alex Engineer", uniqueName: "alex@example.test" },
            { id: "mock-team", displayName: "Platform team", uniqueName: "platform@example.test" },
          ].map((who) => [who.id, who]),
        );
        const q = query.trim().toLowerCase();
        return q.length < 2 ? [] : [...people.values()].filter((who) => `${who.displayName} ${who.uniqueName}`.toLowerCase().includes(q));
      },
      addReviewer: async (who, required) => {
        if (this.snap.pullRequest.reviewers.some((r) => r.id === who.id)) throw new Error("This reviewer is already added.");
        this.snap.pullRequest.reviewers.push({ ...who, vote: 0, isRequired: required });
      },
      setReviewerRequired: async (id, required) => {
        findReviewer(id).isRequired = required;
      },
      removeReviewer: async (id) => {
        findReviewer(id);
        this.snap.pullRequest.reviewers = this.snap.pullRequest.reviewers.filter((r) => r.id !== id);
      },
      addTag: async (name) => {
        name = name.trim();
        if (!name) throw new Error("Enter a tag name.");
        if (this.snap.pullRequest.labels.some((l) => l.active && l.name.toLowerCase() === name.toLowerCase()))
          throw new Error("This tag is already added.");
        this.snap.pullRequest.labels.push({ id: `local-${name}`, name, active: true });
      },
      removeTag: async (name) => {
        this.snap.pullRequest.labels = this.snap.pullRequest.labels.filter((l) => l.name !== name);
      },
      setDescription: async (description) => {
        this.snap.pullRequest.description = description;
      },
      share: async (receivers) => {
        if (!receivers.length) throw new Error("Add at least one person to share with.");
      },
      isFollowing: async () => following,
      setFollowing: async (on) => void (following = on),
      isFavoriteBranch: async (branch) => favorites.has(branch),
      setFavoriteBranch: async (branch, on) => void (on ? favorites.add(branch) : favorites.delete(branch)),
      searchBranches: async (query) => {
        const { sourceRefName, targetRefName } = this.snap.pullRequest;
        const names = [...new Set(["main", "uat", "release/00-next", ...[sourceRefName, targetRefName].map(branchName)])];
        return names.filter((n) => n.toLowerCase().includes(query.trim().toLowerCase())).sort();
      },
      changeTarget: async (branch) => {
        this.snap.pullRequest.targetRefName = branchRef(branch);
      },
      cherryPick: async (onto, topic) => {
        if (!onto.trim() || !topic.trim()) throw new Error("Pick a target branch and name the new branch.");
      },
      // The same checks Azure DevOps makes before it merges.
      complete: async (options, headCommit) => {
        const pr = active("completed");
        const json = toCompletionOptionsJson(options, true);
        if (pr.isDraft) throw new Error("Publish the draft before completing it.");
        if (headCommit !== this.headCommit()) throw new Error("The source branch has new commits. Refresh the pull request and review them first.");
        if (pr.mergeStatus === 2) throw new Error("The pull request has merge conflicts.");
        const unmet = this.snap.policies.filter((p) => p.configuration.isBlocking && p.status !== "approved" && p.status !== "notApplicable");
        if (unmet.length && !json.bypassPolicy) throw new Error("Required policies have not passed. Set auto-complete, or override them with a reason.");
        // Like Azure DevOps, the merge runs in the background: the next read still sees it queued, the one after merged.
        Object.assign(pr, { completionQueueTime: new Date().toISOString(), completionOptions: json, autoCompleteSetBy: undefined });
        this.mergeReads = 1;
      },
      setAutoComplete: async (options) => {
        const pr = active("set to auto-complete");
        pr.autoCompleteSetBy = options ? this.currentUser : undefined;
        if (options) pr.completionOptions = toCompletionOptionsJson(options, false);
      },
      abandon: async () => {
        Object.assign(active("abandoned"), { status: PR_STATUS_NUMBER.abandoned, closedBy: this.currentUser, autoCompleteSetBy: undefined });
      },
      reactivate: async () => {
        const pr = this.snap.pullRequest;
        if (pr.status !== PR_STATUS_NUMBER.abandoned) throw new Error("Only an abandoned pull request can be reactivated.");
        Object.assign(pr, { status: PR_STATUS_NUMBER.active, closedBy: undefined });
      },
      setDraft: async (isDraft) => {
        active(isDraft ? "marked as a draft" : "published").isDraft = isDraft;
      },
      allowedMergeStrategies: async () => [...MERGE_STRATEGIES],
    };
  }

  /** Reads left before a queued merge finishes. */
  private mergeReads = 0;

  private headCommit(): string {
    return this.snap.pullRequest.lastMergeSourceCommit?.commitId ?? this.snap.iterations.at(-1)?.sourceRefCommit.commitId ?? "";
  }

  static async fetch(url: string, currentUser: Identity = MOCK_USER): Promise<MockPrSource> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load mock data ${url}: ${res.status}`);
    return new MockPrSource((await res.json()) as PrSnapshot, currentUser);
  }

  async load(): Promise<PrOverview> {
    const { pullRequest: p } = this.snap;
    if (p.completionQueueTime && p.status === PR_STATUS_NUMBER.active && this.mergeReads-- <= 0)
      Object.assign(p, { status: PR_STATUS_NUMBER.completed, closedBy: this.currentUser, completionQueueTime: undefined });
    return {
      pr: {
        id: p.pullRequestId,
        title: p.title,
        description: p.description,
        status: p.status === 2 ? "abandoned" : p.status === 3 ? "completed" : "active",
        isDraft: p.isDraft,
        createdBy: identity(p.createdBy),
        creationDate: new Date(p.creationDate),
        sourceBranch: p.sourceRefName.replace(/^refs\/heads\//, ""),
        targetBranch: p.targetRefName.replace(/^refs\/heads\//, ""),
        repository: {
          id: p.repository.id,
          name: p.repository.name,
          projectId: p.repository.project.id,
          projectName: p.repository.project.name,
        },
        reviewers: p.reviewers.map((r) => ({ ...identity(r), vote: asVote(r.vote), isRequired: r.isRequired })),
        labels: p.labels.filter((l) => l.active).map((l) => l.name),
        headCommit: this.headCommit(),
        mergeStatus: mergeStatusFromNumber(p.mergeStatus),
        autoCompleteSetBy: p.autoCompleteSetBy && identity(p.autoCompleteSetBy),
        completionOptions: fromCompletionOptionsJson(p.completionOptions),
        completionQueued: p.completionQueueTime ? new Date(p.completionQueueTime) : undefined,
        mergeFailure: p.mergeFailureMessage || undefined,
        closedBy: p.closedBy && identity(p.closedBy),
      },
      iterations: this.snap.iterations.map((it) => ({
        id: it.id,
        createdDate: new Date(it.createdDate),
        author: identity(it.author),
        description: it.description,
        headCommit: it.sourceRefCommit.commitId,
        baseCommit: it.commonRefCommit.commitId,
        commitIds: it.commits.map((c) => c.commitId),
      })),
      threads: this.snap.threads.map(thread),
      commits: this.snap.commits.map((c) => ({
        id: c.commitId,
        message: c.comment,
        authorName: c.author.name,
        authorEmail: c.author.email,
        date: new Date(c.author.date),
      })),
      policies: this.snap.policies.map((p) => ({
        id: p.evaluationId,
        name: p.configuration.type.displayName,
        detail: typeof p.configuration.settings.displayName === "string" ? p.configuration.settings.displayName : undefined,
        state: p.status as PolicyState,
        blocking: p.configuration.isBlocking,
      })),
      workItems: this.snap.workItems,
    };
  }

  async getChanges(iteration: number, compareTo: number): Promise<FileChange[]> {
    const before = this.snap.trees[String(compareTo)] ?? {};
    const after = this.snap.trees[String(iteration)] ?? {};
    const out: FileChange[] = [];
    const renamedFrom = compareTo === 0 ? this.snap.renames : {};
    const renameSources = new Set(Object.values(renamedFrom));
    for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const oldId = before[path];
      const newId = after[path];
      if (oldId === newId) continue;
      if (!newId && renameSources.has(path)) continue; // reported on the rename target
      const from = renamedFrom[path];
      if (from && newId) {
        out.push({ path: strip(path), originalPath: strip(from), changeType: "rename", oldObjectId: before[from], newObjectId: newId });
      } else if (!oldId) out.push({ path: strip(path), changeType: "add", newObjectId: newId });
      else if (!newId) out.push({ path: strip(path), changeType: "delete", oldObjectId: oldId });
      else out.push({ path: strip(path), changeType: "edit", oldObjectId: oldId, newObjectId: newId });
    }
    const paths = [...new Set(Object.values(this.snap.trees).flatMap((tree) => Object.keys(tree)))].sort();
    return out.sort((a, b) => a.path.localeCompare(b.path)).map((c) => ({ ...c, changeTrackingId: paths.indexOf(`/${c.path}`) + 1 }));
  }

  async getBlob(objectId: string): Promise<string> {
    const blob = this.snap.blobs[objectId];
    if (blob === undefined) throw new Error(`blob ${objectId} not in snapshot`);
    return blob;
  }

  async getThreads(iteration: number, compareTo: number): Promise<Thread[]> {
    return this.snap.threads
      .map(thread)
      .filter(
        (t) =>
          !t.file ||
          !t.iterationContext ||
          (t.iterationContext.firstComparingIteration === (compareTo || iteration) &&
            t.iterationContext.secondComparingIteration === iteration),
      );
  }
}

const strip = (p: string) => p.replace(/^\//, "");

function identity(i: IdentityJson): Identity {
  return { id: i.id, displayName: i.displayName, uniqueName: i.uniqueName, imageUrl: i.imageUrl };
}

function comment(c: CommentJson): Comment {
  return {
    id: c.id,
    parentId: c.parentCommentId,
    author: identity(c.author),
    content: c.content,
    published: new Date(c.publishedDate),
    isSystem: c.commentType === 3,
    likes: c.usersLiked.length,
  };
}

export function thread(t: ThreadJson): Thread {
  const type = t.properties.CodeReviewThreadType?.$value;
  const ctx = t.threadContext;
  const right = ctx?.rightFileStart;
  const pos = right ?? ctx?.leftFileStart;
  const end = right ? ctx?.rightFileEnd : ctx?.leftFileEnd;
  const comments = t.comments.map(comment);
  return {
    iterationContext: t.pullRequestThreadContext?.iterationContext,
    id: t.id,
    status: threadStatusFromNumber(t.status),
    published: new Date(t.publishedDate),
    updated: new Date(t.lastUpdatedDate),
    comments,
    file: !ctx?.filePath
      ? undefined
      : pos
        ? { path: strip(ctx.filePath), side: right ? "right" : "left", line: pos.line, endLine: end?.line ?? pos.line }
        : { path: strip(ctx.filePath) },
    kind: type === "VoteUpdate" ? "vote" : type || comments.every((c) => c.isSystem) ? "system" : "comment",
    vote: type === "VoteUpdate" ? asVote(Number(t.properties.CodeReviewVoteResult?.$value ?? 0)) : undefined,
  };
}
