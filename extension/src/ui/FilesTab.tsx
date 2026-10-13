import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import { createPortal } from "react-dom";
import type { FileDiff, Group, HunkInfo } from "../../../src/core/types";
import { isLineAnchor, type FileAnchor, type Iteration, type Thread } from "../data/model";
import type { AnalysisProgress, ReviewModel } from "../review/engine";
import { type DiffMode, DiffHunk, estimateHunkHeight, type ThreadIndex } from "./DiffHunk";
import { ThreadCard } from "./ThreadCard";
import { LineCommentContext, lineThreadInput } from "./LineComments";
import { useReviewActions } from "./ReviewActions";
import { DropdownButton, ModeToggle } from "./controls";
import { GroupingStatus } from "./GroupingStatus";
import { TitleSourceIcon } from "./TitleSource";
import { cx, dirname, plural } from "./util";
import { PierreTree } from "./pierre/PierreTree";
import { LazyMount, LazyRoot } from "./LazyMount";
import { groupColor } from "./groupColors";
import { readPreference, writePreference } from "./preferences";
import { FileReviewProvider, useFileReview, ViewedCheckbox } from "./FileReviewState";
import { viewedStatus } from "./viewed";
import { FileHeader } from "./FileHeader";
import { HostLinks } from "./App";

export type FileView = "grouped" | "alpha";

interface Props {
  storageKey: string;
  review: ReviewModel | null;
  loading: boolean;
  error: string | null;
  threads: Thread[];
  iterations: Iteration[];
  selection: { iteration: number; compareTo: number };
  onSelection: (s: { iteration: number; compareTo: number }) => void;
  view: FileView;
  onView: (v: FileView) => void;
  mode: DiffMode;
  onMode: (m: DiffMode) => void;
  /** Scroll target requested by another tab (group id). */
  focusGroup?: string | null;
  /** Grouping progress while the worker runs; null once done. */
  progress: AnalysisProgress | null;
  /** Grouping is done but the reader is mid-way through the A–Z preview, so it stays until they switch. */
  holdPreview: boolean;
  onShowGrouped: () => void;
  /** Groups the changes again (the title or description may have been edited since). */
  onRegroup: () => void;
  /** The title or description changed since the grouping was made. */
  groupingStale: boolean;
}

export const FilesTab: React.FC<Props> = (props) => {
  const comparison = props.review?.comparison ?? props.selection;
  const key = `viewed.${props.storageKey}.${comparison.compareTo}.${comparison.iteration}`;
  return <FileReviewProvider key={key} storageKey={key} changes={props.review?.changes ?? []}>
    <FilesContent {...props} />
  </FileReviewProvider>;
};

const FilesContent: React.FC<Props> = (props) => {
  const { review, view, mode } = props;
  const fileThreads = React.useMemo(() => indexThreads(props.threads), [props.threads]);
  const commentable = React.useMemo(() => new Set(review?.changes.filter((c) => c.changeTrackingId).map((c) => c.path)), [review]);
  // Groups exist only once analysis finishes; until then the diff is shown A–Z.
  const shownView: FileView = review?.analyzed && !props.holdPreview ? view : "alpha";
  const groups = review?.analyzed ? review.result.groups.filter((g) => g.kind === "semantic").length : 0;
  const [hidden, setHidden] = useHiddenKinds();
  const [search, setSearch] = React.useState("");
  const [treeOpen, setTreeOpen] = useTreeOpen();
  const [collapsedNavGroups, setCollapsedNavGroups] = React.useState(new Set<string>());
  const toggleNavGroup = (id: string) => setCollapsedNavGroups(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const kinds = React.useMemo(() => (review ? fileKinds(review) : new Map<string, Set<FileKind>>()), [review]);
  const shown = React.useCallback((path: string) => ![...(kinds.get(path) ?? [])].some((k) => hidden.has(k)), [kinds, hidden]);
  const commentCounts = React.useMemo(() => new Map([...fileThreads].map(([path, ts]) => [path, ts.length])), [fileThreads]);
  const links = React.useContext(HostLinks);
  const viewUrl = React.useCallback((file: FileDiff) => {
    if (!review) return null;
    const { iteration, compareTo } = review.comparison;
    const head = props.iterations.find((it) => it.id === iteration);
    // A deleted file only exists on the compared-from side.
    const commit = file.status !== "deleted" ? head?.headCommit : compareTo ? props.iterations.find((it) => it.id === compareTo)?.headCommit : head?.baseCommit;
    return commit ? links.fileUrl(file.path, commit) : null;
  }, [review, props.iterations, links]);

  React.useEffect(() => {
    if (props.focusGroup && review) scrollToId(`group-${props.focusGroup}`);
  }, [props.focusGroup, review]);

  return (
    <div className="files-tab">
      {/* The toolbar shows what's on screen; picking "Grouped" while held switches over. */}
      <Toolbar
        {...props}
        view={props.holdPreview ? "alpha" : view}
        onView={(v) => (v === "grouped" && props.holdPreview ? props.onShowGrouped() : props.onView(v))}
        ready={props.holdPreview && view === "grouped" ? groups : null}
        treeOpen={treeOpen}
        onTreeOpen={setTreeOpen}
      />
      {props.error && <div className="error-box">{props.error}</div>}
      {!review && props.error ? null : !review ? (
        <div className="loading">Loading changes…</div>
      ) : (
        <LineCommentContext.Provider
          value={{
            canComment: (path) =>
              review.comparison.iteration === props.selection.iteration &&
              review.comparison.compareTo === props.selection.compareTo &&
              commentable.has(path),
            toThread: (file, content) => lineThreadInput(review, props.selection, file, content),
          }}
        >
          {!review.analyzed && props.progress && (
            <div className="analyzing-note" role="status">
              <div className="analyzing-text">
                <span className="spinner" aria-hidden="true" />
                <span>
                  <strong>Building the guided view of {plural(review.result.files.length, "file")}…</strong> {props.progress.label}. Showing files A–Z
                  until it's done.
                </span>
                <span className="analyzing-percent">{Math.round(props.progress.fraction * 100)}%</span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${Math.round(props.progress.fraction * 100)}%` }} />
              </div>
            </div>
          )}
          {review.analyzed && props.holdPreview && view === "grouped" && (
            <div className="analyzing-note ready" role="status">
              <div className="analyzing-text">
                <Icon iconName="CheckMark" />
                <span>
                  <strong>Grouping is done:</strong> {plural(groups, "concern")}. You're still on the A–Z list so you don't lose your place.
                </span>
                <button className="link-button" onClick={props.onShowGrouped}>
                  Show guided
                </button>
              </div>
            </div>
          )}
          <div className={cx("files-layout", !treeOpen && "tree-hidden")}>
            {treeOpen && (
              <Navigator
                review={review}
                view={shownView}
                shown={shown}
                search={search}
                onSearch={setSearch}
                hidden={hidden}
                onHidden={setHidden}
                kinds={kinds}
                comments={commentCounts}
                collapsedGroups={collapsedNavGroups}
                onToggleGroup={toggleNavGroup}
              />
            )}
            <div className="files-content">
              {shownView === "grouped" ? (
                <GroupedView review={review} mode={mode} fileThreads={fileThreads} shown={shown} viewUrl={viewUrl} />
              ) : (
                <AlphaView review={review} mode={mode} fileThreads={fileThreads} shown={shown} viewUrl={viewUrl} />
              )}
            </div>
          </div>
        </LineCommentContext.Provider>
      )}
    </div>
  );
};

/** Whether the file tree sidebar is shown; hiding it gives the diffs the full width. */
function useTreeOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = React.useState(() => readPreference<string>("fileTree", "shown") !== "hidden");
  const update = React.useCallback((next: boolean) => {
    setOpen(next);
    writePreference("fileTree", next ? "shown" : "hidden");
  }, []);
  return [open, update];
}

/** `ready`: concern count when grouping finished but the A–Z preview is still shown. */
const Toolbar: React.FC<Props & { ready: number | null; treeOpen: boolean; onTreeOpen: (open: boolean) => void }> = ({
  review,
  iterations,
  selection,
  onSelection,
  view,
  onView,
  mode,
  onMode,
  progress,
  ready,
  onShowGrouped,
  onRegroup,
  groupingStale,
  treeOpen,
  onTreeOpen,
}) => {
  const { disabled } = useReviewActions();
  const { viewed } = useFileReview();
  const stats = review ? diffStats(review) : null;
  const viewedCount = review ? review.result.files.filter((f) => viewed.has(f.path)).length : 0;
  const grouping = !!review && !review.analyzed;
  const latest = iterations.at(-1)?.id;
  const updateName = (id: number) => (id === 0 ? "Base" : `Update ${id}${id === latest ? " (latest)" : ""}`);
  return (
    <div className="files-toolbar">
      <Button
        className="tree-toggle"
        iconProps={{ iconName: treeOpen ? "ClosePane" : "OpenPane" }}
        subtle
        ariaLabel={treeOpen ? "Hide file tree" : "Show file tree"}
        ariaPressed={treeOpen}
        tooltipProps={{ text: treeOpen ? "Hide file tree" : "Show file tree" }}
        onClick={() => onTreeOpen(!treeOpen)}
      />
      <ModeToggle
        options={[
          { value: "grouped", text: "Guided", icon: "ViewListGroup" },
          { value: "alpha", text: "Files A–Z", icon: "SortLines" },
        ]}
        value={view}
        onChange={onView}
        menuLabel="File view"
        tooltip={view === "grouped" && grouping ? "Grouping is still running. Click to toggle to 'Files A–Z' mode." : undefined}
      />
      <ModeToggle
        options={[
          { value: "inline", text: "Inline", icon: "DiffInline" },
          { value: "split", text: "Side-by-side", icon: "DiffSideBySide" },
        ]}
        value={mode}
        onChange={onMode}
        menuLabel="Diff view"
      />
      <span className="compare">
        <DropdownButton
          text={updateName(selection.compareTo)}
          icon="BranchCompare"
          disabled={disabled}
          ariaLabel="Compare from"
          options={[0, ...iterations.filter((it) => it.id < selection.iteration).map((it) => it.id)].map((id) => ({
            id: String(id),
            text: updateName(id),
            checked: id === selection.compareTo,
            onSelect: () => onSelection({ ...selection, compareTo: id }),
          }))}
        />
        <Icon iconName="Forward" />
        <DropdownButton
          text={updateName(selection.iteration)}
          disabled={disabled}
          ariaLabel="Compare to"
          options={iterations.map((it) => ({
            id: String(it.id),
            text: updateName(it.id),
            secondaryText: it.description ? it.description.slice(0, 48) : undefined,
            checked: it.id === selection.iteration,
            onSelect: () => onSelection({ iteration: it.id, compareTo: Math.min(selection.compareTo, it.id - 1) }),
          }))}
        />
      </span>
      {/* The toolbar is sticky, so progress stays visible however far the reader scrolls. */}
      {progress && <GroupingStatus progress={progress} />}
      {ready !== null && (
        <span className="grouping-status ready" role="status">
          <Icon iconName="CheckMark" /> Grouped into {plural(ready, "concern")} ·{" "}
          <button className="link-button" onClick={onShowGrouped}>
            Show guided
          </button>
        </span>
      )}
      {review?.analyzed && !progress && (
        <span className={cx("regroup", groupingStale && "stale")} role={groupingStale ? "status" : undefined}>
          {groupingStale && <span className="regroup-hint">Description changed ·</span>}
          <button className="link-button" onClick={onRegroup} title="Group the changes again, using the current title and description">
            <Icon iconName="Refresh" /> Regroup
          </button>
        </span>
      )}
      {stats && (
        <span className="stats">
          <span className="viewed-progress" role="status" aria-label={`${viewedCount} of ${stats.files} files viewed`}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle className="viewed-progress-track" cx="8" cy="8" r="6" />
              <circle className="viewed-progress-fill" cx="8" cy="8" r="6" pathLength="1"
                strokeDasharray={`${stats.files ? viewedCount / stats.files : 0} 1`} />
            </svg>
            {viewedCount} / {stats.files} viewed
          </span>
          {" · "}<span className="adds">+{stats.adds.toLocaleString()}</span> <span className="dels">−{stats.dels.toLocaleString()}</span>
        </span>
      )}
    </div>
  );
};

// ---------- navigator ----------

/** Scrolls to an element, then again once lazily mounted content above it has settled. */
function scrollToId(id: string) {
  const go = () => document.getElementById(id)?.scrollIntoView({ block: "start" });
  go();
  setTimeout(go, 300);
}

interface NavigatorProps {
  review: ReviewModel;
  view: FileView;
  shown: (path: string) => boolean;
  search: string;
  onSearch: (value: string) => void;
  hidden: Set<FileKind>;
  onHidden: (kinds: Set<FileKind>) => void;
  kinds: Map<string, Set<FileKind>>;
  comments: Map<string, number>;
  collapsedGroups: Set<string>;
  onToggleGroup: (id: string) => void;
}

/** Graphite-style file list: a search box and a "Show" filter above the tree. */
const Navigator: React.FC<NavigatorProps> = ({ review, view, shown, search, onSearch, hidden, onHidden, kinds, comments, collapsedGroups, onToggleGroup }) => {
  const { result } = review;
  const { viewed, setFileCollapsed } = useFileReview();
  const go = scrollToId;
  const [nav, setNav] = React.useState<HTMLElement | null>(null);
  const query = search.trim().toLowerCase();
  const visible = (file: FileDiff) => shown(file.path) && (!query || file.path.toLowerCase().includes(query));
  const filtered = result.files.filter((f) => !shown(f.path)).length;
  const empty = query ? `No files match “${search.trim()}”` : "Every file is hidden by filters";
  const header = (
    <div className="nav-filter-bar">
      <label className="nav-search">
        <Icon iconName="Search" />
        <input
          type="search"
          placeholder="Search files"
          aria-label="Search files"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onSearch("")}
        />
      </label>
      <FileFilter hidden={hidden} onHidden={onHidden} kinds={kinds} />
    </div>
  );
  const footer = filtered > 0 && (
    <div className="nav-hidden-note">
      {plural(filtered, "file")} hidden by filters ·{" "}
      <button className="link-button" onClick={() => onHidden(new Set())}>
        Show all
      </button>
    </div>
  );
  if (view === "grouped") {
    const sections = result.groups.map((g, i) => ({ g, i, files: groupFiles(review, g).filter(visible) })).filter(({ files }) => files.length > 0);
    return (
      <nav className="navigator" ref={setNav}>
        {header}
        <LazyRoot.Provider value={nav}>
          {sections.map(({ g, i, files }) => (
            <div key={g.id} className="nav-group">
              <div className="nav-group-header">
                <button type="button" className="nav-group-toggle" onClick={() => onToggleGroup(g.id)}
                  aria-expanded={!collapsedGroups.has(g.id)} aria-controls={`nav-group-tree-${g.id}`}
                  aria-label={`${collapsedGroups.has(g.id) ? "Expand" : "Collapse"} file tree for ${g.title}`}>
                  <Icon iconName={collapsedGroups.has(g.id) ? "ChevronRight" : "ChevronDown"} />
                </button>
                <button type="button" className="nav-group-title" onClick={() => go(`group-${g.id}`)}>
                  <span className="badge" style={{ background: groupColor(result.groups, g) }}>
                    {i + 1}
                  </span>
                  <span className="text">{g.title}</span>
                  {viewedStatus(groupFiles(review, g).map((file) => file.path), viewed).checked && <Icon iconName="CheckMark" className="nav-viewed" ariaLabel="Viewed" />}
                  <span className="count">{g.hunkIds.length}</span>
                </button>
              </div>
              <div id={`nav-group-tree-${g.id}`} hidden={collapsedGroups.has(g.id)}>
                {!collapsedGroups.has(g.id) && <GroupTree review={review} group={g} files={files} comments={comments} />}
              </div>
            </div>
          ))}
        </LazyRoot.Provider>
        {sections.length === 0 && <div className="nav-empty">{empty}</div>}
        {footer}
      </nav>
    );
  }
  const files = result.files.filter(visible).sort((a, b) => a.path.localeCompare(b.path));
  return (
    <nav className="navigator">
      {header}
      {files.length ? (
        <PierreTree files={files} comments={comments} viewed={viewed} maxHeight={Infinity} onSelect={(path) => {
          setFileCollapsed(path, false);
          go(`file-${path}`);
        }} />
      ) : (
        <div className="nav-empty">{empty}</div>
      )}
      {footer}
    </nav>
  );
};

/** Kinds of file the "Show" filter can hide, in menu order. */
type FileKind = "deleted" | "test" | "generated";
const FILE_KINDS: { kind: FileKind; label: string }[] = [
  { kind: "deleted", label: "Deleted files" },
  { kind: "test", label: "Test files" },
  { kind: "generated", label: "Autogenerated files" },
];

function useHiddenKinds(): [Set<FileKind>, (kinds: Set<FileKind>) => void] {
  const [hidden, setHidden] = React.useState(() => new Set(readPreference("hiddenFiles", "").split(",").filter(Boolean) as FileKind[]));
  const update = React.useCallback((kinds: Set<FileKind>) => {
    setHidden(kinds);
    writePreference("hiddenFiles", [...kinds].join(","));
  }, []);
  return [hidden, update];
}

/** What each file is, for the filter: deleted, a test, or lockfile/generated output. */
function fileKinds(review: ReviewModel): Map<string, Set<FileKind>> {
  const out = new Map<string, Set<FileKind>>();
  for (const f of review.result.files) out.set(f.path, new Set<FileKind>(f.status === "deleted" ? ["deleted"] : []));
  for (const info of review.result.hunks.values()) {
    const kinds = out.get(info.file.path);
    if (!kinds) continue;
    if (info.isTest) kinds.add("test");
    if (info.mechanical?.kind === "generated" || info.mechanical?.kind === "lockfile") kinds.add("generated");
  }
  return out;
}

/** Funnel button with a "Show:" checklist that stays open while toggling, like Graphite's. */
const FileFilter: React.FC<{ hidden: Set<FileKind>; onHidden: (kinds: Set<FileKind>) => void; kinds: Map<string, Set<FileKind>> }> = ({
  hidden,
  onHidden,
  kinds,
}) => {
  // Portalled to <body> at a fixed position so the sidebar (sticky, scrolling) neither clips nor covers it.
  const [open, setOpen] = React.useState<{ top: number; left: number } | null>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const place = () => {
    const rect = root.current!.getBoundingClientRect();
    return { top: rect.bottom + 4, left: rect.left };
  };
  const isOpen = !!open;
  React.useEffect(() => {
    if (!isOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) setOpen(null);
    };
    // Toggling a filter reflows the page, so follow the button rather than closing on scroll.
    const follow = () => setOpen(place());
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", follow, true);
    };
  }, [isOpen]);
  const count = (kind: FileKind) => [...kinds.values()].filter((k) => k.has(kind)).length;
  const toggle = (kind: FileKind) => {
    const next = new Set(hidden);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    onHidden(next);
  };
  return (
    <div className="file-filter" ref={root}>
      <button
        className={cx("file-filter-button", hidden.size > 0 && "active")}
        aria-label="Filter files"
        aria-haspopup="true"
        aria-expanded={!!open}
        title={hidden.size ? `Hiding ${FILE_KINDS.filter((k) => hidden.has(k.kind)).map((k) => k.label.toLowerCase()).join(", ")}` : "Filter files"}
        onClick={() => setOpen(open ? null : place())}
      >
        <Icon iconName={hidden.size ? "FilterSolid" : "Filter"} />
      </button>
      {open &&
        createPortal(
          <div className="file-filter-menu" role="menu" style={open} ref={menu}>
            <div className="file-filter-heading">Show:</div>
            {FILE_KINDS.map(({ kind, label }) => (
              <button key={kind} role="menuitemcheckbox" aria-checked={!hidden.has(kind)} className="file-filter-item" onClick={() => toggle(kind)}>
                <span className="label">{label}</span>
                <span className="count">{count(kind)}</span>
                <span className="check">{!hidden.has(kind) && <Icon iconName="CheckMark" />}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
};

function groupFiles(review: ReviewModel, group: Group): FileDiff[] {
  const paths = new Set(group.hunkIds.map((id) => review.result.hunks.get(id)!.file.path));
  return review.result.files.filter((file) => paths.has(file.path));
}

const GroupTree: React.FC<{ review: ReviewModel; group: Group; files: FileDiff[]; comments: Map<string, number> }> = ({ review, group, files, comments }) => {
  const { result } = review;
  const { viewed, setFileCollapsed } = useFileReview();
  // Rough tree height before it renders: a row per file and per folder, capped like the tree itself.
  const rows = files.length + new Set(files.map((f) => dirname(f.path))).size;
  return (
    <LazyMount estimate={Math.min(360, rows * 24 + 8)}>
      <PierreTree
        files={files}
        comments={comments}
        viewed={viewed}
        onSelect={(path) => {
          setFileCollapsed(path, false);
          const section = document.getElementById(`group-${group.id}`);
          section?.querySelector<HTMLButtonElement>(".group-header[aria-expanded=false]")?.click();
          requestAnimationFrame(() => scrollToId(`hunk-${group.hunkIds.find((id) => result.hunks.get(id)!.file.path === path)}`));
        }}
      />
    </LazyMount>
  );
};

// ---------- views ----------

interface ViewProps {
  review: ReviewModel;
  mode: DiffMode;
  fileThreads: Map<string, Thread[]>;
  /** False for files the "Show" filter hides. */
  shown: (path: string) => boolean;
  /** The file's page at the compared update, for "View file". */
  viewUrl: (file: FileDiff) => string | null;
}

type LineThread = Thread & { file: FileAnchor };
const onLine = (t: Thread): t is LineThread => isLineAnchor(t.file);

const GroupedView: React.FC<ViewProps> = (props) => {
  const { review, fileThreads, shown } = props;
  const { result } = review;
  const visible = visibleLines(result.files);
  const orphans = [...fileThreads].flatMap(([path, ts]) => ts.filter(onLine).filter((t) => !isVisible(t, visible.get(path))).map((t) => ({ path, t })));
  // File comments sit on each file's first card in an open concern, so folded concerns can't hide them.
  // A file whose concerns are all folded keeps them on its first card, shown once that concern opens.
  const { groupCollapsed } = useFileReview();
  const firstCards = React.useMemo(() => {
    const first = new Map<string, string>();
    const firstOpen = new Map<string, string>();
    for (const g of result.groups) {
      const open = !groupCollapsed(g.id, groupFiles(review, g).map((f) => f.path), g.kind === "mechanical");
      for (const id of g.hunkIds) {
        const path = result.hunks.get(id)!.file.path;
        if (!shown(path)) continue;
        if (!first.has(path)) first.set(path, id);
        if (open && !firstOpen.has(path)) firstOpen.set(path, id);
      }
    }
    return new Set([...first].map(([path, id]) => firstOpen.get(path) ?? id));
  }, [review, result, shown, groupCollapsed]);
  return (
    <>
      {result.groups.map((g, i) =>
        g.hunkIds.some((id) => shown(result.hunks.get(id)!.file.path)) ? (
          <GroupSection key={g.id} group={g} index={i} firstCards={firstCards} {...props} />
        ) : null,
      )}
      {orphans.length > 0 && (
        <section className="group-section">
          <div className="group-header static">
            <span className="gtitle">Comments outside the changed lines</span>
            <span className="count">{plural(orphans.length, "thread")}</span>
          </div>
          {orphans.map(({ path, t }) => (
            <ThreadCard key={t.id} thread={t} fileLabel={`${path} · line ${t.file.line}`} compact />
          ))}
        </section>
      )}
    </>
  );
};

const GroupSection: React.FC<{ group: Group; index: number; firstCards: Set<string> } & ViewProps> = ({
  group,
  index,
  firstCards,
  review,
  mode,
  fileThreads,
  shown,
  viewUrl,
}) => {
  const { groupCollapsed, setGroupCollapsed } = useFileReview();
  const paths = groupFiles(review, group).map((file) => file.path);
  const open = !groupCollapsed(group.id, paths, group.kind === "mechanical");
  const setOpen = (next: boolean) => setGroupCollapsed(group.id, !next);
  const hunks = group.hunkIds.map((id) => review.result.hunks.get(id)!).filter((h) => shown(h.file.path));
  const files = new Set(hunks.map((h) => h.file.path)).size;
  return (
    <section
      className={cx("group-section", `kind-${group.kind}`)}
      id={`group-${group.id}`}
      style={{ borderLeftColor: groupColor(review.result.groups, group) }}
    >
      <div className="group-header-row">
        <button className="group-header" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon iconName={open ? "ChevronDown" : "ChevronRight"} />
          <span className="badge" style={{ background: groupColor(review.result.groups, group) }}>
            {index + 1}
          </span>
          <span className="gtitle">{group.title}</span>
          <TitleSourceIcon group={group} />
          <span className="count">
            {plural(hunks.length, "change")} · {plural(files, "file")}
          </span>
        </button>
        <ViewedCheckbox paths={paths} label={`Mark concern ${group.title} as viewed`} onChange={(checked) => setOpen(!checked)} />
      </div>
      {open && (
        <>
          {group.rationale && <p className="rationale">{group.rationale}</p>}
          {hunks.map((h) => (
            <HunkCard key={h.hunk.id} info={h} mode={mode} threads={fileThreads.get(h.file.path) ?? []}
              showFileThreads={firstCards.has(h.hunk.id)} viewUrl={viewUrl(h.file)} />
          ))}
        </>
      )}
    </section>
  );
};

const HunkCard: React.FC<{ info: HunkInfo; mode: DiffMode; threads: Thread[]; showFileThreads: boolean; viewUrl: string | null }> = ({
  info,
  mode,
  threads,
  showFileThreads,
  viewUrl,
}) => {
  const { fileCollapsed } = useFileReview();
  const collapsed = fileCollapsed(info.file);
  const adds = info.hunk.lines.filter((l) => l.kind === "add").length;
  const dels = info.hunk.lines.filter((l) => l.kind === "del").length;
  return (
    <article className="hunk-card" id={`hunk-${info.hunk.id}`}>
      {/* The article stays as a scroll target; its contents mount near the viewport. */}
      <LazyMount estimate={FILE_HEADER_HEIGHT + (collapsed ? 0 : estimateHunkHeight(info.hunk, mode))}>
      <FileHeader file={info.file} adds={adds} dels={dels} threads={threads.filter((t) => !onLine(t))} showThreads={showFileThreads} viewUrl={viewUrl}>
        <FileStatusPill file={info.file} />
        {info.isTest && <span className="tag">test</span>}
        {info.mechanical && <span className="tag">{info.mechanical.reason}</span>}
      </FileHeader>
      {!collapsed && <DiffHunk file={info.file} hunk={info.hunk} mode={mode} threads={lineIndex(threads)} symbol={info.symbol} />}
      </LazyMount>
    </article>
  );
};

const AlphaView: React.FC<ViewProps> = ({ review, mode, fileThreads, shown, viewUrl }) => {
  const { fileCollapsed } = useFileReview();
  const files = review.result.files.filter((f) => shown(f.path)).sort((a, b) => a.path.localeCompare(b.path));
  const visible = visibleLines(review.result.files);
  return (
    <>
      {files.map((f) => {
        const threads = fileThreads.get(f.path) ?? [];
        const orphans = threads.filter(onLine).filter((t) => !isVisible(t, visible.get(f.path)));
        const index = lineIndex(threads);
        const adds = f.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "add").length, 0);
        const dels = f.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "del").length, 0);
        const collapsed = fileCollapsed(f);
        return (
          <article key={f.path} className="file-card" id={`file-${f.path}`}>
            <LazyMount estimate={FILE_HEADER_HEIGHT + (collapsed ? 0 : f.hunks.reduce((n, h) => n + estimateHunkHeight(h, mode), 0))}>
            <FileHeader file={f} adds={adds} dels={dels} threads={threads.filter((t) => !onLine(t))} showThreads viewUrl={viewUrl(f)}>
              <FileStatusPill file={f} />
            </FileHeader>
            {!collapsed && orphans.map((t) => (
              <ThreadCard key={t.id} thread={t} fileLabel={`line ${t.file.line} (outside the diff)`} compact />
            ))}
            {!collapsed && f.hunks.map((h) => (
              <DiffHunk key={h.id} file={f} hunk={h} mode={mode} threads={index} symbol={review.result.hunks.get(h.id)?.symbol} />
            ))}
            </LazyMount>
          </article>
        );
      })}
    </>
  );
};

// ---------- helpers ----------

const FILE_HEADER_HEIGHT = 38;

const FileStatusPill: React.FC<{ file: FileDiff }> = ({ file }) => {
  if (file.status !== "added" && file.status !== "deleted") return null;
  return (
    <span className={`file-status-pill file-status-${file.status}`}>
      {file.status === "added" ? "Created" : "Deleted"}
    </span>
  );
};

function indexThreads(threads: Thread[]): Map<string, Thread[]> {
  const out = new Map<string, Thread[]>();
  for (const t of threads) {
    if (t.kind !== "comment" || !t.file) continue;
    out.set(t.file.path, [...(out.get(t.file.path) ?? []), t]);
  }
  return out;
}

function lineIndex(threads: Thread[] | undefined): ThreadIndex {
  const out: ThreadIndex = new Map();
  for (const t of threads ?? []) {
    if (!onLine(t)) continue;
    const key = `${t.file.side}:${t.file.endLine}`;
    out.set(key, [...(out.get(key) ?? []), t]);
  }
  return out;
}

function visibleLines(files: FileDiff[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of files) {
    const set = new Set<string>();
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.newLine !== undefined && l.kind !== "del") set.add(`right:${l.newLine}`);
        if (l.oldLine !== undefined && l.kind !== "add") set.add(`left:${l.oldLine}`);
      }
    }
    out.set(f.path, set);
  }
  return out;
}

function isVisible(t: LineThread, visible: Set<string> | undefined): boolean {
  return !!visible?.has(`${t.file.side}:${t.file.endLine}`);
}

function diffStats(review: ReviewModel) {
  let adds = 0;
  let dels = 0;
  for (const f of review.result.files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.kind === "add") adds++;
        else if (l.kind === "del") dels++;
      }
    }
  }
  return { files: review.result.files.length, adds, dels };
}
