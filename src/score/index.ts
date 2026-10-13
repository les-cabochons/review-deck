import type { PipelineConfig } from "../core/config.js";
import type { HunkInfo, PairScore, SignalName } from "../core/types.js";
import { parseDescriptionSteps, stepAffinities } from "./description.js";
import { inDifferentSteps, SIGNALS, type ScoringContext } from "./signals.js";

/** Produces unit-normalized sentence embeddings. Implemented with transformers.js in src/node/embedder.ts. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** Scores every pair of (non-mechanical) hunks with every enabled signal. Returns pairs with any evidence. */
export async function scorePairs(
  hunks: HunkInfo[],
  config: PipelineConfig,
  embedder: Embedder | null,
  description: string,
  onProgress?: (progress: { stage: "score"; done: number; total: number }) => void,
): Promise<PairScore[]> {
  const symbolDf = new Map<string, number>();
  const tokenDf = new Map<string, number>();
  for (const h of hunks) {
    for (const s of new Set([...h.defines, ...h.references])) symbolDf.set(s, (symbolDf.get(s) ?? 0) + 1);
    for (const t of h.tokens) tokenDf.set(t, (tokenDf.get(t) ?? 0) + 1);
  }

  const steps = config.description.enabled && hunks.length > 1 ? parseDescriptionSteps(description) : [];
  const guided = steps.length > 1;

  let embeddings: Map<string, number[]> | null = null;
  let stepEmbeddings: number[][] | null = null;
  if (config.semantic.enabled && embedder && hunks.length > 1) {
    // One request for hunks and steps: against the backend, each request is a round trip.
    const vectors = await embedder.embed([...hunks.map((h) => h.text), ...(guided ? steps.map((s) => s.text) : [])]);
    embeddings = new Map(hunks.map((h, i) => [h.hunk.id, vectors[i]]));
    if (guided) stepEmbeddings = vectors.slice(hunks.length);
  }
  const affinities = guided ? stepAffinities(hunks, steps, { hunkEmbeddings: embeddings, stepEmbeddings, semanticFloor: config.semantic.floor }) : new Map();

  const ctx: ScoringContext = { config, symbolDf, tokenDf, hunkCount: hunks.length, embeddings, steps, affinities };
  const enabled = (Object.keys(SIGNALS) as SignalName[]).filter(
    (name) => (name !== "semantic" || embeddings) && (name !== "description" || affinities.size > 0),
  );
  const separate = affinities.size > 0 && config.description.crossStepFactor < 1;

  const pairs: PairScore[] = [];
  // Row i scores n-i-1 pairs, so report the share of pairs done, not of rows.
  const totalPairs = (hunks.length * (hunks.length - 1)) / 2;
  let pairsDone = 0;
  for (let i = 0; i < hunks.length; i++) {
    onProgress?.({ stage: "score", done: pairsDone, total: totalPairs });
    pairsDone += hunks.length - i - 1;
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
      // The author put these in different steps: other evidence still links them, just less.
      if (separate && pair.weight > 0 && inDifferentSteps(a, b, ctx)) pair.weight *= config.description.crossStepFactor;
      if (pair.weight > 0) pairs.push(pair);
    }
  }
  return pairs;
}
