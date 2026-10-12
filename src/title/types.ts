import type { Group, HunkInfo, PairScore } from "../core/types.js";

export interface TitleInput {
  group: Group;
  hunks: HunkInfo[];
  /** Pairs with both ends inside the group. */
  pairs: PairScore[];
}

export interface GroupTitle {
  title: string;
  rationale: string;
}

/** Names groups. Implementations: HeuristicTitler (default, browser-safe) and CliLlmTitler (Node, shells out). */
export interface Titler {
  readonly name: string;
  title(inputs: TitleInput[], context: { prTitle: string; prDescription: string }): Promise<GroupTitle[]>;
}
