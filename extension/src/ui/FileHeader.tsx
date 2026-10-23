import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import type { FileDiff } from "../../../src/core/types";
import { isLineAnchor, type Thread } from "../data/model";
import { CommentComposer } from "./CommentComposer";
import { MoreMenu } from "./controls";
import { useFileReview, ViewedCheckbox } from "./FileReviewState";
import { LineCommentContext } from "./LineComments";
import { useReviewActions } from "./ReviewActions";
import { DraftCard } from "./review/DraftCard";
import { usePendingReview } from "./review/PendingReview";
import { ThreadCard } from "./ThreadCard";
import { basename, dirname } from "./util";

/**
 * A file card's header (fold, path, tags, stats, Comment / Viewed / ⋯) and, below it, the comments on the whole
 * file. A file can span several cards in the grouped view, so only one of them shows the file's threads
 * (`showThreads`); any of them can start a new one. The fold and Viewed controls act on the card's chunks only.
 */
export const FileHeader: React.FC<{
  file: FileDiff;
  /** The chunks this card shows: all of the file's in A–Z, one in a guided card. */
  hunkIds: string[];
  adds: number;
  dels: number;
  /** File-level threads (no line anchor). */
  threads: Thread[];
  showThreads: boolean;
  /** The file at the compared update, or null when the host has no file page. */
  viewUrl: string | null;
}> = ({ file, hunkIds, adds, dels, threads, showThreads, viewUrl, children }) => {
  const comments = React.useContext(LineCommentContext);
  const { actions, disabled } = useReviewActions();
  const pending = usePendingReview();
  const [composing, setComposing] = React.useState(false);
  const { collapsed: isCollapsed, setCollapsed } = useFileReview();
  const collapsed = isCollapsed(hunkIds);
  const drafts = pending.draftsAt(file.path).filter((d) => !isLineAnchor(d.thread.file));
  const canComment = !!comments?.canComment(file.path) && !disabled;
  const count = threads.length + drafts.length;
  const inReview = pending.drafts.length > 0;
  const toThread = (content: string) => comments!.toThread({ path: file.path }, content);
  return (
    <>
      <header className="file-header">
        <button type="button" className="file-collapse" aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${file.path}`} onClick={() => setCollapsed(hunkIds, !collapsed)}>
          <Icon iconName={collapsed ? "ChevronRight" : "ChevronDown"} />
        </button>
        <FilePath path={file.path} from={file.status === "renamed" ? file.oldPath : null} />
        {children}
        <span className="spacer" />
        <span className="adds">+{adds}</span> <span className="dels">−{dels}</span>
        <Button
          className="file-comment-button"
          subtle
          iconProps={{ iconName: "Comment" }}
          text={count ? String(count) : undefined}
          disabled={!canComment}
          ariaLabel={`Comment on ${file.path}`}
          ariaPressed={composing}
          tooltipProps={{ text: canComment ? "Comment on this file" : "Comments need the latest comparison to load" }}
          onClick={() => {
            setComposing(!composing);
            if (!composing) setCollapsed(hunkIds, false);
          }}
        />
        <ViewedCheckbox hunkIds={hunkIds} label={`Mark ${file.path} as viewed`} />
        <MoreMenu
          label={`More options for ${file.path}`}
          options={[
            {
              id: "view",
              text: file.status === "deleted" ? "View file before deletion" : "View file",
              icon: "FileCode",
              disabled: !viewUrl,
              onSelect: () => viewUrl && window.open(viewUrl, "_blank", "noopener"),
            },
          ]}
        />
      </header>
      {!collapsed && ((showThreads && count > 0) || composing) && (
        <div className="file-comments">
          {showThreads && threads.map((t) => <ThreadCard key={t.id} thread={t} compact />)}
          {showThreads && drafts.map((d) => <DraftCard key={d.id} draft={d} />)}
          {composing && (
            <CommentComposer
              label={`Comment on ${file.path}`}
              placeholder="Comment on this file"
              onCancel={() => setComposing(false)}
              onSaved={() => setComposing(false)}
              actions={[
                { text: inReview ? "Add review comment" : "Start a review", local: true, onSave: (content) => pending.addThread(toThread(content)) },
                { text: inReview ? "Comment now" : "Add single comment", onSave: (content) => actions.createThread(toThread(content)) },
              ]}
            />
          )}
        </div>
      )}
    </>
  );
};

export const FilePath: React.FC<{ path: string; from?: string | null }> = ({ path, from }) => (
  <span className="file-path" title={path}>
    {from && <span className="dir">{from} → </span>}
    <span className="dir">{dirname(path) ? `${dirname(path)}/` : ""}</span>
    <span className="name">{basename(path)}</span>
  </span>
);

