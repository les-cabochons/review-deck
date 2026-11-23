// How a pull request's concerns connect, and how the changes inside one concern connect, read from the symbols the
// pipeline already records per hunk (HunkInfo.defines and .references). Names are matched as text, like the
// structural signal: two different things with the same name look linked, so every link carries its names.
import type { Group, HunkInfo, Link, ReviewRelations } from "../core/types.js";

export type { Link, ReviewRelations };

/** Names kept per link: enough to judge it, few enough to read. */
const MAX_SYMBOLS = 4;
/** Links kept inside one concern. A concern with more is too dense to draw. */
export const MAX_FLOW_LINKS = 40;
/** Links kept inside concerns over the whole PR, biggest concerns first, so a huge PR's guide still fits its document. */
export const MAX_FLOW_LINKS_TOTAL = 300;
/** A concern needs this many changes for its flow to be worth drawing. */
export const MIN_FLOW_CHANGES = 3;

/** `.hide`: a member, matched by its name alone whatever object it is on. The loosest kind of match. */
export const isMember = (symbol: string) => symbol.startsWith(".");

/** The link rests only on member names, which match whatever object they are on: shown, but not drawn. */
export const isLoose = (link: Link) => link.symbols.every(isMember);

/** Named symbols first, longest first (more specific), then members. */
function rank(symbols: Iterable<string>): string[] {
  return [...symbols].sort((a, b) => Number(isMember(a)) - Number(isMember(b)) || b.length - a.length || (a < b ? -1 : 1)).slice(0, MAX_SYMBOLS);
}

/**
 * Every link between two hunks of `hunks`: `user` references a name `def` defines. A hunk never links to itself. A
 * name defined in the user's own file resolves there, never to a same-named thing in another file: two different
 * `make`s in two files must not link.
 */
function hunkLinks(hunks: HunkInfo[]): Map<string, { def: HunkInfo; user: HunkInfo; symbols: Set<string> }> {
  const definers = new Map<string, HunkInfo[]>();
  for (const h of hunks) for (const s of h.defines) (definers.get(s) ?? definers.set(s, []).get(s)!).push(h);
  const links = new Map<string, { def: HunkInfo; user: HunkInfo; symbols: Set<string> }>();
  for (const user of hunks) {
    for (const s of user.references) {
      const all = definers.get(s) ?? [];
      const local = all.filter((d) => d.file.path === user.file.path);
      for (const def of local.length > 0 ? local : all) {
        if (def === user) continue;
        const key = `${def.hunk.id}\u0000${user.hunk.id}`;
        let link = links.get(key);
        if (!link) links.set(key, (link = { def, user, symbols: new Set() }));
        link.symbols.add(s);
      }
    }
  }
  return links;
}

/**
 * The links between the concerns of `groups`, and inside each. Misc and mechanical groups are left out, and so are
 * test files: that a test calls the code it tests says nothing about how the change fits together.
 */
export function relationsOf(groups: Group[], hunks: Map<string, HunkInfo>): ReviewRelations {
  const concerns = groups.filter((g) => g.kind === "semantic");
  const groupOf = new Map<string, string>();
  for (const g of concerns) for (const id of g.hunkIds) if (!hunks.get(id)?.isTest) groupOf.set(id, g.id);
  const members = [...groupOf.keys()].map((id) => hunks.get(id)).filter((h): h is HunkInfo => !!h);

  const between = new Map<string, Link & { names: Set<string> }>();
  const inside = new Map<string, Map<string, Link & { names: Set<string> }>>();
  for (const { def, user, symbols } of hunkLinks(members).values()) {
    const from = groupOf.get(def.hunk.id)!;
    const to = groupOf.get(user.hunk.id)!;
    const [map, a, b] = from === to ? [inside.get(from) ?? inside.set(from, new Map()).get(from)!, def.hunk.id, user.hunk.id] : [between, from, to];
    const key = `${a}\u0000${b}`;
    let link = map.get(key);
    if (!link) map.set(key, (link = { from: a, to: b, symbols: [], names: new Set() }));
    for (const s of symbols) link.names.add(s);
  }
  const done = ({ names, ...link }: Link & { names: Set<string> }): Link => ({ ...link, symbols: rank(names) });
  const order = (a: Link, b: Link) => (a.from + "\u0000" + a.to < b.from + "\u0000" + b.to ? -1 : 1);
  const flows: Record<string, Link[]> = {};
  let kept = 0;
  for (const g of [...concerns].sort((a, b) => b.hunkIds.length - a.hunkIds.length)) {
    const links = inside.get(g.id);
    if (!links || g.hunkIds.filter((id) => groupOf.has(id)).length < MIN_FLOW_CHANGES || links.size > MAX_FLOW_LINKS || kept + links.size > MAX_FLOW_LINKS_TOTAL) continue;
    flows[g.id] = [...links.values()].map(done).sort(order);
    kept += links.size;
  }
  return { links: [...between.values()].map(done).sort(order), flows };
}

/**
 * Relations as saved with a guide (extension/src/review/saved.ts), checked: links whose ends aren't `groupIds` (or,
 * inside a concern, `hunkIds`) are dropped, and so is anything malformed. Null when there is nothing readable.
 */
export function readRelations(raw: unknown, groupIds: ReadonlySet<string>, hunkIds: ReadonlySet<string>): ReviewRelations | null {
  const r = raw as { links?: unknown; flows?: unknown } | null | undefined;
  if (!r || !Array.isArray(r.links) || typeof r.flows !== "object" || r.flows === null || Array.isArray(r.flows)) return null;
  const link = (ids: ReadonlySet<string>) => (l: unknown): l is Link => {
    const x = l as Partial<Link> | null;
    return (
      // A link a test made, saved before tests were left out, is dropped like a malformed one.
      typeof x?.from === "string" && typeof x.to === "string" && ids.has(x.from) && ids.has(x.to) && (x as { kind?: unknown }).kind !== "tests" &&
      Array.isArray(x.symbols) && x.symbols.every((s) => typeof s === "string")
    );
  };
  const clean = (l: Link): Link => ({ from: l.from, to: l.to, symbols: l.symbols.slice(0, MAX_SYMBOLS) });
  const flows: Record<string, Link[]> = {};
  for (const [group, links] of Object.entries(r.flows as Record<string, unknown>)) {
    if (groupIds.has(group) && Array.isArray(links)) flows[group] = links.filter(link(hunkIds)).slice(0, MAX_FLOW_LINKS).map(clean);
  }
  return { links: r.links.filter(link(groupIds)).map(clean), flows };
}
