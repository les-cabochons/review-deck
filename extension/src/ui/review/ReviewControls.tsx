import { Button } from "azure-devops-ui/Button";
import * as React from "react";
import type { Vote } from "../../data/model";
import { type MenuOption, SplitActionButton } from "../controls";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { useReviewActions } from "../ReviewActions";
import { cx, plural, VOTE_INFO } from "../util";
import { usePendingReview } from "./PendingReview";

// Azure DevOps' vote menu: imperative labels, each with its vote's coloured badge.
const VOTE_MENU: { vote: Vote; text: string }[] = [
  { vote: 10, text: "Approve" },
  { vote: 5, text: "Approve with suggestions" },
  { vote: -5, text: "Wait for author" },
  { vote: -10, text: "Reject" },
];

/** The Azure DevOps vote control: "Approve" with the other votes behind the chevron. */
export const VoteButton: React.FC<{ vote: Vote }> = ({ vote }) => {
  const { actions, disabled, run } = useReviewActions();
  const set = (v: Vote) => v !== vote && void run(() => actions.setVote(v));
  const options: MenuOption[] = [
    ...VOTE_MENU.map(({ vote: v, text }) => {
      const info = VOTE_INFO[String(v)];
      return { id: String(v), text, icon: info.icon, iconClassName: `vote-badge tone-${info.tone}`, onSelect: () => set(v) };
    }),
    { id: "div", text: "", divider: true },
    { id: "reset", text: "Reset feedback", icon: "CircleFill", iconClassName: "vote-reset", disabled: vote === 0, onSelect: () => set(0) },
  ];
  // Like Azure DevOps, the button always reads "Approve": the current vote shows on the reviewer list.
  return (
    <SplitActionButton
      className="vote-button"
      text="Approve"
      onClick={() => set(10)}
      options={options}
      disabled={disabled}
      menuLabel="More actions"
    />
  );
};

const VERDICTS: { vote: Vote | null; title: string; detail: string }[] = [
  { vote: null, title: "Comment", detail: "Submit general feedback without changing your vote." },
  { vote: 10, title: "Approve", detail: "Approve these changes." },
  { vote: 5, title: "Approve with suggestions", detail: "Approve, with optional follow-ups." },
  { vote: -5, title: "Wait for author", detail: "Changes are needed before this can merge." },
  { vote: -10, title: "Reject", detail: "These changes should not merge." },
];

/**
 * "Review" (or "Finish review (n)" while drafts are pending): a panel to write a summary, pick a
 * verdict, and submit pending comments in one go, like GitHub's review flow.
 */
export const ReviewButton: React.FC<{ vote: Vote }> = ({ vote }) => {
  const pending = usePendingReview();
  const { actions, disabled, run } = useReviewActions();
  const [open, setOpen] = React.useState(false);
  const [summary, setSummary] = React.useState("");
  const [verdict, setVerdict] = React.useState<Vote | null>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const count = pending.drafts.length;

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      // Menus and callouts render in a portal: ignore clicks there.
      const target = e.target as HTMLElement;
      if (!box.current?.contains(target) && !target.closest(".bolt-portal-host, .bolt-callout")) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const nothing = count === 0 && !summary.trim() && (verdict === null || verdict === vote);
  const submit = async () => {
    if (nothing) return;
    const ok = await run(() => pending.submit(actions, { vote: verdict === vote ? null : verdict, summary }));
    if (ok) {
      setSummary("");
      setVerdict(null);
      setOpen(false);
    }
  };

  return (
    <div className="review-button" ref={box}>
      <Button
        text={count > 0 ? `Finish review (${count})` : "Review"}
        iconProps={{ iconName: "ReviewSolid" }}
        primary={count > 0}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        ariaExpanded={open}
      />
      {open && (
        <div className="review-panel" role="dialog" aria-label="Finish your review">
          <h2>Finish your review</h2>
          {count > 0 && <p className="muted">{plural(count, "pending comment")} will be posted.</p>}
          <MarkdownEditor
            label="Review summary"
            value={summary}
            onChange={setSummary}
            placeholder="Leave a summary (optional)"
            autoFocus
            minRows={3}
            onSubmit={() => void submit()}
            onCancel={() => setOpen(false)}
          />
          <fieldset className="verdicts">
            <legend className="sr-only">Verdict</legend>
            {VERDICTS.map((v) => (
              <label key={String(v.vote)} className={cx("verdict", verdict === v.vote && "selected")}>
                <input type="radio" name="verdict" checked={verdict === v.vote} onChange={() => setVerdict(v.vote)} />
                <span>
                  <strong>
                    {v.title}
                    {v.vote !== null && v.vote === vote && <span className="muted"> (current)</span>}
                  </strong>
                  <small className="muted">{v.detail}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="review-panel-actions">
            {count > 0 && (
              <button
                className="link-button danger"
                disabled={disabled}
                onClick={() => window.confirm(`Discard ${plural(count, "pending comment")}?`) && pending.discard()}
              >
                Discard pending
              </button>
            )}
            <span className="spacer" />
            <Button text="Cancel" subtle onClick={() => setOpen(false)} />
            <Button text="Submit review" primary disabled={disabled || nothing} onClick={() => void submit()} />
          </div>
        </div>
      )}
    </div>
  );
};
