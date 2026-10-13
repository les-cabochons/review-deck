import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import type { AppHost } from "../../app/host";
import {
  type Artifact,
  type ArtifactFile,
  buildChangelog,
  type ChangelogSection,
  conventionTags,
  digestFor,
  formatBytes,
  type GitTag,
  type GitTagDetails,
  isRelease,
  parseVersion,
  type PipelineRun,
  previousTag,
  readChecksums,
  type ReleaseCatalog,
  type ReleaseSource,
  repoReleaseSettings,
  type Repository,
  runSucceeded,
} from "../../data/releases";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { readPreference, writePreference } from "../preferences";
import { cx, Markdown, plural, Time } from "../util";

type View = "releases" | "tags";

/** The Releases | Tags switch, and how each view words its list. */
const VIEWS: Record<View, { text: string; icon: string; noun: string; list: string; find: string; none: string }> = {
  releases: {
    text: "Releases",
    icon: "Package",
    noun: "releases",
    list: "Release list",
    find: "Find a release",
    none: "No releases yet: no tag's latest publishing pipeline run succeeded with artifacts. Switch to Tags to see every tag.",
  },
  tags: { text: "Tags", icon: "Tag", noun: "tags", list: "Tag list", find: "Find a tag", none: "No tags." },
};

const readView = (): View => (readPreference<string>("changelog.view", "releases") === "tags" ? "tags" : "releases");

/** Git tags resolved so far: when and by whom, and their latest publishing pipeline run. */
interface TagInfo {
  tag: GitTag;
  details: GitTagDetails | null;
  run: PipelineRun | null;
  artifacts: Artifact[];
  release: boolean;
}

/** Tags resolved per round, and per page of the Release list. */
const CHUNK = 12;
const PAGE = 10;
/** Artifact groups start expanded up to this many. */
const EXPAND_ARTIFACTS = 3;

/**
 * Repos → Changelog (contribution "changelog-hub", dist/changelog.html): the repository's git tags that follow
 * the tag convention, each with its generated Changelog, and the Releases among them with their Artifacts.
 */
export const ChangelogPage: React.FC<{ host: AppHost }> = ({ host }) => {
  const [catalog, setCatalog] = React.useState<ReleaseCatalog | null>(null);
  /** The repository picked in Azure DevOps' own repository picker, above the page. */
  const [repo, setRepo] = React.useState<Repository | null>(null);
  const [settings, setSettings] = React.useState<ReturnType<typeof repoReleaseSettings> | null>(null);
  const [view, setView] = React.useState<View>(readView);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    host.setTitle("Changelog");
    let cancelled = false;
    host.releases().then(
      (c) => !cancelled && setCatalog(c),
      (e: Error) => !cancelled && setError(`Couldn't load the changelog: ${e.message}`),
    );
    host
      .currentRepository()
      .catch(() => null)
      .then((current) => {
        if (cancelled) return;
        if (current) setRepo(current);
        // E.g. a TFVC repository is selected: it has no git tags.
        else setError("Pick a Git repository in the repository picker above to see its changelog.");
      });
    return () => {
      cancelled = true;
    };
  }, [host]);

  React.useEffect(() => {
    if (!repo) return;
    let cancelled = false;
    host.projectSettings().then((s) => !cancelled && setSettings(repoReleaseSettings(s.releases, repo.id)));
    return () => {
      cancelled = true;
    };
  }, [host, repo]);

  const source = React.useMemo(() => repo && catalog && catalog.source(repo), [catalog, repo]);

  return (
    <div className="changelog-page">
      <header className="changelog-header">
        {/* Like GitHub's Releases | Tags switch; Azure DevOps already names the page in its breadcrumb. */}
        <div className="changelog-views" role="tablist" aria-label="Show">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={cx(view === v && "selected")}
              onClick={() => {
                writePreference("changelog.view", v);
                setView(v);
              }}
            >
              <Icon iconName={VIEWS[v].icon} />
              {VIEWS[v].text}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <div className="search-box changelog-search">
          <Icon iconName="Search" />
          <input
            type="search"
            placeholder={VIEWS[view].find}
            aria-label={VIEWS[view].find}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {source && settings && <TagList key={source.repository.id} source={source} convention={settings.tagConvention} pipelineId={settings.pipelineId} view={view} query={query} />}
      {!error && !(source && settings) && <div className="loading">Loading…</div>}
    </div>
  );
};

const TagList: React.FC<{ source: ReleaseSource; convention: string; pipelineId: number | null; view: View; query: string }> = ({
  source,
  convention,
  pipelineId,
  view,
  query,
}) => {
  const [sorted, setSorted] = React.useState<GitTag[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** The Release list's page, and the tag shown (the newest when unset or filtered out); paging doesn't change it. */
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);
  React.useEffect(() => setPage(0), [view, query]);
  // Tags resolved so far by name, kept while the search changes; `resolvedCount` re-renders when it grows.
  const cache = React.useRef(new Map<string, TagInfo>());
  const [, setResolvedCount] = React.useState(0);
  const alive = React.useRef(true);
  React.useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  React.useEffect(() => {
    source.tags().then(
      (tags) => alive.current && setSorted(conventionTags(tags, convention)),
      (e: Error) => alive.current && setError(`Couldn't read the tags: ${e.message}`),
    );
  }, [source, convention]);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const candidates = React.useMemo(() => sorted?.filter((t) => terms.every((term) => t.name.toLowerCase().includes(term))) ?? null, [sorted, terms.join(" ")]);
  const shows = (i: TagInfo) => view === "tags" || i.release;
  /** The candidates resolved so far, in order: cards only show for an unbroken run from the newest. */
  const resolvedPrefix = (list: GitTag[]) => {
    const prefix: TagInfo[] = [];
    for (const tag of list) {
      const info = cache.current.get(tag.name);
      if (!info) break;
      prefix.push(info);
    }
    return prefix;
  };
  const infos = candidates ? resolvedPrefix(candidates) : [];
  const visible = infos.filter(shows);

  /** Resolves matching tags in order, a chunk at a time, until PAGE more of them show in this view or none are left. */
  const loadMore = React.useCallback(async () => {
    if (!candidates || loading) return;
    setLoading(true);
    setError(null);
    try {
      const target = resolvedPrefix(candidates).filter(shows).length + PAGE;
      for (;;) {
        const prefix = resolvedPrefix(candidates);
        if (prefix.length >= candidates.length || prefix.filter(shows).length >= target) break;
        const chunk = candidates.slice(prefix.length).filter((t) => !cache.current.has(t.name)).slice(0, CHUNK);
        const [details, runs] = await Promise.all([
          source.tagDetails(chunk).catch((e) => (console.warn("[semantic-pr] tag details unavailable:", e), new Map<string, GitTagDetails>())),
          Promise.all(
            chunk.map(async (tag) => {
              const run = await source.latestRun(tag, pipelineId).catch((e) => (console.warn(`[semantic-pr] runs for ${tag.name} unavailable:`, e), null));
              const artifacts = runSucceeded(run) ? await source.artifacts(run).catch(() => [] as Artifact[]) : [];
              return { run, artifacts };
            }),
          ),
        ]);
        chunk.forEach((tag, i) =>
          cache.current.set(tag.name, { tag, details: details.get(tag.name) ?? null, ...runs[i], release: isRelease(runs[i].run, runs[i].artifacts.length) }),
        );
        if (!alive.current) return;
        setResolvedCount(cache.current.size);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [candidates, loading, view, source, pipelineId]);

  const done = !candidates || infos.length >= candidates.length;
  // The first page, and again when the view or the search leaves fewer cards than a page so far.
  React.useEffect(() => {
    if (candidates && !loading && !error && visible.length < PAGE && !done) void loadMore();
  }, [candidates, view, loading]);

  const retry = (
    <button type="button" className="link-button" onClick={() => (sorted ? void loadMore() : location.reload())}>
      Try again
    </button>
  );
  if (error && !infos.length)
    return (
      <div className="error-box" role="alert">
        {error} {retry}
      </div>
    );
  if (!sorted) return <div className="loading">Loading tags…</div>;
  if (!sorted.length)
    return (
      <div className="changelog-empty muted">
        No git tags in <b>{source.repository.name}</b> follow the tag convention <code>{convention}</code>. Project administrators can change it in
        Project settings → Review Deck.
      </div>
    );

  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const current = Math.min(page, pages - 1);
  const listed = visible.slice(current * PAGE, current * PAGE + PAGE);
  const shown = visible.find((i) => i.tag.name === selected) ?? visible[0] ?? null;
  const canNext = current < pages - 1 || !done;
  const next = async () => {
    // The next page may not be resolved yet: fetch until it has a page of cards or the tags run out.
    if (current >= pages - 1) await loadMore();
    setPage(current + 1);
  };

  if (visible.length === 0 && done && !loading)
    return (
      <div className="changelog-empty muted">
        {terms.length
          ? `No ${VIEWS[view].noun} match "${query.trim()}".`
          : VIEWS[view].none}
      </div>
    );

  return (
    <div className="tag-explorer">
      <nav className="tag-list" aria-labelledby="tag-list-title">
        <h2 id="tag-list-title">{VIEWS[view].list}</h2>
        <ol>
          {listed.map((info) => (
            <li key={info.tag.name}>
              <button
                type="button"
                className={cx("tag-list-item", info === shown && "selected")}
                aria-current={info === shown ? "true" : undefined}
                title={info.tag.name}
                onClick={() => setSelected(info.tag.name)}
              >
                {info.tag.name}
              </button>
            </li>
          ))}
        </ol>
        {loading && <p className="loading tag-list-loading">Loading…</p>}
        {error && (
          <p className="tone-warning" role="alert">
            {error} {retry}
          </p>
        )}
        {(pages > 1 || canNext) && (
          <div className="tag-list-pages">
            <button type="button" className="link-button" disabled={current === 0 || loading} onClick={() => setPage(current - 1)}>
              <Icon iconName="ChevronLeft" /> Previous
            </button>
            <button type="button" className="link-button" disabled={!canNext || loading} onClick={() => void next()}>
              Next <Icon iconName="ChevronRight" />
            </button>
          </div>
        )}
      </nav>
      <main className="tag-explorer-main">{shown ? <TagView key={shown.tag.name} info={shown} sorted={sorted} source={source} /> : <div className="loading">Loading tags…</div>}</main>
    </div>
  );
};

/** The selected tag: its badges, description, Changelog and, for a Release, its Artifacts. */
const TagView: React.FC<{ info: TagInfo; sorted: GitTag[]; source: ReleaseSource }> = ({ info, sorted, source }) => {
  const { tag, details, run, release } = info;
  return (
    <article className="tag-card" aria-labelledby="tag-view-name">
      <header className="tag-card-head">
        <h2 className="tag-name" id="tag-view-name">
          {tag.name}
        </h2>
        <TagBadge info={info} />
        <span className="spacer" />
        <span className="tag-meta muted">
          {details?.author && <span>{details.author}</span>}
          {details?.date && <Time date={details.date} />}
        </span>
      </header>
      <div className="tag-card-body">
        <Description source={source} tag={tag.name} message={details?.message ?? null} />
        <Changelog source={source} tag={tag} previous={previousTag(sorted, tag)} />
        {release && run && <Artifacts run={run} artifacts={info.artifacts} />}
      </div>
    </article>
  );
};

const TagBadge: React.FC<{ info: TagInfo }> = ({ info: { tag, run, release } }) => {
  if (release) return <span className="tag-badge release">{parseVersion(tag.name)?.prerelease.length ? "Pre-release" : "Release"}</span>;
  if (run?.result === "failed") return <span className="tag-badge failed">Run failed</span>;
  if (run?.result === "canceled") return <span className="tag-badge neutral">Run canceled</span>;
  if (run?.result === "running") return <span className="tag-badge neutral">Running</span>;
  return null;
};

/** The release description: written in the hub, or else the annotated tag's message. */
const Description: React.FC<{ source: ReleaseSource; tag: string; message: string | null }> = ({ source, tag, message }) => {
  const [saved, setSaved] = React.useState<string | null | undefined>(undefined);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    source.description(tag).then((text) => !cancelled && setSaved(text));
    return () => {
      cancelled = true;
    };
  }, [source, tag]);

  if (saved === undefined) return null;
  const text = saved ?? message ?? "";

  if (draft !== null) {
    const save = () => {
      setSaving(true);
      setError(null);
      source.saveDescription(tag, draft).then(
        () => {
          setSaved(draft.trim() ? draft : null);
          setDraft(null);
          setSaving(false);
        },
        (e: Error) => {
          setError(`Couldn't save: ${e.message}`);
          setSaving(false);
        },
      );
    };
    return (
      <section className="tag-description editing">
        <MarkdownEditor value={draft} onChange={setDraft} label="Release description" placeholder="Describe this release" autoFocus minRows={4} disabled={saving} onSubmit={save} onCancel={() => setDraft(null)} />
        {error && (
          <p className="tone-warning" role="alert">
            {error}
          </p>
        )}
        <div className="tag-description-actions">
          <Button text="Cancel" onClick={() => setDraft(null)} disabled={saving} />
          <Button primary text={saving ? "Saving…" : "Save"} onClick={save} disabled={saving} />
        </div>
      </section>
    );
  }
  return (
    <section className="tag-description">
      {text.trim() ? <Markdown text={text} /> : <p className="muted">No description.</p>}
      <Button subtle className="tag-description-edit" iconProps={{ iconName: "Edit" }} text={text.trim() ? "Edit description" : "Add a description"} onClick={() => setDraft(text)} />
    </section>
  );
};

const Changelog: React.FC<{ source: ReleaseSource; tag: GitTag; previous: GitTag | null }> = ({ source, tag, previous }) => {
  const [sections, setSections] = React.useState<ChangelogSection[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    source.commits(previous, tag).then(
      (commits) => !cancelled && setSections(buildChangelog(commits)),
      (e: Error) => !cancelled && setError(`Couldn't read the commits: ${e.message}`),
    );
    return () => {
      cancelled = true;
    };
  }, [source, tag, previous]);

  if (error)
    return (
      <p className="tone-warning" role="alert">
        {error}
      </p>
    );
  if (!sections) return <div className="loading">Loading changelog…</div>;
  return (
    <section className="changelog">
      {!sections.length && <p className="muted">No changes since {previous?.name ?? "the first commit"}.</p>}
      {sections.map((s) => (
        <div key={s.key} className={cx("changelog-section", `changelog-${s.key}`)}>
          <h3>{s.title}</h3>
          <ul>
            {s.entries.map((e) => (
              <li key={e.sha}>
                {e.scope && <b>{e.scope}: </b>}
                {e.breaking && s.key !== "breaking" ? "⚠️ " : ""}
                {e.subject}
                <span className="muted">
                  {" "}
                  by {e.author} in{" "}
                  <a href={source.commitUrl(e.sha)} target="_top" className="changelog-sha">
                    {e.sha.slice(0, 7)}
                  </a>
                  {e.pullRequest !== null && (
                    <>
                      {" "}
                      <a href={source.pullRequestUrl(e.pullRequest)} target="_top">
                        !{e.pullRequest}
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {previous && (
        <p className="changelog-full">
          <b>Full changelog:</b>{" "}
          <a href={source.compareUrl(previous.name, tag.name)} target="_top">
            {previous.name}…{tag.name}
          </a>
        </p>
      )}
    </section>
  );
};

/** The latest publishing pipeline run's Artifacts, each a group of files with a zip of the whole. */
const Artifacts: React.FC<{ run: PipelineRun; artifacts: Artifact[] }> = ({ run, artifacts }) => {
  const [files, setFiles] = React.useState<(ArtifactFile[] | null)[] | null>(null);
  /** Checksums read from each artifact's own checksum files, by artifact; a file looks in its own artifact's first. */
  const [digests, setDigests] = React.useState<Map<string, string>[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    Promise.all(artifacts.map((a) => a.files())).then(async (lists) => {
      if (cancelled) return;
      setFiles(lists);
      const sums = await Promise.all(lists.map((l) => readChecksums(l ?? [])));
      if (!cancelled) setDigests(sums);
    });
    return () => {
      cancelled = true;
    };
  }, [artifacts]);

  const fileCount = files?.reduce((n, l) => n + (l?.length ?? 0), 0) ?? 0;
  return (
    <section className="artifacts">
      <h3>
        Artifacts <span className="count-pill">{artifacts.length}</span>
        {fileCount > 0 && <span className="muted artifacts-files"> · {plural(fileCount, "file")}</span>}
      </h3>
      <p className="artifacts-run muted">
        From{" "}
        <a href={run.url} target="_top">
          {run.pipeline} #{run.number}
        </a>
        {run.result === "partiallySucceeded" ? <span className="tone-warning"> · partially succeeded</span> : <span className="tone-success"> · succeeded</span>}
        {run.finished && (
          <>
            , finished <Time date={run.finished} />
          </>
        )}
      </p>
      <ul className="artifact-groups">
        {artifacts.map((a, i) => (
          <ArtifactGroup
            key={a.name}
            artifact={a}
            files={files ? files[i] : undefined}
            digests={[digests[i] ?? new Map(), ...digests.filter((_, j) => j !== i)]}
            defaultExpanded={artifacts.length <= EXPAND_ARTIFACTS}
          />
        ))}
      </ul>
    </section>
  );
};

const ArtifactGroup: React.FC<{
  artifact: Artifact;
  /** undefined while loading, null when the artifact can't be listed. */
  files: ArtifactFile[] | null | undefined;
  /** Checksum maps in order of preference: this artifact's, then the run's other artifacts'. */
  digests: Map<string, string>[];
  defaultExpanded: boolean;
}> = ({ artifact, files, digests, defaultExpanded }) => {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const listable = files !== null;
  return (
    <li className="artifact-group">
      <div className="artifact-head">
        {listable ? (
          <button type="button" className="artifact-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            <Icon iconName={expanded ? "ChevronDown" : "ChevronRight"} />
            <span className="artifact-name">{artifact.name}</span>
          </button>
        ) : (
          <span className="artifact-toggle">
            <Icon iconName="ZipFolder" />
            <span className="artifact-name">{artifact.name}</span>
          </span>
        )}
        <span className="spacer" />
        {artifact.size !== null && <span className="muted artifact-size">{formatBytes(artifact.size)}</span>}
        {artifact.zipUrl && (
          <a className="artifact-download" href={artifact.zipUrl} target="_top" download>
            <Icon iconName="Download" /> zip
          </a>
        )}
      </div>
      {listable && expanded && (
        <ul className="artifact-files">
          {files === undefined && <li className="muted">Loading files…</li>}
          {files?.map((f) => (
            <FileRow key={f.path} file={f} digest={digestFor(digests, f.path)} date={f.date} />
          ))}
        </ul>
      )}
    </li>
  );
};

const FileRow: React.FC<{ file: ArtifactFile; digest: string | null; date: Date | null }> = ({ file, digest, date }) => {
  const [copied, setCopied] = React.useState(false);
  return (
    <li className="artifact-file">
      <Icon iconName="Page" className="muted" />
      <a href={file.downloadUrl} target="_top" download className="artifact-file-name">
        {file.path}
      </a>
      {/* Always a cell, so sizes and dates line up with rows that have a digest. */}
      <span className="artifact-digest">
        {digest && (
          <>
            <code title={`sha256:${digest}`}>sha256:{digest.slice(0, 12)}…</code>
            <Button
              subtle
              iconProps={{ iconName: copied ? "CheckMark" : "Copy" }}
              ariaLabel={`Copy the sha256 of ${file.path}`}
              tooltipProps={{ text: copied ? "Copied" : "Copy sha256" }}
              onClick={() => {
                void navigator.clipboard?.writeText(digest);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
          </>
        )}
      </span>
      <span className="muted artifact-size">{file.size !== null ? formatBytes(file.size) : ""}</span>
      <span className="muted artifact-date">{date && <Time date={date} />}</span>
    </li>
  );
};
