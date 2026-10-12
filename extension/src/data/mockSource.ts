import {
  asVote,
  type Comment,
  type FileChange,
  type Identity,
  type PolicyState,
  type PrOverview,
  type PrSource,
  type Thread,
  threadStatusFromNumber,
} from "./model";
import type { CommentJson, IdentityJson, PrSnapshot, ThreadJson } from "./snapshot";

/** Serves a PrSnapshot JSON (built by scripts/build-ado-mock.ts) for local development. */
export class MockPrSource implements PrSource {
  readonly kind = "mock";

  private constructor(private readonly snap: PrSnapshot) {}

  static async fetch(url: string): Promise<MockPrSource> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load mock data ${url}: ${res.status}`);
    return new MockPrSource((await res.json()) as PrSnapshot);
  }

  async load(): Promise<PrOverview> {
    const { pullRequest: p } = this.snap;
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
        repository: { id: p.repository.id, name: p.repository.name, projectId: p.repository.project.id, projectName: p.repository.project.name },
        reviewers: p.reviewers.map((r) => ({ ...identity(r), vote: asVote(r.vote), isRequired: r.isRequired })),
        labels: p.labels.filter((l) => l.active).map((l) => l.name),
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
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async getBlob(objectId: string): Promise<string> {
    const blob = this.snap.blobs[objectId];
    if (blob === undefined) throw new Error(`blob ${objectId} not in snapshot`);
    return blob;
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
    id: t.id,
    status: threadStatusFromNumber(t.status),
    published: new Date(t.publishedDate),
    updated: new Date(t.lastUpdatedDate),
    comments,
    file: ctx && pos ? { path: strip(ctx.filePath), side: right ? "right" : "left", line: pos.line, endLine: end?.line ?? pos.line } : undefined,
    kind: type === "VoteUpdate" ? "vote" : type || comments.every((c) => c.isSystem) ? "system" : "comment",
    vote: type === "VoteUpdate" ? asVote(Number(t.properties.CodeReviewVoteResult?.$value ?? 0)) : undefined,
  };
}
