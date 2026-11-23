// An attribute's two values side by side, with what changed between them marked, like a word diff.
import { diffWordsWithSpace } from "diff";

/** A run of one side's text: the same on both sides, changed (removed before, added after), or left out. */
export interface ValuePart {
  kind: "same" | "changed" | "elided";
  text: string;
}

export interface ValueDiff {
  before: ValuePart[];
  after: ValuePart[];
}

/** Text kept on each side of a change, in an unchanged run long enough to be cut. */
const CONTEXT = 40;

/**
 * Splits `before` and `after` into the runs they share and the runs that changed, word by word. A long unchanged run
 * keeps CONTEXT characters next to each change and loses its middle, so a long value shows where it changed. A
 * changed run is never cut.
 */
export function valueDiff(before: string, after: string): ValueDiff {
  const parts = diffWordsWithSpace(before, after);
  const side = (skip: "added" | "removed"): ValuePart[] => {
    const runs: ValuePart[] = [];
    for (const part of parts) {
      if (part[skip]) continue;
      const kind = part.added || part.removed ? "changed" : "same";
      const last = runs.at(-1);
      if (last?.kind === kind) last.text += part.value;
      else runs.push({ kind, text: part.value });
    }
    return runs.flatMap((run, i) => (run.kind === "same" ? elide(run.text, i > 0, i < runs.length - 1) : [run]));
  };
  return { before: side("added"), after: side("removed") };
}

/** An unchanged run, cut in the middle when long: `afterChange` keeps its start, `beforeChange` its end. */
function elide(text: string, afterChange: boolean, beforeChange: boolean): ValuePart[] {
  const keepStart = afterChange ? CONTEXT : 0;
  const keepEnd = beforeChange ? CONTEXT : 0;
  // Not worth an ellipsis for a few characters, and a value without any change stays whole.
  if (text.length <= keepStart + keepEnd + 12 || (!afterChange && !beforeChange)) return [{ kind: "same", text }];
  const parts: ValuePart[] = [];
  if (keepStart) parts.push({ kind: "same", text: text.slice(0, keepStart) });
  parts.push({ kind: "elided", text: "…" });
  if (keepEnd) parts.push({ kind: "same", text: text.slice(text.length - keepEnd) });
  return parts;
}
