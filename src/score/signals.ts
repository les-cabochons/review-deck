import type { PipelineConfig } from "../core/config.js";
import { dirname, logicalModule, stripExtension } from "../core/paths.js";
import type { HunkInfo, SignalName, SignalScore } from "../core/types.js";

/** Shared, per-PR context for signal functions. */
export interface ScoringContext {
  config: PipelineConfig;
  /** Number of hunks whose defines/references contain a symbol. */
  symbolDf: Map<string, number>;
  /** Number of hunks whose lexical tokens contain a token. */
  tokenDf: Map<string, number>;
  hunkCount: number;
  /** Unit-normalized embedding per hunk ID (only when the semantic signal is enabled). */
  embeddings: Map<string, number[]> | null;
}

export type Signal = (a: HunkInfo, b: HunkInfo, ctx: ScoringContext) => SignalScore | null;

const symbolWeight = (s: string, ctx: ScoringContext) => 1 / Math.sqrt(Math.max(1, (ctx.symbolDf.get(s) ?? 1) - 1));

/** One hunk defines/changes a symbol the other references (or both change the same symbol). */
export const structural: Signal = (a, b, ctx) => {
  const evidence: string[] = [];
  let score = 0;
  const seen = new Set<string>();
  const add = (s: string, factor: number, label: string) => {
    if (seen.has(s)) return;
    seen.add(s);
    score += factor * symbolWeight(s, ctx);
    evidence.push(`${label} ${s}`);
  };
  for (const s of a.defines) {
    if (b.references.has(s)) add(s, 1, "def→use");
    else if (b.defines.has(s)) add(s, 1, "both change");
  }
  for (const s of b.defines) if (a.references.has(s)) add(s, 1, "def→use");
  const f = ctx.config.structural.impactFactor;
  for (const s of a.impacts) if (b.references.has(s) || b.defines.has(s)) add(s, f, "impact→use");
  for (const s of b.impacts) if (a.references.has(s) || a.defines.has(s)) add(s, f, "impact→use");
  return score > 0 ? { score: Math.min(1, score), evidence } : null;
};

/** A test hunk and a code hunk whose file the test imports; strongest when they share a changed symbol. */
export const testPairing: Signal = (a, b, ctx) => {
  if (a.isTest === b.isTest) return null;
  const [test, code] = a.isTest ? [a, b] : [b, a];
  const codeModules = [code.file.newPath, code.file.oldPath].filter((p): p is string => !!p).map(stripExtension);
  const imported = codeModules.find((m) => test.fileImports.has(m));
  if (!imported) return null;
  const used = new Set([...test.references, ...test.defines]);
  const direct = [...code.defines].filter((s) => used.has(s));
  if (direct.length > 0) return { score: 1, evidence: [`test uses ${unique(direct).join(", ")}`] };
  const indirect = [...code.impacts].filter((s) => used.has(s));
  if (indirect.length > 0) {
    return { score: ctx.config.structural.impactFactor, evidence: [`test uses ${unique(indirect).join(", ")} (impacted)`] };
  }
  return { score: ctx.config.testPairing.importOnly, evidence: [`test imports ${imported}`] };
};

/** IDF-weighted overlap of identifiers and string literals on changed lines. */
export const lexical: Signal = (a, b, ctx) => {
  const idf = (t: string) => Math.log(1 + ctx.hunkCount / (ctx.tokenDf.get(t) ?? 1));
  const total = (s: Set<string>) => [...s].reduce((acc, t) => acc + idf(t), 0);
  const shared = [...a.tokens].filter((t) => b.tokens.has(t));
  if (shared.length === 0) return null;
  // Geometric mean, not min: a 2-token hunk sharing 1 token with a 20-token hunk is weak evidence.
  const denom = Math.sqrt(total(a.tokens) * total(b.tokens));
  if (denom === 0) return null;
  const score = shared.reduce((acc, t) => acc + idf(t), 0) / denom;
  const top = shared.sort((x, y) => idf(y) - idf(x)).slice(0, 6);
  return { score: Math.min(1, score), evidence: [`shared ${top.join(", ")}`] };
};

/** Cosine similarity of local sentence embeddings, rescaled above a floor. */
export const semantic: Signal = (a, b, ctx) => {
  const ea = ctx.embeddings?.get(a.hunk.id);
  const eb = ctx.embeddings?.get(b.hunk.id);
  if (!ea || !eb) return null;
  let cos = 0;
  for (let i = 0; i < ea.length; i++) cos += ea[i] * eb[i];
  const floor = ctx.config.semantic.floor;
  const score = Math.max(0, (cos - floor) / (1 - floor));
  return score > 0 ? { score, evidence: [`cos ${cos.toFixed(3)}`] } : null;
};

/** Weak tiebreaker: same file > same (logical) directory > shared top-level directory. */
export const path: Signal = (a, b) => {
  if (a.file.path === b.file.path) return { score: 1, evidence: ["same file"] };
  const da = dirname(logicalModule(a.file.path));
  const db = dirname(logicalModule(b.file.path));
  if (da === db) return { score: 0.6, evidence: [`same dir ${da || "/"}`] };
  const pa = da.split("/");
  const pb = db.split("/");
  if (pa[0] && pa[0] === pb[0]) return { score: 0.3, evidence: [`under ${pa[0]}/`] };
  return null;
};

export const SIGNALS: Record<SignalName, Signal> = {
  structural,
  testPairing,
  lexical,
  semantic,
  path,
};

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
