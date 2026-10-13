import { isTrunk, shortBranch } from "./branches.js";

/** What stack building needs from a PR. Branch names may include `refs/heads/`. */
export interface StackPr {
  id: number;
  repository: { id: string };
  sourceBranch: string;
  targetBranch: string;
  status: "active" | "completed" | "abandoned";
}

/**
 * One PR's place in its stack. `layers` runs bottom (into the trunk) to top and goes through `pr`:
 * below it, its chain of parents; above it, its children, following the first child where the stack forks.
 */
export interface StackPosition<T extends StackPr = StackPr> {
  pr: T;
  /** Bottom to top; includes `pr`. */
  layers: T[];
  /** Where the bottom layer merges: a trunk branch, or a branch with no open PR (`base.trunk` false). */
  base: { branch: string; trunk: boolean };
  /** PRs that build on `pr` directly; more than one means the stack forks here. */
  children: T[];
  /** The PR whose source branch `pr` targets, if it's open. */
  parent: T | null;
}

/**
 * Stacks among open PRs: a PR is stacked on another when it targets that PR's source branch in the
 * same repository. Returns null for a PR that's alone (into a trunk, nothing on top of it).
 */
export function stackFor<T extends StackPr>(pr: T, all: readonly T[], trunkPatterns: readonly string[]): StackPosition<T> | null {
  const open = all.filter((p) => p.status === "active" && p.repository.id === pr.repository.id);
  const bySource = new Map<string, T[]>();
  const byTarget = new Map<string, T[]>();
  for (const p of open) {
    push(bySource, key(p.sourceBranch), p);
    push(byTarget, key(p.targetBranch), p);
  }
  // A PR into a trunk branch has no parent even if some other PR happens to come from that trunk.
  const parentOf = (p: T): T | null =>
    isTrunk(p.targetBranch, trunkPatterns) ? null : ((bySource.get(key(p.targetBranch)) ?? []).find((q) => q.id !== p.id) ?? null);
  const childrenOf = (p: T): T[] => (byTarget.get(key(p.sourceBranch)) ?? []).filter((q) => q.id !== p.id && parentOf(q)?.id === p.id).sort((a, b) => a.id - b.id);

  const below: T[] = [];
  const seen = new Set<number>([pr.id]);
  for (let p = parentOf(pr); p && !seen.has(p.id); p = parentOf(p)) {
    seen.add(p.id);
    below.unshift(p);
  }
  const above: T[] = [];
  for (let p = childrenOf(pr)[0]; p && !seen.has(p.id); p = childrenOf(p)[0]) {
    seen.add(p.id);
    above.push(p);
  }
  const layers = [...below, pr, ...above];
  const bottom = layers[0];
  const base = { branch: shortBranch(bottom.targetBranch), trunk: isTrunk(bottom.targetBranch, trunkPatterns) };
  const children = childrenOf(pr);
  // Alone: one layer straight into a trunk. A single PR into a non-trunk branch is shown as a stack,
  // because its base (a merged or abandoned parent) is worth pointing out.
  if (layers.length === 1 && base.trunk) return null;
  return { pr, layers, base, children, parent: parentOf(pr) };
}

/** "2 of 4" positions for every stacked PR in a list, for hub rows. */
export function stackIndex<T extends StackPr>(all: readonly T[], trunkPatterns: readonly string[]): Map<number, { index: number; size: number; bottomId: number }> {
  const out = new Map<number, { index: number; size: number; bottomId: number }>();
  for (const pr of all) {
    if (pr.status !== "active" || out.has(pr.id)) continue;
    const position = stackFor(pr, all, trunkPatterns);
    if (!position) continue;
    position.layers.forEach((layer, i) => {
      if (!out.has(layer.id)) out.set(layer.id, { index: i + 1, size: position.layers.length, bottomId: position.layers[0].id });
    });
  }
  return out;
}

function key(branch: string): string {
  return shortBranch(branch).toLowerCase();
}

function push<K, V>(map: Map<K, V[]>, k: K, v: V): void {
  const list = map.get(k);
  if (list) list.push(v);
  else map.set(k, [v]);
}
