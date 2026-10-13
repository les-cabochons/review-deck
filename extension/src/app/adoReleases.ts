import { getClient } from "azure-devops-extension-api";
import { type Build, BuildQueryOrder, BuildRestClient, BuildResult, BuildStatus } from "azure-devops-extension-api/Build";
import type { IExtensionDataManager } from "azure-devops-extension-api/Common";
import { ContainerItemType, FileContainerRestClient } from "azure-devops-extension-api/FileContainer";
import { type GitCommitRef, GitRestClient, GitVersionType } from "azure-devops-extension-api/Git";
import {
  type Artifact,
  type ArtifactFile,
  type Commit,
  descriptionDocumentId,
  type GitTag,
  type GitTagDetails,
  type PipelineRun,
  type ReleaseCatalog,
  type ReleaseSource,
  type Repository,
  type RunResult,
} from "../data/releases";

/** Most commits a Changelog reads; older ones are left out. */
const MAX_COMMITS = 1000;
/** Parallel requests when reading annotated tags. */
const TAG_CONCURRENCY = 8;

interface Context {
  hostUrl: string;
  projectId: string;
  projectName: string;
  token: () => Promise<string>;
  data: () => Promise<IExtensionDataManager>;
}

/** Git tags, pipeline runs and artifacts through the Azure DevOps REST API; release descriptions in extension data. */
export class AdoReleaseCatalog implements ReleaseCatalog {
  private readonly git = getClient(GitRestClient);
  private readonly build = getClient(BuildRestClient);

  constructor(private readonly context: Context) {}

  async repositories(): Promise<Repository[]> {
    const repos = await this.git.getRepositories(this.context.projectId);
    return repos
      .filter((r) => !r.isDisabled)
      .map((r) => ({ id: r.id, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async pipelines(repositoryId: string) {
    const definitions = await this.build.getDefinitions(this.context.projectId, undefined, repositoryId, "TfsGit");
    return definitions.map((d) => ({ id: d.id, name: d.path && d.path !== "\\" ? `${d.path.replace(/^\\/, "")}\\${d.name}` : d.name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  source(repository: Repository): ReleaseSource {
    return new AdoReleaseSource(this.context, repository, this.git, this.build);
  }
}

class AdoReleaseSource implements ReleaseSource {
  private readonly containers = getClient(FileContainerRestClient);
  private readonly repoUrl: string;

  constructor(
    private readonly context: Context,
    readonly repository: Repository,
    private readonly git: GitRestClient,
    private readonly build: BuildRestClient,
  ) {
    this.repoUrl = `${context.hostUrl}${encodeURIComponent(context.projectName)}/_git/${encodeURIComponent(repository.name)}`;
  }

  async tags(): Promise<GitTag[]> {
    // peelTags: an annotated tag's ref points at the tag object; peeledObjectId is its commit.
    const refs = await this.git.getRefs(this.repository.id, this.context.projectId, "tags/", false, false, false, false, true);
    return refs.map((r) => ({
      name: r.name.replace(/^refs\/tags\//, ""),
      commitId: r.peeledObjectId || r.objectId,
      tagObjectId: r.peeledObjectId ? r.objectId : null,
    }));
  }

  async tagDetails(tags: GitTag[]): Promise<Map<string, GitTagDetails>> {
    const details = new Map<string, GitTagDetails>();
    const lightweight = tags.filter((t) => !t.tagObjectId);
    const annotated = tags.filter((t) => t.tagObjectId);
    const commits = lightweight.length
      ? this.git.getCommitsBatch({ ids: lightweight.map((t) => t.commitId) } as never, this.repository.id, this.context.projectId)
      : Promise.resolve([] as GitCommitRef[]);
    const queue = [...annotated];
    const workers = Array.from({ length: Math.min(TAG_CONCURRENCY, queue.length) }, async () => {
      for (let tag = queue.shift(); tag; tag = queue.shift()) {
        try {
          const a = await this.git.getAnnotatedTag(this.context.projectId, this.repository.id, tag.tagObjectId!);
          details.set(tag.name, { date: a.taggedBy?.date ? new Date(a.taggedBy.date) : null, author: a.taggedBy?.name ?? null, message: a.message?.trim() || null });
        } catch (e) {
          console.warn(`[semantic-pr] annotated tag ${tag.name} unavailable:`, e);
        }
      }
    });
    const [refs] = await Promise.all([commits, ...workers]);
    const byId = new Map(refs.map((c) => [c.commitId, c]));
    for (const tag of lightweight) {
      const c = byId.get(tag.commitId);
      details.set(tag.name, { date: c?.author?.date ? new Date(c.author.date) : null, author: c?.author?.name ?? null, message: null });
    }
    return details;
  }

  async commits(from: GitTag | null, to: GitTag): Promise<Commit[]> {
    const version = (tag: GitTag) => ({ version: tag.name, versionType: GitVersionType.Tag, versionOptions: 0 });
    // Meant as: itemVersion the base, compareVersion the target, giving what the target has that the base doesn't.
    // The API's documentation doesn't say which way round it is; check against a real repository.
    const criteria = from ? { itemVersion: version(from), compareVersion: version(to) } : { itemVersion: version(to) };
    const refs = await this.git.getCommitsBatch(criteria as never, this.repository.id, this.context.projectId, 0, MAX_COMMITS);
    return refs.map((c) => ({
      id: c.commitId,
      message: c.comment ?? "",
      author: c.author?.name ?? "",
      date: c.author?.date ? new Date(c.author.date) : null,
      parents: c.parents?.length,
    }));
  }

  async latestRun(tag: GitTag, pipelineId: number | null): Promise<PipelineRun | null> {
    const builds = await this.build.getBuilds(
      this.context.projectId,
      pipelineId === null ? undefined : [pipelineId],
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      1, // top
      undefined, undefined, undefined,
      BuildQueryOrder.QueueTimeDescending,
      `refs/tags/${tag.name}`,
      undefined,
      this.repository.id,
      "TfsGit",
    );
    const build = builds[0];
    return build ? toRun(build) : null;
  }

  async artifacts(run: PipelineRun): Promise<Artifact[]> {
    const artifacts = await this.build.getArtifacts(this.context.projectId, run.id);
    return artifacts.map((a) => {
      const size = Number(a.resource?.properties?.artifactsize);
      return {
        name: a.name,
        size: Number.isFinite(size) && size > 0 ? size : null,
        zipUrl: a.resource?.downloadUrl ?? "",
        files: () => this.files(run.id, a.name, a.resource?.type ?? "", a.resource?.data ?? "").catch((e) => {
          console.warn(`[semantic-pr] could not list the files of ${a.name}:`, e);
          return null;
        }),
      };
    });
  }

  /** Lists an artifact's files: build artifacts through their file container, pipeline artifacts through their manifest. */
  private async files(buildId: number, name: string, type: string, data: string): Promise<ArtifactFile[] | null> {
    if (type.toLowerCase() === "container") {
      // data is "#/<containerId>/<rootPath>".
      const m = /^#\/(\d+)\/(.+)$/.exec(data);
      if (!m) return null;
      const root = m[2];
      const items = await this.containers.getItems(Number(m[1]), this.context.projectId, root);
      return items
        .filter((i) => i.itemType === ContainerItemType.File)
        .map((i) => ({
          path: i.path.startsWith(`${root}/`) ? i.path.slice(root.length + 1) : i.path,
          size: i.fileLength ?? null,
          date: i.dateLastModified ? new Date(i.dateLastModified) : null,
          downloadUrl: i.contentLocation,
          read: () => this.fetchText(i.contentLocation),
        }));
    }
    if (type === "PipelineArtifact") {
      // Not a documented listing: the artifact's manifest, read through the documented "get file" endpoint.
      const manifest = JSON.parse(new TextDecoder().decode(await this.build.getFile(this.context.projectId, buildId, name, data, "manifest.json"))) as {
        items?: { path: string; blob?: { id: string; size?: number } }[];
        manifestReferences?: unknown[];
      };
      // A large artifact's manifest is split across several: offer the zip instead of a partial list.
      if (manifest.manifestReferences?.length || !manifest.items) return null;
      return manifest.items
        .filter((i) => i.blob?.id)
        .map((i) => {
          const path = i.path.replace(/^\//, "");
          const fileName = path.slice(path.lastIndexOf("/") + 1);
          const query = new URLSearchParams({ artifactName: name, fileId: i.blob!.id, fileName, "api-version": "7.1" });
          return {
            path,
            size: i.blob!.size ?? null,
            date: null,
            downloadUrl: `${this.context.hostUrl}${this.context.projectId}/_apis/build/builds/${buildId}/artifacts?${query}`,
            read: async () => new TextDecoder().decode(await this.build.getFile(this.context.projectId, buildId, name, i.blob!.id, fileName)),
          };
        });
    }
    return null;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url, { headers: { authorization: `Bearer ${await this.context.token()}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  /** One collection per repository: repository ids are unique in the organization, and document ids are limited to 50 characters. */
  private get descriptions() {
    return `release-descriptions-${this.repository.id}`;
  }

  async description(tag: string): Promise<string | null> {
    try {
      const doc = (await (await this.context.data()).getDocument(this.descriptions, descriptionDocumentId(tag))) as { tag?: string; text?: string };
      return doc.tag === tag && typeof doc.text === "string" ? doc.text : null;
    } catch (e) {
      // Never written: 404.
      if ((e as { status?: number }).status !== 404) console.warn("[semantic-pr] release description unavailable:", e);
      return null;
    }
  }

  async saveDescription(tag: string, text: string): Promise<void> {
    const data = await this.context.data();
    const id = descriptionDocumentId(tag);
    if (text.trim()) await data.setDocument(this.descriptions, { id, __etag: -1, tag, text });
    else
      await data.deleteDocument(this.descriptions, id).catch((e: { status?: number }) => {
        if (e.status !== 404) throw e;
      });
  }

  commitUrl(id: string): string {
    return `${this.repoUrl}/commit/${id}`;
  }

  pullRequestUrl(id: number): string {
    return `${this.repoUrl}/pullrequest/${id}`;
  }

  compareUrl(base: string, target: string): string {
    return `${this.repoUrl}/branchCompare?${new URLSearchParams({ baseVersion: `GT${base}`, targetVersion: `GT${target}` })}`;
  }
}

function toRun(build: Build): PipelineRun {
  const result: RunResult =
    build.status !== BuildStatus.Completed
      ? "running"
      : build.result === BuildResult.Succeeded
        ? "succeeded"
        : build.result === BuildResult.PartiallySucceeded
          ? "partiallySucceeded"
          : build.result === BuildResult.Canceled
            ? "canceled"
            : "failed";
  return {
    id: build.id,
    pipeline: build.definition?.name ?? "Pipeline",
    number: build.buildNumber,
    result,
    finished: build.finishTime ? new Date(build.finishTime) : null,
    url: build._links?.web?.href ?? "",
  };
}
