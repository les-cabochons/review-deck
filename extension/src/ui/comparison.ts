import { latestIteration, type PrOverview } from "../data/model";
import type { ReviewModel } from "../review/engine";

/** Which update the Files tab shows, against which (0: the PR's base). */
export type Comparison = ReviewModel["comparison"];

/** The latest update against the PR's base, which the Files tab opens on; iteration 0 until the PR is known. */
export function latestComparison(data: PrOverview | null): Comparison {
  return { iteration: data ? latestIteration(data) : 0, compareTo: 0 };
}

export const sameComparison = (a: Comparison, b: Comparison) => a.iteration === b.iteration && a.compareTo === b.compareTo;

/**
 * The comparison to show once a load says which update is the latest. The page moves to it when the one shown is
 * the one the page last picked on its own (`picked`), as after a push since the kept copy or since a load that
 * failed part way. A comparison the reader chose stays.
 */
export function followLatest(shown: Comparison, picked: Comparison, latest: Comparison): Comparison {
  return sameComparison(shown, picked) ? latest : shown;
}
