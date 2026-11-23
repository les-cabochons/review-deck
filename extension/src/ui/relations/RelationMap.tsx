import * as React from "react";
import type { Link } from "../../../../src/core/types";
import { boxTitle, layoutRelations, type MapItem, type MapNode, startOf } from "../../../../src/relations/diagram";
import { cx } from "../util";

interface Props {
  items: MapItem[];
  links: Link[];
  /** The stripe and badge colour of an item; grey when absent. */
  color?: (id: string) => string;
  /** The number on an item's badge (a concern's place in the guide). */
  badge?: (id: string) => string | null;
  /** Caption of the row of items without a link. */
  apartCaption: string;
  /** Mark the item to start reading from. */
  showStart?: boolean;
  onSelect?: (id: string) => void;
  /** Height the map may take before it scrolls. */
  height: number;
  label: string;
}

/** Below this the text is too small to read: a larger map scrolls instead of shrinking further. */
const MIN_SCALE = 0.75;
let maps = 0;

/**
 * A map of items (concerns, or the changes in one concern) and the names that link them, laid out by
 * src/relations/diagram.ts. An arrow goes from what defines a name to what uses it, both ways when each uses the
 * other. Loose links (member names only) aren't drawn.
 */
const RelationMap: React.FC<Props> = ({ items, links, color, badge, apartCaption, showStart, onSelect, height, label }) => {
  const [box, setBox] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  const [id] = React.useState(() => `relmap${++maps}`);
  React.useLayoutEffect(() => {
    if (!box) return;
    const measure = () => setWidth(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);
  const measured = width > 0;
  const fit = { width: Math.max(width - 8, 240), height };
  const map = React.useMemo(() => (measured ? layoutRelations(items, links, fit) : null), [items, links, measured, fit.width, fit.height]);
  const start = React.useMemo(() => (map && showStart ? startOf(map) : null), [map, showStart]);
  const scale = map ? Math.max(MIN_SCALE, Math.min(1, fit.width / map.width, fit.height / map.height)) : 1;

  return (
    <div className="relation-map" ref={setBox} style={{ maxHeight: height + 16 }}>
      {map && (
        <svg viewBox={`0 0 ${map.width} ${map.height}`} width={Math.ceil(map.width * scale)} height={Math.ceil(map.height * scale)} role="img" aria-label={label}>
          <defs>
            <marker id={`${id}-end`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="relation-arrowhead" d="M0,0 L10,5 L0,10 z" />
            </marker>
          </defs>
          {map.edges.map((edge) => (
            <g key={`${edge.from}>${edge.to}`} className="relation-edge">
              <title>{`${edge.from} ${edge.both ? "and" : "→"} ${edge.to}: ${edge.symbols.join(", ")}`}</title>
              <path d={smooth(edge.points)} markerEnd={`url(#${id}-end)`} markerStart={edge.both ? `url(#${id}-end)` : undefined} />
              {edge.label && (
                <text x={edge.label.x} y={edge.label.y + 4} textAnchor="middle">
                  {edge.label.text}
                </text>
              )}
            </g>
          ))}
          {map.nodes.map((node) => (
            <Box key={node.id} node={node} color={color?.(node.id)} badge={badge?.(node.id) ?? null} start={node.id === start} onSelect={onSelect} />
          ))}
          {map.apartTop !== null && (
            <text className="relation-apart-caption" x={12} y={map.apartTop + 14}>
              {apartCaption}
            </text>
          )}
          {map.apart.map((node) => (
            <Box key={node.id} node={node} color={color?.(node.id)} badge={badge?.(node.id) ?? null} start={false} onSelect={onSelect} apart />
          ))}
        </svg>
      )}
    </div>
  );
};
export default RelationMap;

const Box: React.FC<{ node: MapNode; color?: string; badge: string | null; start: boolean; apart?: boolean; onSelect?: (id: string) => void }> = ({
  node,
  color,
  badge,
  start,
  apart,
  onSelect,
}) => {
  const { x, y, width, height } = node;
  const select = onSelect ? () => onSelect(node.id) : undefined;
  const left = x + (badge ? 30 : 10);
  return (
    <g
      className={cx("relation-node", apart && "apart", select && "selectable")}
      style={color ? ({ "--node-color": color } as React.CSSProperties) : undefined}
      tabIndex={select ? 0 : undefined}
      role={select ? "button" : undefined}
      aria-label={select ? `${node.title}${start ? ", start here" : ""}. Show it.` : undefined}
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
      <title>{[node.title, node.path ?? node.subtitle].filter(Boolean).join("\n")}</title>
      <rect x={x} y={y} width={width} height={height} rx={6} />
      {badge && (
        <g className="relation-badge">
          <circle cx={x + 15} cy={y + height / 2} r={9} />
          <text x={x + 15} y={y + height / 2 + 4} textAnchor="middle">
            {badge}
          </text>
        </g>
      )}
      <text className="relation-node-title" x={left} y={node.subtitle && !apart ? y + 20 : y + height / 2 + 4}>
        {boxTitle(node.title)}
      </text>
      {node.subtitle && !apart && (
        <text className="relation-node-subtitle" x={left} y={y + 35}>
          {start && <tspan className="relation-start">start here · </tspan>}
          {fitText(node.subtitle, width - (left - x) - 8 - (start ? 80 : 0))}
        </text>
      )}
    </g>
  );
};

/** `text` cut to `room` pixels of 10.5 px monospace, keeping its end (a file name matters more than its folders). */
function fitText(text: string, room: number): string {
  const chars = Math.floor(room / 6.4);
  return text.length <= chars ? text : `…${text.slice(text.length - Math.max(chars - 1, 4))}`;
}

/** A line through dagre's points: straight to each midpoint, curving around the corners. */
function smooth(points: { x: number; y: number }[]): string {
  const at = (p: { x: number; y: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  if (points.length < 3) return `M${points.map(at).join(" L")}`;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let d = `M${at(points[0])} L${at(mid(points[0], points[1]))}`;
  for (let i = 1; i < points.length - 1; i++) d += ` Q${at(points[i])} ${at(mid(points[i], points[i + 1]))}`;
  return `${d} L${at(points[points.length - 1])}`;
}
