import { Graph, layout } from "@dagrejs/dagre";
import { blockTitle, isChanged, isInfrastructure } from "./blocks.js";
import type { InfraBlock, InfraEdge, InfraModule } from "./types.js";

export interface DiagramNode {
  block: InfraBlock;
  /** `box`: a resource, data source or module. `chip`: a variable, local or output. */
  shape: "box" | "chip";
  title: string;
  /** A box's second line: the address. */
  subtitle: string | null;
  /** Top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdge {
  edge: InfraEdge;
  /** The line's points, from `edge.from` to `edge.to`. */
  points: { x: number; y: number }[];
  /** For an edge that isn't `same`: the attributes holding the reference, and where to write them. */
  label: { text: string; x: number; y: number } | null;
}

export interface Diagram {
  width: number;
  height: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const isWiring = (block: InfraBlock) => block.kind === "variable" || block.kind === "local" || block.kind === "output";

/**
 * What the diagram draws: every changed resource, data source and module, plus what the change involves around
 * them. That is what a changed block uses through a changed line, what uses a changed block, and the changed
 * variables, locals and outputs wired to one of them. A changed variable with nothing drawn around it is left to
 * the list.
 */
function drawn(module: InfraModule): { blocks: InfraBlock[]; edges: InfraEdge[] } {
  const byAddress = new Map(module.blocks.map((b) => [b.address, b]));
  const picked = new Set<string>();
  for (const block of module.blocks) if (isChanged(block) && (isInfrastructure(block) || isWiring(block))) picked.add(block.address);
  const drawable = (block: InfraBlock) => isInfrastructure(block) || (isWiring(block) && isChanged(block));
  for (const edge of module.edges) {
    const from = byAddress.get(edge.from)!;
    const to = byAddress.get(edge.to)!;
    // An unchanged reference of a changed block says nothing about the change, so its target stays out.
    if (isChanged(to) && drawable(from) && (to.status !== "changed" || edge.status !== "same")) picked.add(from.address);
    if (isChanged(from) && isInfrastructure(to)) picked.add(to.address);
  }
  const edges = module.edges.filter((e) => picked.has(e.from) && picked.has(e.to));
  for (const address of [...picked]) {
    if (isWiring(byAddress.get(address)!) && !edges.some((e) => e.from === address || e.to === address)) picked.delete(address);
  }
  return { blocks: [...picked].map((a) => byAddress.get(a)!), edges: edges.filter((e) => picked.has(e.from) && picked.has(e.to)) };
}

// Text is measured by character count: close enough for a monospace address and a short title, and it keeps the
// layout out of the DOM, so it can run anywhere and be tested.
const BOX_HEIGHT = 50;
const CHIP_HEIGHT = 30;
const boxWidth = (title: string, subtitle: string) => Math.max(170, Math.min(290, Math.max(title.length * 7.4, subtitle.length * 6.5) + 26));
const chipWidth = (title: string) => Math.max(110, Math.min(260, title.length * 6.6 + 30));
const LABEL_CHAR = 6.2;

/** `app_settings.API_KEY` reads as `API_KEY`: the map's name adds nothing next to the arrow. */
function edgeLabel(edge: InfraEdge): string {
  const short = edge.via.map((path) => path.replace(/^app_settings\./, ""));
  return short.slice(0, 2).join(", ") + (short.length > 2 ? ` +${short.length - 2}` : "");
}

function lay(blocks: InfraBlock[], edges: InfraEdge[], rankdir: "LR" | "TB"): Diagram {
  const graph = new Graph();
  graph.setGraph({ rankdir, nodesep: rankdir === "LR" ? 16 : 22, ranksep: rankdir === "LR" ? 46 : 40, edgesep: 12, marginx: 14, marginy: 14 });
  graph.setDefaultEdgeLabel(() => ({}));
  const nodes = new Map<string, Omit<DiagramNode, "x" | "y">>();
  for (const block of blocks) {
    const { title, subtitle } = blockTitle(block);
    const shape = isWiring(block) ? "chip" : "box";
    const width = shape === "chip" ? chipWidth(title) : boxWidth(title, subtitle ?? "");
    const height = shape === "chip" ? CHIP_HEIGHT : BOX_HEIGHT;
    nodes.set(block.address, { block, shape, title, subtitle, width, height });
    graph.setNode(block.address, { width, height });
  }
  const labels = new Map<InfraEdge, string>();
  for (const edge of edges) {
    const text = edge.status === "same" ? "" : edgeLabel(edge);
    labels.set(edge, text);
    graph.setEdge(edge.from, edge.to, { width: text ? text.length * LABEL_CHAR + 10 : 0, height: text ? 16 : 0, labelpos: "c" });
  }
  layout(graph);
  const size = graph.graph();
  return {
    width: Math.ceil(size.width ?? 0),
    height: Math.ceil(size.height ?? 0),
    nodes: [...nodes].map(([address, node]) => {
      const at = graph.node(address);
      return { ...node, x: at.x - node.width / 2, y: at.y - node.height / 2 };
    }),
    edges: edges.map((edge) => {
      const at = graph.edge(edge.from, edge.to);
      const text = labels.get(edge)!;
      return { edge, points: at.points ?? [], label: text && at.x !== undefined && at.y !== undefined ? { text, x: at.x, y: at.y } : null };
    }),
  };
}

/**
 * Lays out a module's changes, or returns null when it changes nothing a diagram can show. Tries left-to-right and
 * top-to-bottom and keeps the one that overflows `fit` (the space the page has, in pixels) the least.
 */
export function layoutDiagram(module: InfraModule, fit: { width: number; height: number }): Diagram | null {
  const { blocks, edges } = drawn(module);
  if (blocks.length === 0) return null;
  const overflow = (d: Diagram) => Math.max(d.width / fit.width, d.height / fit.height);
  return [lay(blocks, edges, "LR"), lay(blocks, edges, "TB")].sort((a, b) => overflow(a) - overflow(b))[0];
}
