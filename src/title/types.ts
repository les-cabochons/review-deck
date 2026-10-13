import type { Group, HunkInfo, PairScore, TitleSource } from "../core/types.js";

export interface TitleInput {
  group: Group;
  hunks: HunkInfo[];
  /** Pairs with both ends inside the group. */
  pairs: PairScore[];
}

export interface GroupTitle {
  title: string;
  rationale: string;
  /** Where the group belongs in the PR's reading order, when the titler chose one (lower reads first). */
  position?: number;
  source: TitleSource;
}

/** Names groups, and may pick their reading order. Implementations: HeuristicTitler (default, browser-safe) and CliLlmTitler (Node, shells out). */
export interface Titler {
  readonly name: string;
  title(inputs: TitleInput[], context: { prTitle: string; prDescription: string }): Promise<GroupTitle[]>;
}
