import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import { isCompleting, mergeProblem, unmetPolicies } from "../../data/completion";
import { type CompletionOptions, MERGE_STRATEGIES, type MergeStrategy, type PrOverview, type PullRequest } from "../../data/model";
import { SplitActionButton } from "../controls";
import { useModal } from "../modal";
import { readPreference, writePreference } from "../preferences";
import { useReviewActions } from "../ReviewActions";
import { cx, plural } from "../util";

const STRATEGY: Record<MergeStrategy, { title: string; detail: string; verb: string }> = {
  noFastForward: { title: "Merge (no fast forward)", detail: "Keep every commit and add a merge commit.", verb: "merge" },
  squash: { title: "Squash commit", detail: "Combine all commits into one commit on the target branch.", verb: "squash" },
  rebase: { title: "Rebase and fast-forward", detail: "Replay the commits onto the target branch, without a merge commit.", verb: "rebase" },
  rebaseMerge: { title: "Semi-linear merge", detail: "Rebase the commits, then add a merge commit.", verb: "rebase and merge" },
};

/** While completing, re-read the PR this often, for up to this many times (two minutes). */
const POLL_MS = 3000;
const POLL_LIMIT = 40;

type DialogMode = "complete" | "autoComplete";

/**
 * The header's completion control, by PR state: Complete (with auto-complete, draft and abandon behind the
 * chevron), Publish for drafts, Reactivate for abandoned PRs, and nothing once merged.
 */
export const CompletionButton: React.FC<{ data: PrOverview }> = ({ data }) => {
  const { actions, disabled, run } = useReviewActions();
  const [dialog, setDialog] = React.useState<DialogMode | null>(null);
  const { pr } = data;
  const completing = isCompleting(pr);
  const abandon = () => window.confirm(`Abandon !${pr.id}? You can reactivate it later.`) && void run(() => actions.abandon());

  if (pr.status === "completed") return null;
  if (pr.status === "abandoned")
    return <Button text="Reactivate" iconProps={{ iconName: "BranchPullRequest" }} primary disabled={disabled} onClick={() => void run(() => actions.reactivate())} />;
  if (pr.isDraft)
    return (
      <SplitActionButton
        text="Publish"
        icon="BranchPullRequest"
        primary
        disabled={disabled}
        onClick={() => void run(() => actions.setDraft(false))}
        menuLabel="Completion options"
        options={[{ id: "abandon", text: "Abandon", icon: "BranchRequestClosed", onSelect: abandon }]}
      />
    );
  return (
    <>
      <SplitActionButton
        text={completing ? "Completing…" : "Complete"}
        icon="BranchMerge"
        primary
        disabled={disabled || completing}
        onClick={() => setDialog("complete")}
        menuLabel="Completion options"
        options={[
          pr.autoCompleteSetBy
            ? { id: "auto", text: "Cancel auto-complete", icon: "Cancel", onSelect: () => void run(() => actions.setAutoComplete(null)) }
            : { id: "auto", text: "Set auto-complete", icon: "TriggerAuto", onSelect: () => setDialog("autoComplete") },
          { id: "draft", text: "Mark as draft", icon: "BranchRequestDraft", onSelect: () => void run(() => actions.setDraft(true)) },
          { id: "div", text: "", divider: true },
          { id: "abandon", text: "Abandon", icon: "BranchRequestClosed", onSelect: abandon },
        ]}
      />
      {dialog && <CompleteDialog data={data} mode={dialog} onClose={() => setDialog(null)} />}
    </>
  );
};

/**
 * Lines under the PR title for a merge in progress or failed, conflicts, auto-complete, and who closed the PR.
 * While Azure DevOps merges, it re-reads the PR until the merge finishes.
 */
export const CompletionNotice: React.FC<{ pr: PullRequest }> = ({ pr }) => {
  const { actions, disabled, run, poll } = useReviewActions();
  const completing = isCompleting(pr);
  const problem = pr.status === "active" ? mergeProblem(pr) : null;
  const [stalled, setStalled] = React.useState(false);

  React.useEffect(() => {
    if (!completing) return;
    setStalled(false);
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries <= POLL_LIMIT) return void poll();
      clearInterval(timer);
      setStalled(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [completing]);

  if (pr.status === "completed")
    return (
      <p className="completion-notice">
        <Icon iconName="BranchMerged" className="tone-merged" /> Merged into <span className="branch">{pr.targetBranch}</span>
        {pr.closedBy && <> by {pr.closedBy.displayName}</>}.
      </p>
    );
  if (pr.status === "abandoned")
    return (
      <p className="completion-notice">
        <Icon iconName="BranchRequestClosed" /> Abandoned{pr.closedBy && <> by {pr.closedBy.displayName}</>}.
      </p>
    );
  return (
    <>
      {completing && (
        <p className="completion-notice" role="status">
          <Icon iconName="ProgressLoopOuter" className="tone-info" /> Completing: Azure DevOps is merging into <span className="branch">{pr.targetBranch}</span>.
          {stalled && (
            <>
              {" "}This is taking a while.
              <button className="link-button" onClick={() => void poll()}>
                Refresh
              </button>
            </>
          )}
        </p>
      )}
      {problem && (
        <p className="completion-notice" role="alert">
          <Icon iconName="StatusErrorFull" className="tone-error" /> The merge didn't complete: {problem}
        </p>
      )}
      {pr.mergeStatus === "conflicts" && (
        <p className="completion-notice" role="status">
          <Icon iconName="Warning" className="tone-warning" /> This branch has merge conflicts with <span className="branch">{pr.targetBranch}</span>. Resolve them before completing.
        </p>
      )}
      {pr.autoCompleteSetBy && (
        <p className="completion-notice">
          <Icon iconName="TriggerAuto" className="tone-info" /> Auto-complete set by {pr.autoCompleteSetBy.displayName}: it will{" "}
          {STRATEGY[pr.completionOptions?.mergeStrategy ?? "noFastForward"].verb} into <span className="branch">{pr.targetBranch}</span> when the required
          checks pass{pr.completionOptions?.deleteSourceBranch && <> and delete <span className="branch">{pr.sourceBranch}</span></>}.{" "}
          <button className="link-button" disabled={disabled} onClick={() => void run(() => actions.setAutoComplete(null))}>
            Cancel auto-complete
          </button>
        </p>
      )}
    </>
  );
};

const PREF_STRATEGY = "mergeStrategy";
const PREF_DELETE = "deleteSourceBranch";
const PREF_WORK_ITEMS = "transitionWorkItems";

/** Merge type, merge commit message and post-merge cleanup, like Azure DevOps' "Complete pull request" dialog. */
const CompleteDialog: React.FC<{ data: PrOverview; mode: DialogMode; onClose: () => void }> = ({ data, mode, onClose }) => {
  const { pr } = data;
  const { actions, disabled, error, run } = useReviewActions();
  const saved = pr.completionOptions;
  const [allowed, setAllowed] = React.useState<MergeStrategy[] | null>(null);
  const [strategy, setStrategy] = React.useState<MergeStrategy>(() => saved?.mergeStrategy ?? readPreference<MergeStrategy>(PREF_STRATEGY, "noFastForward"));
  const [message, setMessage] = React.useState(() => saved?.mergeCommitMessage || `Merged PR ${pr.id}: ${pr.title}`);
  const [deleteBranch, setDeleteBranch] = React.useState(() => saved?.deleteSourceBranch ?? readPreference<string>(PREF_DELETE, "false") === "true");
  const [workItems, setWorkItems] = React.useState(() => saved?.transitionWorkItems ?? readPreference<string>(PREF_WORK_ITEMS, "true") === "true");
  const [override, setOverride] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const dialog = React.useRef<HTMLDivElement>(null);
  const unmet = unmetPolicies(data.policies);
  const conflicts = pr.mergeStatus === "conflicts";
  const openThreads = data.threads.filter((t) => t.kind === "comment" && (t.status === "active" || t.status === "pending")).length;

  React.useEffect(() => {
    let cancelled = false;
    actions.allowedMergeStrategies(pr.repository.id, pr.targetBranch).then((list) => {
      if (cancelled) return;
      setAllowed(list);
      setStrategy((current) => (list.includes(current) ? current : list[0]));
    });
    return () => {
      cancelled = true;
    };
  }, [actions, pr.repository.id, pr.targetBranch]);

  useModal(dialog, onClose);

  const options = (): CompletionOptions => {
    writePreference(PREF_STRATEGY, strategy);
    writePreference(PREF_DELETE, String(deleteBranch));
    writePreference(PREF_WORK_ITEMS, String(workItems));
    return {
      mergeStrategy: strategy,
      deleteSourceBranch: deleteBranch,
      transitionWorkItems: workItems,
      mergeCommitMessage: message,
      bypassReason: mode === "complete" && override ? reason : undefined,
    };
  };
  const submit = async (write: () => Promise<void>) => {
    if (await run(write)) onClose();
  };
  const canComplete = !conflicts && (unmet.length === 0 || (override && !!reason.trim()));
  const busy = disabled || !allowed;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="modal complete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="complete-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <Icon iconName={mode === "complete" ? "BranchMerge" : "TriggerAuto"} />
          <h2 id="complete-dialog-title">{mode === "complete" ? "Complete pull request" : "Set auto-complete"}</h2>
          <span className="spacer" />
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            <Icon iconName="Cancel" />
          </button>
        </header>
        <p className="muted">
          {mode === "complete" ? "Merge" : "When the required checks pass, merge"} <span className="branch">{pr.sourceBranch}</span> into{" "}
          <span className="branch">{pr.targetBranch}</span>.
        </p>
        {conflicts && (
          <p className="complete-warning" role="alert">
            <Icon iconName="Warning" className="tone-warning" /> Merge conflicts: resolve them on the source branch first.
          </p>
        )}
        {unmet.length > 0 && (
          <p className="complete-warning">
            <Icon iconName="Warning" className="tone-warning" /> Required {unmet.length === 1 ? "check hasn't" : "checks haven't"} passed: {unmet.map((p) => p.name).join(", ")}.
            {mode === "complete" && " Set auto-complete to merge once they do."}
          </p>
        )}
        {openThreads > 0 && <p className="muted complete-note">{plural(openThreads, "comment")} still active.</p>}

        <fieldset className="verdicts">
          <legend className="complete-label">Merge type</legend>
          {MERGE_STRATEGIES.filter((m) => !allowed || allowed.includes(m)).map((m) => (
            <label key={m} className={cx("verdict", strategy === m && "selected")}>
              <input type="radio" name="merge-strategy" checked={strategy === m} onChange={() => setStrategy(m)} />
              <span>
                <strong>{STRATEGY[m].title}</strong>
                <small className="muted">{STRATEGY[m].detail}</small>
              </span>
            </label>
          ))}
          {allowed && allowed.length < MERGE_STRATEGIES.length && <small className="muted">Branch policy limits the merge types.</small>}
        </fieldset>

        {strategy !== "rebase" && (
          <label className="complete-field">
            <span className="complete-label">Merge commit message</span>
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
        )}
        <label className="complete-check">
          <input type="checkbox" checked={workItems} onChange={(e) => setWorkItems(e.target.checked)} />
          Complete associated work items after merging{data.workItems.length > 0 && <span className="muted"> ({data.workItems.length})</span>}
        </label>
        <label className="complete-check">
          <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
          Delete <span className="branch">{pr.sourceBranch}</span> after merging
        </label>
        {mode === "complete" && unmet.length > 0 && (
          <>
            <label className="complete-check">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Override branch policies and enable merge <span className="muted">(needs the "Bypass policies" permission)</span>
            </label>
            {override && (
              <label className="complete-field">
                <span className="complete-label">Reason for overriding</span>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded on the pull request" />
              </label>
            )}
          </>
        )}

        {error && (
          <p className="complete-warning write-error" role="alert">
            {error}
          </p>
        )}
        <div className="review-panel-actions">
          <span className="spacer" />
          <Button text="Cancel" subtle onClick={onClose} />
          {mode === "autoComplete" ? (
            <Button text="Set auto-complete" primary disabled={busy} onClick={() => void submit(() => actions.setAutoComplete(options()))} />
          ) : (
            <>
              {unmet.length > 0 && !override && (
                <Button text="Set auto-complete" disabled={busy} onClick={() => void submit(() => actions.setAutoComplete(options()))} />
              )}
              <Button
                text="Complete merge"
                primary
                disabled={busy || !canComplete}
                onClick={() => void submit(() => actions.complete(options(), pr.headCommit))}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};
