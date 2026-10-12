import { declKey } from "../parse/symbols.js";
import type { HunkInfo } from "../core/types.js";

export interface MergeNote {
  from: string;
  into: string;
  symbol: string;
}

/**
 * Modularity-based clustering likes to split a new helper (plus its tests) from
 * the feature that introduced it. A declaration that did not exist before the PR
 * belongs with its users, so merge any community that adds a symbol into the
 * community that references it. Returns the merged communities and why.
 */
export function mergeNewSymbolUsers(communities: string[][], hunks: Map<string, HunkInfo>): { communities: string[][]; merges: MergeNote[] } {
  const parent = communities.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const communityOf = new Map<string, number>();
  communities.forEach((ids, i) => ids.forEach((id) => communityOf.set(id, i)));
  const merges: MergeNote[] = [];

  for (const [id, def] of hunks) {
    const ci = communityOf.get(id);
    if (ci === undefined || def.isTest || def.addedDecls.length === 0) continue;
    // Match keys for the added declarations: plain for module-level, `.name` for members.
    const keys = def.addedDecls.map((q) => {
      const name = q.split(".").pop()!;
      return def.defines.has(`.${name}`) ? declKey({ kind: "method", name }) : name;
    });
    for (const [otherId, user] of hunks) {
      const cj = communityOf.get(otherId);
      if (cj === undefined || find(ci) === find(cj)) continue;
      const used = keys.find((k) => user.references.has(k));
      if (!used) continue;
      merges.push({ from: otherId, into: id, symbol: used });
      parent[find(cj)] = find(ci);
    }
  }

  const merged = new Map<number, string[]>();
  communities.forEach((ids, i) => merged.set(find(i), [...(merged.get(find(i)) ?? []), ...ids]));
  return { communities: [...merged.values()].sort((a, b) => b.length - a.length), merges };
}
