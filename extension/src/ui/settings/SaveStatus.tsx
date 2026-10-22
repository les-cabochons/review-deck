import * as React from "react";

/** "Saving…" / "Saved", the quiet autosave confirmation Azure DevOps settings pages use. */
export const SaveStatus: React.FC<{ status: "saving" | "saved" | null }> = ({ status }) =>
  status ? (
    <span className="save-status muted" role="status">
      {status === "saving" ? "Saving…" : "Saved"}
    </span>
  ) : null;
