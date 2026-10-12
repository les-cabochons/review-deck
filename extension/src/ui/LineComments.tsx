import * as React from "react";
import type { FileAnchor, NewThread } from "../data/model";
import type { ReviewModel } from "../review/engine";

interface LineComments {
  /** Builds the new-thread payload for a line in the current comparison (throws if it is stale). */
  toThread: (file: FileAnchor, content: string) => NewThread;
  canComment: (path: string) => boolean;
}
export const LineCommentContext = React.createContext<LineComments | null>(null);

export function lineThreadInput(
  review: Pick<ReviewModel, "changes" | "comparison">,
  selection: { iteration: number; compareTo: number },
  file: FileAnchor,
  content: string,
): NewThread {
  if (review.comparison.iteration !== selection.iteration || review.comparison.compareTo !== selection.compareTo) {
    throw new Error("Wait for the selected comparison to load before commenting.");
  }
  const change = review.changes.find((c) => c.path === file.path);
  if (!change?.changeTrackingId) throw new Error("This file has no change tracking ID. Reload the diff before commenting.");
  return { content, file, comparison: { ...selection, changeTrackingId: change.changeTrackingId } };
}
