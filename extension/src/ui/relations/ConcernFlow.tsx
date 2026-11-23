import * as React from "react";
import type { Group, ReviewResult } from "../../../../src/core/types";
import { isLoose } from "../../../../src/relations/relations";
import { plural } from "../util";

const RelationMap = React.lazy(() => import("./RelationMap"));

/** The concern's changes that use each other's names, and their links. Empty when none do through a named symbol. */
function flowOf(group: Group, result: ReviewResult) {
  const links = (result.relations?.flows[group.id] ?? []).filter((l) => !isLoose(l));
  const ids = [...new Set(links.flatMap((l) => [l.from, l.to]))].filter((id) => result.hunks.has(id));
  const items = ids.map((id) => {
    const h = result.hunks.get(id)!;
    const file = h.file.path.slice(h.file.path.lastIndexOf("/") + 1);
    // The file name: the full path is in the box's tooltip and on the change below.
    return { id, title: h.symbol ?? file, subtitle: h.symbol ? file : `change ${h.hunk.index + 1}`, path: h.file.path };
  });
  return { items, links };
}

/** True when the concern has a flow worth drawing. */
export function hasFlow(group: Group, result: ReviewResult): boolean {
  return flowOf(group, result).items.length >= 2;
}

/**
 * Inside a concern of the Guided view: which of its changes use names another one defines, so the reader can start
 * from the change everything else builds on. Clicking a change scrolls to it.
 */
export const ConcernFlow: React.FC<{ group: Group; result: ReviewResult; color: string }> = ({ group, result, color }) => {
  const { items, links } = React.useMemo(() => flowOf(group, result), [group, result]);
  if (items.length < 2) return null;
  const others = group.hunkIds.length - items.length;
  const show = (id: string) => {
    const card = document.getElementById(`hunk-${id}`);
    card?.scrollIntoView({ behavior: "smooth", block: "start" });
    card?.classList.add("flash");
    setTimeout(() => card?.classList.remove("flash"), 1500);
  };
  return (
    <details className="concern-flow" open>
      <summary>
        How these changes connect
        {others > 0 && <span className="muted"> · {plural(others, "other change")} not linked</span>}
      </summary>
      <React.Suspense fallback={<div className="relation-map loading">Drawing the map…</div>}>
        <RelationMap
          items={items}
          links={links}
          color={() => color}
          apartCaption=""
          showStarts
          onSelect={show}
          height={260}
          label={`How the changes in concern ${group.title} connect`}
        />
      </React.Suspense>
    </details>
  );
};
