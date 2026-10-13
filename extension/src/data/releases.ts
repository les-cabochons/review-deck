/**
 * The Changelog hub's model (see GLOSSARY.md): git tags that follow the project's tag convention, the
 * Changelog generated from the commits since each one's previous tag, and the Artifacts of the publishing
 * pipeline's latest run on the tag, which make it a Release.
 */

export interface Repository {
  id: string;
  name: string;
}

export interface GitTag {
  name: string;
  /** The tagged commit. */
  commitId: string;
  /** The annotated tag's object id, or null for a lightweight tag. */
  tagObjectId: string | null;
}

/** When and by whom a git tag was made, and its annotation: the tagger for annotated tags, else the commit. */
export interface GitTagDetails {
  date: Date | null;
  author: string | null;
  /** The annotated tag's message, or null for a lightweight tag. */
  message: string | null;
}

export interface Commit {
  id: string;
  /** The full commit message (Azure DevOps may truncate long ones). */
  message: string;
  author: string;
  date: Date | null;
  /** Number of parents, when the host reports them; merge commits (2+) are left out of the Changelog. */
  parents?: number;
}

export type RunResult = "succeeded" | "partiallySucceeded" | "failed" | "canceled" | "running";

/** A pipeline run on a git tag. */
export interface PipelineRun {
  id: number;
  pipeline: string;
  number: string;
  result: RunResult;
  finished: Date | null;
  url: string;
}

export interface ArtifactFile {
  /** Relative to the artifact, without a leading slash. */
  path: string;
  size: number | null;
  date: Date | null;
  downloadUrl: string;
  /** The file's text, for reading checksum files. */
  read(): Promise<string>;
}

export interface Artifact {
  name: string;
  size: number | null;
  zipUrl: string;
  /** Lists the files, or resolves to null when this artifact can't be listed (it's then offered as a zip only). */
  files(): Promise<ArtifactFile[] | null>;
}

/** One repository's tags, commits, runs and release descriptions. */
export interface ReleaseSource {
  readonly repository: Repository;
  tags(): Promise<GitTag[]>;
  tagDetails(tags: GitTag[]): Promise<Map<string, GitTagDetails>>;
  /** Commits reachable from `to` but not from `from` (every ancestor when `from` is null), newest first. */
  commits(from: GitTag | null, to: GitTag): Promise<Commit[]>;
  /** The latest run on the tag, of `pipelineId` or of any pipeline when null. */
  latestRun(tag: GitTag, pipelineId: number | null): Promise<PipelineRun | null>;
  artifacts(run: PipelineRun): Promise<Artifact[]>;
  description(tag: string): Promise<string | null>;
  saveDescription(tag: string, text: string): Promise<void>;
  commitUrl(id: string): string;
  pullRequestUrl(id: number): string;
  compareUrl(base: string, target: string): string;
}

export interface Pipeline {
  id: number;
  name: string;
}

/** Repositories and their pipelines, for the settings page, and each repository's tags. */
export interface ReleaseCatalog {
  repositories(): Promise<Repository[]>;
  pipelines(repositoryId: string): Promise<Pipeline[]>;
  source(repository: Repository): ReleaseSource;
}

// ---------- settings ----------

export interface RepoReleaseSettings {
  /** Overrides the project's tag convention. */
  tagConvention?: string;
  /** The publishing pipeline; any pipeline run on a tag counts when unset. */
  pipelineId?: number;
}

export interface ReleaseSettings {
  tagConvention: string;
  /** By repository id. */
  repos: Record<string, RepoReleaseSettings>;
}

export const DEFAULT_TAG_CONVENTION = "v*";
export const DEFAULT_RELEASE_SETTINGS: ReleaseSettings = { tagConvention: DEFAULT_TAG_CONVENTION, repos: {} };

export function readReleaseSettings(saved: unknown): ReleaseSettings {
  const s = (saved ?? {}) as { tagConvention?: unknown; repos?: unknown };
  const repos: Record<string, RepoReleaseSettings> = {};
  if (s.repos && typeof s.repos === "object") {
    for (const [id, value] of Object.entries(s.repos as Record<string, { tagConvention?: unknown; pipelineId?: unknown }>)) {
      const repo: RepoReleaseSettings = {};
      if (typeof value?.tagConvention === "string" && value.tagConvention.trim()) repo.tagConvention = value.tagConvention.trim();
      if (typeof value?.pipelineId === "number" && Number.isSafeInteger(value.pipelineId)) repo.pipelineId = value.pipelineId;
      if (repo.tagConvention || repo.pipelineId !== undefined) repos[id] = repo;
    }
  }
  const convention = typeof s.tagConvention === "string" && s.tagConvention.trim() ? s.tagConvention.trim() : DEFAULT_TAG_CONVENTION;
  return { tagConvention: convention, repos };
}

export function repoReleaseSettings(settings: ReleaseSettings, repositoryId: string): { tagConvention: string; pipelineId: number | null } {
  const repo = settings.repos[repositoryId];
  return { tagConvention: repo?.tagConvention ?? settings.tagConvention, pipelineId: repo?.pipelineId ?? null };
}

// ---------- tag convention and versions ----------

/** `*` matches any run of characters (slashes included), `?` one character. Case-sensitive, like git refs. */
export function matchesConvention(tag: string, pattern: string): boolean {
  const source = pattern
    .trim()
    .split("")
    .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`).test(tag);
}

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

/** The semver in a tag name, after any prefix (`v1.2.3`, `release/1.2.3-rc.1`), or null. */
export function parseVersion(tag: string): SemVer | null {
  const m = /^(?:.*?[^\d.])?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ? m[4].split(".") : [] };
}

/** Semver precedence: negative when a comes before b. */
export function compareVersions(a: SemVer, b: SemVer): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core) return core;
  if (!a.prerelease.length || !b.prerelease.length) return b.prerelease.length - a.prerelease.length;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * The tags that follow the convention, newest first: semver tags by version, then any others by name
 * (they have no version to order by).
 */
export function conventionTags<T extends { name: string }>(tags: T[], convention: string): T[] {
  const matching = tags.filter((t) => matchesConvention(t.name, convention));
  const versioned = matching.flatMap((t) => {
    const v = parseVersion(t.name);
    return v ? [{ t, v }] : [];
  });
  versioned.sort((a, b) => compareVersions(b.v, a.v) || b.t.name.localeCompare(a.t.name));
  const others = matching.filter((t) => !parseVersion(t.name)).sort((a, b) => b.name.localeCompare(a.name));
  return [...versioned.map((x) => x.t), ...others];
}

/**
 * The tag a Changelog starts from, in a list sorted by `conventionTags`: a stable version starts from the
 * previous stable version (so it covers its release candidates' changes), a prerelease from the tag just
 * before it. Tags without a version start from the next one down the list.
 */
export function previousTag<T extends { name: string }>(sorted: T[], tag: T): T | null {
  const index = sorted.indexOf(tag);
  if (index < 0) return null;
  const version = parseVersion(tag.name);
  const older = sorted.slice(index + 1);
  if (!version || version.prerelease.length) return older[0] ?? null;
  return older.find((t) => parseVersion(t.name)?.prerelease.length === 0) ?? null;
}

// ---------- changelog ----------

export interface ChangelogEntry {
  sha: string;
  type: string | null;
  scope: string | null;
  subject: string;
  breaking: boolean;
  author: string;
  /** The pull request a "Merged PR N: …" commit came from. */
  pullRequest: number | null;
}

export interface ChangelogSection {
  key: string;
  title: string;
  entries: ChangelogEntry[];
}

/** Conventional-commit types and their section, in display order. Anything else goes under "Other changes". */
const SECTIONS: { key: string; title: string; types: string[] }[] = [
  { key: "breaking", title: "⚠️ Breaking changes", types: [] },
  { key: "feat", title: "Features", types: ["feat", "feature"] },
  { key: "fix", title: "Bug fixes", types: ["fix"] },
  { key: "perf", title: "Performance", types: ["perf"] },
  { key: "refactor", title: "Refactoring", types: ["refactor"] },
  { key: "docs", title: "Documentation", types: ["docs", "doc"] },
  { key: "test", title: "Tests", types: ["test", "tests"] },
  { key: "build", title: "Build & CI", types: ["build", "ci"] },
  { key: "chore", title: "Chores", types: ["chore"] },
  { key: "other", title: "Other changes", types: [] },
];

/** Parses one commit; the subject is the message's first line, without Azure DevOps' "Merged PR N: " prefix. */
export function parseCommit(commit: Commit): ChangelogEntry {
  const [first = "", ...rest] = commit.message.split(/\r?\n/);
  let subject = first.trim();
  let pullRequest: number | null = null;
  const merged = /^Merged PR (\d+):\s*/.exec(subject);
  if (merged) {
    pullRequest = Number(merged[1]);
    subject = subject.slice(merged[0].length);
  }
  const conventional = /^([A-Za-z]+)(?:\(([^)]*)\))?(!)?:\s+(.+)$/.exec(subject);
  const footerBreaking = rest.some((line) => /^BREAKING[ -]CHANGE:/.test(line));
  if (!conventional) return { sha: commit.id, type: null, scope: null, subject, breaking: footerBreaking, author: commit.author, pullRequest };
  return {
    sha: commit.id,
    type: conventional[1].toLowerCase(),
    scope: conventional[2]?.trim() || null,
    subject: conventional[4].trim(),
    breaking: !!conventional[3] || footerBreaking,
    author: commit.author,
    pullRequest,
  };
}

/** Groups commits (newest first) into sections in display order, leaving out merge commits and empty sections. */
export function buildChangelog(commits: Commit[]): ChangelogSection[] {
  const sections = SECTIONS.map((s) => ({ key: s.key, title: s.title, entries: [] as ChangelogEntry[] }));
  const byKey = new Map(sections.map((s) => [s.key, s]));
  for (const commit of commits) {
    if ((commit.parents ?? 1) > 1) continue;
    const entry = parseCommit(commit);
    const key = entry.breaking ? "breaking" : (SECTIONS.find((s) => entry.type && s.types.includes(entry.type))?.key ?? "other");
    byKey.get(key)!.entries.push(entry);
  }
  return sections.filter((s) => s.entries.length);
}

// ---------- releases ----------

/** A run that finished well enough to publish: succeeded, or partially succeeded (some steps failed or were skipped). */
export const runSucceeded = (run: PipelineRun | null): run is PipelineRun => run?.result === "succeeded" || run?.result === "partiallySucceeded";

/** A git tag is a Release when its latest publishing pipeline run succeeded and produced Artifacts. */
export function isRelease(run: PipelineRun | null, artifactCount: number): boolean {
  return runSucceeded(run) && artifactCount > 0;
}

// ---------- checksums ----------

const CHECKSUM_FILE = /(^|\/)(SHA256SUMS(\.txt)?|[^/]+\.sha256)$/i;

export const isChecksumFile = (path: string) => CHECKSUM_FILE.test(path);

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * sha256 digests by file name, from a `SHA256SUMS`-style file (`<hex>  [*]name` per line) or a
 * `<name>.sha256` sidecar, which may hold just the digest.
 */
export function parseChecksums(path: string, text: string): Map<string, string> {
  const digests = new Map<string, string>();
  const sidecarOf = /\.sha256$/i.test(path) ? baseName(path).replace(/\.sha256$/i, "") : null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([0-9a-fA-F]{64})(?:\s+\*?(.+?))?\s*$/.exec(line);
    if (!m) continue;
    const name = m[2] ? baseName(m[2].replace(/\\/g, "/")) : sidecarOf;
    if (name) digests.set(name, m[1].toLowerCase());
  }
  return digests;
}

/** Reads every checksum file in the list, and returns digests by file name (empty when there are none). */
export async function readChecksums(files: ArtifactFile[]): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  await Promise.all(
    files
      .filter((f) => isChecksumFile(f.path))
      .map(async (f) => {
        try {
          for (const [name, digest] of parseChecksums(f.path, await f.read())) digests.set(name, digest);
        } catch (e) {
          console.warn(`[semantic-pr] could not read ${f.path}:`, e);
        }
      }),
  );
  return digests;
}

/**
 * A file's digest from the checksum maps in order of preference: its own artifact's first, then the others' (one
 * SHA256SUMS often covers every artifact of a run), so a same-named file in another artifact can't shadow its own.
 */
export const digestFor = (maps: Map<string, string>[], path: string) => {
  for (const digests of maps) {
    const digest = digests.get(baseName(path));
    if (digest) return digest;
  }
  return null;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** An extension data document id (at most 50 characters) for a tag's release description. */
export function descriptionDocumentId(tag: string): string {
  if (/^[A-Za-z0-9._-]{1,50}$/.test(tag)) return tag;
  let hash = 0x811c9dc5;
  for (const ch of tag) hash = Math.imul(hash ^ ch.codePointAt(0)!, 0x01000193);
  const safe = tag.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  return `${safe}~${(hash >>> 0).toString(16)}`;
}
