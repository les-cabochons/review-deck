import { latestIteration, type PrOverview, type Thread } from "../data/model";
import type { ReviewModel } from "../review/engine";

/** Which update the Files tab shows, against which (0: the PR's base). */
export type Comparison = ReviewModel["comparison"];

/**
 * The latest update against the PR's base, which the Files tab opens on. Iteration 0, with nothing to build yet, until
 * the updates are known. A page drawn from the PR's hub row (hubCache.ts prFromRow) doesn't know them.
 */
export function latestComparison(data: PrOverview | null): Comparison {
  if (!data || (data.partial && data.iterations.length === 0)) return { iteration: 0, compareTo: 0 };
  return { iteration: latestIteration(data), compareTo: 0 };
}

export const sameComparison = (a: Comparison, b: Comparison) => a.iteration === b.iteration && a.compareTo === b.compareTo;

/**
 * The Files tab's name for a comparison, as its select shows it. A comparison holds what updates compareTo + 1 to
 * iteration pushed: "All changes" for every update (the latest against the base), "Update 3" for one, "Updates 2–3"
 * for a range, which only a comment's own comparison opens (threadComparison).
 */
export function comparisonLabel({ iteration, compareTo }: Comparison, latest: number): string {
  if (iteration === 0 || (iteration === latest && compareTo === 0)) return "All changes";
  return compareTo === iteration - 1 ? `Update ${iteration}` : `Updates ${compareTo + 1}–${iteration}`;
}

/**
 * The comparison a comment was written on, from its iteration context, or null when it has none. A comment is saved
 * with first = compareTo || iteration and second = iteration (adoActions.ts createThread), so equal iterations mean
 * the PR's base, as Azure DevOps documents them. Each comparison's comments are read for that comparison only
 * (PrSource.getThreads), so this is the one sure to hold the comment.
 */
export function threadComparison(thread: Pick<Thread, "iterationContext">): Comparison | null {
  const context = thread.iterationContext;
  if (!context) return null;
  const { firstComparingIteration: first, secondComparingIteration: second } = context;
  return { iteration: second, compareTo: first === second ? 0 : first };
}

/**
 * The comparison to show once a load says which update is the latest. The page moves to it when the one shown is
 * the one the page last picked on its own (`picked`), as after a push since the kept copy or since a load that
 * failed part way. A comparison the reader chose stays.
 */
export function followLatest(shown: Comparison, picked: Comparison, latest: Comparison): Comparison {
  return sameComparison(shown, picked) ? latest : shown;
}
