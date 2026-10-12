import { analyzeHunks } from "./analyze/hunks.js";
import { clusterHunks } from "./cluster/louvain.js";
import { mergeNewSymbolUsers } from "./cluster/refine.js";
import type { PipelineConfig } from "./core/config.js";
import type { FileProvider, Group, HunkInfo, ReviewResult } from "./core/types.js";
import { parseDiff } from "./diff/parse.js";
import { orderGroups } from "./order/topo.js";
import type { SyntaxParsers } from "./parse/treesitter.js";
import { type Embedder, scorePairs } from "./score/index.js";
import { describeGroup, HeuristicTitler } from "./title/heuristic.js";
import type { Titler, TitleInput } from "./title/types.js";

export interface PrInput {
  title: string;
  description: string;
  diff: string;
  files: FileProvider;
}

export interface PipelineDeps {
  parsers: SyntaxParsers;
  embedder?: Embedder | null;
  titler?: Titler;
}

/** diff text -> grouped, ordered, titled hunks. Browser-safe: all host specifics come in through `deps`. */
export async function runPipeline(input: PrInput, config: PipelineConfig, deps: PipelineDeps): Promise<ReviewResult> {
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const time = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      timings[name] = Math.round(performance.now() - start);
    }
  };

  const files = await time("parse", () => parseDiff(input.diff));
  const hunks = await time("analyze", () => analyzeHunks(files, input.files, deps.parsers, config));

  const all = [...hunks.values()];
  const mechanical = all.filter((h) => h.mechanical);
  const reviewable = all.filter((h) => !h.mechanical);

  const embedder = config.semantic.enabled ? (deps.embedder ?? null) : null;
  if (config.semantic.enabled && !embedder) warnings.push("semantic signal enabled but no embedder supplied; skipped");
  const pairs = await time("score", () => scorePairs(reviewable, config, embedder));

  const { communities, merges } = await time("cluster", () => {
    const raw = clusterHunks(reviewable.map((h) => h.hunk.id), pairs, config);
    return config.cluster.mergeNewSymbolUsers ? mergeNewSymbolUsers(raw, hunks, { maxSize: config.cluster.mergeMaxSize }) : { communities: raw, merges: [] };
  });
  let groups = buildGroups(communities, mechanical);
  groups = await time("order", () => orderGroups(groups, hunks));

  const titler = deps.titler ?? new HeuristicTitler();
  await time("title", () => applyTitles(groups, hunks, pairs, titler, input, warnings));

  return {
    title: input.title,
    description: input.description,
    files,
    hunks,
    pairs,
    groups,
    merges,
    timings,
    options: { semantic: !!embedder, titler: titler.name, weights: config.weights, minEdgeWeight: config.minEdgeWeight },
    warnings,
  };
}

function buildGroups(communities: string[][], mechanical: HunkInfo[]): Group[] {
  const groups: Group[] = [];
  const singletons = communities.filter((c) => c.length === 1).flat();
  const clusters = communities.filter((c) => c.length > 1);
  // A PR with a single reviewable hunk is one concern, not "misc".
  if (clusters.length === 0 && singletons.length === 1) clusters.push(singletons.splice(0));
  clusters.forEach((ids, i) => groups.push({ id: `g${i + 1}`, kind: "semantic", hunkIds: ids, title: "", rationale: "" }));
  if (singletons.length > 0) groups.push({ id: "misc", kind: "misc", hunkIds: singletons, title: "", rationale: "" });
  if (mechanical.length > 0) {
    groups.push({ id: "mechanical", kind: "mechanical", hunkIds: mechanical.map((h) => h.hunk.id), title: "", rationale: "" });
  }
  return groups;
}

async function applyTitles(
  groups: Group[],
  hunks: Map<string, HunkInfo>,
  pairs: ReviewResult["pairs"],
  titler: Titler,
  input: PrInput,
  warnings: string[],
): Promise<void> {
  const inputs: TitleInput[] = groups.map((group) => {
    const ids = new Set(group.hunkIds);
    return {
      group,
      hunks: group.hunkIds.map((id) => hunks.get(id)!),
      pairs: pairs.filter((p) => ids.has(p.a) && ids.has(p.b)),
    };
  });
  // Only semantic groups go to a pluggable titler; misc/mechanical always use fixed heuristic labels.
  const semantic = inputs.filter((i) => i.group.kind === "semantic");
  let titles = semantic.map(describeGroup);
  if (titler.name !== "heuristic" && semantic.length > 0) {
    try {
      titles = await titler.title(semantic, { prTitle: input.title, prDescription: input.description });
    } catch (err) {
      warnings.push(`${titler.name} titler failed, fell back to heuristic: ${(err as Error).message}`);
    }
  }
  semantic.forEach((i, k) => Object.assign(i.group, titles[k]));
  for (const i of inputs) if (i.group.kind !== "semantic") Object.assign(i.group, describeGroup(i));
}
