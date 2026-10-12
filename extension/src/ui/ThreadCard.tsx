import { Icon } from "azure-devops-ui/Icon";
import * as React from "react";
import type { Thread } from "../data/model";
import { Avatar, cx, isOpen, Markdown, THREAD_STATUS_LABEL, Time } from "./util";

/** A comment thread: root comment, replies, status. Used in the timeline and inline in diffs. */
export const ThreadCard: React.FC<{
  thread: Thread;
  /** Shown in the header for file threads in the timeline ("path line 12"). */
  fileLabel?: React.ReactNode;
  compact?: boolean;
}> = ({ thread, fileLabel, compact }) => {
  const [root, ...replies] = thread.comments.filter((c) => !c.isSystem);
  const [collapsed, setCollapsed] = React.useState(!isOpen(thread.status) && !!compact);
  if (!root) return null;
  const statusLabel = THREAD_STATUS_LABEL[thread.status];
  return (
    <div className={cx("thread", compact && "compact", !isOpen(thread.status) && "resolved")}>
      <div className="thread-head">
        {fileLabel && <span className="thread-file">{fileLabel}</span>}
        {statusLabel && <span className={cx("thread-status", `status-${thread.status}`)}>{statusLabel}</span>}
        {compact && (
          <button className="link-button" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? `Show ${replies.length + 1} comment${replies.length ? "s" : ""}` : "Hide"}
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          {[root, ...replies].map((c, i) => (
            <div key={c.id} className={cx("comment", i > 0 && "reply")}>
              <Avatar who={c.author} size={i === 0 ? 28 : 24} />
              <div className="comment-body">
                <div className="comment-meta">
                  <strong>{c.author.displayName}</strong> <Time date={c.published} />
                  {c.likes > 0 && (
                    <span className="likes">
                      <Icon iconName="Like" /> {c.likes}
                    </span>
                  )}
                </div>
                <Markdown text={c.content} />
              </div>
            </div>
          ))}
          <div className="reply-box disabled" title="Replying arrives in milestone 2">
            Reply…
          </div>
        </>
      )}
    </div>
  );
};
