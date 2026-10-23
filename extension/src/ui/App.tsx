import { Icon } from "azure-devops-ui/Icon";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { Toast } from "azure-devops-ui/Toast";
import * as React from "react";
import type { AppHost, Route } from "../app/host";
import { hubPatch, rememberPr } from "../data/hubCache";
import { readPrSnapshot, writePrSnapshot } from "../data/prCache";
import type { Identity, PrOverview, PrSource, Thread } from "../data/model";
import type { AnalysisProgress, ReviewModel } from "../review/engine";
import { Breadcrumb } from "./Breadcrumb";
import { CommitsTab } from "./CommitsTab";
import type { DiffMode } from "./DiffHunk";
import { MentionContext } from "./editor/MarkdownEditor";
import type { FileView } from "./FilesTab";
import { GroupingStatus } from "./GroupingStatus";
import { OverviewTab } from "./OverviewTab";
import { PrSkeleton } from "./PrSkeleton";
import { PrMenu, type PrMenuLinks } from "./PrMenu";
import { StackBar, StackPanel } from "./stack/StackPanel";
import { useStack } from "./stack/useStack";
import { usePreference } from "./usePreference";
import { ReviewActionsProvider, useReviewActions } from "./ReviewActions";
import { PendingReviewProvider } from "./review/PendingReview";
import { CompletionButton, CompletionNotice } from "./review/CompletionControls";
import { ReviewButton, VoteButton } from "./review/ReviewControls";
import { Avatar, cx, IdentityNames, plural, Time } from "./util";

type TabId = "overview" | "files" | "commits";
/** Announce finished grouping only if the A–Z preview was up this long; small PRs group almost instantly. */
const ANNOUNCE_AFTER_MS = 2000;
/** Scrolled further than this into the preview, finishing doesn't swap the view under the reader. */
const KEEP_PREVIEW_SCROLL = 300;

interface ToastSpec {
  message: string;
  callToAction?: string;
  onCallToAction?: () => void;
}

const FilesTab = React.lazy(() => import("./FilesTab").then(module => ({ default: module.FilesTab })));

/** Links that depend on where the page runs (native ADO page, comment permalinks). */
export const HostLinks = React.createContext<{
  commentUrl: (threadId: number, commentId: number) => string;
  fileUrl: (path: string, commit: string) => string | null;
}>({
  commentUrl: (threadId, commentId) => `${location.href.split("#")[0]}#comment-${threadId}-${commentId}`,
  fileUrl: () => null,
});

/** One pull request: Overview / Files / Commits, with review controls in the header. */
export const PrPage: React.FC<{ host: AppHost; route: Extract<Route, { view: "pr" }>; source: PrSource }> = ({ host, route, source }) => {
  /** What this browser kept from opening the PR before: shown at once, while `source` loads the real thing. */
  const [kept] = React.useState(() => readPrSnapshot(host.cacheScope, route.pr));
  const [data, setData] = React.useState<PrOverview | null>(kept);
  /** `data` is the kept copy: changes wait for the first load, so none is made from what may be out of date. */
  const [stale, setStale] = React.useState(!!kept);
  const [error, setError] = React.useState<string | null>(null);
  /** Why loading failed while the kept copy shows; it stays, marked as possibly out of date, as the hub keeps its rows. */
  const [refreshError, setRefreshError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabId>(() =>
    ["overview", "files", "commits"].includes(location.hash.slice(1)) ? (location.hash.slice(1) as TabId) : "overview",
  );
  const [selection, setSelection] = React.useState(() => latestComparison(kept));
  const [review, setReview] = React.useState<ReviewModel | null>(null);
  const [reviewError, setReviewError] = React.useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = React.useState(false);
  const [fileThreads, setFileThreads] = React.useState<Thread[]>([]);
  const [threadError, setThreadError] = React.useState<string | null>(null);
  const [focusGroup, setFocusGroup] = React.useState<string | null>(null);
  const [view, setView] = usePreference<FileView>("fileView", "grouped");
  const [mode, setMode] = usePreference<DiffMode>("diffMode", "inline");
  const [progress, setProgress] = React.useState<AnalysisProgress | null>(null);
  /** Bumped by "Regroup"; `freshNext` makes that run skip the saved grouping. */
  const [regroup, setRegroup] = React.useState(0);
  const freshNext = React.useRef(false);
  /** The title and description the grouping was made with; they differ from `data` once edited (here, or since it was saved). */
  const [groupedWith, setGroupedWith] = React.useState<{ title: string; description: string } | null>(null);
  const stack = useStack(host, route.pr);
  const openLayer = (pr: { id: number; repository: { id: string } }) => host.navigate({ view: "pr", repo: pr.repository.id, pr: pr.id });
  /** Grouping finished while the reader was deep in the A–Z preview: keep it until they ask. */
  const [holdPreview, setHoldPreview] = React.useState(false);
  const [toast, setToast] = React.useState<ToastSpec | null>(null);
  const live = React.useRef({ tab, view });
  live.current = { tab, view };

  /** Loaded just now, here or after a change made through ReviewActions: the page is current again. */
  const loaded = (d: PrOverview) => {
    setData(d);
    setStale(false);
    setRefreshError(null);
  };
  const load = () => {
    setRefreshError(null);
    source.load().then(
      (d) => {
        loaded(d);
        // Opened from the kept copy: a push since then moves to the new latest, unless the reader picked another comparison.
        const latest = latestComparison(d);
        setSelection((s) => (sameComparison(s, latestComparison(kept)) && !sameComparison(s, latest) ? latest : s));
      },
      (e: Error) => (kept ? setRefreshError(e.message) : setError(e.message)),
    );
  };
  React.useEffect(load, [source]);

  // After opening the PR and after every change made here (votes, reviewers, tags), so the hub shows it in its new
  // section straight away when you go back, and the next open of this PR paints it at once.
  React.useEffect(() => {
    if (!data || stale) return;
    rememberPr(host.cacheScope, hubPatch(data));
    writePrSnapshot(host.cacheScope, data);
  }, [host, data, stale]);

  React.useEffect(() => {
    if (data) host.setTitle(`!${data.pr.id} ${data.pr.title}`);
  }, [host, data?.pr.id, data?.pr.title]);

  React.useEffect(() => {
    if (!data || selection.iteration === 0) return;
    let cancelled = false;
    const abort = new AbortController();
    let previewAt: number | null = null;
    const meta = { title: data.pr.title, description: data.pr.description };
    const fresh = freshNext.current;
    freshNext.current = false;
    setGroupedWith(null);
    setReviewLoading(true);
    setReview(null);
    setReviewError(null);
    setProgress(null);
    setHoldPreview(false);
    Promise.all([import("../review/engine"), host.backendService(), host.projectSettings(), host.organizationSettings()])
      .then(([{ buildReview }, backend, settings, organization]) => {
        if (cancelled) return null;
        // A saved guided view shows once the files are in; otherwise the preview (diff only) shows until grouping is done.
        return buildReview(source, meta, selection.iteration, selection.compareTo, {
          signal: abort.signal,
          fresh,
          backend,
          aiTitles: settings.aiTitles && organization.aiTitles,
          saved: { store: host.savedReviews(), key: { repo: route.repo, pr: route.pr, iteration: selection.iteration, compareTo: selection.compareTo } },
          onPreview: (preview) => {
            if (cancelled) return;
            previewAt = Date.now();
            setReview(preview);
            setProgress({ fraction: 0, label: "Starting" });
          },
          onProgress: (p) => !cancelled && setProgress(p),
        });
      })
      .then((r) => {
        if (cancelled || !r) return;
        setReview(r);
        setGroupedWith({ title: r.result.title, description: r.result.description });
        setProgress(null);
        if (previewAt !== null && Date.now() - previewAt >= ANNOUNCE_AFTER_MS) announceGrouped(r);
      })
      .catch((e: Error) => !cancelled && setReviewError(`Could not analyze changes: ${e.message}`))
      .finally(() => !cancelled && setReviewLoading(false));
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [source, data?.pr.id, selection.iteration, selection.compareTo, regroup]);

  /** Groups the changes again with the current title and description, ignoring the saved grouping. */
  const regroupNow = () => {
    freshNext.current = true;
    setRegroup((n) => n + 1);
  };
  const groupingStale = !!data && !!groupedWith && (groupedWith.title !== data.pr.title || groupedWith.description !== data.pr.description);

  React.useEffect(() => {
    if (!data || !selection.iteration) return;
    let cancelled = false;
    setFileThreads([]);
    setThreadError(null);
    source
      .getThreads(selection.iteration, selection.compareTo)
      .then((threads) => {
        if (!cancelled) setFileThreads(threads);
      })
      .catch((e: Error) => {
        if (!cancelled) setThreadError(`Could not load comments for this comparison: ${e.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [source, data?.threads, selection.iteration, selection.compareTo]);

  const showGrouped = () => {
    setHoldPreview(false);
    setView("grouped");
    document.querySelector(".files-tab")?.scrollIntoView({ block: "start" });
  };

  function announceGrouped(r: ReviewModel) {
    const concerns = r.result.groups.filter((g) => g.kind === "semantic").length;
    const message = `Grouped ${plural(r.result.files.length, "file")} into ${plural(concerns, "concern")}.`;
    const { tab, view } = live.current;
    if (tab !== "files") setToast({ message, callToAction: "View files", onCallToAction: () => selectTab("files") });
    else if (view === "grouped" && window.scrollY > KEEP_PREVIEW_SCROLL) {
      setHoldPreview(true);
      setToast({ message, callToAction: "Show guided", onCallToAction: showGrouped });
    } else setToast({ message });
  }

  const people = React.useMemo(() => knownPeople(data, source.currentUser), [data, source.currentUser]);
  const names = React.useMemo(() => new Map(people.map((p) => [p.id, p.displayName])), [people]);
  const native = host.nativePrUrl(route);
  const links = React.useMemo(
    () => ({
      commentUrl: (threadId: number, commentId: number) =>
        native && host.kind === "ado" ? `${native}?discussionId=${threadId}` : `${location.href.split("#")[0]}#comment-${threadId}-${commentId}`,
      fileUrl: (path: string, commit: string) => host.fileUrl(route, path, commit),
    }),
    [native, host, route],
  );
  const menuLinks = React.useMemo<PrMenuLinks>(
    () => ({ review: host.reviewUrl(route), native, createPr: (source, target) => host.createPrUrl(route, source, target) }),
    [host, route, native],
  );

  const selectTab = (id: TabId) => {
    setTab(id);
    history.replaceState(null, "", `${location.pathname}${location.search}#${id}`);
  };
  const back = () => host.navigate({ view: "hub" });

  if (error)
    return (
      <div className="page-error">
        <Breadcrumb onBack={back} />
        <div className="error-box" role="alert">
          Could not load the pull request: {error}
        </div>
      </div>
    );
  if (!data) return <PrSkeleton host={host} route={route} />;

  return (
    <IdentityNames.Provider value={names}>
      <ReviewActionsProvider source={source} onData={loaded} stale={stale}>
        <PendingReviewProvider storageKey={`${route.repo}.${route.pr}.${source.currentUser.id}`}>
          <MentionProvider people={people}>
            <HostLinks.Provider value={links}>
              <div className="review-page">
                <Breadcrumb onBack={back} repo={data.pr.repository.name} id={data.pr.id} nativeUrl={native} />
                {refreshError && (
                  <div className="error-box" role="alert">
                    Could not refresh the pull request, so this may be out of date: {refreshError}{" "}
                    <button className="link-button" onClick={load}>
                      Try again
                    </button>
                  </div>
                )}
                <PrHeader
                  data={data}
                  review={review}
                  progress={progress}
                  refreshing={stale && !refreshError}
                  links={menuLinks}
                  onToast={(message) => setToast({ message })}
                />
                {stack && <StackBar view={stack} onOpen={openLayer} />}
                <TabBar className="pr-tabs" selectedTabId={tab} onSelectedTabChanged={(id) => selectTab(id as TabId)} tabSize={TabSize.Tall}>
                  <Tab id="overview" name="Overview" />
                  <Tab id="files" name="Files" badgeCount={review?.result.files.length} />
                  <Tab id="commits" name="Commits" badgeCount={data.commits.length || undefined} />
                </TabBar>
                <main className={cx("tab-content", `tab-${tab}`)}>
                  {tab === "overview" && (
                    <OverviewTab
                      data={data}
                      review={review}
                      building={!!progress}
                      sidebarTop={stack && <StackPanel view={stack} onOpen={openLayer} onRestack={(pr) => host.restack(pr)} />}
                      onOpenFiles={() => selectTab("files")}
                      onOpenGroup={(id) => {
                        setView("grouped");
                        setFocusGroup(id);
                        selectTab("files");
                      }}
                    />
                  )}
                  {tab === "files" && (
                    <React.Suspense fallback={<div className="loading">Loading diff renderer…</div>}>
                    <FilesTab
                      storageKey={JSON.stringify([host.cacheScope, data.pr.repository.projectId, route.repo, route.pr, source.currentUser.id])}
                      review={review}
                      loading={reviewLoading}
                      error={reviewError ?? threadError}
                      threads={fileThreads}
                      iterations={data.iterations}
                      selection={selection}
                      onSelection={setSelection}
                      view={view}
                      onView={setView}
                      mode={mode}
                      onMode={setMode}
                      focusGroup={focusGroup}
                      progress={progress}
                      holdPreview={holdPreview}
                      onShowGrouped={showGrouped}
                      onRegroup={regroupNow}
                      groupingStale={groupingStale}
                    />
                    </React.Suspense>
                  )}
                  {tab === "commits" && <CommitsTab data={data} />}
                </main>
                {toast && <TimedToast key={toast.message} spec={toast} onDone={() => setToast(null)} />}
              </div>
            </HostLinks.Provider>
          </MentionProvider>
        </PendingReviewProvider>
      </ReviewActionsProvider>
    </IdentityNames.Provider>
  );
};

const MentionProvider: React.FC<{ people: Identity[] }> = ({ people, children }) => {
  const { actions } = useReviewActions();
  const value = React.useMemo(() => ({ known: people, search: (q: string) => actions.searchReviewers(q) }), [people, actions]);
  return <MentionContext.Provider value={value}>{children}</MentionContext.Provider>;
};

type Comparison = ReviewModel["comparison"];

/** The latest update against the PR's base, which the Files tab opens on; iteration 0 until the PR is known. */
function latestComparison(data: PrOverview | null): Comparison {
  return { iteration: data ? (data.iterations.at(-1)?.id ?? 1) : 0, compareTo: 0 };
}

const sameComparison = (a: Comparison, b: Comparison) => a.iteration === b.iteration && a.compareTo === b.compareTo;

function knownPeople(data: PrOverview | null, me: Identity): Identity[] {
  if (!data) return [me];
  const all = [me, data.pr.createdBy, ...data.pr.reviewers, ...data.threads.flatMap((t) => t.comments.map((c) => c.author))];
  return [...new Map(all.filter((p) => p.id).map((p) => [p.id, p])).values()];
}

const STATUS: Record<string, { label: string; icon: string; className: string }> = {
  active: { label: "Active", icon: "BranchPullRequest", className: "status-active" },
  draft: { label: "Draft", icon: "BranchRequestDraft", className: "status-draft" },
  completed: { label: "Completed", icon: "BranchMerged", className: "status-completed" },
  abandoned: { label: "Abandoned", icon: "BranchRequestClosed", className: "status-abandoned" },
};

/** An azure-devops-ui toast that fades out on its own after a few seconds. */
const TimedToast: React.FC<{ spec: ToastSpec; onDone: () => void }> = ({ spec, onDone }) => {
  const ref = React.useRef<Toast>(null);
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (ref.current) ref.current.fadeOut().promise.then(onDone, onDone);
      else onDone();
    }, 8000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Toast
      ref={ref}
      message={spec.message}
      callToAction={spec.callToAction}
      onCallToActionClick={() => {
        spec.onCallToAction?.();
        onDone();
      }}
    />
  );
};

const PrHeader: React.FC<{
  data: PrOverview;
  review: ReviewModel | null;
  progress: AnalysisProgress | null;
  /** The kept copy shows while the PR loads. */
  refreshing: boolean;
  links: PrMenuLinks;
  onToast: (message: string) => void;
}> = ({ data, review, progress, refreshing, links, onToast }) => {
  const { pr } = data;
  const { currentUser } = useReviewActions();
  const vote = pr.reviewers.find((r) => r.id === currentUser.id)?.vote ?? 0;
  const status = STATUS[pr.isDraft && pr.status === "active" ? "draft" : pr.status];
  const stats = review ? diffStats(review) : null;
  const groups = review?.analyzed ? review.result.groups.filter((g) => g.kind === "semantic").length : undefined;
  return (
    <header className="pr-header">
      <div className="pr-title-row">
        <h1>
          {pr.title} <span className="pr-id">!{pr.id}</span>
        </h1>
        <div className="pr-actions">
          <ReviewButton vote={vote} />
          <VoteButton vote={vote} />
          <CompletionButton data={data} />
          <PrMenu pr={pr} links={links} onToast={onToast} />
        </div>
      </div>
      <div className="pr-meta">
        <span className={cx("status-pill", status.className)}>
          <Icon iconName={status.icon} /> {status.label}
        </span>
        <Avatar who={pr.createdBy} size={20} />
        <strong>{pr.createdBy.displayName}</strong>
        <span className="muted">wants to merge</span>
        <span className="branch">{pr.sourceBranch}</span>
        <span className="muted">into</span>
        <span className="branch">{pr.targetBranch}</span>
        <span className="muted">
          · opened <Time date={pr.creationDate} />
        </span>
        {stats && (
          <span className="meta-stats">
            {plural(stats.files, "file")} · <span className="adds">+{stats.adds.toLocaleString()}</span> <span className="dels">−{stats.dels.toLocaleString()}</span>
            {groups !== undefined && <> · {plural(groups, "concern")}</>}
            {progress && (
              <>
                {" · "}
                <GroupingStatus progress={progress} />
              </>
            )}
          </span>
        )}
      </div>
      <CompletionNotice pr={pr} />
      {refreshing && <div className="refresh-progress" role="progressbar" aria-label="Updating pull request" />}
    </header>
  );
};

function diffStats(review: ReviewModel) {
  let adds = 0;
  let dels = 0;
  for (const f of review.result.files) for (const h of f.hunks) for (const l of h.lines) l.kind === "add" ? adds++ : l.kind === "del" && dels++;
  return { files: review.result.files.length, adds, dels };
}
