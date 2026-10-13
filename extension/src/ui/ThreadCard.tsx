import * as React from "react";
import type { Comment, Thread, ThreadStatus } from "../data/model";
import { HostLinks } from "./App";
import { CommentComposer } from "./CommentComposer";
import { DropdownButton, MoreMenu } from "./controls";
import { quote } from "./editor/format";
import { useReviewActions } from "./ReviewActions";
import { DraftCard } from "./review/DraftCard";
import { usePendingReview } from "./review/PendingReview";
import { Avatar, cx, isOpen, Markdown, THREAD_STATUS_LABEL, Time } from "./util";

const STATUS_ORDER: ThreadStatus[] = ["active", "pending", "fixed", "wontFix", "closed", "byDesign"];

/** A comment thread: root comment, replies, status. Used in the timeline and inline in diffs. */
export const ThreadCard: React.FC<{
  thread: Thread;
  /** Shown in the header for file threads in the timeline ("path line 12"). */
  fileLabel?: React.ReactNode;
  compact?: boolean;
}> = ({ thread, fileLabel, compact }) => {
  const { actions, disabled, run } = useReviewActions();
  const pending = usePendingReview();
  const [reply, setReply] = React.useState<{ initial: string; key: number } | null>(null);
  const [root, ...replies] = thread.comments.filter((c) => !c.isSystem);
  const [collapsed, setCollapsed] = React.useState(!isOpen(thread.status) && !!compact);
  const drafts = pending.repliesTo(thread.id);
  const links = React.useContext(HostLinks);
  if (!root) return null;

  const quoteReply = (c: Comment) => {
    const selection = window.getSelection()?.toString().trim();
    const inComment = selection && c.content.includes(selection) ? selection : c.content;
    setCollapsed(false);
    setReply({ initial: quote(inComment, c.author.displayName), key: Date.now() });
  };
  const inReview = pending.drafts.length > 0;

  return (
    <div className={cx("thread", compact && "compact", !isOpen(thread.status) && "resolved")} id={`thread-${thread.id}`}>
      <div className="thread-head">
        {fileLabel && <span className="thread-file">{fileLabel}</span>}
        <span className="spacer" />
        {compact && (
          <button className="link-button" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? `Show ${replies.length + 1} comment${replies.length ? "s" : ""}` : "Collapse"}
          </button>
        )}
        <DropdownButton
          className={cx("thread-status-button", `ts-${thread.status}`)}
          text={THREAD_STATUS_LABEL[thread.status] || "Unknown"}
          disabled={disabled}
          subtle
          ariaLabel={`Status for thread ${thread.id}`}
          options={STATUS_ORDER.map((s) => ({
            id: s,
            text: THREAD_STATUS_LABEL[s],
            selected: s === thread.status,
            onSelect: () => s !== thread.status && void run(() => actions.setThreadStatus(thread.id, s)),
          }))}
        />
      </div>
      {!collapsed && (
        <>
          {[root, ...replies].map((c, i) => (
            <div key={c.id} className={cx("comment", i > 0 && "reply")} id={`comment-${thread.id}-${c.id}`}>
              <Avatar who={c.author} size={i === 0 ? 28 : 24} />
              <div className="comment-body">
                <div className="comment-meta">
                  <strong>{c.author.displayName}</strong> <Time date={c.published} />
                  {c.likes > 0 && <span className="likes">♥ {c.likes}</span>}
                  <span className="spacer" />
                  <MoreMenu
                    label={`Actions for ${c.author.displayName}'s comment`}
                    options={[
                      { id: "quote", text: "Quote reply", icon: "Reply", onSelect: () => quoteReply(c) },
                      { id: "copy", text: "Copy link", icon: "Link", onSelect: () => void navigator.clipboard?.writeText(links.commentUrl(thread.id, c.id)) },
                      { id: "copy-text", text: "Copy text", icon: "Copy", onSelect: () => void navigator.clipboard?.writeText(c.content) },
                    ]}
                  />
                </div>
                <Markdown text={c.content} />
              </div>
            </div>
          ))}
          {drafts.map((d) => (
            <div key={d.id} className="reply">
              <DraftCard draft={d} asReply />
            </div>
          ))}
          {reply ? (
            <CommentComposer
              key={reply.key}
              className="reply-composer"
              label={`Reply to thread ${thread.id}`}
              initial={reply.initial}
              onCancel={() => setReply(null)}
              onSaved={() => setReply(null)}
              actions={
                inReview
                  ? [
                      { text: "Add review comment", local: true, onSave: (text) => pending.addReply(thread.id, root.id, text) },
                      { text: "Reply now", onSave: (text) => actions.reply(thread.id, root.id, text) },
                    ]
                  : [
                      { text: "Reply", onSave: (text) => actions.reply(thread.id, root.id, text) },
                      { text: "Start a review", local: true, onSave: (text) => pending.addReply(thread.id, root.id, text) },
                    ]
              }
            />
          ) : (
            <button className="reply-box" disabled={disabled} onClick={() => setReply({ initial: "", key: Date.now() })}>
              Write a reply…
            </button>
          )}
        </>
      )}
    </div>
  );
};
