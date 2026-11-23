// Where the boxes and arrows of a relations map go, laid out with dagre. Text is measured by character count, which
// keeps the layout out of the DOM, so it can run anywhere and be tested.
import { Graph, layout } from "@dagrejs/dagre";
import type { Link } from "../core/types.js";
import { isLoose } from "./relations.js";

export interface MapItem {
  id: string;
  title: string;
  /** Second line: a count of changes, or a file name. */
  subtitle: string | null;
  /** The full path of a change's file, for its tooltip. */
  path?: string;
}

export interface MapNode extends MapItem {
  /** Top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapEdge {
  from: string;
  to: string;
  /** Each end uses the other: one line, an arrowhead at both ends. */
  both: boolean;
  /** The names behind the link, best first, both directions merged. */
  symbols: string[];
  points: { x: number; y: number }[];
  label: { text: string; x: number; y: number } | null;
}

export interface RelationMap {
  width: number;
  height: number;
  /** Items with a drawn link, laid out by dagre. */
  nodes: MapNode[];
  edges: MapEdge[];
  /** Items without one, in a row under the others. */
  apart: MapNode[];
  /** Where the row of items without a link starts, for its caption. Null when there are none, or nothing else. */
  apartTop: number | null;
}

const HEIGHT = 46;
const APART_HEIGHT = 30;
const GAP = 12;
const LABEL_CHAR = 6.2;
const MAX_TITLE = 34;
const width = (item: MapItem) => Math.max(130, Math.min(260, Math.max(Math.min(item.title.length, MAX_TITLE) * 7.2, (item.subtitle ?? "").length * 6.2) + 44));

/** A title cut to fit its box: the full one is the box's tooltip. */
export const boxTitle = (title: string) => (title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title);

/** One edge per pair of items, both directions merged. Loose links (member names only) are left out. */
function pairs(links: Link[], ids: ReadonlySet<string>): Omit<MapEdge, "points" | "label">[] {
  const byPair = new Map<string, Omit<MapEdge, "points" | "label"> & { names: string[]; directions: Set<string> }>();
  for (const link of links) {
    if (isLoose(link) || !ids.has(link.from) || !ids.has(link.to)) continue;
    const [a, b] = link.from < link.to ? [link.from, link.to] : [link.to, link.from];
    const key = `${a}\u0000${b}`;
    let edge = byPair.get(key);
    if (!edge) byPair.set(key, (edge = { from: link.from, to: link.to, both: false, symbols: [], names: [], directions: new Set() }));
    edge.directions.add(`${link.from}>${link.to}`);
    for (const s of link.symbols) if (!edge.names.includes(s)) edge.names.push(s);
  }
  return [...byPair.values()].map(({ names, directions, ...edge }) => ({ ...edge, both: directions.size > 1, symbols: names.filter((s) => !s.startsWith(".")).concat(names.filter((s) => s.startsWith("."))) }));
}

const labelOf = (symbols: string[]) => (symbols.length > 1 ? `${symbols[0]} +${symbols.length - 1}` : (symbols[0] ?? ""));

function lay(items: MapItem[], edges: Omit<MapEdge, "points" | "label">[], rankdir: "LR" | "TB"): Pick<RelationMap, "width" | "height" | "nodes" | "edges"> {
  const graph = new Graph();
  graph.setGraph({ rankdir, nodesep: rankdir === "LR" ? 18 : 26, ranksep: rankdir === "LR" ? 70 : 54, edgesep: 14, marginx: 12, marginy: 12 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const item of items) graph.setNode(item.id, { width: width(item), height: HEIGHT });
  for (const edge of edges) {
    const text = labelOf(edge.symbols);
    graph.setEdge(edge.from, edge.to, { width: text.length * LABEL_CHAR + 10, height: 16, labelpos: "c" });
  }
  layout(graph);
  const size = graph.graph();
  return {
    width: Math.ceil(size.width ?? 0),
    height: Math.ceil(size.height ?? 0),
    nodes: items.map((item) => {
      const at = graph.node(item.id);
      return { ...item, x: at.x - at.width / 2, y: at.y - at.height / 2, width: at.width, height: at.height };
    }),
    edges: edges.map((edge) => {
      const at = graph.edge(edge.from, edge.to);
      const text = labelOf(edge.symbols);
      return { ...edge, points: at.points ?? [], label: text && at.x !== undefined && at.y !== undefined ? { text, x: at.x, y: at.y } : null };
    }),
  };
}

/**
 * Lays out `items` and the links between them. Items with a drawn link go through dagre, left to right or top to
 * bottom, whichever overflows `fit` less; the others go in rows under them. Null when there are no items.
 */
export function layoutRelations(items: MapItem[], links: Link[], fit: { width: number; height: number }): RelationMap | null {
  if (items.length === 0) return null;
  const edges = pairs(links, new Set(items.map((i) => i.id)));
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const drawn = items.filter((i) => linked.has(i.id));
  const overflow = (m: { width: number; height: number }) => Math.max(m.width / fit.width, m.height / fit.height);
  const main = drawn.length === 0 ? { width: 0, height: 0, nodes: [], edges: [] } : [lay(drawn, edges, "LR"), lay(drawn, edges, "TB")].sort((a, b) => overflow(a) - overflow(b))[0];

  // The rest, in rows as wide as the map (or the space it has), under a caption.
  const rowWidth = Math.max(main.width, Math.min(fit.width, 720));
  const apartTop = drawn.length > 0 && drawn.length < items.length ? main.height + 4 : null;
  let x = 12;
  let y = (apartTop ?? 0) + (apartTop === null ? 12 : 22);
  const apart: MapNode[] = [];
  for (const item of items.filter((i) => !linked.has(i.id))) {
    const w = width(item);
    if (x > 12 && x + w > rowWidth - 12) {
      x = 12;
      y += APART_HEIGHT + GAP / 2;
    }
    apart.push({ ...item, subtitle: null, x, y, width: w, height: APART_HEIGHT });
    x += w + GAP;
  }
  const right = Math.max(main.width, ...apart.map((n) => n.x + n.width + 12));
  const bottom = apart.length ? y + APART_HEIGHT + 12 : main.height;
  return { width: Math.ceil(right), height: Math.ceil(bottom), nodes: main.nodes, edges: main.edges, apart, apartTop };
}

/**
 * Where to start reading: of the drawn items that use nothing else drawn, the one the most others depend on, directly
 * or through others. Null when every item uses another (a cycle) or nothing is drawn.
 */
export function startOf(map: RelationMap): string | null {
  const code = map.edges;
  const users = new Set(code.flatMap((e) => (e.both ? [e.from, e.to] : [e.to])));
  const next = new Map<string, string[]>();
  for (const e of code) (next.get(e.from) ?? next.set(e.from, []).get(e.from)!).push(e.to);
  const reach = (id: string) => {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) for (const n of next.get(stack.pop()!) ?? []) if (!seen.has(n) && n !== id) stack.push((seen.add(n), n));
    return seen.size;
  };
  const candidates = map.nodes.filter((n) => next.has(n.id) && !users.has(n.id)).map((n) => ({ id: n.id, reach: reach(n.id) }));
  candidates.sort((a, b) => b.reach - a.reach);
  return candidates[0]?.id ?? null;
}
