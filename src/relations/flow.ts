// The boxes of a concern's flow map: its changes, merged per function and file, and the links between them.
import type { Group, HunkInfo, Link, ReviewRelations } from "../core/types.js";
import type { MapItem } from "./diagram.js";
import { isLoose } from "./relations.js";

/** Past this many boxes a flow map can't be read; the concern then gets a one-line summary instead. */
export const MAX_FLOW_BOXES = 12;

export interface FlowBox extends MapItem {
  /** The changes in the box, in diff order: a click goes to the first. */
  hunkIds: string[];
}

export interface ConcernFlowMap {
  boxes: FlowBox[];
  /** Between boxes, both directions kept, a box's own changes linking each other left out. */
  links: Link[];
  /** More boxes than MAX_FLOW_BOXES: summarize, don't draw. */
  tooMany: boolean;
  /** Changes of the concern in no box, test files aside: nothing links them. */
  unlinked: number;
  /**
   * The changes behind each arrow, by `pairKey` of its two boxes: the change that defines a name and the change that
   * uses it, for every name the arrow stands for. An arrow between two big boxes may involve only a few of their changes.
   */
  arrowHunks: Record<string, string[]>;
}

/** The key of an arrow between boxes `a` and `b`, whichever way it points. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`);

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The flow of `group`: changes linked through a named symbol, one box per function and file. Changes inside the same
 * function of the same file share a box, so a large function edited in many places is one box, not many boxes with
 * its name. Every box reads the same way: the function as its title, its file (and how many changes, past one) below.
 * A change outside any function gets its own box, titled by its place in the file.
 */
export function concernFlow(group: Group, relations: ReviewRelations | undefined, hunks: Map<string, HunkInfo>): ConcernFlowMap {
  const links = (relations?.flows[group.id] ?? []).filter((l) => !isLoose(l) && hunks.has(l.from) && hunks.has(l.to));
  const linked = new Set(links.flatMap((l) => [l.from, l.to]));
  const boxOf = new Map<string, string>();
  const members = new Map<string, HunkInfo[]>();
  for (const id of group.hunkIds) {
    if (!linked.has(id)) continue;
    const h = hunks.get(id)!;
    const box = h.symbol ? `${h.file.path}\u0000${h.symbol}` : id;
    boxOf.set(id, box);
    (members.get(box) ?? members.set(box, []).get(box)!).push(h);
  }

  const boxes: FlowBox[] = [...members].map(([id, hs]) => {
    const count = hs.length > 1 ? ` · ${plural(hs.length, "change")}` : "";
    return {
      id,
      title: hs[0].symbol ?? `change ${hs[0].hunk.index + 1}`,
      subtitle: `${basename(hs[0].file.path)}${count}`,
      path: hs[0].file.path,
      hunkIds: hs.map((h) => h.hunk.id),
    };
  });
  const merged = new Map<string, Link>();
  const arrowHunks: Record<string, string[]> = {};
  for (const l of links) {
    const from = boxOf.get(l.from);
    const to = boxOf.get(l.to);
    if (!from || !to || from === to) continue;
    const involved = (arrowHunks[pairKey(from, to)] ??= []);
    for (const id of [l.from, l.to]) if (!involved.includes(id)) involved.push(id);
    const key = `${from}\u0001${to}`;
    const link = merged.get(key) ?? { from, to, symbols: [] };
    for (const s of l.symbols) if (!link.symbols.includes(s)) link.symbols.push(s);
    merged.set(key, link);
  }
  const drawn = new Set([...merged.values()].flatMap((l) => [l.from, l.to]));
  const shown = boxes.filter((b) => drawn.has(b.id));
  return {
    boxes: shown,
    links: [...merged.values()],
    tooMany: shown.length > MAX_FLOW_BOXES,
    unlinked: group.hunkIds.filter((id) => !hunks.get(id)?.isTest).length - shown.reduce((n, b) => n + b.hunkIds.length, 0),
    // In diff order, like the boxes' changes.
    arrowHunks: Object.fromEntries(Object.entries(arrowHunks).map(([key, ids]) => [key, group.hunkIds.filter((id) => ids.includes(id))])),
  };
}
