import * as React from "react";
import type { Link } from "../../../../src/core/types";
import { boxTitle, layoutRelations, type MapEdge, type MapItem, type MapNode } from "../../../../src/relations/diagram";
import { cx } from "../util";
import { DiagramCanvas } from "./DiagramCanvas";

interface Props {
  items: MapItem[];
  links: Link[];
  /** The colour of an item's bar and badge; grey when absent. */
  color?: (id: string) => string;
  /** The number on an item's badge (a concern's place in the guide). */
  badge?: (id: string) => string | null;
  /** Caption of the rows of items without a link. */
  apartCaption: string;
  onSelect?: (id: string) => void;
  /** A connector was clicked, or activated with Enter or Space. Without it, connectors only have their tooltip. */
  onSelectEdge?: (from: string, to: string) => void;
  /** The card id, or the `pairKey` of a connector's two cards, drawn as selected. */
  selected?: string | null;
  /** Height the map may take; the rest is reached by dragging (DiagramCanvas). */
  height: number;
  label: string;
  /** Extra class on a card, such as the Infra view's `tone-replace`. */
  cardClass?: (id: string) => string | undefined;
  /** Whether a card can be picked; all of them when absent. */
  selectable?: (id: string) => boolean;
  /**
   * How to draw a connector: an extra class (`added`, `removed`, `touched`), a mark before its label ("+ "), and
   * whether it is quiet: drawn, but without a label.
   */
  edgeInfo?: (from: string, to: string) => { className?: string; mark?: string; quiet?: boolean } | undefined;
  /** A thumbnail: fitted whole into `height`, without labels, not interactive, not draggable. */
  compact?: boolean;
}

/** The arrowheads a map defines, one per connector class, so a head takes its line's colour. */
const HEADS = ["", "added", "removed", "touched"];

let maps = 0;

/**
 * A map of items (concerns, or the changes in one concern) and the names that link them, laid out by
 * src/relations/diagram.ts: columns from left to right, what is defined before what uses it. A connector's arrowhead
 * is on the user's side, on both sides when each uses the other. Loose links (member names only) aren't drawn.
 */
const RelationMap: React.FC<Props> = ({ items, links, color, badge, apartCaption, onSelect, onSelectEdge, selected, height, label, cardClass, selectable, edgeInfo, compact }) => {
  const [box, setBox] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  // Arrowhead markers are looked up by id in the whole document, so each map needs its own.
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
  const room = Math.max(width - 8, 240);
  const map = React.useMemo(() => (measured ? layoutRelations(items, links, { width: room }) : null), [items, links, measured, room]);
  const titles = React.useMemo(() => new Map(items.map((i) => [i.id, i.title])), [items]);
  const pick = (id: string) => (onSelect && !compact && (!selectable || selectable(id)) ? onSelect : undefined);

  const svg = map && (
        <svg
          viewBox={`0 0 ${map.width} ${map.height}`}
          width={compact ? Math.ceil(map.width * Math.min(1, room / map.width, height / map.height)) : map.width}
          height={compact ? Math.ceil(map.height * Math.min(1, room / map.width, height / map.height)) : map.height}
          role={compact ? undefined : "img"}
          aria-hidden={compact || undefined}
          aria-label={compact ? undefined : label}
        >
          <defs>
            {HEADS.map((head) => (
              <marker key={head} id={`${id}-end${head && `-${head}`}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path className={cx("relation-arrowhead", head)} d="M0,0 L10,5 L0,10 z" />
              </marker>
            ))}
          </defs>
          {map.headings.map((h) => (
            <text key={h.text} className="relation-heading" x={h.x} y={h.y}>
              {h.text}
            </text>
          ))}
          {map.edges.map((edge) => {
            const info = edgeInfo?.(edge.from, edge.to);
            const head = info?.className && HEADS.includes(info.className) ? `-${info.className}` : "";
            return (
              <Connector
                key={`${edge.from}>${edge.to}`}
                edge={edge}
                marker={`url(#${id}-end${head})`}
                titles={titles}
                selected={selected}
                onSelect={compact ? undefined : onSelectEdge}
                className={info?.className}
                mark={info?.mark}
                quiet={compact || info?.quiet}
              />
            );
          })}
          {map.nodes.map((node) => (
            <Card key={node.id} node={node} color={color?.(node.id)} badge={badge?.(node.id) ?? null} onSelect={pick(node.id)} selected={selected === node.id} className={cardClass?.(node.id)} />
          ))}
          {map.apartTop !== null && (
            <text className="relation-apart-caption" x={12} y={map.apartTop + 14}>
              {apartCaption}
            </text>
          )}
          {map.apart.map((node) => (
            <Card key={node.id} node={node} color={color?.(node.id)} badge={badge?.(node.id) ?? null} onSelect={pick(node.id)} apart className={cardClass?.(node.id)} />
          ))}
        </svg>
  );

  return (
    <div className={cx("relation-map", compact && "compact")} ref={setBox}>
      {map &&
        (compact ? (
          svg
        ) : (
          <DiagramCanvas contentWidth={map.width} contentHeight={map.height} maxHeight={height} label={label}>
            {svg}
          </DiagramCanvas>
        ))}
    </div>
  );
};
export default RelationMap;

const onKey = (act: () => void) => (e: React.KeyboardEvent) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  act();
};

const Connector: React.FC<{
  edge: MapEdge;
  marker: string;
  titles: Map<string, string>;
  selected?: string | null;
  onSelect?: (from: string, to: string) => void;
  className?: string;
  /** Written before the label: "+ " for a reference the change adds. */
  mark?: string;
  /** Drawn without its label. */
  quiet?: boolean;
}> = ({ edge, marker, titles, selected, onSelect, className, mark, quiet }) => {
  const select = onSelect ? () => onSelect(edge.from, edge.to) : undefined;
  const key = edge.from < edge.to ? `${edge.from}\u0001${edge.to}` : `${edge.to}\u0001${edge.from}`;
  const tooltip = edgeTooltip(edge, titles);
  return (
    <g
      className={cx("relation-edge", className, select && "selectable", selected === key && "selected")}
      tabIndex={select ? 0 : undefined}
      role={select ? "button" : undefined}
      aria-pressed={select ? selected === key : undefined}
      aria-label={select ? `${tooltip}. Show only these changes.` : undefined}
      onClick={select}
      onKeyDown={select && onKey(select)}
    >
      <title>{tooltip}</title>
      {/* The line is 1.5 px: a wide invisible copy under it is what the pointer finds. */}
      <path className="relation-edge-hit" d={edge.path} />
      {/* The path runs left to right; the arrowhead goes on the user's side. */}
      <path d={edge.path} markerEnd={edge.both || !edge.reversed ? marker : undefined} markerStart={edge.both || edge.reversed ? marker : undefined} />
      {edge.label && !quiet && (
        <text x={edge.label.x} y={edge.label.y}>
          {mark}
          {edge.label.text}
        </text>
      )}
    </g>
  );
};

/** How many of a card's five squares are green: its share of added lines, with at least one square for each side that has lines. */
function greenSquares(adds: number, dels: number): number {
  if (adds + dels === 0) return 0;
  return Math.max(adds > 0 ? 1 : 0, Math.min(dels > 0 ? 4 : 5, Math.round((5 * adds) / (adds + dels))));
}

const Card: React.FC<{
  node: MapNode;
  color?: string;
  badge: string | null;
  apart?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  className?: string;
}> = ({ node, color, badge, apart, selected, onSelect, className }) => {
  const { x, y, width, height } = node;
  const select = onSelect ? () => onSelect(node.id) : undefined;
  const left = x + (badge ? 34 : 13);
  // Two lines of text, centred in a card that may be taller for its connectors.
  const line1 = y + height / 2 - 3;
  const line2 = y + height / 2 + 13;
  const stats = !apart && node.adds !== undefined && node.dels !== undefined ? { adds: node.adds, dels: node.dels, green: greenSquares(node.adds, node.dels) } : null;
  const subtitleRoom = width - (left - x) - 8 - (stats ? 108 : 0);
  return (
    <g
      className={cx("relation-node", className, apart && "apart", select && "selectable", selected && "selected")}
      aria-pressed={select ? !!selected : undefined}
      style={color ? ({ "--node-color": color } as React.CSSProperties) : undefined}
      tabIndex={select ? 0 : undefined}
      role={select ? "button" : undefined}
      aria-label={select ? `${node.tooltip ?? `${node.title}${node.subtitle ? `, ${node.subtitle}` : ""}`}${stats ? `, ${stats.adds} added, ${stats.dels} removed` : ""}. Show it.` : undefined}
      onClick={select}
      onKeyDown={select && onKey(select)}
    >
      <title>{node.tooltip ?? [node.title, node.path ?? node.subtitle].filter(Boolean).join("\n")}</title>
      <rect className="relation-card" x={x} y={y} width={width} height={height} rx={7} />
      <rect className="relation-bar" x={x} y={y + 7} width={3} height={height - 14} rx={1.5} />
      {badge && (
        <g className="relation-badge">
          <circle cx={x + 19} cy={y + height / 2} r={9} />
          <text x={x + 19} y={y + height / 2 + 4} textAnchor="middle">
            {badge}
          </text>
        </g>
      )}
      <text className="relation-node-title" x={left} y={node.subtitle && !apart ? line1 : y + height / 2 + 4}>
        {boxTitle(node.title)}
      </text>
      {node.subtitle && !apart && (
        <text className="relation-node-subtitle" x={left} y={line2}>
          {fitText(node.subtitle, subtitleRoom)}
        </text>
      )}
      {stats && (
        <>
          <text className="relation-stats" x={x + width - 62} y={line2} textAnchor="end">
            <tspan className="adds">+{stats.adds}</tspan> <tspan className="dels">−{stats.dels}</tspan>
          </text>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} className={i < stats.green ? "relation-square adds" : "relation-square dels"} x={x + width - 55 + i * 9} y={line2 - 8} width={7} height={7} rx={1.5} />
          ))}
        </>
      )}
    </g>
  );
};

/**
 * A connector's tooltip, in full: "make uses sentence, cleanupFailureReason and REPORT_ENTRY_LIMIT from sentence", or
 * "layerRuntimeCoreDependenciesBase uses StorageCleanup" when the only name is the card it comes from. The card a
 * connector goes to doesn't use its own name, so that name is left out.
 */
function edgeTooltip(edge: { from: string; to: string; both: boolean; names: string[] }, titles: Map<string, string>): string {
  const from = titles.get(edge.from) ?? edge.from;
  const to = titles.get(edge.to) ?? edge.to;
  const used = edge.names.filter((n) => edge.both || n !== to);
  const list = used.length > 1 ? `${used.slice(0, -1).join(", ")} and ${used.at(-1)}` : (used[0] ?? "");
  if (edge.both) return `${from} and ${to} use each other: ${list}`;
  return used.length === 1 && used[0] === from ? `${to} uses ${from}` : `${to} uses ${list} from ${from}`;
}

/** `text` cut to `room` pixels of 10.5 px monospace, keeping its end (a file name matters more than its folders). */
function fitText(text: string, room: number): string {
  const chars = Math.floor(room / 6.4);
  return text.length <= chars ? text : `…${text.slice(text.length - Math.max(chars - 1, 4))}`;
}
