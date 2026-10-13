import type { SignalName } from "./types.js";

/** All tunables in one place. */
export interface PipelineConfig {
  /** Edge weight = sum of weight * signal score (each signal is in [0, 1]). */
  weights: Record<SignalName, number>;
  /** Edges lighter than this are dropped before clustering, so weak signals alone (path) never link hunks. */
  minEdgeWeight: number;
  structural: {
    /** Score for a link through a one-hop "impacted" symbol rather than a directly changed one. */
    impactFactor: number;
  };
  testPairing: {
    /** Score when the test file imports the code file but shares no changed symbol with the hunk. */
    importOnly: number;
  };
  description: {
    /** Link hunks the PR description puts in the same step (score/description.ts). */
    enabled: boolean;
    /** Weight kept by a pair whose hunks the description confidently puts in different steps. */
    crossStepFactor: number;
    /** A hunk's strongest step affinity must reach this to count as confidently placed. */
    confident: number;
  };
  semantic: {
    enabled: boolean;
    model: string;
    /** Cosine similarities at or below `floor` score 0; 1.0 scores 1; linear in between. */
    floor: number;
  };
  louvain: {
    resolution: number;
    seed: number;
  };
  cluster: {
    /** After Louvain, merge a community that introduces a symbol into the community that uses it. */
    mergeNewSymbolUsers: boolean;
    /** Largest community that can be absorbed by that merge. */
    mergeMaxSize: number;
  };
  /** Generic names ignored by structural/lexical matching. */
  stopwords: string[];
}

export const DEFAULT_CONFIG: PipelineConfig = {
  weights: {
    structural: 1.0,
    testPairing: 0.9,
    lexical: 0.45,
    semantic: 0.5,
    path: 0.25,
    description: 1.0,
  },
  minEdgeWeight: 0.22,
  structural: { impactFactor: 0.6 },
  testPairing: { importOnly: 0.15 },
  description: { enabled: true, crossStepFactor: 0.5, confident: 0.75 },
  semantic: {
    enabled: false,
    model: "Xenova/all-MiniLM-L6-v2",
    floor: 0.5,
  },
  louvain: { resolution: 1.0, seed: 7 },
  cluster: { mergeNewSymbolUsers: true, mergeMaxSize: 4 },
  stopwords: [
    // TS/JS builtins and primitive types
    "string", "number", "boolean", "unknown", "never", "void", "undefined", "null", "true", "false", "this",
    "Promise", "Record", "Partial", "Omit", "Pick", "Readonly", "Array", "Object", "String", "Number", "Boolean",
    "Error", "Date", "Math", "JSON", "Map", "Set", "RegExp", "async", "await", "const", "let", "type",
    // ubiquitous member / variable names
    "length", "push", "map", "filter", "join", "slice", "split", "get", "set", "has", "delete", "keys", "values",
    "entries", "then", "catch", "toString", "test", "trim", "replace", "data", "res", "err", "error", "value",
    "key", "input", "options", "config", "name", "path", "url", "message", "status", "body", "result",
    "item", "items", "args", "default", "export", "import", "from", "return", "new", "constructor",
    // test framework API
    "describe", "it", "expect", "vi", "jest", "fn", "beforeEach", "afterEach", "beforeAll", "afterAll",
    "not", "rejects", "resolves", "vitest",
  ],
};

export function mergeConfig(overrides: DeepPartial<PipelineConfig> = {}): PipelineConfig {
  return deepMerge(DEFAULT_CONFIG, overrides) as PipelineConfig;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return over;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = deepMerge(out[k], v);
  return out;
}
