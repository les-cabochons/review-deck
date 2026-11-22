import * as React from "react";
import { needsLook } from "../../../../src/infra/blocks";
import { type Diagram, layoutDiagram } from "../../../../src/infra/diagram";
import type { InfraModule } from "../../../../src/infra/types";
import { cx } from "../util";
import { verdict } from "./verdict";

interface Props {
  module: InfraModule;
  /** A thumbnail: scaled to fit whole, without labels or addresses, and not interactive. */
  compact?: boolean;
  /** A changed box or chip was clicked, or activated with Enter or Space. */
  onSelect?: (address: string) => void;
}

/** The space the full diagram may take before it scrolls, and the thumbnail's. */
const HEIGHT = { full: 440, compact: 150 };
/** Below this the text is too small to read: a larger diagram scrolls instead of shrinking further. */
const MIN_SCALE = 0.75;
let diagrams = 0;

/**
 * The diagram of a module's changes: each changed resource with what the change involves around it
 * (src/infra/diagram.ts picks and places them). Colour is never the only cue: every state has its own symbol
 * and border.
 */
const InfraDiagram: React.FC<Props> = ({ module, compact, onSelect }) => {
  const [box, setBox] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  // Arrowhead markers are looked up by id in the whole document, so each diagram needs its own.
  const [id] = React.useState(() => `infra-d${++diagrams}`);
  React.useLayoutEffect(() => {
    if (!box) return;
    const measure = () => setWidth(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);

  const fit = { width: Math.max(width - 8, 240), height: compact ? HEIGHT.compact : HEIGHT.full };
  // Not before the box is measured: `measured` is a dependency because a narrow box has the same `fit` as an unmeasured one.
  const measured = width > 0;
  const diagram = React.useMemo(() => (measured ? layoutDiagram(module, fit) : null), [module, measured, fit.width, fit.height]);
  const scale = diagram ? Math.max(compact ? 0 : MIN_SCALE, Math.min(1, fit.width / diagram.width, fit.height / diagram.height)) : 1;

  return (
    <div className={cx("infra-diagram", compact && "compact")} ref={setBox} style={compact ? undefined : { maxHeight: HEIGHT.full + 16 }}>
      {measured && !diagram && <p className="muted infra-diagram-empty">Nothing to draw: no resource, data source or module changed.</p>}
      {diagram && (
        <svg
          viewBox={`0 0 ${diagram.width} ${diagram.height}`}
          width={Math.ceil(diagram.width * scale)}
          height={Math.ceil(diagram.height * scale)}
          role={compact ? undefined : "group"}
          aria-label={`Diagram of the Terraform changes in ${module.dir || "the repository root"}`}
          aria-hidden={compact || undefined}
        >
          <defs>
            {(["same", "added", "removed", "touched"] as const).map((status) => (
              <marker key={status} id={`${id}-${status}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path className={cx("infra-arrowhead", status)} d="M0,0 L10,5 L0,10 z" />
              </marker>
            ))}
          </defs>
          {diagram.edges.map(({ edge, points, label }) => (
            <g key={`${edge.from}>${edge.to}`} className={cx("infra-edge", edge.status)}>
              <title>{`${edge.to} uses ${edge.from} through ${edge.via.join(", ")}`}</title>
              <path d={smooth(points)} markerEnd={`url(#${id}-${edge.status})`} />
              {label && !compact && (
                <text x={label.x} y={label.y + 4} textAnchor="middle">
                  {EDGE_MARK[edge.status]} {label.text}
                </text>
              )}
            </g>
          ))}
          {diagram.nodes.map((node) => (
            <NodeShape key={node.block.address} node={node} compact={!!compact} onSelect={onSelect} />
          ))}
        </svg>
      )}
    </div>
  );
};
export default InfraDiagram;

const EDGE_MARK = { added: "+", removed: "−", touched: "~", same: "" };

const NodeShape: React.FC<{ node: Diagram["nodes"][number]; compact: boolean; onSelect?: (address: string) => void }> = ({ node, compact, onSelect }) => {
  const { block, shape, x, y, width, height } = node;
  const { tone, symbol, label } = verdict(block);
  const select = onSelect && !compact && needsLook(block) ? () => onSelect(block.address) : undefined;
  const title = `${symbol ? `${symbol} ` : ""}${node.title}`;
  return (
    <g
      className={cx("infra-node", shape, `tone-${tone}`, select && "selectable")}
      tabIndex={select ? 0 : undefined}
      role={select ? "button" : undefined}
      aria-label={select ? `${block.address}, ${label}. Show details.` : undefined}
      onClick={select}
      onKeyDown={
        select &&
        ((e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          select();
        })
      }
    >
      <title>{`${block.address}: ${label}${block.file ? "" : " (declared in a file this pull request doesn't change)"}`}</title>
      <rect x={x} y={y} width={width} height={height} rx={shape === "chip" ? height / 2 : 6} />
      {shape === "chip" ? (
        <text className="infra-node-title" x={x + width / 2} y={y + height / 2 + 4} textAnchor="middle">
          {title}
        </text>
      ) : (
        <>
          <text className="infra-node-title" x={x + 11} y={compact ? y + height / 2 + 5 : y + 21}>
            {title}
          </text>
          {!compact && (
            <text className="infra-node-address" x={x + 11} y={y + 37}>
              {node.subtitle}
            </text>
          )}
        </>
      )}
    </g>
  );
};

/** A line through dagre's points: straight to each midpoint, curving around the corners. */
function smooth(points: { x: number; y: number }[]): string {
  const at = (p: { x: number; y: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  if (points.length < 3) return `M${points.map(at).join(" L")}`;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let d = `M${at(points[0])} L${at(mid(points[0], points[1]))}`;
  for (let i = 1; i < points.length - 1; i++) d += ` Q${at(points[i])} ${at(mid(points[i], points[i + 1]))}`;
  return `${d} L${at(points[points.length - 1])}`;
}
