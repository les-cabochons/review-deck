import { Icon } from "azure-devops-ui/Icon";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import * as React from "react";
import type { AppHost, Route } from "../app/host";
import type { Identity, PrOverview, PrSource, Thread } from "../data/model";
import type { ReviewModel } from "../review/engine";
import { CommitsTab } from "./CommitsTab";
import { MoreMenu, SplitActionButton } from "./controls";
import type { DiffMode } from "./DiffHunk";
import { MentionContext } from "./editor/MarkdownEditor";
import { FilesTab, type FileView } from "./FilesTab";
import { OverviewTab } from "./OverviewTab";
import { readPreference, writePreference } from "./preferences";
import { ReviewActionsProvider, useReviewActions } from "./ReviewActions";
import { PendingReviewProvider } from "./review/PendingReview";
import { ReviewButton, VoteButton } from "./review/ReviewControls";
import { Avatar, cx, IdentityNames, plural, Time } from "./util";

type TabId = "overview" | "files" | "commits";

function usePref<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = React.useState<T>(() => readPreference(key, initial));
  return [
    value,
    (v: T) => {
      setValue(v);
      writePreference(key, v);
    },
  ];
}

/** Links that depend on where the page runs (native ADO page, comment permalinks). */
export const HostLinks = React.createContext<{ commentUrl: (threadId: number, commentId: number) => string }>({
  commentUrl: (threadId, commentId) => `${location.href.split("#")[0]}#comment-${threadId}-${commentId}`,
});

/** One pull request: Overview / Files / Commits, with review controls in the header. */
export const PrPage: React.FC<{ host: AppHost; route: Extract<Route, { view: "pr" }>; source: PrSource }> = ({ host, route, source }) => {
  const [data, setData] = React.useState<PrOverview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabId>(() =>
    ["overview", "files", "commits"].includes(location.hash.slice(1)) ? (location.hash.slice(1) as TabId) : "overview",
  );
  const [selection, setSelection] = React.useState({ iteration: 0, compareTo: 0 });
  const [review, setReview] = React.useState<ReviewModel | null>(null);
  const [reviewError, setReviewError] = React.useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = React.useState(false);
  const [fileThreads, setFileThreads] = React.useState<Thread[]>([]);
  const [threadError, setThreadError] = React.useState<string | null>(null);
  const [focusGroup, setFocusGroup] = React.useState<string | null>(null);
  const [view, setView] = usePref<FileView>("fileView", "grouped");
  const [mode, setMode] = usePref<DiffMode>("diffMode", "inline");

  React.useEffect(() => {
    source
      .load()
      .then((d) => {
        setData(d);
        setSelection({ iteration: d.iterations.at(-1)?.id ?? 1, compareTo: 0 });
      })
      .catch((e: Error) => setError(e.message));
  }, [source]);

  React.useEffect(() => {
    if (data) host.setTitle(`!${data.pr.id} ${data.pr.title}`);
  }, [host, data?.pr.id, data?.pr.title]);

  React.useEffect(() => {
    if (!data || selection.iteration === 0) return;
    let cancelled = false;
    setReviewLoading(true);
    setReview(null);
    setReviewError(null);
    import("../review/engine")
      .then(({ buildReview }) => {
        if (cancelled) return null;
        return buildReview(source, { title: data.pr.title, description: data.pr.description }, selection.iteration, selection.compareTo);
      })
      .then((r) => !cancelled && setReview(r))
      .catch((e: Error) => !cancelled && setReviewError(`Could not analyze changes: ${e.message}`))
      .finally(() => !cancelled && setReviewLoading(false));
    return () => {
      cancelled = true;
    };
  }, [source, data?.pr.id, selection.iteration, selection.compareTo]);

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

  const people = React.useMemo(() => knownPeople(data, source.currentUser), [data, source.currentUser]);
  const names = React.useMemo(() => new Map(people.map((p) => [p.id, p.displayName])), [people]);
  const native = host.nativePrUrl(route);
  const links = React.useMemo(
    () => ({
      commentUrl: (threadId: number, commentId: number) =>
        native && host.kind === "ado" ? `${native}?discussionId=${threadId}` : `${location.href.split("#")[0]}#comment-${threadId}-${commentId}`,
    }),
    [native, host.kind],
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
  if (!data)
    return (
      <div className="page-loading">
        <Breadcrumb onBack={back} />
        <div className="loading">Loading pull request…</div>
      </div>
    );

  return (
    <IdentityNames.Provider value={names}>
      <ReviewActionsProvider source={source} onData={setData}>
        <PendingReviewProvider storageKey={`${route.repo}.${route.pr}.${source.currentUser.id}`}>
          <MentionProvider people={people}>
            <HostLinks.Provider value={links}>
              <div className="review-page">
                <Breadcrumb onBack={back} repo={data.pr.repository.name} id={data.pr.id} nativeUrl={native} />
                <PrHeader data={data} review={review} />
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
                      onOpenFiles={() => selectTab("files")}
                      onOpenGroup={(id) => {
                        setView("grouped");
                        setFocusGroup(id);
                        selectTab("files");
                      }}
                    />
                  )}
                  {tab === "files" && (
                    <FilesTab
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
                    />
                  )}
                  {tab === "commits" && <CommitsTab data={data} />}
                </main>
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

function knownPeople(data: PrOverview | null, me: Identity): Identity[] {
  if (!data) return [me];
  const all = [me, data.pr.createdBy, ...data.pr.reviewers, ...data.threads.flatMap((t) => t.comments.map((c) => c.author))];
  return [...new Map(all.filter((p) => p.id).map((p) => [p.id, p])).values()];
}

const Breadcrumb: React.FC<{ onBack: () => void; repo?: string; id?: number; nativeUrl?: string | null }> = ({ onBack, repo, id, nativeUrl }) => (
  <nav className="breadcrumb" aria-label="Breadcrumb">
    <button className="crumb-link" onClick={onBack}>
      <Icon iconName="Back" /> Pull requests
    </button>
    {repo && (
      <>
        <span className="crumb-sep">/</span>
        <span className="crumb">{repo}</span>
      </>
    )}
    {id !== undefined && (
      <>
        <span className="crumb-sep">/</span>
        <span className="crumb">!{id}</span>
      </>
    )}
    <span className="spacer" />
    {nativeUrl && (
      <a className="crumb-link" href={nativeUrl} target="_top">
        Open in Azure DevOps <Icon iconName="NavigateExternalInline" />
      </a>
    )}
  </nav>
);

const STATUS: Record<string, { label: string; icon: string; className: string }> = {
  active: { label: "Active", icon: "BranchPullRequest", className: "status-active" },
  draft: { label: "Draft", icon: "BranchRequestDraft", className: "status-draft" },
  completed: { label: "Completed", icon: "BranchMerged", className: "status-completed" },
  abandoned: { label: "Abandoned", icon: "BranchRequestClosed", className: "status-abandoned" },
};

const PrHeader: React.FC<{ data: PrOverview; review: ReviewModel | null }> = ({ data: { pr }, review }) => {
  const { currentUser } = useReviewActions();
  const vote = pr.reviewers.find((r) => r.id === currentUser.id)?.vote ?? 0;
  const status = STATUS[pr.isDraft && pr.status === "active" ? "draft" : pr.status];
  const todo = "Completion arrives in milestone 3";
  const stats = review ? diffStats(review) : null;
  const groups = review?.result.groups.filter((g) => g.kind === "semantic").length;
  return (
    <header className="pr-header">
      <div className="pr-title-row">
        <h1>
          {pr.title} <span className="pr-id">!{pr.id}</span>
        </h1>
        <div className="pr-actions">
          <ReviewButton vote={vote} />
          <VoteButton vote={vote} />
          <SplitActionButton
            text="Complete"
            primary
            disabled
            onClick={() => {}}
            menuLabel="Completion options"
            options={[
              { id: "auto", text: "Set auto-complete", icon: "TriggerAuto", disabled: true },
              { id: "draft", text: "Mark as draft", icon: "BranchRequestDraft", disabled: true },
              { id: "abandon", text: "Abandon", icon: "BranchRequestClosed", disabled: true },
            ]}
          />
          <MoreMenu
            label="More actions"
            options={[
              { id: "copy", text: "Copy pull request link", icon: "Link", onSelect: () => void navigator.clipboard?.writeText(location.href) },
              { id: "todo", text: todo, disabled: true },
            ]}
          />
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
            {plural(stats.files, "file")} · <span className="adds">+{stats.adds}</span> <span className="dels">−{stats.dels}</span>
            {groups !== undefined && <> · {plural(groups, "concern")}</>}
          </span>
        )}
      </div>
    </header>
  );
};

function diffStats(review: ReviewModel) {
  let adds = 0;
  let dels = 0;
  for (const f of review.result.files) for (const h of f.hunks) for (const l of h.lines) l.kind === "add" ? adds++ : l.kind === "del" && dels++;
  return { files: review.result.files.length, adds, dels };
}
