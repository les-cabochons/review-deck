// Where the cards and connectors of a relations map go: columns from left to right, what is defined before what uses
// it, joined by square connectors that never cross a card. Text is measured by character count, which keeps the
// layout out of the DOM, so it can run anywhere and be tested.
import type { Link } from "../core/types.js";
import { isLoose } from "./relations.js";

export interface MapItem {
  id: string;
  title: string;
  /** Second line: a count of changes, or a file name. */
  subtitle: string | null;
  /** The full path of a change's file, for its tooltip. */
  path?: string;
  /** The card's tooltip, when its title and path don't say enough. */
  tooltip?: string;
  /** Lines the item adds and removes, shown as counts and five squares. */
  adds?: number;
  dels?: number;
}

export interface MapNode extends MapItem {
  /** Top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapEdge {
  /** `to` uses something `from` defines. */
  from: string;
  to: string;
  /** Each end uses the other: an arrowhead at both ends. */
  both: boolean;
  /** The names behind the link, best first, both directions merged, without the ends' own titles: the label's. */
  symbols: string[];
  /** All of them, the ends' own titles too: the tooltip's. */
  names: string[];
  /** The connector as SVG path data: horizontal and vertical runs with rounded corners, drawn left to right. */
  path: string;
  /** The path runs from `to` to `from`: a use that closes a cycle, whose user sits left of what it uses. */
  reversed: boolean;
  /** The names, written above the connector where it leaves its left card. Null when the cards' titles said it all. */
  label: { text: string; x: number; y: number } | null;
}

export interface RelationMap {
  width: number;
  height: number;
  /** Items with a drawn link, in columns. */
  nodes: MapNode[];
  edges: MapEdge[];
  /** Headings over the first and last columns. */
  headings: { text: string; x: number; y: number }[];
  /** Items without a link, in rows under the others. */
  apart: MapNode[];
  /** Where the rows of items without a link start, for their caption. Null when there are none, or nothing else. */
  apartTop: number | null;
}

const MARGIN = 12;
const HEADING_HEIGHT = 22;
const CARD_HEIGHT = 44;
/** Space between two connectors entering or leaving one side of a card. */
const PORT_GAP = 14;
const ROW_GAP = 12;
const APART_HEIGHT = 30;
const LABEL_CHAR = 6.1;
/** Space between two vertical runs in the gap between columns. */
const LANE = 12;
const CORNER = 6;
const MAX_TITLE = 34;
/** Room the line counts and their five squares take on a card's second line. */
const STATS_WIDTH = 112;

/** A title cut to fit its card: the full one is the card's tooltip. */
export const boxTitle = (title: string) => (title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title);

const cardWidth = (item: MapItem) => {
  const stats = item.adds !== undefined ? STATS_WIDTH : 0;
  return Math.max(170, Math.min(340, Math.max(Math.min(item.title.length, MAX_TITLE) * 7.2, (item.subtitle ?? "").length * 6.4 + stats) + 40));
};

/**
 * The first name, and how many more: "measureWorktree +1". Empty when the cards' own titles said it all. A name longer
 * than `cap` is cut: labels set how far apart the columns are, and the tooltip has the name whole.
 */
function labelOf(symbols: string[], cap: number): string {
  if (symbols.length === 0) return "";
  const name = symbols[0].length > cap ? `${symbols[0].slice(0, cap - 1)}…` : symbols[0];
  return symbols.length > 1 ? `${name} +${symbols.length - 1}` : name;
}

type Pair = Omit<MapEdge, "path" | "label" | "reversed">;

/**
 * One edge per pair of items, both directions merged. Loose links (member names only) are left out, and so are the
 * names that are an end's own title: a connector from the card `StorageCleanup` labelled `StorageCleanup` says nothing.
 */
function pairs(links: Link[], items: ReadonlyMap<string, MapItem>): Pair[] {
  const byPair = new Map<string, Pair & { directions: Set<string> }>();
  for (const link of links) {
    if (isLoose(link) || !items.has(link.from) || !items.has(link.to)) continue;
    const [a, b] = link.from < link.to ? [link.from, link.to] : [link.to, link.from];
    const key = `${a}\u0000${b}`;
    let edge = byPair.get(key);
    if (!edge) byPair.set(key, (edge = { from: link.from, to: link.to, both: false, symbols: [], names: [], directions: new Set() }));
    edge.directions.add(`${link.from}>${link.to}`);
    for (const s of link.symbols) if (!edge.names.includes(s)) edge.names.push(s);
  }
  const best = (list: string[]) => list.filter((s) => !s.startsWith(".")).concat(list.filter((s) => s.startsWith(".")));
  return [...byPair.values()].map(({ directions, ...edge }) => {
    const own = new Set([items.get(edge.from)!.title, items.get(edge.to)!.title]);
    return { ...edge, both: directions.size > 1, symbols: best(edge.names.filter((s) => !own.has(s))), names: best(edge.names) };
  });
}

/**
 * Each item's column: one past the furthest of what it uses. A use that closes a cycle doesn't count (its connector
 * is still drawn), so a cycle can't loop the layout, and its user ends up left of what it uses.
 */
function columnsOf(ids: string[], edges: Pair[]): Map<string, number> {
  const uses = new Map<string, string[]>();
  for (const e of edges) (uses.get(e.to) ?? uses.set(e.to, []).get(e.to)!).push(e.from);
  const column = new Map<string, number>();
  const open = new Set<string>();
  const visit = (id: string): number => {
    const known = column.get(id);
    if (known !== undefined) return known;
    if (open.has(id)) return -1;
    open.add(id);
    let col = 0;
    for (const from of uses.get(id) ?? []) col = Math.max(col, visit(from) + 1);
    open.delete(id);
    column.set(id, col);
    return col;
  };
  for (const id of ids) visit(id);
  return column;
}

/** A card, or a pass-through point that keeps a connector spanning several columns clear of the cards between. */
interface Slot {
  id: string;
  item: MapItem | null;
  column: number;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One hop of a connector, between two neighbouring columns: it leaves `from` at `y1` and reaches `to` at `y2`. */
interface Hop {
  edge: Pair;
  from: Slot;
  to: Slot;
  y1: number;
  y2: number;
}

function lay(items: MapItem[], edges: Pair[]): Pick<RelationMap, "width" | "height" | "nodes" | "edges" | "headings"> {
  const column = columnsOf(items.map((i) => i.id), edges);
  const slots = new Map<string, Slot>();
  for (const item of items) slots.set(item.id, { id: item.id, item, column: column.get(item.id)!, order: 0, x: 0, y: 0, width: cardWidth(item), height: CARD_HEIGHT });

  // Every connector as hops between neighbouring columns, through pass-through slots where it spans more than one.
  const hops: Hop[] = [];
  const chains = new Map<Pair, Hop[]>();
  for (const edge of edges) {
    const a = slots.get(edge.from)!;
    const b = slots.get(edge.to)!;
    // columnsOf never leaves two linked items level; if it did, the connector would have nowhere to go.
    if (a.column === b.column) continue;
    const [left, right] = a.column < b.column ? [a, b] : [b, a];
    const chain: Hop[] = [];
    let previous = left;
    for (let c = left.column + 1; c <= right.column; c++) {
      const next: Slot = c === right.column ? right : { id: `${edge.from}\u0000${edge.to}\u0000${c}`, item: null, column: c, order: 0, x: 0, y: 0, width: 0, height: PORT_GAP };
      if (!next.item) slots.set(next.id, next);
      chain.push({ edge, from: previous, to: next, y1: 0, y2: 0 });
      previous = next;
    }
    hops.push(...chain);
    chains.set(edge, chain);
  }

  const count = Math.max(...[...slots.values()].map((s) => s.column)) + 1;
  // Two columns have room for whole names; with more, long names are cut so the map still fits most pages.
  const label = (edge: Pair) => labelOf(edge.symbols, count > 2 ? 16 : 28);
  const columns: Slot[][] = Array.from({ length: count }, () => []);
  for (const slot of slots.values()) columns[slot.column].push(slot);

  // Order each column by where its neighbours sit, sweeping right, left, then right again: fewer crossings.
  const number = () => columns.forEach((col) => col.forEach((slot, i) => (slot.order = i)));
  number();
  const sortBy = (col: Slot[], neighbours: (slot: Slot) => Slot[]) => {
    const weight = new Map(
      col.map((slot) => {
        const near = neighbours(slot);
        return [slot, near.length ? near.reduce((sum, n) => sum + n.order, 0) / near.length : slot.order] as const;
      }),
    );
    col.sort((a, b) => weight.get(a)! - weight.get(b)! || a.order - b.order);
    number();
  };
  const before = (slot: Slot) => hops.filter((h) => h.to === slot).map((h) => h.from);
  const after = (slot: Slot) => hops.filter((h) => h.from === slot).map((h) => h.to);
  for (let c = 1; c < count; c++) sortBy(columns[c], before);
  for (let c = count - 2; c >= 0; c--) sortBy(columns[c], after);
  for (let c = 1; c < count; c++) sortBy(columns[c], before);

  // A card grows with the connectors on its busiest side, so each has its own port.
  for (const slot of slots.values()) {
    if (!slot.item) continue;
    const ports = Math.max(hops.filter((h) => h.to === slot).length, hops.filter((h) => h.from === slot).length);
    slot.height = Math.max(CARD_HEIGHT, 22 + ports * PORT_GAP);
  }

  // Columns are stacked from the top and centred on the tallest.
  const heights = columns.map((col) => col.reduce((sum, slot) => sum + slot.height, 0) + ROW_GAP * (col.length - 1));
  const tallest = Math.max(...heights);
  const top = MARGIN + HEADING_HEIGHT;
  columns.forEach((col, c) => {
    let y = top + (tallest - heights[c]) / 2;
    for (const slot of col) {
      slot.y = y;
      y += slot.height + ROW_GAP;
    }
  });

  // Ports: on each side of a card, connectors are spread around its middle in the order of their other ends.
  const middle = (slot: Slot) => slot.y + slot.height / 2;
  for (const slot of slots.values()) {
    const spread = (side: Hop[], other: (h: Hop) => Slot, set: (h: Hop, y: number) => void) => {
      side.sort((a, b) => middle(other(a)) - middle(other(b)));
      side.forEach((h, i) => set(h, slot.item ? middle(slot) + (i - (side.length - 1) / 2) * PORT_GAP : middle(slot)));
    };
    spread(hops.filter((h) => h.from === slot), (h) => h.to, (h, y) => (h.y1 = y));
    spread(hops.filter((h) => h.to === slot), (h) => h.from, (h, y) => (h.y2 = y));
  }

  // The gap after each column holds the labels, then one lane per vertical run.
  const lanes: Hop[][] = columns.map(() => []);
  for (const hop of hops) if (Math.abs(hop.y1 - hop.y2) > 0.5) lanes[hop.from.column].push(hop);
  // Runs going down take lanes further left as they start lower, runs going up further right: they don't cross.
  const down = (h: Hop) => h.y2 > h.y1;
  for (const gap of lanes) gap.sort((a, b) => Number(!down(a)) - Number(!down(b)) || (down(a) ? b.y1 - a.y1 : a.y1 - b.y1));
  const labelWidth = (c: number) => Math.max(0, ...[...chains.values()].filter((chain) => chain[0].from.column === c).map((chain) => label(chain[0].edge).length * LABEL_CHAR + 16));
  let x = MARGIN;
  const laneStart: number[] = [];
  columns.forEach((col, c) => {
    const wide = Math.max(...col.map((slot) => slot.width));
    // A pass-through slot is as wide as its column: the connector crosses it as one level run.
    for (const slot of col) Object.assign(slot, { x, width: wide });
    laneStart[c] = x + wide + Math.max(labelWidth(c), 24);
    x = laneStart[c] + lanes[c].length * LANE + 20;
  });
  const last = columns[count - 1];
  const width = last[0].x + last[0].width + MARGIN;

  const hopPath = (hop: Hop, first: boolean): string => {
    const x1 = hop.from.x + (hop.from.item ? hop.from.width : 0);
    const x2 = hop.to.x;
    const head = first ? `M${x1},${hop.y1}` : `H${x1}`;
    if (Math.abs(hop.y1 - hop.y2) <= 0.5) return `${head} H${x2}`;
    const lane = laneStart[hop.from.column] + (lanes[hop.from.column].indexOf(hop) + 1) * LANE;
    const dir = hop.y2 > hop.y1 ? 1 : -1;
    const r = Math.min(CORNER, Math.abs(hop.y2 - hop.y1) / 2);
    return `${head} H${lane - r} Q${lane},${hop.y1} ${lane},${hop.y1 + dir * r} V${hop.y2 - dir * r} Q${lane},${hop.y2} ${lane + r},${hop.y2} H${x2}`;
  };

  const nodes = items.map((item) => {
    const s = slots.get(item.id)!;
    return { ...item, x: s.x, y: s.y, width: s.width, height: s.height };
  });
  const mapEdges: MapEdge[] = [...chains].map(([edge, chain]) => {
    const text = label(edge);
    const start = chain[0];
    return {
      ...edge,
      path: chain.map((hop, i) => hopPath(hop, i === 0)).join(" "),
      reversed: start.from.id !== edge.from,
      label: text ? { text, x: start.from.x + start.from.width + 8, y: start.y1 - 5 } : null,
    };
  });

  const headings = count > 1 ? [{ text: "Defined here", x: MARGIN, y: MARGIN + 10 }, { text: "Uses them", x: last[0].x, y: MARGIN + 10 }] : [];
  return { width: Math.ceil(width), height: Math.ceil(top + tallest + MARGIN), nodes, edges: mapEdges, headings };
}

/**
 * Lays out `items` and the links between them. Items with a drawn link go in columns, each one past what it uses;
 * the others go in rows under them, as wide as `fit` allows. Null when there are no items.
 */
export function layoutRelations(items: MapItem[], links: Link[], fit: { width: number }): RelationMap | null {
  if (items.length === 0) return null;
  const edges = pairs(links, new Map(items.map((i) => [i.id, i])));
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const drawn = items.filter((i) => linked.has(i.id));
  const main = drawn.length === 0 ? { width: 0, height: 0, nodes: [], edges: [], headings: [] } : lay(drawn, edges);

  const rowWidth = Math.max(main.width, Math.min(fit.width, 720));
  const apartTop = drawn.length > 0 && drawn.length < items.length ? main.height + 4 : null;
  let x = MARGIN;
  let y = (apartTop ?? 0) + (apartTop === null ? MARGIN : 22);
  const apart: MapNode[] = [];
  for (const item of items.filter((i) => !linked.has(i.id))) {
    const w = Math.max(130, Math.min(260, Math.min(item.title.length, MAX_TITLE) * 7.2 + 44));
    if (x > MARGIN && x + w > rowWidth - MARGIN) {
      x = MARGIN;
      y += APART_HEIGHT + ROW_GAP / 2;
    }
    apart.push({ ...item, subtitle: null, x, y, width: w, height: APART_HEIGHT });
    x += w + ROW_GAP;
  }
  const right = Math.max(main.width, ...apart.map((n) => n.x + n.width + MARGIN));
  const bottom = apart.length ? y + APART_HEIGHT + MARGIN : main.height;
  return { ...main, width: Math.ceil(right), height: Math.ceil(bottom), apart, apartTop };
}
