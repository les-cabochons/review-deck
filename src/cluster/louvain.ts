import { UndirectedGraph } from "graphology";
import louvainModule from "graphology-communities-louvain";
import type { PipelineConfig } from "../core/config.js";
import type { PairScore } from "../core/types.js";

// CJS package: depending on the loader the default import is the function itself (Node, esbuild)
// or a namespace with `.default`; typings also differ between NodeNext and Bundler resolution.
type Louvain = (graph: UndirectedGraph, options: object) => Record<string, number>;
const louvain = ((louvainModule as unknown as { default?: Louvain }).default ?? louvainModule) as unknown as Louvain;

/** Clusters hunk IDs with Louvain on the weighted pair graph. Returns communities (largest first). */
export function clusterHunks(ids: string[], pairs: PairScore[], config: PipelineConfig): string[][] {
  if (ids.length === 0) return [];
  const graph = new UndirectedGraph();
  for (const id of ids) graph.addNode(id);
  for (const p of pairs) {
    if (p.weight < config.minEdgeWeight || !graph.hasNode(p.a) || !graph.hasNode(p.b)) continue;
    graph.addEdge(p.a, p.b, { weight: p.weight });
  }

  const assignment: Record<string, number> =
    graph.size === 0
      ? Object.fromEntries(ids.map((id, i) => [id, i]))
      : louvain(graph, {
          getEdgeWeight: "weight",
          resolution: config.louvain.resolution,
          rng: mulberry32(config.louvain.seed),
        });

  const byCommunity = new Map<number, string[]>();
  for (const id of ids) {
    const c = assignment[id];
    byCommunity.set(c, [...(byCommunity.get(c) ?? []), id]);
  }
  return [...byCommunity.values()].sort((x, y) => y.length - x.length);
}

/** Small seeded PRNG so clustering is deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
