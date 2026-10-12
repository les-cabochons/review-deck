import * as React from "react";
import type { FileDiff, Hunk } from "../../../src/core/types";
import type { Thread } from "../data/model";
import { ThreadCard } from "./ThreadCard";
import { CommentComposer } from "./CommentComposer";
import { LineCommentContext } from "./LineComments";
import { useReviewActions } from "./ReviewActions";
import { DraftCard } from "./review/DraftCard";
import { usePendingReview } from "./review/PendingReview";
import { anchorKey, lineAnnotations, pierreHunk, type LineAnchor } from "./pierre/adapter";
import { PierreDiff } from "./pierre/PierreDiff";
import { LazyMount } from "./LazyMount";

/** Hunks longer than this wait for a click, like GitHub's "Load diff". */
const LARGE_HUNK_LINES = 1000;
const LINE_HEIGHT = 20;

export type DiffMode = "inline" | "split";
export type ThreadIndex = Map<string, Thread[]>;
interface Props {
  file: FileDiff;
  hunk: Hunk;
  mode: DiffMode;
  threads: ThreadIndex;
  symbol?: string | null;
}

export const DiffHunk: React.FC<Props> = (props) => {
  const { hunk, mode } = props;
  // Large hunks that already carry comments open by default so threads are never hidden.
  const [loadLarge, setLoadLarge] = React.useState(() => lineAnnotations(hunk, props.threads.keys()).length > 0);
  const header = <div className="pierre-hunk-header">{hunk.header}{props.symbol && <strong>{props.symbol}</strong>}</div>;
  if (!hunk.header) return <div className="diff-note">No content changes, rename or mode change only.</div>;
  if (hunk.lines.length > LARGE_HUNK_LINES && !loadLarge)
    return <>
      {header}
      <div className="diff-note large-hunk">
        This change is {hunk.lines.length.toLocaleString()} lines long, so it isn't shown by default.{" "}
        <button className="link-button" onClick={() => setLoadLarge(true)}>Load diff</button>
      </div>
    </>;
  return <>
    {header}
    <LazyMount estimate={diffHeight(hunk, mode)}>
      <HunkDiff {...props} />
    </LazyMount>
  </>;
};

const HUNK_HEADER_HEIGHT = 24;

/** Placeholder height for a whole DiffHunk (header + diff) before it first renders. */
export function estimateHunkHeight(hunk: Hunk, mode: DiffMode): number {
  if (!hunk.header) return 40;
  return HUNK_HEADER_HEIGHT + (hunk.lines.length > LARGE_HUNK_LINES ? 44 : diffHeight(hunk, mode));
}

/** One row per line (changed pairs share a row side by side), plus Pierre's block padding. */
function diffHeight(hunk: Hunk, mode: DiffMode): number {
  let rows = hunk.lines.length;
  if (mode === "split") {
    const adds = hunk.lines.filter((l) => l.kind === "add").length;
    const dels = hunk.lines.filter((l) => l.kind === "del").length;
    rows -= Math.min(adds, dels);
  }
  return rows * LINE_HEIGHT + 16;
}

const HunkDiff: React.FC<Props> = ({ file, hunk, mode, threads }) => {
  const comments = React.useContext(LineCommentContext);
  const { actions, disabled } = useReviewActions();
  const pending = usePendingReview();
  const [anchor, setAnchor] = React.useState<LineAnchor | null>(null);
  const metadata = React.useMemo(() => hunk.header ? pierreHunk(file, hunk) : null, [file, hunk]);
  const drafts = pending.draftsAt(file.path);
  const annotations = React.useMemo(() => lineAnnotations(hunk, [
    ...threads.keys(), ...drafts.map(draft => anchorKey({ side: draft.thread.file!.side, line: draft.thread.file!.endLine })),
    ...(anchor ? [anchorKey(anchor)] : []),
  ]), [hunk, threads, pending.drafts, anchor]);
  const canComment = !!comments?.canComment(file.path) && !disabled;
  if (!metadata) return null;
  const inReview = pending.drafts.length > 0;
  return <>
    <PierreDiff metadata={metadata} mode={mode} annotations={annotations} onComment={canComment ? setAnchor : undefined}
      renderAnnotation={key => <>
        {(threads.get(key) ?? []).map(thread => <ThreadCard key={`thread-${thread.id}`} thread={thread} compact />)}
        {drafts.filter(draft => anchorKey({ side: draft.thread.file!.side, line: draft.thread.file!.endLine }) === key)
          .map(draft => <DraftCard key={draft.id} draft={draft} />)}
        {anchor && anchorKey(anchor) === key && <CommentComposer
          label={`Comment on ${file.path}, ${anchor.side} line ${anchor.line}`}
          onCancel={() => setAnchor(null)} onSaved={() => setAnchor(null)}
          actions={[
            { text: inReview ? "Add review comment" : "Start a review", local: true,
              onSave: content => pending.addThread(comments!.toThread({ path: file.path, ...anchor, endLine: anchor.line }, content)) },
            { text: inReview ? "Comment now" : "Add single comment",
              onSave: content => actions.createThread(comments!.toThread({ path: file.path, ...anchor, endLine: anchor.line }, content)) },
          ]}
        />}
      </>}
    />
  </>;
};
