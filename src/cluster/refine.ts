import type { HunkInfo } from "../core/types.js";

export interface MergeNote {
  from: string;
  into: string;
  symbol: string;
}

export interface MergeOptions {
  /** Only communities up to this size can be absorbed (a helper plus its tests, not a whole concern). */
  maxSize: number;
}

/**
 * Modularity-based clustering likes to split a new private helper (plus its tests)
 * from the feature that introduced it. If every use of a small community's newly
 * added symbols sits in exactly one other community, absorb it there.
 *
 * Deliberately conservative: in a large refactor new symbols are used everywhere,
 * and an unrestricted "merge into users" rule chains all groups into one. So:
 * one target only, small communities only, and no chaining (absorbed communities
 * are never targets).
 */
export function mergeNewSymbolUsers(
  communities: string[][],
  hunks: Map<string, HunkInfo>,
  options: MergeOptions,
): { communities: string[][]; merges: MergeNote[] } {
  const communityOf = new Map<string, number>();
  communities.forEach((ids, i) => ids.forEach((id) => communityOf.set(id, i)));
  const target = new Map<number, { into: number; note: MergeNote }>();

  communities.forEach((ids, ci) => {
    if (ids.length > options.maxSize) return;
    const added = ids
      .map((id) => hunks.get(id)!)
      .filter((h) => !h.isTest)
      .flatMap((h) => h.addedDecls.map((q) => ({ id: h.hunk.id, name: q.split(".").pop()! })));
    if (added.length === 0) return;
    const users = new Map<number, MergeNote>();
    for (const [otherId, user] of hunks) {
      const cj = communityOf.get(otherId);
      if (cj === undefined || cj === ci) continue;
      const hit = added.find((a) => user.references.has(a.name) || user.references.has(`.${a.name}`));
      if (hit && !users.has(cj)) users.set(cj, { from: otherId, into: hit.id, symbol: hit.name });
    }
    if (users.size === 1) {
      const [[into, note]] = [...users];
      target.set(ci, { into, note });
    }
  });

  const absorbed = new Set(target.keys());
  const merged = communities.map((ids) => [...ids]);
  const merges: MergeNote[] = [];
  for (const [from, { into, note }] of target) {
    if (absorbed.has(into)) continue; // no chaining
    merged[into].push(...communities[from]);
    merged[from] = [];
    merges.push(note);
  }
  return { communities: merged.filter((c) => c.length > 0).sort((a, b) => b.length - a.length), merges };
}
