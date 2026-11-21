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

/**
 * A fixed rule's hit on a hunk's added lines (src/analyze/safety.ts): a likely secret, or a migration that can lose
 * data or break a deploy. It never holds the matched text, because findings are saved with the guide.
 */
export interface SafetyFinding {
  kind: "secret" | "migration";
  /** `medium`: the rule is often right but also hits harmless code (a password-like literal, a rename). */
  severity: "high" | "medium";
  /** The rule's short name, e.g. "AWS access key" or "Drops a column". */
  rule: string;
  /** One sentence on why it matters. */
  message: string;
  /** New-side line it was found on, or null when the file itself is the finding (a committed `.env`). */
  line: number | null;
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
  /**
   * Unchanged declarations in the same file that use a declaration this hunk changes, innermost only (a method, not
   * also its class), by qualified name. What the page lists under the hunk. Stricter than `impacts`: no hunk of the
   * file touches them, and a changed member only counts for its siblings. Matched by name, so a local variable named
   * like the changed declaration can add a false entry.
   */
  affected: string[];
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
  /** What the safety rules found on the hunk's added lines, in line order. A hunk with any is never mechanical. */
  findings: SafetyFinding[];
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

/** How closely a concern needs reading (src/analyze/level.ts). An ordinary concern has none. */
export type ReviewLevel = "must" | "skim" | "skip";

export interface Group {
  id: string;
  kind: "semantic" | "misc" | "mechanical";
  hunkIds: string[];
  title: string;
  rationale: string;
  /** Absent on an ordinary concern, and in guides saved before levels existed. */
  level?: ReviewLevel;
  /** Why it has that level, in one line. Set with `level`. */
  levelReason?: string;
  /** Who wrote the title and rationale (absent in groupings saved before this was recorded). */
  titleSource?: TitleSource;
}

/**
 * `llm`: a model read the changes and the PR description. `description`: the PR description's step that matches
 * the group. `heuristic`: rules over the code structure (symbols, renames, moves).
 */
export type TitleSource = "llm" | "description" | "heuristic";

/** How concerns connect (src/relations): `to` uses something `from` defines or changes. Test files are left out. */
export interface Link {
  from: string;
  to: string;
  /** The names behind the link, best first: named symbols, then members (`.hide`), which match the loosest. */
  symbols: string[];
}

export interface ReviewRelations {
  /** Between concerns (semantic groups), by group id. */
  links: Link[];
  /** Inside each concern, by hunk id, keyed by group id. A concern whose changes don't use each other has none. */
  flows: Record<string, Link[]>;
}

export interface ReviewResult {
  title: string;
  description: string;
  files: FileDiff[];
  hunks: Map<string, HunkInfo>;
  pairs: PairScore[];
  groups: Group[];
  /** How the groups connect. Absent from a guide saved before it was recorded, or published without it. */
  relations?: ReviewRelations;
  /** Community merges done after Louvain (a hunk using a symbol another community introduced). */
  merges: { from: string; into: string; symbol: string }[];
  timings: Record<string, number>;
  options: { semantic: boolean; titler: string; weights: Record<SignalName, number>; minEdgeWeight: number };
  warnings: string[];
}
