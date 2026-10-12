import type { PipelineConfig } from "../core/config.js";
import type { HunkInfo, PairScore, SignalName } from "../core/types.js";
import { SIGNALS, type ScoringContext } from "./signals.js";

/** Produces unit-normalized sentence embeddings. Implemented with transformers.js in src/node/embedder.ts. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** Scores every pair of (non-mechanical) hunks with every enabled signal. Returns pairs with any evidence. */
export async function scorePairs(hunks: HunkInfo[], config: PipelineConfig, embedder: Embedder | null): Promise<PairScore[]> {
  const symbolDf = new Map<string, number>();
  const tokenDf = new Map<string, number>();
  for (const h of hunks) {
    for (const s of new Set([...h.defines, ...h.references])) symbolDf.set(s, (symbolDf.get(s) ?? 0) + 1);
    for (const t of h.tokens) tokenDf.set(t, (tokenDf.get(t) ?? 0) + 1);
  }

  let embeddings: Map<string, number[]> | null = null;
  if (config.semantic.enabled && embedder && hunks.length > 1) {
    const vectors = await embedder.embed(hunks.map((h) => h.text));
    embeddings = new Map(hunks.map((h, i) => [h.hunk.id, vectors[i]]));
  }

  const ctx: ScoringContext = { config, symbolDf, tokenDf, hunkCount: hunks.length, embeddings };
  const enabled = (Object.keys(SIGNALS) as SignalName[]).filter((name) => name !== "semantic" || embeddings);

  const pairs: PairScore[] = [];
  for (let i = 0; i < hunks.length; i++) {
    for (let j = i + 1; j < hunks.length; j++) {
      const a = hunks[i];
      const b = hunks[j];
      const pair: PairScore = { a: a.hunk.id, b: b.hunk.id, signals: {}, weight: 0 };
      for (const name of enabled) {
        const result = SIGNALS[name](a, b, ctx);
        if (!result) continue;
        pair.signals[name] = result;
        pair.weight += config.weights[name] * result.score;
      }
      if (pair.weight > 0) pairs.push(pair);
    }
  }
  return pairs;
}
