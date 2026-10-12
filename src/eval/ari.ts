import type { Group } from "../core/types.js";

/** Adjusted Rand Index between two labelings of the same items. */
export function adjustedRandIndex(truth: Map<string, string>, predicted: Map<string, string>): number {
  const items = [...truth.keys()];
  const n = items.length;
  if (n < 2) return 1;
  const choose2 = (x: number) => (x * (x - 1)) / 2;
  const contingency = new Map<string, number>();
  const rows = new Map<string, number>();
  const cols = new Map<string, number>();
  for (const item of items) {
    const t = truth.get(item)!;
    const p = predicted.get(item) ?? `__missing:${item}`;
    contingency.set(`${t}\u0000${p}`, (contingency.get(`${t}\u0000${p}`) ?? 0) + 1);
    rows.set(t, (rows.get(t) ?? 0) + 1);
    cols.set(p, (cols.get(p) ?? 0) + 1);
  }
  const index = [...contingency.values()].reduce((s, v) => s + choose2(v), 0);
  const sumRows = [...rows.values()].reduce((s, v) => s + choose2(v), 0);
  const sumCols = [...cols.values()].reduce((s, v) => s + choose2(v), 0);
  const expected = (sumRows * sumCols) / choose2(n);
  const max = (sumRows + sumCols) / 2;
  // Degenerate case (e.g. both partitions are a single cluster): ARI is 0/0; identical partitions score 1.
  if (max === expected) return samePartition(truth, predicted) ? 1 : 0;
  return (index - expected) / (max - expected);
}

function samePartition(a: Map<string, string>, b: Map<string, string>): boolean {
  const pairs = new Map<string, string>();
  const reverse = new Map<string, string>();
  for (const [item, la] of a) {
    const lb = b.get(item) ?? `__missing:${item}`;
    if ((pairs.get(la) ?? lb) !== lb || (reverse.get(lb) ?? la) !== la) return false;
    pairs.set(la, lb);
    reverse.set(lb, la);
  }
  return true;
}

/** Hunk -> cluster label. Misc hunks count as singletons ("not grouped with anything"). */
export function labelsFromGroups(groups: Group[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of groups) for (const id of g.hunkIds) out.set(id, g.kind === "misc" ? `misc:${id}` : g.id);
  return out;
}

export function labelsFromTruth(groups: { id: string; hunks: string[] }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of groups) for (const id of g.hunks) out.set(id, g.id);
  return out;
}
