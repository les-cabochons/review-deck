import * as React from "react";
import type { Group, ReviewResult } from "../../../../src/core/types";
import { concernFlow, pairKey } from "../../../../src/relations/flow";
import { plural } from "../util";
import { useDiagramsShown } from "./diagramsShown";
import { DiagramControls, HowToRead } from "./HowToRead";

const RelationMap = React.lazy(() => import("./RelationMap"));

/** What the reader picked in a concern's map: a box or an arrow, and the changes it stands for. */
export interface FlowFocus {
  /** The box id, or the arrow's `pairKey`. */
  key: string;
  /** "make", or "sentence → make", for the line above the changes. */
  label: string;
  hunkIds: string[];
}

/**
 * Inside a concern of the Guided view: which of its changes use names another one defines, one box per function and
 * file (src/relations/flow.ts). Clicking a box shows only its changes, and clicking an arrow only the changes behind it:
 * the change that defines each name and the one that uses it. Clicking it again shows them all. Past
 * MAX_FLOW_BOXES boxes, a line says so instead of a map nobody can read. None of it shows once the reader hid the
 * diagrams (diagramsShown.ts).
 */
export const ConcernFlow: React.FC<{
  group: Group;
  result: ReviewResult;
  color: string;
  focus: FlowFocus | null;
  onFocus: (focus: FlowFocus | null) => void;
}> = ({ group, result, color, focus, onFocus }) => {
  const flow = React.useMemo(() => concernFlow(group, result.relations, result.hunks), [group, result]);
  const boxes = React.useMemo(() => new Map(flow.boxes.map((b) => [b.id, b])), [flow]);
  const [shown, setShown] = useDiagramsShown();
  const [reading, setReading] = React.useState(false);
  if (!shown || flow.boxes.length < 2) return null;
  const others = flow.unlinked > 0 && <span className="muted"> · {plural(flow.unlinked, "other change")} not linked</span>;
  if (flow.tooMany)
    return (
      <p className="concern-flow concern-flow-summary">
        How these changes connect: {flow.boxes.length} linked places, too many to draw{others}
      </p>
    );
  const toggle = (next: FlowFocus) => onFocus(focus?.key === next.key ? null : next);
  const showBox = (id: string) => {
    const box = boxes.get(id)!;
    toggle({ key: id, label: box.title, hunkIds: box.hunkIds });
  };
  const showArrow = (from: string, to: string) => {
    const key = pairKey(from, to);
    toggle({ key, label: `${boxes.get(from)!.title} → ${boxes.get(to)!.title}`, hunkIds: flow.arrowHunks[key] ?? [] });
  };
  return (
    <div className="concern-flow">
      <div className="concern-flow-head">
        <span>
          How these changes connect
          {others}
        </span>
        <DiagramControls reading={reading} onReading={setReading} onHide={() => setShown(false)} />
      </div>
      {reading && <HowToRead kind="changes" />}
      <React.Suspense fallback={<div className="relation-map loading">Drawing the map…</div>}>
        <RelationMap
          items={flow.boxes}
          links={flow.links}
          color={() => color}
          apartCaption=""
          onSelect={showBox}
          onSelectEdge={showArrow}
          selected={focus?.key ?? null}
          height={260}
          label={`How the changes in concern ${group.title} connect`}
        />
      </React.Suspense>
    </div>
  );
};
