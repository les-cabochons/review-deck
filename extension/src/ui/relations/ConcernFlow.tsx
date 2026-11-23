import * as React from "react";
import type { Group, ReviewResult } from "../../../../src/core/types";
import { concernFlow } from "../../../../src/relations/flow";
import { plural } from "../util";
import { useDiagramsShown } from "./diagramsShown";
import { DiagramControls, HowToRead } from "./HowToRead";

const RelationMap = React.lazy(() => import("./RelationMap"));

/**
 * Inside a concern of the Guided view: which of its changes use names another one defines, one box per function and
 * file (src/relations/flow.ts). Clicking a box goes to its first change. Past
 * MAX_FLOW_BOXES boxes, a line says so instead of a map nobody can read. None of it shows once the reader hid the
 * diagrams (diagramsShown.ts).
 */
export const ConcernFlow: React.FC<{ group: Group; result: ReviewResult; color: string }> = ({ group, result, color }) => {
  const flow = React.useMemo(() => concernFlow(group, result.relations, result.hunks), [group, result]);
  const first = React.useMemo(() => new Map(flow.boxes.map((b) => [b.id, b.hunkIds[0]])), [flow]);
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
  const show = (box: string) => {
    const card = document.getElementById(`hunk-${first.get(box)}`);
    card?.scrollIntoView({ behavior: "smooth", block: "start" });
    card?.classList.add("flash");
    setTimeout(() => card?.classList.remove("flash"), 1500);
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
          onSelect={show}
          height={260}
          label={`How the changes in concern ${group.title} connect`}
        />
      </React.Suspense>
    </div>
  );
};
