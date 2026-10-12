import * as React from "react";
import { CommentComposer } from "../CommentComposer";
import { MoreMenu } from "../controls";
import { useReviewActions } from "../ReviewActions";
import { Avatar, Markdown } from "../util";
import { type Draft, usePendingReview } from "./PendingReview";

/** A pending review comment: visible only to you until the review is submitted. */
export const DraftCard: React.FC<{ draft: Draft; asReply?: boolean }> = ({ draft, asReply }) => {
  const pending = usePendingReview();
  const { currentUser } = useReviewActions();
  const [editing, setEditing] = React.useState(false);
  const body = (
    <div className="comment draft">
      <Avatar who={currentUser} size={asReply ? 24 : 28} />
      <div className="comment-body">
        <div className="comment-meta">
          <strong>{currentUser.displayName}</strong> <span className="pending-badge">Pending</span>
          <span className="spacer" />
          <MoreMenu
            label="Pending comment actions"
            options={[
              { id: "edit", text: "Edit", icon: "Edit", onSelect: () => setEditing(true) },
              { id: "delete", text: "Delete", icon: "Delete", onSelect: () => pending.remove(draft.id) },
            ]}
          />
        </div>
        {editing ? (
          <CommentComposer
            label="Edit pending comment"
            initial={draft.content}
            actions={[{ text: "Update comment", local: true, onSave: (text) => pending.update(draft.id, text) }]}
            onCancel={() => setEditing(false)}
            onSaved={() => setEditing(false)}
          />
        ) : (
          <Markdown text={draft.content} />
        )}
      </div>
    </div>
  );
  return asReply ? body : <div className="thread compact draft-thread">{body}</div>;
};
