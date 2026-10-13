// Core data model shared by every pipeline stage. Browser-safe: no Node imports.

export type Side = "old" | "new";

export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface Hunk {
  /** `<path>#<n>`; see README for the convention. */
  id: string;
  path: string;
  index: number;
  /** The `@@ ... @@ section` line, or "" for pseudo-hunks (pure renames, binary files). */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  /** Display path: new path, or old path for deletions. */
  path: string;
  oldPath: string | null;
  newPath: string | null;
  status: "added" | "deleted" | "modified" | "renamed";
  similarity: number | null;
  binary: boolean;
  /** Raw lines between `diff --git` and the first hunk (inclusive), used for rendering. */
  headerLines: string[];
  hunks: Hunk[];
}

/** Supplies file contents at either side of the diff. Implemented per host (fixtures, git, Azure DevOps REST). */
export interface FileProvider {
  get(path: string, side: Side): Promise<string | null>;
}

export interface MechanicalInfo {
  kind: "lockfile" | "generated" | "rename" | "binary" | "whitespace" | "dependency-manifest";
  reason: string;
}

/** A hunk enriched with syntactic facts. */
export interface HunkInfo {
  hunk: Hunk;
  file: FileDiff;
  language: string | null;
  isTest: boolean;
  /** Innermost named declaration around the change, qualified (e.g. `HttpClient.request`). */
  symbol: string | null;
  /** Declarations whose span contains a changed line. */
  enclosing: string[];
  /** Names this hunk declares, removes, or modifies (decl names, members, object keys on changed lines, enclosing decls). */
  defines: Set<string>;
  /** Unchanged declarations in the same file that use something in `defines` (one hop). */
  impacts: Set<string>;
  /** Identifiers used on changed lines. */
  references: Set<string>;
  /** Normalized tokens for lexical overlap: identifiers + string literals + comment words. */
  tokens: Set<string>;
  /** Module paths (repo-relative, no extension) imported by this hunk's file. */
  fileImports: Set<string>;
  /** True if every changed line is a comment or blank. */
  commentOnly: boolean;
  /** Names of declarations added (present only on the new side) / removed (only on the old side). */
  addedDecls: string[];
  removedDecls: string[];
  mechanical: MechanicalInfo | null;
  /** Compact text used for embeddings and LLM prompts. */
  text: string;
}

export type SignalName = "structural" | "testPairing" | "lexical" | "semantic" | "path" | "description";

export interface SignalScore {
  score: number;
  evidence: string[];
}

export interface PairScore {
  a: string;
  b: string;
  signals: Partial<Record<SignalName, SignalScore>>;
  weight: number;
}

export interface Group {
  id: string;
  kind: "semantic" | "misc" | "mechanical";
  hunkIds: string[];
  title: string;
  rationale: string;
  /** Who wrote the title and rationale (absent in groupings saved before this was recorded). */
  titleSource?: TitleSource;
}

/**
 * `llm`: a model read the changes and the PR description. `description`: the PR description's step that matches
 * the group. `heuristic`: rules over the code structure (symbols, renames, moves).
 */
export type TitleSource = "llm" | "description" | "heuristic";

export interface ReviewResult {
  title: string;
  description: string;
  files: FileDiff[];
  hunks: Map<string, HunkInfo>;
  pairs: PairScore[];
  groups: Group[];
  /** Community merges done after Louvain (a hunk using a symbol another community introduced). */
  merges: { from: string; into: string; symbol: string }[];
  timings: Record<string, number>;
  options: { semantic: boolean; titler: string; weights: Record<SignalName, number>; minEdgeWeight: number };
  warnings: string[];
}
