import type { Group, HunkInfo } from "../core/types.js";

/** True if `a` should come before `b`: a defines something b uses, or a is code and b is a test that depends on it. */
function dependsOn(user: HunkInfo, def: HunkInfo): boolean {
  if (user === def) return false;
  if (!user.isTest && def.isTest) return false;
  if (user.isTest && !def.isTest) return true;
  for (const s of def.defines) if (user.references.has(s)) return true;
  return false;
}

const byLocation = (a: HunkInfo, b: HunkInfo) =>
  Number(a.isTest) - Number(b.isTest) || a.file.path.localeCompare(b.file.path) || a.hunk.index - b.hunk.index;

/**
 * Kahn's algorithm with a deterministic tie-break. On a cycle, releases the
 * remaining node with the fewest unmet dependencies (then by `tieBreak`).
 */
export function topoSort<T>(items: T[], deps: (item: T) => T[], tieBreak: (a: T, b: T) => number): T[] {
  const remaining = new Set(items);
  const pending = new Map(items.map((it) => [it, new Set(deps(it).filter((d) => remaining.has(d) && d !== it))]));
  const out: T[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((it) => pending.get(it)!.size === 0).sort(tieBreak);
    const next =
      ready[0] ?? [...remaining].sort((a, b) => pending.get(a)!.size - pending.get(b)!.size || tieBreak(a, b))[0];
    out.push(next);
    remaining.delete(next);
    for (const set of pending.values()) set.delete(next);
  }
  return out;
}

/** Orders hunks within each group, then groups: definitions before usages, code before tests, misc/mechanical last. */
export function orderGroups(groups: Group[], hunks: Map<string, HunkInfo>): Group[] {
  for (const g of groups) {
    const infos = g.hunkIds.map((id) => hunks.get(id)!);
    g.hunkIds = topoSort(infos, (h) => infos.filter((d) => dependsOn(h, d)), byLocation).map((h) => h.hunk.id);
  }

  const semantic = groups.filter((g) => g.kind === "semantic");
  const groupOf = new Map<string, Group>();
  for (const g of semantic) for (const id of g.hunkIds) groupOf.set(id, g);
  const groupDeps = (g: Group): Group[] => {
    const out = new Set<Group>();
    for (const id of g.hunkIds) {
      const user = hunks.get(id)!;
      if (user.isTest) continue;
      for (const [otherId, other] of groupOf) {
        if (other === g) continue;
        const def = hunks.get(otherId)!;
        if (!def.isTest && dependsOn(user, def)) out.add(other);
      }
    }
    return [...out];
  };
  const ordered = topoSort(semantic, groupDeps, (a, b) => b.hunkIds.length - a.hunkIds.length || a.id.localeCompare(b.id));
  return [...ordered, ...groups.filter((g) => g.kind === "misc"), ...groups.filter((g) => g.kind === "mechanical")];
}
