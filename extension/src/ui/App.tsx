import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import * as React from "react";
import type { PrOverview, PrSource } from "../data/model";
import { buildReview, type ReviewModel } from "../review/engine";
import { CommitsTab } from "./CommitsTab";
import type { DiffMode } from "./DiffHunk";
import { FilesTab, type FileView } from "./FilesTab";
import { OverviewTab } from "./OverviewTab";
import { Avatar, cx, Time } from "./util";

type TabId = "overview" | "files" | "commits";

function usePref<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = React.useState<T>(() => (localStorage.getItem(`semantic-review.${key}`) as T) || initial);
  return [
    value,
    (v: T) => {
      localStorage.setItem(`semantic-review.${key}`, v);
      setValue(v);
    },
  ];
}

export const App: React.FC<{ source: PrSource }> = ({ source }) => {
  const [data, setData] = React.useState<PrOverview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabId>(() => (["overview", "files", "commits"].includes(location.hash.slice(1)) ? (location.hash.slice(1) as TabId) : "overview"));
  const [selection, setSelection] = React.useState({ iteration: 0, compareTo: 0 });
  const [review, setReview] = React.useState<ReviewModel | null>(null);
  const [reviewError, setReviewError] = React.useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = React.useState(false);
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
    if (!data || selection.iteration === 0) return;
    let cancelled = false;
    setReviewLoading(true);
    setReviewError(null);
    buildReview(source, { title: data.pr.title, description: data.pr.description }, selection.iteration, selection.compareTo)
      .then((r) => !cancelled && setReview(r))
      .catch((e: Error) => !cancelled && setReviewError(`Could not analyze changes: ${e.message}`))
      .finally(() => !cancelled && setReviewLoading(false));
    return () => {
      cancelled = true;
    };
  }, [source, data, selection.iteration, selection.compareTo]);

  const selectTab = (id: TabId) => {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
  };

  if (error) return <div className="error-box page-error">Could not load the pull request: {error}</div>;
  if (!data) return <div className="loading page-loading">Loading pull request…</div>;

  return (
    <div className="review-page">
      <PrHeader data={data} />
      <TabBar className="pr-tabs" selectedTabId={tab} onSelectedTabChanged={(id) => selectTab(id as TabId)} tabSize={TabSize.Tall}>
        <Tab id="overview" name="Overview" />
        <Tab id="files" name="Files" badgeCount={review?.result.files.length} />
        <Tab id="commits" name="Commits" badgeCount={data.commits.length || undefined} />
      </TabBar>
      <main className="tab-content">
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
            error={reviewError}
            threads={data.threads}
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
  );
};

const STATUS: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  draft: { label: "Draft", className: "status-draft" },
  completed: { label: "Completed", className: "status-completed" },
  abandoned: { label: "Abandoned", className: "status-abandoned" },
};

const PrHeader: React.FC<{ data: PrOverview }> = ({ data: { pr } }) => {
  const status = STATUS[pr.isDraft && pr.status === "active" ? "draft" : pr.status];
  const todo = "Arrives in milestone 2";
  return (
    <header className="pr-header">
      <div className="pr-title-row">
        <h1>
          <span className="pr-id">!{pr.id}</span> {pr.title}
        </h1>
        <div className="pr-actions">
          <Button text="Approve" iconProps={{ iconName: "CheckMark" }} disabled tooltipProps={{ text: todo }} />
          <Button text="Complete" primary disabled tooltipProps={{ text: todo }} />
          <Button iconProps={{ iconName: "More" }} subtle disabled ariaLabel="More actions" tooltipProps={{ text: todo }} />
        </div>
      </div>
      <div className="pr-meta">
        <span className={cx("status-pill", status.className)}>{status.label}</span>
        <Avatar who={pr.createdBy} size={20} />
        <strong>{pr.createdBy.displayName}</strong>
        <span className="muted">wants to merge</span>
        <span className="branch">
          <Icon iconName="BranchMerge" /> {pr.sourceBranch}
        </span>
        <span className="muted">into</span>
        <span className="branch">{pr.targetBranch}</span>
        <span className="muted">
          · <Time date={pr.creationDate} />
        </span>
      </div>
    </header>
  );
};
